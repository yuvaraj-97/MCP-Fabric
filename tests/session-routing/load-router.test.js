import assert from "node:assert/strict";
import test from "node:test";

import { LoadRouter } from "../../packages/gateway/load-balancer/load-router.js";
import { MemorySessionRegistry } from "../../packages/gateway/session-registry/memory-session-registry.js";

test("assigns a new session to the least-loaded healthy instance", async () => {
  const registry = new MemorySessionRegistry();
  const router = new LoadRouter({ sessionRegistry: registry });

  router.upsertInstance({ serverInstanceId: "server-a", load: 0.4 });
  router.upsertInstance({ serverInstanceId: "server-b", load: 0.2 });

  const route = await router.routeSession("session-1");

  assert.deepEqual(route, {
    sessionId: "session-1",
    serverInstanceId: "server-b",
    reusedExistingSession: false,
    runtimeMode: "sticky",
  });
  assert.equal(registry.get("session-1").serverInstanceId, "server-b");
});

test("routes an existing session back to its assigned healthy instance", async () => {
  const registry = new MemorySessionRegistry();
  const router = new LoadRouter({ sessionRegistry: registry });

  router.upsertInstance({ serverInstanceId: "server-a", load: 0.69 });
  router.upsertInstance({ serverInstanceId: "server-b", load: 0.1 });
  registry.assign("session-1", "server-a");

  const route = await router.routeSession("session-1");

  assert.deepEqual(route, {
    sessionId: "session-1",
    serverInstanceId: "server-a",
    reusedExistingSession: true,
    runtimeMode: "sticky",
  });
});

test("does not assign new sessions to overloaded instances", async () => {
  const registry = new MemorySessionRegistry();
  const router = new LoadRouter({ sessionRegistry: registry, loadThreshold: 0.7 });

  router.upsertInstance({ serverInstanceId: "server-a", load: 0.7 });
  router.upsertInstance({ serverInstanceId: "server-b", load: 0.2 });

  const route = await router.routeSession("session-1");

  assert.equal(route.serverInstanceId, "server-b");
});

test("keeps existing sessions sticky even when the assigned instance is over threshold", async () => {
  const registry = new MemorySessionRegistry();
  const router = new LoadRouter({ sessionRegistry: registry, loadThreshold: 0.7 });

  router.upsertInstance({ serverInstanceId: "server-a", load: 0.9 });
  router.upsertInstance({ serverInstanceId: "server-b", load: 0.2 });
  registry.assign("session-1", "server-a");

  const route = await router.routeSession("session-1");

  assert.equal(route.serverInstanceId, "server-a");
  assert.equal(route.reusedExistingSession, true);
});

test("reassigns a session when the previous instance is unhealthy", async () => {
  const registry = new MemorySessionRegistry();
  const router = new LoadRouter({ sessionRegistry: registry });

  router.upsertInstance({ serverInstanceId: "server-a", healthy: false, load: 0.1 });
  router.upsertInstance({ serverInstanceId: "server-b", healthy: true, load: 0.2 });
  registry.assign("session-1", "server-a");

  const route = await router.routeSession("session-1");

  assert.deepEqual(route, {
    sessionId: "session-1",
    serverInstanceId: "server-b",
    reusedExistingSession: false,
    runtimeMode: "sticky",
  });
  assert.equal(registry.get("session-1").serverInstanceId, "server-b");
});

test("stateless mode bypasses existing healthy session affinity", async () => {
  const registry = new MemorySessionRegistry();
  const router = new LoadRouter({ sessionRegistry: registry });

  router.upsertInstance({ serverInstanceId: "server-a", load: 0.6 });
  router.upsertInstance({ serverInstanceId: "server-b", load: 0.1 });
  registry.assign("session-1", "server-a", { runtimeMode: "stateless" });

  const route = await router.routeSession("session-1");

  assert.deepEqual(route, {
    sessionId: "session-1",
    serverInstanceId: "server-b",
    reusedExistingSession: false,
    runtimeMode: "stateless",
  });
  assert.equal(registry.get("session-1").serverInstanceId, "server-b");
  assert.equal(registry.get("session-1").metadata.runtimeMode, "stateless");
});

