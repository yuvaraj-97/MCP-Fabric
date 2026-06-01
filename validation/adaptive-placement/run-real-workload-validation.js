import { runAdaptivePlacementRealWorkloadValidation } from "./real-workload-harness.js";

const report = await runAdaptivePlacementRealWorkloadValidation({
  cleanup: process.env.MCP_ADAPTIVE_REAL_WORKLOAD_KEEP_ARTIFACTS !== "1",
});

console.log("Adaptive placement real-workload validation completed.");
console.log(JSON.stringify(report, null, 2));
