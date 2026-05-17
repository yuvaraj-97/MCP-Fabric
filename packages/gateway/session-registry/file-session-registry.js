import { dirname } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

export class FileSessionRegistry {
  #filePath;
  #now;
  #sessions = new Map();

  constructor({ filePath, now = () => Date.now() } = {}) {
    assertNonEmptyString(filePath, "filePath");
    this.#filePath = filePath;
    this.#now = now;
    this.#loadFromDisk();
  }

  storageKind() {
    return "file";
  }

  isDurable() {
    return true;
  }

  filePath() {
    return this.#filePath;
  }

  assign(sessionId, serverInstanceId, metadata = {}) {
    assertNonEmptyString(sessionId, "sessionId");
    assertNonEmptyString(serverInstanceId, "serverInstanceId");

    const now = this.#now();
    const existing = this.#sessions.get(sessionId);
    const record = {
      sessionId,
      serverInstanceId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      metadata: { ...existing?.metadata, ...metadata },
    };

    this.#sessions.set(sessionId, record);
    this.#persist();
    return cloneRecord(record);
  }

  get(sessionId) {
    assertNonEmptyString(sessionId, "sessionId");
    this.pruneExpired();
    const record = this.#sessions.get(sessionId);
    return record ? cloneRecord(record) : undefined;
  }

  delete(sessionId) {
    assertNonEmptyString(sessionId, "sessionId");
    const deleted = this.#sessions.delete(sessionId);
    this.#persist();
    return deleted;
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

    this.#persist();
    return deleted;
  }

  list() {
    this.pruneExpired();
    return Array.from(this.#sessions.values(), cloneRecord);
  }

  markDisconnected(sessionId, { gracePeriodMs = 0 } = {}) {
    const record = this.get(sessionId);
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

  markReconnected(sessionId) {
    const record = this.get(sessionId);
    if (!record) {
      return undefined;
    }

    return this.assign(sessionId, record.serverInstanceId, {
      connectionState: "active",
      disconnectedAt: null,
      graceUntil: null,
    });
  }

  isExpired(sessionId) {
    return this.get(sessionId) === undefined;
  }

  isWithinGrace(sessionId) {
    const record = this.get(sessionId);
    if (!record) {
      return false;
    }

    return isWithinGrace(record, this.#now());
  }

  pruneExpired() {
    const now = this.#now();
    let deleted = 0;
    for (const [sessionId, record] of this.#sessions.entries()) {
      if (isExpiredRecord(record, now)) {
        this.#sessions.delete(sessionId);
        deleted += 1;
      }
    }

    if (deleted > 0) {
      this.#persist();
    }

    return deleted;
  }

  clear() {
    this.#sessions.clear();
    this.#persist();
  }

  #loadFromDisk() {
    if (!existsSync(this.#filePath)) {
      return;
    }

    const raw = readFileSync(this.#filePath, "utf8");
    if (!raw.trim()) {
      return;
    }

    const parsed = JSON.parse(raw);
    for (const record of parsed.sessions ?? []) {
      if (record?.sessionId && record?.serverInstanceId) {
        this.#sessions.set(record.sessionId, {
          sessionId: record.sessionId,
          serverInstanceId: record.serverInstanceId,
          createdAt: record.createdAt ?? this.#now(),
          updatedAt: record.updatedAt ?? this.#now(),
          metadata: { ...(record.metadata ?? {}) },
        });
      }
    }

    this.pruneExpired();
  }

  #persist() {
    mkdirSync(dirname(this.#filePath), { recursive: true });
    const tmpPath = `${this.#filePath}.tmp`;
    const payload = JSON.stringify(
      {
        version: 1,
        sessions: this.list(),
      },
      null,
      2,
    );
    writeFileSync(tmpPath, payload, "utf8");
    renameSync(tmpPath, this.#filePath);
  }
}

export function removeRegistryFile(filePath) {
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true });
  }
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
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}