test("explicit stateless mode can override a previously sticky session", async () => {
  const registry = new MemorySessionRegistry();
  const router = new LoadRouter({ sessionRegistry: registry });

  router.upsertInstance({ serverInstanceId: "server-a", load: 0.6 });
  router.upsertInstance({ serverInstanceId: "server-b", load: 0.1 });
  registry.assign("session-1", "server-a", { runtimeMode: "sticky" });

  const decision = await router.explainRoute("session-1", { runtimeMode: "stateless" });

  assert.equal(decision.serverInstanceId, "server-b");
  assert.equal(decision.reusedExistingSession, false);
  assert.equal(decision.runtimeMode, "stateless");
  assert.ok(
    decision.trace.some((entry) => entry.type === "stateless-session-reassignment-allowed"),
  );
});

test("rejects unsupported runtime modes", async () => {
  const registry = new MemorySessionRegistry();
  const router = new LoadRouter({ sessionRegistry: registry });

  router.upsertInstance({ serverInstanceId: "server-a", load: 0.1 });

  await assert.rejects(
    () => router.routeSession("session-1", { runtimeMode: "pinned" }),
    /runtimeMode must be one of: stateless, sticky/,
  );
});

test("fails clearly when no instance can accept a new session", async () => {
  const registry = new MemorySessionRegistry();
  const router = new LoadRouter({ sessionRegistry: registry, loadThreshold: 0.7 });

  router.upsertInstance({ serverInstanceId: "server-a", load: 0.8 });
  router.upsertInstance({ serverInstanceId: "server-b", healthy: false, load: 0.1 });

  await assert.rejects(
    () => router.routeSession("session-1"),
    /No healthy server instance is accepting new sessions/,
  );
});

test("explains routing decisions step by step for the demo dashboard", async () => {
  const registry = new MemorySessionRegistry();
  const router = new LoadRouter({ sessionRegistry: registry, loadThreshold: 0.7 });

  router.upsertInstance({ serverInstanceId: "server-a", load: 0.65 });
  router.upsertInstance({ serverInstanceId: "server-b", load: 0.2 });

  const decision = await router.explainRoute("session-9");

  assert.equal(decision.serverInstanceId, "server-b");
  assert.equal(decision.reusedExistingSession, false);
  assert.ok(Array.isArray(decision.trace));
  assert.equal(decision.trace[0].type, "lookup");
  assert.ok(decision.trace.some((entry) => entry.type === "instance-evaluated"));
  assert.ok(decision.trace.some((entry) => entry.type === "instance-selected"));
  assert.ok(decision.trace.some((entry) => entry.type === "session-assigned"));
});

test("auto scaler hook emits once when healthy average load crosses threshold", async () => {
  const registry = new MemorySessionRegistry();
  const events = [];
  const router = new LoadRouter({
    sessionRegistry: registry,
    autoScaleThreshold: 0.8,
    autoScalerHook(event) {
      events.push(event);
    },
  });

  router.upsertInstance({ serverInstanceId: "server-a", load: 0.7, healthy: true });
  router.upsertInstance({ serverInstanceId: "server-b", load: 0.9, healthy: true });
  router.upsertInstance({ serverInstanceId: "server-b", load: 0.95, healthy: true });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "cluster-pressure");
  assert.equal(events[0].healthyInstanceCount, 2);
  assert.equal(events[0].totalInstanceCount, 2);
  assert.ok(events[0].averageLoad >= 0.8);
});

test("auto scaler hook resets after pressure drops below threshold", async () => {
  const registry = new MemorySessionRegistry();
  const events = [];
  const router = new LoadRouter({
    sessionRegistry: registry,
    autoScaleThreshold: 0.8,
    autoScalerHook(event) {
      events.push(event);
    },
  });

  router.upsertInstance({ serverInstanceId: "server-a", load: 0.9, healthy: true });
  router.upsertInstance({ serverInstanceId: "server-b", load: 0.9, healthy: true });
  router.upsertInstance({ serverInstanceId: "server-b", load: 0.1, healthy: true });
  router.upsertInstance({ serverInstanceId: "server-b", load: 0.95, healthy: true });

  assert.equal(events.length, 2);
});

test("auto scaler hook failures do not break routing", async () => {
  const registry = new MemorySessionRegistry();
  const router = new LoadRouter({
    sessionRegistry: registry,
    autoScaleThreshold: 0.8,
    autoScalerHook() {
      throw new Error("autoscaler unavailable");
    },
  });

  router.upsertInstance({ serverInstanceId: "server-a", load: 0.9, healthy: true });
  router.upsertInstance({ serverInstanceId: "server-b", load: 0.2, healthy: true });

  const route = await router.routeSession("session-1");
  assert.equal(route.serverInstanceId, "server-b");
});
