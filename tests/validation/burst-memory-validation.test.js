import assert from "node:assert/strict";
import test from "node:test";

import { runBurstMemoryProof } from "../../validation/burst-memory/run-proof.js";

test("burst memory proof verifies bounded session churn", async () => {
  const report = await runBurstMemoryProof({
    sessionCount: 250,
    concurrency: 25,
    sessionTtlMs: 100,
    maxPeakHeapGrowthBytes: 64 * 1024 * 1024,
    maxRetainedHeapGrowthBytes: 32 * 1024 * 1024,
  });

  assert.equal(report.ok, true);
  assert.equal(report.activeSessionsAfterBurst, 250);
  assert.equal(report.prunedSessions, 250);
  assert.equal(report.activeSessionsAfterPrune, 0);
});
