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

    const now = this.#now();
    const existing = await this.#readRecord(sessionId);
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

    await this.#writeRecord(record);
    return cloneRecord(record);
  }

  async get(sessionId) {
    assertNonEmptyString(sessionId, "sessionId");

    const record = await this.#readRecord(sessionId);
    if (!record) {
      return undefined;
    }

    if (isExpiredRecord(record, this.#now())) {
      await this.#deleteRecord(sessionId);
      return undefined;
    }

    return cloneRecord(record);
  }

  async delete(sessionId) {
    assertNonEmptyString(sessionId, "sessionId");

    const existed = (await this.#readRecord(sessionId)) !== undefined;
    await this.#deleteRecord(sessionId);
    return existed;
  }

  async deleteByServer(serverInstanceId) {
    assertNonEmptyString(serverInstanceId, "serverInstanceId");

    let deleted = 0;
    for (const record of await this.#readAllRecords()) {
      if (record.serverInstanceId === serverInstanceId) {
        await this.#deleteRecord(record.sessionId);
        deleted += 1;
      }
    }

    return deleted;
  }

  async list() {
    const now = this.#now();
    const records = [];
    for (const record of await this.#readAllRecords()) {
      if (isExpiredRecord(record, now)) {
        await this.#deleteRecord(record.sessionId);
        continue;
      }

      records.push(record);
    }

    return records.map(cloneRecord);
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
    const now = this.#now();
    let deleted = 0;
    for (const record of await this.#readAllRecords()) {
      if (isExpiredRecord(record, now)) {
        await this.#deleteRecord(record.sessionId);
        deleted += 1;
      }
    }

    return deleted;
  }

  async clear() {
    const keys = await this.#listSessionKeys();
    if (keys.length > 0 && typeof this.#client.del === "function") {
      await this.#client.del(...keys);
    } else {
      await Promise.all(keys.map((key) => this.#client.set(key, "")));
    }

    await this.#deleteKey(this.#key);
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

  async #readRecord(sessionId) {
    const key = this.#sessionKey(sessionId);
    const record = normalizeRecord(JSON.parse((await this.#client.get(key)) || "null"), sessionId);
    if (record) {
      return record;
    }

    return this.#readLegacyRecord(sessionId);
  }

  async #readRecordByKey(key) {
    const raw = await this.#client.get(key);
    if (!raw) {
      return undefined;
    }

    return normalizeRecord(JSON.parse(raw));
  }

  async #readAllRecords() {
    const records = new Map();
    for (const key of await this.#listSessionKeys()) {
      const record = await this.#readRecordByKey(key);
      if (record) {
        records.set(record.sessionId, record);
      }
    }

    for (const record of Object.values(await this.#migrateLegacyState())) {
      if (!records.has(record.sessionId)) {
        records.set(record.sessionId, record);
      }
    }

    return Array.from(records.values());
  }

  async #writeRecord(record) {
    const normalized = normalizeRecord(record);
    if (!normalized) {
      return;
    }

    const ttlMs = ttlFromRecord(normalized, this.#now());
    if (ttlMs !== undefined && ttlMs <= 0) {
      await this.#deleteRecord(normalized.sessionId);
      return;
    }

    const key = this.#sessionKey(normalized.sessionId);
    const payload = JSON.stringify(normalized);
    if (ttlMs !== undefined) {
      await this.#client.set(key, payload, "PX", ttlMs);
      return;
    }

    await this.#client.set(key, payload);
  }

  async #deleteRecord(sessionId) {
    await this.#deleteKey(this.#sessionKey(sessionId));
  }

  async #deleteKey(key) {
    if (typeof this.#client.del === "function") {
      await this.#client.del(key);
      return;
    }

    await this.#client.set(key, "");
  }

  async #listSessionKeys() {
    const pattern = `${this.#key}:session:*`;
    if (typeof this.#client.scan === "function") {
      const keys = [];
      let cursor = "0";
      do {
        const [nextCursor, batch] = await this.#client.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = String(nextCursor);
        keys.push(...batch);
      } while (cursor !== "0");
      return keys;
    }

    if (typeof this.#client.keys === "function") {
      return this.#client.keys(pattern);
    }

    return [];
  }

  async #readLegacyRecord(sessionId) {
    const state = await this.#migrateLegacyState();
    return state[sessionId];
  }

  async #migrateLegacyState() {
    const raw = await this.#client.get(this.#key);
    if (!raw) {
      return {};
    }

    const sessions = normalizeState(JSON.parse(raw)).sessions;
    for (const record of Object.values(sessions)) {
      await this.#writeRecord(record);
    }
    await this.#deleteKey(this.#key);
    return sessions;
  }

  #sessionKey(sessionId) {
    return `${this.#key}:session:${encodeURIComponent(sessionId)}`;
  }
}

function normalizeRecord(record, expectedSessionId) {
  const sessionId = String(expectedSessionId ?? record?.sessionId ?? "");
  if (!sessionId || !record?.serverInstanceId) {
    return undefined;
  }

  return {
    sessionId,
    serverInstanceId: String(record.serverInstanceId),
    createdAt: Number(record.createdAt ?? 0),
    updatedAt: Number(record.updatedAt ?? 0),
    metadata:
      record.metadata && typeof record.metadata === "object" ? { ...record.metadata } : {},
  };
}

function normalizeState(state) {
  const inputSessions =
    state?.sessions && typeof state.sessions === "object" ? state.sessions : {};
  const sessions = {};

  for (const [sessionId, record] of Object.entries(inputSessions)) {
    const normalized = normalizeRecord(record, sessionId);
    if (normalized) {
      sessions[sessionId] = normalized;
    }
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

function ttlFromRecord(record, now) {
  if (typeof record?.metadata?.expiresAt !== "number") {
    return undefined;
  }

  return record.metadata.expiresAt - now;
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
