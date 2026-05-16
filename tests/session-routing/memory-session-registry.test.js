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
