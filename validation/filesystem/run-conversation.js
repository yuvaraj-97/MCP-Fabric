import { runFilesystemConversationValidation } from "./conversation-runner.js";

const report = await runFilesystemConversationValidation();

console.log("Filesystem conversation validation completed.");
console.log(JSON.stringify(report, null, 2));
