import assert from "node:assert/strict";
import test from "node:test";

import { runMemoryValidation } from "../../validation/memory/harness.js";

test("memory validation proves the same application behavior over stdio and gateway-backed HTTP/SSE", async () => {
  const report = await runMemoryValidation();

  assert.equal(report.ok, true);
  assert.deepEqual(report.stdio.toolNames, [
    "memory_forget",
    "memory_list",
    "memory_recall",
    "memory_remember",
  ]);
  assert.equal(report.stdio.rememberResult.namespace, "operators");
  assert.equal(report.stdio.rememberResult.key, "primary-contact");
  assert.equal(report.http.recallResult.found, true);
  assert.equal(report.http.recallResult.value, "Asha manages the gateway rollout.");
  assert.equal(report.http.listResult.count, 1);
  assert.equal(report.http.listResult.entries[0].key, "primary-contact");
  assert.equal(
    report.http.initialize.serverInstanceId,
    report.http.stickyServerInstanceId,
  );
  assert.notEqual(
    report.http.initialize.serverInstanceId,
    report.http.reassignedServerInstanceId,
  );
  assert.equal(report.http.reassignedRecallResult.found, true);
  assert.equal(report.storeSnapshot[0].namespace, "operators");
  assert.ok(report.observability.summary.totalRequests >= 4);
  assert.ok(
    report.observability.recentEvents.some((event) => event.eventType === "route.completed"),
  );
});
