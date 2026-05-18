import assert from "node:assert/strict";
import test from "node:test";

import { runFilesystemValidation } from "../../validation/filesystem/harness.js";

test("filesystem validation proves the same application behavior over stdio and gateway-backed HTTP/SSE", async () => {
  const report = await runFilesystemValidation();

  assert.equal(report.ok, true);
  assert.deepEqual(report.stdio.toolNames, [
    "fs_list",
    "fs_read_text",
    "fs_stat",
    "fs_write_text",
  ]);
  assert.equal(report.stdio.writeResult.path, "notes/hello.txt");
  assert.equal(report.http.readResult.content, "filesystem validation works");
  assert.equal(report.http.listResult.path, "notes");
  assert.ok(report.http.listResult.entries.some((entry) => entry.name === "hello.txt"));
  assert.equal(
    report.http.initialize.serverInstanceId,
    report.http.stickyServerInstanceId,
  );
  assert.notEqual(
    report.http.initialize.serverInstanceId,
    report.http.reassignedServerInstanceId,
  );
  assert.equal(report.http.reassignedReadResult.content, "filesystem validation works");
  assert.ok(report.observability.summary.totalRequests >= 4);
  assert.ok(
    report.observability.recentEvents.some((event) => event.eventType === "route.completed"),
  );
});
