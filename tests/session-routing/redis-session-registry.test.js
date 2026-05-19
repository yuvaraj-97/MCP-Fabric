import assert from "node:assert/strict";
import test from "node:test";

import { RedisSessionRegistry } from "../../packages/gateway/session-registry/redis-session-registry.js";

test("redis session registry persists mappings across instances sharing the same client", async () => {
  const client = createFakeRedisClient();
  const first = new RedisSessionRegistry({ client, key: "sessions:test" });

  await first.assign("session-1", "server-a", { clientId: "client-a" });

  const second = new RedisSessionRegistry({ client, key: "sessions:test" });
  const record = await second.get("session-1");

  assert.equal(second.storageKind(), "redis");
  assert.equal(second.isDurable(), true);
  assert.equal(second.redisKey(), "sessions:test");
  assert.equal(record.serverInstanceId, "server-a");
  assert.equal(record.metadata.clientId, "client-a");
});

test("redis session registry delete persists across instances", async () => {
  const client = createFakeRedisClient();
  const first = new RedisSessionRegistry({ client });

  await first.assign("session-1", "server-a");
  await first.delete("session-1");

  const second = new RedisSessionRegistry({ client });
  assert.equal(await second.get("session-1"), undefined);
});

test("redis session registry prunes expired sessions on reload", async () => {
  const clock = createClock();
  const client = createFakeRedisClient();
  const first = new RedisSessionRegistry({ client, now: clock.now });

  await first.assign("session-expired", "server-a", { expiresAt: clock.now() + 100 });
  clock.advance(101);

  const second = new RedisSessionRegistry({ client, now: clock.now });
  assert.equal(await second.get("session-expired"), undefined);
  assert.equal((await second.list()).length, 0);
});

test("redis session registry preserves disconnect grace metadata across instances", async () => {
  const clock = createClock();
  const client = createFakeRedisClient();
  const first = new RedisSessionRegistry({ client, now: clock.now });

  await first.assign("session-grace", "server-a", { expiresAt: clock.now() + 5_000 });
  await first.markDisconnected("session-grace", { gracePeriodMs: 300 });

  const second = new RedisSessionRegistry({ client, now: clock.now });
  const record = await second.get("session-grace");

  assert.equal(record.metadata.connectionState, "disconnected");
  assert.equal(record.metadata.graceUntil, clock.now() + 300);
  assert.equal(await second.isWithinGrace("session-grace"), true);
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

function createClock(start = 1_700_000_000_000) {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
      return current;
    },
  };
}
