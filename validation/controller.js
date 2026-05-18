import { FilesystemConversationRunner } from "./filesystem/conversation-runner.js";
import { OpenAIFilesystemConversationRunner } from "./filesystem/openai-conversation-runner.js";
import { GitConversationRunner } from "./git/conversation-runner.js";
import { MemoryConversationRunner } from "./memory/conversation-runner.js";

export class ValidationController {
  #runners;

  constructor() {
    this.#runners = new Map([
      ["filesystem-conversation", new FilesystemConversationRunner()],
      ["filesystem-openai-conversation", new OpenAIFilesystemConversationRunner()],
      ["git-conversation", new GitConversationRunner()],
      ["memory-conversation", new MemoryConversationRunner()],
    ]);
  }

  listScenarios() {
    return Array.from(this.#runners.values(), (runner) => runner.getState());
  }

  getScenario(scenarioId) {
    const runner = this.#getRunner(scenarioId);
    return runner.getState();
  }

  resetScenario(scenarioId) {
    const runner = this.#getRunner(scenarioId);
    return runner.reset();
  }

  async runStep(scenarioId, stepId) {
    const runner = this.#getRunner(scenarioId);
    return runner.runStep(stepId);
  }

  async runStepStream(scenarioId, stepId, emit) {
    const runner = this.#getRunner(scenarioId);
    if (typeof runner.runStepStream === "function") {
      return runner.runStepStream(stepId, emit);
    }

    emit({
      type: "step.started",
      scenarioId,
      stepId,
    });
    const payload = await runner.runStep(stepId);
    emit({
      type: "step.completed",
      payload,
    });
    return payload;
  }

  #getRunner(scenarioId) {
    const runner = this.#runners.get(scenarioId);
    if (!runner) {
      throw new Error(`Unknown validation scenario: ${scenarioId}`);
    }

    return runner;
  }
}
