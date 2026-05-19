import assert from "node:assert/strict";
import test from "node:test";

import { createIoredisClient } from "../../packages/gateway/session-registry/ioredis-client.js";

test("createIoredisClient instantiates a Redis client with the provided URL", () => {
  const calls = [];

  class FakeRedis {
    constructor(url, options) {
      calls.push({ url, options });
      this.url = url;
      this.options = options;
    }
  }

  const client = createIoredisClient({
    url: "redis://127.0.0.1:6379",
    RedisCtor: FakeRedis,
    options: { connectTimeout: 500 },
  });

  assert.equal(client.url, "redis://127.0.0.1:6379");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.lazyConnect, true);
  assert.equal(calls[0].options.enableOfflineQueue, false);
  assert.equal(calls[0].options.maxRetriesPerRequest, 1);
  assert.equal(calls[0].options.connectTimeout, 500);
});

test("createIoredisClient requires a redis URL", () => {
  assert.throws(() => createIoredisClient(), /redisUrl is required/);
});
