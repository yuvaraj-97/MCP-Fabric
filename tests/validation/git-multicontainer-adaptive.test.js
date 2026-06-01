import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runGitMulticontainerProof } from "../../validation/git/multicontainer-harness.js";
import { initializeGitValidationWorkspace } from "../../validation/git/workspace.js";

test("git multi-container proof validates adaptive placement over remote MCP processes", async (t) => {
  const rootDir = mkdtempSync(join(tmpdir(), "git-multicontainer-adaptive-test-"));
  initializeGitValidationWorkspace(rootDir);
  let report;
  try {
    report = await runGitMulticontainerProof({
      rootDir,
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
  assert.equal(report.checks.stagedStateVisibleAfterReassignment, true);
  assert.equal(report.mcp.initialize.runtimeMode, "stateless");
  assert.equal(report.mcp.initialize.runtimeRecommendation.adaptivePlacement.applied, true);
  assert.equal(
    report.mcp.initialize.runtimeRecommendation.adaptivePlacement.runtimeModeSource,
    "adaptive-classifier",
  );
  assert.notEqual(
    report.mcp.initialize.serverInstanceId,
    report.mcp.adaptiveReadServerInstanceId,
  );
  assert.equal(report.gateway.observability.summary.totalAdaptivePlacements, 1);
  assert.equal(report.gateway.observability.summary.totalAdaptivePlacementFallbacks, 0);
  assert.equal(report.gateway.observability.summary.totalAdaptivePlacementMismatches, 0);
});
