import { OpenAIConversationRunner } from "../openai-conversation-runner.js";
import { FilesystemConversationRunner } from "./conversation-runner.js";

const OPENAI_SCENARIO_ID = "filesystem-openai-conversation";

export class OpenAIFilesystemConversationRunner extends OpenAIConversationRunner {
  constructor({ client = null } = {}) {
    super({
      scenarioId: OPENAI_SCENARIO_ID,
      title: "Filesystem OpenAI Conversation Validation",
      baseRunner: new FilesystemConversationRunner(),
      client,
    });
  }
}

export async function runFilesystemOpenAIConversationValidation() {
  const runner = new OpenAIFilesystemConversationRunner();
  const results = [];
  for (const step of runner.describe().steps) {
    const executed = await runner.runStep(step.id);
    results.push(executed.result);
  }

  return {
    scenario: runner.describe(),
    rootDir: runner.getState().rootDir,
    results,
    transcript: runner.getState().transcript,
    observability: runner.getState().observability,
  };
}
