import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runMemoryMulticontainerProof } from "../../validation/memory/multicontainer-harness.js";

test("memory multi-container proof preserves continuity across remote reassignment", async (t) => {
  const rootDir = mkdtempSync(join(tmpdir(), "memory-multicontainer-test-"));
  let report;
  try {
    report = await runMemoryMulticontainerProof({
      storeFile: join(rootDir, "memory-store.json"),
      cleanup: true,
    });
  } catch (error) {
    if (error?.code === "EPERM" && error?.syscall === "listen") {
      t.skip("sandbox blocks local listeners for remote-process proof");
      return;
    }
    throw error;
  }

  assert.equal(report.ok, true);
  assert.equal(report.checks.stickyRouting, true);
  assert.equal(report.checks.unhealthyReassignment, true);
  assert.equal(report.checks.memoryVisibleThroughMcp, true);
  assert.equal(report.checks.memoryVisibleOnSharedStore, true);
  assert.equal(report.checks.remoteServersSeeSharedStore, true);
  assert.deepEqual(report.mcp.tools, [
    "memory_forget",
    "memory_list",
    "memory_recall",
    "memory_remember",
  ]);
  assert.equal(
    report.mcp.initialize.serverInstanceId,
    report.mcp.stickyServerInstanceId,
  );
  assert.notEqual(
    report.mcp.initialize.serverInstanceId,
    report.mcp.reassignedServerInstanceId,
  );
  assert.equal(
    report.mcp.reassignedRecallResult.value,
    "Use the gateway as the shared communication layer between clients and remote MCP servers.",
  );
  assert.ok(report.gateway.observability.summary.totalReassignments >= 1);
  assert.ok(
    report.remoteMemorySnapshots.every((snapshot) => Array.isArray(snapshot.memory.namespaces)),
  );
});
