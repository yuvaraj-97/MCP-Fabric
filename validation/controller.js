import { FilesystemConversationRunner } from "./filesystem/conversation-runner.js";
import { OpenAIFilesystemConversationRunner } from "./filesystem/openai-conversation-runner.js";

export class ValidationController {
  #runners;

  constructor() {
    this.#runners = new Map([
      ["filesystem-conversation", new FilesystemConversationRunner()],
      ["filesystem-openai-conversation", new OpenAIFilesystemConversationRunner()],
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

  #getRunner(scenarioId) {
    const runner = this.#runners.get(scenarioId);
    if (!runner) {
      throw new Error(`Unknown validation scenario: ${scenarioId}`);
    }

    return runner;
  }
}
