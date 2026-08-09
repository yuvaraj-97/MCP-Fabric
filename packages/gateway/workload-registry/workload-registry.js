import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import { createIoredisClient } from "../session-registry/ioredis-client.js";

export function createWorkloadRegistry({
  backend = "memory",
  filePath,
  now = () => Date.now(),
  redisClient,
  redisKey = "mcp:gateway:workloads",
  redisUrl,
  redisClientFactory = createIoredisClient,
} = {}) {
  if (backend === "memory") {
    return new MemoryWorkloadRegistry({ now });
  }

  if (backend === "file") {
    if (!filePath) {
      throw new TypeError("filePath is required for file-backed WorkloadRegistry");
    }
    return new FileWorkloadRegistry({ filePath, now });
  }

  if (backend === "redis") {
    return new RedisWorkloadRegistry({
      client:
        redisClient ??
        redisClientFactory({
          url: redisUrl,
        }),
      key: redisKey,
      now,
      closeClientOnClose: redisClient === undefined,
    });
  }

  throw new RangeError(`Unsupported workload registry backend: ${backend}`);
}

class MemoryWorkloadRegistry {
  #now;
  #workloads = new Map();

  constructor({ now = () => Date.now() } = {}) {
    this.#now = now;
  }

  storageKind() {
    return "memory";
  }

  isDurable() {
    return false;
  }

  create(id, { kind, serverInstanceId, expiresAt, recoveryPolicy = "default", metadata = {} }) {
    assertNonEmptyString(id, "id");
    assertNonEmptyString(serverInstanceId, "serverInstanceId");

    const timeNow = this.#now();
    const record = {
      id,
      kind: kind || "unknown",
      serverInstanceId,
      createdAt: timeNow,
      updatedAt: timeNow,
      expiresAt: expiresAt || (timeNow + 3600000), // Default 1hr TTL
      recoveryPolicy,
      metadata: { ...metadata },
    };

    this.#workloads.set(id, record);
    return cloneRecord(record);
  }

  get(id) {
    assertNonEmptyString(id, "id");
    const record = this.#workloads.get(id);
    if (!record) {
      return undefined;
    }

    if (record.expiresAt && record.expiresAt <= this.#now()) {
      this.#workloads.delete(id);
      return undefined;
    }

    return cloneRecord(record);
  }

  update(id, metadata = {}) {
    assertNonEmptyString(id, "id");
    const record = this.#workloads.get(id);
    if (!record) {
      throw new Error(`Workload with id ${id} not found`);
    }

    record.updatedAt = this.#now();
    record.metadata = { ...record.metadata, ...metadata };
    return cloneRecord(record);
  }

  delete(id) {
    assertNonEmptyString(id, "id");
    return this.#workloads.delete(id);
  }

