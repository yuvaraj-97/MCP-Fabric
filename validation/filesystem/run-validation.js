import { runFilesystemValidation } from "./harness.js";

const report = await runFilesystemValidation({
  cleanup: true,
});

console.log("Filesystem validation completed.");
console.log(JSON.stringify(report, null, 2));
