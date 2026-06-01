import test from "node:test";

import {
  assertAdaptivePlacementSustainedReport,
  runAdaptivePlacementSustainedValidation,
} from "../../validation/adaptive-placement/sustained-harness.js";

test("adaptive placement sustained canary validation aggregates real-workload quality", async () => {
  const report = await runAdaptivePlacementSustainedValidation({
    iterations: 2,
    delayMs: 0,
  });

  assertAdaptivePlacementSustainedReport(report);
});
