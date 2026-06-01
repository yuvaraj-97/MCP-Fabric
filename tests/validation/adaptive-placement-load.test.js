import test from "node:test";

import {
  assertAdaptivePlacementLoadReport,
  runAdaptivePlacementLoadValidation,
} from "../../validation/adaptive-placement/load-harness.js";

test("adaptive placement load validation preserves telemetry invariants", async () => {
  const report = await runAdaptivePlacementLoadValidation({
    sessionCount: 250,
    concurrency: 25,
    maxPeakHeapGrowthBytes: 64 * 1024 * 1024,
    maxRetainedHeapGrowthBytes: 32 * 1024 * 1024,
  });

  assertAdaptivePlacementLoadReport(report);
});
