import { OpenAIConversationRunner } from "../openai-conversation-runner.js";
import { GitConversationRunner } from "./conversation-runner.js";

export class OpenAIGitConversationRunner extends OpenAIConversationRunner {
  constructor({ client = null } = {}) {
    super({
      scenarioId: "git-openai-conversation",
      title: "Git OpenAI Conversation Validation",
      baseRunner: new GitConversationRunner(),
      client,
    });
  }
}
