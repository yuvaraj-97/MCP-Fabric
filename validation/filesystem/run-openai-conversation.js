import { runFilesystemOpenAIConversationValidation } from "./openai-conversation-runner.js";

const report = await runFilesystemOpenAIConversationValidation();

console.log("Filesystem OpenAI conversation validation completed.");
console.log(JSON.stringify(report, null, 2));
