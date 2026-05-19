import assert from "node:assert/strict";
import test from "node:test";

import { createSessionRegistry } from "../../packages/gateway/session-registry/create-session-registry.js";

test("createSessionRegistry selects the memory backend by default", () => {
  const registry = createSessionRegistry();

  assert.equal(registry.storageKind(), "memory");
  assert.equal(registry.isDurable(), false);
});

test("createSessionRegistry creates a redis registry when configured", () => {
  const registry = createSessionRegistry({
    backend: "redis",
    redisClient: createFakeRedisClient(),
    redisKey: "mcp:test:sessions",
  });

  assert.equal(registry.storageKind(), "redis");
  assert.equal(registry.redisKey(), "mcp:test:sessions");
});

test("createSessionRegistry requires a file path for the file backend", () => {
  assert.throws(
    () => createSessionRegistry({ backend: "file" }),
    /filePath is required when sessionRegistryBackend=file/,
  );
});

function createFakeRedisClient() {
  const store = new Map();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
      return "OK";
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
  };
}
