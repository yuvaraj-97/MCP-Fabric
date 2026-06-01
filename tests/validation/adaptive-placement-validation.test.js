import test from "node:test";

import {
  assertAdaptivePlacementReport,
  runAdaptivePlacementValidation,
} from "../../validation/adaptive-placement/harness.js";

test("adaptive placement canary validation proves gated rollout behavior", async () => {
  const report = await runAdaptivePlacementValidation();

  assertAdaptivePlacementReport(report);
});
