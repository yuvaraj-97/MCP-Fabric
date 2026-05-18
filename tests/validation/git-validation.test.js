import assert from "node:assert/strict";
import test from "node:test";

import { runGitValidation } from "../../validation/git/harness.js";

test("git validation proves the same application behavior over stdio and gateway-backed HTTP/SSE", async () => {
  const report = await runGitValidation();

  assert.equal(report.ok, true);
  assert.deepEqual(report.stdio.toolNames, [
    "git_diff_cached",
    "git_list_files",
    "git_read_file",
    "git_stage_paths",
    "git_stat_path",
    "git_status",
    "git_write_file",
  ]);
  assert.equal(report.stdio.writeResult.path, "notes/hello.txt");
  assert.equal(report.http.statusBeforeStage.clean, false);
  assert.ok(
    report.http.statusBeforeStage.porcelain.some(
      (entry) =>
        (entry.path === "notes/" || entry.path === "notes/hello.txt") &&
        entry.workTreeStatus === "?",
    ),
  );
  assert.deepEqual(report.http.stageResult.stagedPaths, ["notes/hello.txt"]);
  assert.ok(report.http.stickyDiffResult.stagedFiles.includes("notes/hello.txt"));
  assert.equal(
    report.http.initialize.serverInstanceId,
    report.http.stickyServerInstanceId,
  );
  assert.notEqual(
    report.http.initialize.serverInstanceId,
    report.http.reassignedServerInstanceId,
  );
  assert.ok(
    report.http.reassignedStatusResult.porcelain.some(
      (entry) => entry.path === "notes/hello.txt" && entry.indexStatus === "A",
    ),
  );
  assert.ok(
    report.workspaceSnapshot.items.some((entry) => entry.path === "notes/hello.txt"),
  );
  assert.ok(report.observability.summary.totalRequests >= 4);
  assert.ok(
    report.observability.recentEvents.some((event) => event.eventType === "route.completed"),
  );
});
