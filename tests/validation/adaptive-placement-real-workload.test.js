import test from "node:test";

import {
  assertAdaptivePlacementRealWorkloadReport,
  runAdaptivePlacementRealWorkloadValidation,
} from "../../validation/adaptive-placement/real-workload-harness.js";

test("adaptive placement real-workload validation captures classifier quality evidence", async () => {
  const report = await runAdaptivePlacementRealWorkloadValidation({ cleanup: true });

  assertAdaptivePlacementRealWorkloadReport(report);
});
