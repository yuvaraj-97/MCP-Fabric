import { runMemoryValidation } from "./harness.js";

const report = await runMemoryValidation();

console.log("Memory validation completed.");
console.log(JSON.stringify(report, null, 2));
