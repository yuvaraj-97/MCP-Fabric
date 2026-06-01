import assert from "node:assert/strict";
import test from "node:test";

import { runFilesystemMulticontainerProof } from "../../validation/multicontainer/harness.js";

test("filesystem multi-container proof validates adaptive placement over remote MCP processes", async (t) => {
  let report;
  try {
    report = await runFilesystemMulticontainerProof({
      adaptivePlacement: true,
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
  assert.equal(report.checks.adaptivePlacement, true);
  assert.equal(report.checks.adaptiveDynamicRouting, true);
  assert.equal(report.checks.adaptiveTelemetry, true);
  assert.equal(report.checks.artifactVisibleThroughMcp, true);
  assert.equal(report.checks.artifactVisibleOnSharedWorkspace, true);
  assert.equal(report.mcp.initialize.runtimeMode, "stateless");
  assert.equal(report.mcp.initialize.runtimeRecommendation.adaptivePlacement.applied, true);
  assert.notEqual(
    report.mcp.initialize.serverInstanceId,
    report.mcp.adaptiveStatServerInstanceId,
  );
  assert.equal(report.gateway.observability.summary.totalAdaptivePlacements, 1);
  assert.equal(report.gateway.observability.summary.totalAdaptivePlacementFallbacks, 0);
  assert.equal(report.gateway.observability.summary.totalAdaptivePlacementMismatches, 0);
});
