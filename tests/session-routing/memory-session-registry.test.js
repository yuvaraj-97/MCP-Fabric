import assert from "node:assert/strict";
import test from "node:test";

import { MemorySessionRegistry } from "../../packages/gateway/session-registry/memory-session-registry.js";

test("assign stores a new session mapping", () => {
  const registry = new MemorySessionRegistry();

  const record = registry.assign("session-1", "server-a", { user: "demo" });

  assert.equal(record.sessionId, "session-1");
  assert.equal(record.serverInstanceId, "server-a");
  assert.equal(record.metadata.user, "demo");
});

test("assign preserves createdAt and merges metadata on reassignment", async () => {
  const registry = new MemorySessionRegistry();

  const first = registry.assign("session-1", "server-a", { region: "apac" });
  await new Promise((resolve) => setTimeout(resolve, 2));
  const second = registry.assign("session-1", "server-b", { owner: "gateway" });

  assert.equal(second.createdAt, first.createdAt);
  assert.notEqual(second.updatedAt, first.updatedAt);
  assert.equal(second.serverInstanceId, "server-b");
  assert.deepEqual(second.metadata, {
    region: "apac",
    owner: "gateway",
  });
});

test("delete removes one session mapping", () => {
  const registry = new MemorySessionRegistry();
  registry.assign("session-1", "server-a");

  assert.equal(registry.delete("session-1"), true);
  assert.equal(registry.get("session-1"), undefined);
});

test("deleteByServer removes every session for one instance", () => {
  const registry = new MemorySessionRegistry();
  registry.assign("session-1", "server-a");
  registry.assign("session-2", "server-a");
  registry.assign("session-3", "server-b");

  const deleted = registry.deleteByServer("server-a");

  assert.equal(deleted, 2);
  assert.equal(registry.get("session-1"), undefined);
  assert.equal(registry.get("session-2"), undefined);
  assert.equal(registry.get("session-3").serverInstanceId, "server-b");
});

test("list and get return defensive copies", () => {
  const registry = new MemorySessionRegistry();
  registry.assign("session-1", "server-a", { state: "live" });

  const fetched = registry.get("session-1");
  fetched.metadata.state = "mutated";
  const listed = registry.list();
  listed[0].metadata.state = "changed";

  assert.equal(registry.get("session-1").metadata.state, "live");
});

test("memory registry reports non-durable storage", () => {
  const registry = new MemorySessionRegistry();

  assert.equal(registry.storageKind(), "memory");
  assert.equal(registry.isDurable(), false);
});

test("expired sessions are pruned from the memory registry", () => {
  const clock = createClock();
  const registry = new MemorySessionRegistry({ now: clock.now });

  registry.assign("session-ttl", "server-a", { expiresAt: clock.now() + 100 });
  clock.advance(101);

  assert.equal(registry.get("session-ttl"), undefined);
  assert.equal(registry.list().length, 0);
});

test("memory registry tracks disconnect and reconnect grace metadata", () => {
  const clock = createClock();
  const registry = new MemorySessionRegistry({ now: clock.now });

  registry.assign("session-grace", "server-a", { expiresAt: clock.now() + 5_000 });
  const disconnected = registry.markDisconnected("session-grace", { gracePeriodMs: 250 });

  assert.equal(disconnected.metadata.connectionState, "disconnected");
  assert.equal(disconnected.metadata.disconnectedAt, clock.now());
  assert.equal(disconnected.metadata.graceUntil, clock.now() + 250);
  assert.equal(registry.isWithinGrace("session-grace"), true);

  const reconnected = registry.markReconnected("session-grace");
  assert.equal(reconnected.metadata.connectionState, "active");
  assert.equal(reconnected.metadata.disconnectedAt, null);
  assert.equal(reconnected.metadata.graceUntil, null);
  assert.equal(registry.isWithinGrace("session-grace"), false);
});

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