  deleteByServer(serverInstanceId) {
    assertNonEmptyString(serverInstanceId, "serverInstanceId");
    let deleted = 0;
    for (const [id, record] of this.#workloads.entries()) {
      if (record.serverInstanceId === serverInstanceId) {
        this.#workloads.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  reassign(id, serverInstanceId) {
    assertNonEmptyString(id, "id");
    assertNonEmptyString(serverInstanceId, "serverInstanceId");
    const record = this.#workloads.get(id);
    if (!record) {
      throw new Error(`Workload with id ${id} not found`);
    }

    record.serverInstanceId = serverInstanceId;
    record.updatedAt = this.#now();
    return cloneRecord(record);
  }

  touch(id, ttlMs = 3600000) {
    assertNonEmptyString(id, "id");
    const record = this.#workloads.get(id);
    if (!record) {
      return false;
    }

    const timeNow = this.#now();
    record.updatedAt = timeNow;
    record.expiresAt = timeNow + ttlMs;
    return true;
  }

  list() {
    const timeNow = this.#now();
    const result = [];
    for (const record of this.#workloads.values()) {
      if (record.expiresAt && record.expiresAt <= timeNow) {
        this.#workloads.delete(record.id);
      } else {
        result.push(cloneRecord(record));
      }
    }
    return result;
  }

  pruneExpired() {
    const timeNow = this.#now();
    let deleted = 0;
    for (const [id, record] of this.#workloads.entries()) {
      if (record.expiresAt && record.expiresAt <= timeNow) {
        this.#workloads.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  clear() {
    this.#workloads.clear();
  }
}

class RedisWorkloadRegistry {
  #client;
  #key;
  #now;
  #closeClientOnClose;
  #connectPromise = null;

  constructor({
    client,
    closeClientOnClose = false,
    key = "mcp:gateway:workloads",
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

  async #ensureConnected() {
    if (this.#connectPromise) {
      return this.#connectPromise;
    }
    if (this.#client.status === "ready" || this.#client.status === "connecting") {
      return;
    }
    if (typeof this.#client.connect !== "function") {
      return;
    }
    this.#connectPromise = this.#client.connect().catch(() => {
      this.#connectPromise = null;
    });
    return this.#connectPromise;
  }

  #workloadKey(id) {
    return `${this.#key}:${id}`;
  }

  async create(id, { kind, serverInstanceId, expiresAt, recoveryPolicy = "default", metadata = {} }) {
    assertNonEmptyString(id, "id");
    assertNonEmptyString(serverInstanceId, "serverInstanceId");
    await this.#ensureConnected();

    const timeNow = this.#now();
    const record = {
      id,
      kind: kind || "unknown",
      serverInstanceId,
      createdAt: timeNow,
      updatedAt: timeNow,
      expiresAt: expiresAt || (timeNow + 3600000),
      recoveryPolicy,
      metadata: { ...metadata },
    };

    await this.#writeRecord(record);
    return cloneRecord(record);
  }

  async get(id) {
    assertNonEmptyString(id, "id");
    const record = await this.#readRecord(id);
    if (!record) {
      return undefined;
    }

    if (record.expiresAt && record.expiresAt <= this.#now()) {
      await this.#deleteRecord(id);
      return undefined;
    }

    return cloneRecord(record);
  }

  async update(id, metadata = {}) {
    assertNonEmptyString(id, "id");
    const record = await this.#readRecord(id);
    if (!record) {
      throw new Error(`Workload with id ${id} not found`);
    }

    record.updatedAt = this.#now();
    record.metadata = { ...record.metadata, ...metadata };
    await this.#writeRecord(record);
    return cloneRecord(record);
  }

  async delete(id) {
    assertNonEmptyString(id, "id");
    const key = this.#workloadKey(id);
    const existed = (await this.#client.get(key)) !== null;
    await this.#deleteRecord(id);
    return existed;
  }

  async deleteByServer(serverInstanceId) {
    assertNonEmptyString(serverInstanceId, "serverInstanceId");
    let deleted = 0;
    const records = await this.#readAllRecords();
    for (const record of records) {
      if (record.serverInstanceId === serverInstanceId) {
        await this.#deleteRecord(record.id);
        deleted++;
      }
    }
    return deleted;
  }

  async reassign(id, serverInstanceId) {
    assertNonEmptyString(id, "id");
    assertNonEmptyString(serverInstanceId, "serverInstanceId");
    const record = await this.#readRecord(id);
    if (!record) {
      throw new Error(`Workload with id ${id} not found`);
    }

    record.serverInstanceId = serverInstanceId;
    record.updatedAt = this.#now();
    await this.#writeRecord(record);
    return cloneRecord(record);
  }

  async touch(id, ttlMs = 3600000) {
    assertNonEmptyString(id, "id");
    const record = await this.#readRecord(id);
    if (!record) {
      return false;
    }

    const timeNow = this.#now();
    record.updatedAt = timeNow;
    record.expiresAt = timeNow + ttlMs;
    await this.#writeRecord(record);
    return true;
  }

  async list() {
    const timeNow = this.#now();
    const records = await this.#readAllRecords();
    const result = [];
    for (const record of records) {
      if (record.expiresAt && record.expiresAt <= timeNow) {
        await this.#deleteRecord(record.id);
      } else {
        result.push(cloneRecord(record));
      }
    }
    return result;
  }

  async pruneExpired() {
    const timeNow = this.#now();
    let deleted = 0;
    const records = await this.#readAllRecords();
    for (const record of records) {
      if (record.expiresAt && record.expiresAt <= timeNow) {
        await this.#deleteRecord(record.id);
        deleted++;
      }
    }
    return deleted;
  }

  async clear() {
    const keys = await this.#listKeys();
    if (keys.length > 0 && typeof this.#client.del === "function") {
      await this.#client.del(...keys);
    } else {
      await Promise.all(keys.map((k) => this.#client.set(k, "")));
    }
  }

  async close() {
    if (!this.#closeClientOnClose) {
      return;
    }
    if (typeof this.#client.quit === "function") {
      await this.#client.quit();
    } else if (typeof this.#client.disconnect === "function") {
      this.#client.disconnect();
    }
  }

  async #readRecord(id) {
    await this.#ensureConnected();
    const key = this.#workloadKey(id);
    const data = await this.#client.get(key);
    if (!data) return undefined;
    try {
      return JSON.parse(data);
    } catch {
      return undefined;
    }
  }

  async #writeRecord(record) {
    await this.#ensureConnected();
    const key = this.#workloadKey(record.id);
    const payload = JSON.stringify(record);
    const ttlMs = record.expiresAt - this.#now();
    if (ttlMs > 0) {
      await this.#client.set(key, payload, "PX", ttlMs);
    } else {
      await this.#client.set(key, payload);
    }
  }

  async #deleteRecord(id) {
    await this.#ensureConnected();
    const key = this.#workloadKey(id);
    if (typeof this.#client.del === "function") {
      await this.#client.del(key);
    } else {
      await this.#client.set(key, "");
    }
  }

  async #listKeys() {
    await this.#ensureConnected();
    if (typeof this.#client.keys === "function") {
      return await this.#client.keys(`${this.#key}:*`);
    }
    return [];
  }

  async #readAllRecords() {
    const keys = await this.#listKeys();
    const records = [];
    for (const key of keys) {
      const data = await this.#client.get(key);
      if (data) {
        try {
          records.push(JSON.parse(data));
        } catch {}
      }
    }
    return records;
  }
}

