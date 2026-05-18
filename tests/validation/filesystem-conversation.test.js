import assert from "node:assert/strict";
import test from "node:test";

import { runFilesystemConversationValidation } from "../../validation/filesystem/conversation-runner.js";

test("filesystem conversation validation walks through stdio, sticky HTTP, and unhealthy reassignment", async () => {
  const report = await runFilesystemConversationValidation();

  assert.equal(report.scenario.id, "filesystem-conversation");
  assert.equal(report.results.length, 5);
  assert.equal(report.results[0].transport, "stdio");
  assert.equal(report.results[2].transport, "http-sse-gateway");
  assert.equal(
    report.results[2].outputs.read.payload.result.structuredContent.content,
    "filesystem validation works",
  );
  assert.equal(
    report.results[3].outputs.stickyCheck.initialServerInstanceId,
    report.results[3].outputs.stickyCheck.currentServerInstanceId,
  );
  assert.notEqual(
    report.results[4].outputs.reassignmentCheck.previousServerInstanceId,
    report.results[4].outputs.reassignmentCheck.newServerInstanceId,
  );
  assert.match(
    report.results[4].outputs.reassignmentCheck.recoveryAction,
    /reassigned/,
  );
});
