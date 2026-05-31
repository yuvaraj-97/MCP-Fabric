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

test("redis session registry writes independent session keys to avoid concurrent lost updates", async () => {
  const client = createFakeRedisClient({
    beforeGet: createBarrier({ count: 2 }),
  });
  const registry = new RedisSessionRegistry({ client, key: "sessions:test" });

  await Promise.all([
    registry.assign("session-1", "server-a"),
    registry.assign("session-2", "server-b"),
  ]);

  assert.equal((await registry.get("session-1")).serverInstanceId, "server-a");
  assert.equal((await registry.get("session-2")).serverInstanceId, "server-b");
  assert.deepEqual(client.keysWritten().sort(), [
    "sessions:test:session:session-1",
    "sessions:test:session:session-2",
  ]);
});

test("redis session registry uses native redis ttl when expiresAt metadata exists", async () => {
  const clock = createClock();
  const client = createFakeRedisClient({ now: clock.now });
  const registry = new RedisSessionRegistry({
    client,
    key: "sessions:test",
    now: clock.now,
  });

  await registry.assign("session-ttl", "server-a", { expiresAt: clock.now() + 100 });

  assert.deepEqual(client.setCalls[0], {
    key: "sessions:test:session:session-ttl",
    mode: "PX",
    ttlMs: 100,
  });
  assert.equal((await registry.get("session-ttl")).serverInstanceId, "server-a");

  clock.advance(101);

  assert.equal(await registry.get("session-ttl"), undefined);
  assert.equal((await registry.list()).length, 0);
});

test("redis session registry connects lazy clients before issuing commands", async () => {
  const client = createFakeRedisClient();
  let connectCalls = 0;
  client.status = "wait";
  client.connect = async () => {
    connectCalls += 1;
    client.status = "ready";
  };

  const registry = new RedisSessionRegistry({ client, key: "sessions:test" });

  await registry.assign("session-1", "server-a");
  assert.equal((await registry.get("session-1")).serverInstanceId, "server-a");
  assert.equal(connectCalls, 1);
});

test("redis session registry connects clients that expose connect without status", async () => {
  const client = createFakeRedisClient();
  let connected = false;
  client.connect = async () => {
    connected = true;
  };

  const registry = new RedisSessionRegistry({ client, key: "sessions:test" });

  await registry.assign("session-1", "server-a");
  assert.equal(connected, true);
});

test("redis session registry can read and migrate legacy aggregate state", async () => {
  const client = createFakeRedisClient();
  await client.set(
    "sessions:test",
    JSON.stringify({
      version: 1,
      sessions: {
        "legacy-session": {
          sessionId: "legacy-session",
          serverInstanceId: "server-a",
          createdAt: 1,
          updatedAt: 1,
          metadata: { clientId: "legacy-client" },
        },
      },
    }),
  );
  const registry = new RedisSessionRegistry({ client, key: "sessions:test" });

  const record = await registry.get("legacy-session");

  assert.equal(record.serverInstanceId, "server-a");
  assert.equal(record.metadata.clientId, "legacy-client");
  assert.deepEqual(client.keysWritten(), ["sessions:test:session:legacy-session"]);
});

function createFakeRedisClient({ now = () => Date.now(), beforeGet } = {}) {
  const store = new Map();
  const expiresAt = new Map();
  const client = {
    setCalls: [],
    keysWritten() {
      return Array.from(store.keys());
    },
    async get(key) {
      await beforeGet?.(key);
      expireKey(key);
      return store.get(key) ?? null;
    },
    async set(key, value, mode, ttlMs) {
      store.set(key, value);
      if (mode === "PX") {
        expiresAt.set(key, now() + ttlMs);
        client.setCalls.push({ key, mode, ttlMs });
      } else {
        expiresAt.delete(key);
        client.setCalls.push({ key });
      }
      return "OK";
    },
    async del(...keys) {
      let deleted = 0;
      for (const key of keys) {
        expireKey(key);
        if (store.delete(key)) {
          deleted += 1;
        }
        expiresAt.delete(key);
      }
      return deleted;
    },
    async keys(pattern) {
      const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
      for (const key of store.keys()) {
        expireKey(key);
      }
      return Array.from(store.keys()).filter((key) => key.startsWith(prefix));
    },
  };

  return client;

  function expireKey(key) {
    const expiry = expiresAt.get(key);
    if (expiry !== undefined && expiry <= now()) {
      store.delete(key);
      expiresAt.delete(key);
    }
  }
}

function createBarrier({ count }) {
  let pending = 0;
  let release;
  const ready = new Promise((resolve) => {
    release = resolve;
  });

  return async function waitForConcurrentGets() {
    pending += 1;
    if (pending >= count) {
      release();
    }

    await ready;
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
