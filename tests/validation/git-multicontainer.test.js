import assert from "node:assert/strict";
import test from "node:test";

import { runGitMulticontainerProof } from "../../validation/git/multicontainer-harness.js";

test("git multi-container proof validates sticky routing and reassignment across remote MCP processes", async (t) => {
  let report;
  try {
    report = await runGitMulticontainerProof();
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
  assert.equal(report.checks.artifactVisibleThroughMcp, true);
  assert.equal(report.checks.artifactVisibleOnSharedWorkspace, true);
  assert.equal(report.checks.stagedStateVisibleAfterReassignment, true);
  assert.deepEqual(report.mcp.tools, [
    "git_diff_cached",
    "git_list_files",
    "git_read_file",
    "git_stage_paths",
    "git_stat_path",
    "git_status",
    "git_write_file",
  ]);
  assert.equal(report.mcp.writeResult.path, "notes/git-multicontainer-change.txt");
  assert.ok(
    report.mcp.statusBeforeStage.porcelain.some(
      (entry) =>
        (entry.path === "notes/" || entry.path === "notes/git-multicontainer-change.txt") &&
        entry.workTreeStatus === "?",
    ),
  );
  assert.deepEqual(report.mcp.stageResult.stagedPaths, ["notes/git-multicontainer-change.txt"]);
  assert.ok(
    report.mcp.stickyDiffResult.stagedFiles.includes("notes/git-multicontainer-change.txt"),
  );
  assert.notEqual(
    report.mcp.initialize.serverInstanceId,
    report.mcp.reassignedServerInstanceId,
  );
  assert.ok(report.workspaceSnapshot.items.some((item) => item.path === "notes/git-multicontainer-change.txt"));
  assert.ok(report.gateway.observability.summary.totalRequests >= 6);
});
