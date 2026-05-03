export class MemorySessionRegistry {
  #sessions = new Map();

  assign(sessionId, serverInstanceId, metadata = {}) {
    assertNonEmptyString(sessionId, "sessionId");
    assertNonEmptyString(serverInstanceId, "serverInstanceId");

    const now = Date.now();
    const existing = this.#sessions.get(sessionId);
    const record = {
      sessionId,
      serverInstanceId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      metadata: { ...existing?.metadata, ...metadata },
    };

    this.#sessions.set(sessionId, record);
    return { ...record, metadata: { ...record.metadata } };
  }

  get(sessionId) {
    assertNonEmptyString(sessionId, "sessionId");

    const record = this.#sessions.get(sessionId);
    if (!record) {
      return undefined;
    }

    return { ...record, metadata: { ...record.metadata } };
  }

  delete(sessionId) {
    assertNonEmptyString(sessionId, "sessionId");
    return this.#sessions.delete(sessionId);
  }

  deleteByServer(serverInstanceId) {
    assertNonEmptyString(serverInstanceId, "serverInstanceId");

    let deleted = 0;
    for (const [sessionId, record] of this.#sessions.entries()) {
      if (record.serverInstanceId === serverInstanceId) {
        this.#sessions.delete(sessionId);
        deleted += 1;
      }
    }

    return deleted;
  }

  list() {
    return Array.from(this.#sessions.values(), (record) => ({
      ...record,
      metadata: { ...record.metadata },
    }));
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}
