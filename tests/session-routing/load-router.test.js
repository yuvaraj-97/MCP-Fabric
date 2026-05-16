import assert from "node:assert/strict";
import test from "node:test";

import { LoadRouter } from "../../packages/gateway/load-balancer/load-router.js";
import { MemorySessionRegistry } from "../../packages/gateway/session-registry/memory-session-registry.js";

test("assigns a new session to the least-loaded healthy instance", () => {
  const registry = new MemorySessionRegistry();
  const router = new LoadRouter({ sessionRegistry: registry });

  router.upsertInstance({ serverInstanceId: "server-a", load: 0.4 });
  router.upsertInstance({ serverInstanceId: "server-b", load: 0.2 });

  const route = router.routeSession("session-1");

  assert.deepEqual(route, {
    sessionId: "session-1",
    serverInstanceId: "server-b",
    reusedExistingSession: false,
  });
  assert.equal(registry.get("session-1").serverInstanceId, "server-b");
});

test("routes an existing session back to its assigned healthy instance", () => {
  const registry = new MemorySessionRegistry();
  const router = new LoadRouter({ sessionRegistry: registry });

  router.upsertInstance({ serverInstanceId: "server-a", load: 0.69 });
  router.upsertInstance({ serverInstanceId: "server-b", load: 0.1 });
  registry.assign("session-1", "server-a");

  const route = router.routeSession("session-1");

  assert.deepEqual(route, {
    sessionId: "session-1",
    serverInstanceId: "server-a",
    reusedExistingSession: true,
  });
});

test("does not assign new sessions to overloaded instances", () => {
  const registry = new MemorySessionRegistry();
  const router = new LoadRouter({ sessionRegistry: registry, loadThreshold: 0.7 });

  router.upsertInstance({ serverInstanceId: "server-a", load: 0.7 });
  router.upsertInstance({ serverInstanceId: "server-b", load: 0.2 });

  const route = router.routeSession("session-1");

  assert.equal(route.serverInstanceId, "server-b");
});

test("keeps existing sessions sticky even when the assigned instance is over threshold", () => {
  const registry = new MemorySessionRegistry();
  const router = new LoadRouter({ sessionRegistry: registry, loadThreshold: 0.7 });

  router.upsertInstance({ serverInstanceId: "server-a", load: 0.9 });
  router.upsertInstance({ serverInstanceId: "server-b", load: 0.2 });
  registry.assign("session-1", "server-a");

  const route = router.routeSession("session-1");

  assert.equal(route.serverInstanceId, "server-a");
  assert.equal(route.reusedExistingSession, true);
});

test("reassigns a session when the previous instance is unhealthy", () => {
  const registry = new MemorySessionRegistry();
  const router = new LoadRouter({ sessionRegistry: registry });

  router.upsertInstance({ serverInstanceId: "server-a", healthy: false, load: 0.1 });
  router.upsertInstance({ serverInstanceId: "server-b", healthy: true, load: 0.2 });
  registry.assign("session-1", "server-a");

  const route = router.routeSession("session-1");

  assert.deepEqual(route, {
    sessionId: "session-1",
    serverInstanceId: "server-b",
    reusedExistingSession: false,
  });
  assert.equal(registry.get("session-1").serverInstanceId, "server-b");
});

test("fails clearly when no instance can accept a new session", () => {
  const registry = new MemorySessionRegistry();
  const router = new LoadRouter({ sessionRegistry: registry, loadThreshold: 0.7 });

  router.upsertInstance({ serverInstanceId: "server-a", load: 0.8 });
  router.upsertInstance({ serverInstanceId: "server-b", healthy: false, load: 0.1 });

  assert.throws(
    () => router.routeSession("session-1"),
    /No healthy server instance is accepting new sessions/,
  );
});

test("explains routing decisions step by step for the demo dashboard", () => {
  const registry = new MemorySessionRegistry();
  const router = new LoadRouter({ sessionRegistry: registry, loadThreshold: 0.7 });

  router.upsertInstance({ serverInstanceId: "server-a", load: 0.65 });
  router.upsertInstance({ serverInstanceId: "server-b", load: 0.2 });

  const decision = router.explainRoute("session-9");

  assert.equal(decision.serverInstanceId, "server-b");
  assert.equal(decision.reusedExistingSession, false);
  assert.ok(Array.isArray(decision.trace));
  assert.equal(decision.trace[0].type, "lookup");
  assert.ok(decision.trace.some((entry) => entry.type === "instance-evaluated"));
  assert.ok(decision.trace.some((entry) => entry.type === "instance-selected"));
  assert.ok(decision.trace.some((entry) => entry.type === "session-assigned"));
});
