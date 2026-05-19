export class RedisSessionRegistry {
  #client;
  #closeClientOnClose;
  #key;
  #now;

  constructor({
    client,
    closeClientOnClose = false,
    key = "mcp:gateway:sessions",
    now = () => Date.now(),
  } = {}) {
    if (!client || typeof client.get !== "function" || typeof client.set !== "function") {
      throw new TypeError("client must provide async get and set methods");
    }
    assertNonEmptyString(key, "key");

    this.#client = client;
    this.#closeClientOnClose = closeClientOnClose;
    this.#key = key;
    this.#now = now;
  }

  storageKind() {
    return "redis";
  }

  isDurable() {
    return true;
  }

  redisKey() {
    return this.#key;
  }

  async assign(sessionId, serverInstanceId, metadata = {}) {
    assertNonEmptyString(sessionId, "sessionId");
    assertNonEmptyString(serverInstanceId, "serverInstanceId");

    const state = await this.#readState();
    const now = this.#now();
    const existing = state.sessions[sessionId];
    const record = {
      sessionId,
      serverInstanceId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      metadata: {
        ...existing?.metadata,
        ...metadata,
      },
    };

    state.sessions[sessionId] = record;
    await this.#writeState(state);
    return cloneRecord(record);
  }

  async get(sessionId) {
    assertNonEmptyString(sessionId, "sessionId");

    const state = await this.#readState();
    const record = state.sessions[sessionId];
    if (!record) {
      return undefined;
    }

    if (isExpiredRecord(record, this.#now())) {
      delete state.sessions[sessionId];
      await this.#writeState(state);
      return undefined;
    }

    return cloneRecord(record);
  }

  async delete(sessionId) {
    assertNonEmptyString(sessionId, "sessionId");

    const state = await this.#readState();
    const existed = Boolean(state.sessions[sessionId]);
    delete state.sessions[sessionId];
    await this.#writeState(state);
    return existed;
  }

  async deleteByServer(serverInstanceId) {
    assertNonEmptyString(serverInstanceId, "serverInstanceId");

    const state = await this.#readState();
    let deleted = 0;
    for (const [sessionId, record] of Object.entries(state.sessions)) {
      if (record.serverInstanceId === serverInstanceId) {
        delete state.sessions[sessionId];
        deleted += 1;
      }
    }

    await this.#writeState(state);
    return deleted;
  }

  async list() {
    const state = await this.#readState();
    const now = this.#now();
    let deleted = 0;
    for (const [sessionId, record] of Object.entries(state.sessions)) {
      if (isExpiredRecord(record, now)) {
        delete state.sessions[sessionId];
        deleted += 1;
      }
    }

    if (deleted > 0) {
      await this.#writeState(state);
    }

    return Object.values(state.sessions).map(cloneRecord);
  }

  async markDisconnected(sessionId, { gracePeriodMs = 0 } = {}) {
    const record = await this.get(sessionId);
    if (!record) {
      return undefined;
    }

    const now = this.#now();
    return this.assign(sessionId, record.serverInstanceId, {
      connectionState: "disconnected",
      disconnectedAt: now,
      graceUntil: gracePeriodMs > 0 ? now + gracePeriodMs : now,
    });
  }

  async markReconnected(sessionId) {
    const record = await this.get(sessionId);
    if (!record) {
      return undefined;
    }

    return this.assign(sessionId, record.serverInstanceId, {
      connectionState: "active",
      disconnectedAt: null,
      graceUntil: null,
    });
  }

  async isExpired(sessionId) {
    return (await this.get(sessionId)) === undefined;
  }

  async isWithinGrace(sessionId) {
    const record = await this.get(sessionId);
    if (!record) {
      return false;
    }

    return isWithinGrace(record, this.#now());
  }

  async pruneExpired() {
    const state = await this.#readState();
    const now = this.#now();
    let deleted = 0;
    for (const [sessionId, record] of Object.entries(state.sessions)) {
      if (isExpiredRecord(record, now)) {
        delete state.sessions[sessionId];
        deleted += 1;
      }
    }

    if (deleted > 0) {
      await this.#writeState(state);
    }

    return deleted;
  }

  async clear() {
    await this.#client.del?.(this.#key);
    if (typeof this.#client.del !== "function") {
      await this.#writeState({ version: 1, sessions: {} });
    }
  }

  async close() {
    if (!this.#closeClientOnClose) {
      return;
    }

    if (typeof this.#client.quit === "function") {
      await this.#client.quit();
      return;
    }

    if (typeof this.#client.disconnect === "function") {
      this.#client.disconnect();
    }
  }

  async #readState() {
    const raw = await this.#client.get(this.#key);
    if (!raw) {
      return {
        version: 1,
        sessions: {},
      };
    }

    return normalizeState(JSON.parse(raw));
  }

  async #writeState(state) {
    await this.#client.set(this.#key, JSON.stringify(normalizeState(state)));
  }
}

function normalizeState(state) {
  const inputSessions =
    state?.sessions && typeof state.sessions === "object" ? state.sessions : {};
  const sessions = {};

  for (const [sessionId, record] of Object.entries(inputSessions)) {
    if (!sessionId || !record?.serverInstanceId) {
      continue;
    }

    sessions[sessionId] = {
      sessionId,
      serverInstanceId: String(record.serverInstanceId),
      createdAt: Number(record.createdAt ?? 0),
      updatedAt: Number(record.updatedAt ?? 0),
      metadata:
        record.metadata && typeof record.metadata === "object"
          ? { ...record.metadata }
          : {},
    };
  }

  return {
    version: 1,
    sessions,
  };
}

function cloneRecord(record) {
  return {
    ...record,
    metadata: { ...record.metadata },
  };
}

function isExpiredRecord(record, now) {
  return typeof record?.metadata?.expiresAt === "number" && record.metadata.expiresAt <= now;
}

function isWithinGrace(record, now) {
  return (
    record?.metadata?.connectionState === "disconnected" &&
    typeof record?.metadata?.graceUntil === "number" &&
    record.metadata.graceUntil >= now
  );
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}
