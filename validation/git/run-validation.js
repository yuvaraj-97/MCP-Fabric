import { runGitValidation } from "./harness.js";

const report = await runGitValidation();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