function cloneRecord(record) {
  return {
    ...record,
    metadata: { ...record.metadata },
  };
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

class FileWorkloadRegistry {
  #filePath;
  #now;
  #workloads = new Map();
  #writePromise = Promise.resolve();
  #writeScheduled = false;
  #writeQueued = false;
  #writeSequence = 0;
  #persistError;

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

  async create(id, { kind, serverInstanceId, expiresAt, recoveryPolicy = "default", metadata = {} }) {
    assertNonEmptyString(id, "id");
    assertNonEmptyString(serverInstanceId, "serverInstanceId");

    const timeNow = this.#now();
    const record = {
      id,
      kind: kind || "unknown",
      serverInstanceId,
      createdAt: timeNow,
      updatedAt: timeNow,
      expiresAt: expiresAt || (timeNow + 3600000),
      recoveryPolicy,
      metadata: { ...metadata },
    };

    this.#workloads.set(id, record);
    this.#persist();
    return cloneRecord(record);
  }

  async get(id) {
    assertNonEmptyString(id, "id");
    this.pruneExpired();
    const record = this.#workloads.get(id);
    return record ? cloneRecord(record) : undefined;
  }

  async update(id, updates = {}) {
    assertNonEmptyString(id, "id");
    this.pruneExpired();
    const existing = this.#workloads.get(id);
    if (!existing) {
      throw new Error(`Workload not found: ${id}`);
    }

    const timeNow = this.#now();
    const record = {
      ...existing,
      ...updates,
      metadata: { ...existing.metadata, ...updates.metadata },
      updatedAt: timeNow,
    };

    this.#workloads.set(id, record);
    this.#persist();
    return cloneRecord(record);
  }

  async delete(id) {
    assertNonEmptyString(id, "id");
    const deleted = this.#workloads.delete(id);
    if (deleted) {
      this.#persist();
    }
    return deleted;
  }

  async reassign(id, serverInstanceId) {
    assertNonEmptyString(id, "id");
    assertNonEmptyString(serverInstanceId, "serverInstanceId");
    return this.update(id, { serverInstanceId });
  }

  async touch(id, expiresAt) {
    assertNonEmptyString(id, "id");
    return this.update(id, { expiresAt });
  }

  async list() {
    this.pruneExpired();
    return Array.from(this.#workloads.values(), cloneRecord);
  }

  pruneExpired() {
    const timeNow = this.#now();
    for (const [id, record] of this.#workloads.entries()) {
      if (record.expiresAt <= timeNow) {
        this.#workloads.delete(id);
      }
    }
    this.#persist();
  }

  async prune() {
    this.pruneExpired();
  }

  async close() {
    await this.flush();
  }

  async flush() {
    await this.#writePromise;
    if (this.#persistError) {
      throw this.#persistError;
    }
  }

  #loadFromDisk() {
    if (!existsSync(this.#filePath)) {
      return;
    }

    const raw = readFileSync(this.#filePath, "utf8");
    if (!raw.trim()) {
      return;
    }

    try {
      const state = JSON.parse(raw);
      for (const record of state.workloads ?? []) {
        if (record?.id && record?.serverInstanceId) {
          this.#workloads.set(record.id, record);
        }
      }
      this.pruneExpired();
    } catch {}
  }

  #persist() {
    if (this.#writeScheduled) {
      this.#writeQueued = true;
      return;
    }

    this.#writeScheduled = true;
    this.#writePromise = this.#writePromise
      .catch(() => undefined)
      .then(() => this.#drainPersistQueue());
    this.#writePromise.catch(() => undefined);
  }

  #snapshot() {
    return {
      version: 1,
      workloads: Array.from(this.#workloads.values(), cloneRecord),
    };
  }

  async #drainPersistQueue() {
    try {
      do {
        this.#writeQueued = false;
        await this.#writeState(this.#snapshot());
      } while (this.#writeQueued);
    } finally {
      this.#writeScheduled = false;
    }
  }

  async #writeState(state) {
    const tmpPath = `${this.#filePath}.${process.pid}.${++this.#writeSequence}.tmp`;
    const payload = JSON.stringify(state, null, 2);

    try {
      await fs.mkdir(dirname(this.#filePath), { recursive: true });
      await fs.writeFile(tmpPath, payload, "utf8");
      await fs.rename(tmpPath, this.#filePath);
      this.#persistError = undefined;
    } catch (error) {
      this.#persistError = error;
      throw error;
    } finally {
      await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    }
  }
}
