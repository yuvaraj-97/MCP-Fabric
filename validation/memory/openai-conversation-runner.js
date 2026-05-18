import { OpenAIConversationRunner } from "../openai-conversation-runner.js";
import { MemoryConversationRunner } from "./conversation-runner.js";

export class OpenAIMemoryConversationRunner extends OpenAIConversationRunner {
  constructor({ client = null } = {}) {
    super({
      scenarioId: "memory-openai-conversation",
      title: "Memory OpenAI Conversation Validation",
      baseRunner: new MemoryConversationRunner(),
      client,
    });
  }
}
