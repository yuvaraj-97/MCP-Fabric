import { runAdaptivePlacementValidation } from "./harness.js";

const report = await runAdaptivePlacementValidation();

console.log("Adaptive placement canary validation completed.");
console.log(JSON.stringify(report, null, 2));
