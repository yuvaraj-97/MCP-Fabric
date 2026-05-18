import { FilesystemConversationRunner } from "./conversation-runner.js";
import {
  createOpenAIResponsesClient,
  resolveOpenAIApiKey,
} from "../openai-client.js";

const OPENAI_SCENARIO_ID = "filesystem-openai-conversation";

export class OpenAIFilesystemConversationRunner {
  #baseRunner;
  #client;
  #state;

  constructor({ client = null } = {}) {
    this.#client = client;
    this.reset();
  }

  reset() {
    this.#baseRunner = new FilesystemConversationRunner();
    this.#state = {
      transcript: [],
      results: new Map(),
    };
    return this.getState();
  }

  describe() {
    const base = this.#baseRunner.describe();
    const apiKeyAvailable = Boolean(resolveOpenAIApiKey());
    return {
      id: OPENAI_SCENARIO_ID,
      targetId: "filesystem",
      targetLabel: "Filesystem",
      title: "Filesystem OpenAI Conversation Validation",
      audience:
        "Uses the OpenAI API to generate assistant replies while the real validation actions still run through the shared stdio and gateway-backed HTTP/SSE transports.",
      rootDir: this.#baseRunner.getState().rootDir,
      createdFile: this.#baseRunner.getState().createdFile,
      provider: {
        name: "OpenAI Responses API",
        model: process.env.OPENAI_MODEL || "gpt-5",
      },
      available: apiKeyAvailable,
      disabledReason: apiKeyAvailable
        ? null
        : "OPENAI_API_KEY was not found in the environment or .env file.",
      steps: base.steps.map((step) => ({
        ...step,
        transport: step.transport,
        completed: this.#state.results.has(step.id),
      })),
    };
  }

  getState() {
    const description = this.describe();
    return {
      ...description,
      observability: this.#baseRunner.getObservability(),
      transcript: this.#state.transcript.slice(),
      results: description.steps
        .filter((step) => this.#state.results.has(step.id))
        .map((step) => this.#state.results.get(step.id)),
    };
  }

  async runStep(stepId) {
    const state = this.getState();
    const step = state.steps.find((candidate) => candidate.id === stepId);
    if (!step) {
      throw new Error(`Unknown validation step: ${stepId}`);
    }

    if (!state.available) {
      throw new Error(state.disabledReason);
    }

    const client = this.#resolveClient();
    const userPrompt = step.userPrompt;
    const toolName = `run_${step.id.replaceAll(/[^a-z0-9]+/gi, "_")}`;
    const firstResponse = await client.createResponse({
      instructions:
        "You are validating an MCP transport and gateway prototype. Always call the provided function tool first. After the tool output arrives, explain the result in plain English for a non-technical operator. Be specific about what was tested and whether it passed.",
      input: buildPromptText({
        transcript: this.#state.transcript,
        step,
      }),
      tools: [
        {
          type: "function",
          name: toolName,
          description: `Execute the validation action for ${step.title}.`,
          parameters: {
            type: "object",
            properties: {
              stepId: {
                type: "string",
                enum: [step.id],
              },
            },
            required: ["stepId"],
            additionalProperties: false,
          },
        },
      ],
      tool_choice: "required",
    });

    const functionCall = firstResponse.output?.find((item) => item.type === "function_call");
    if (!functionCall) {
      throw new Error("OpenAI validation response did not request a tool call.");
    }

    const toolArgs = safeJsonParse(functionCall.arguments, { stepId: step.id });
    const executed = await this.#baseRunner.runStep(toolArgs.stepId);

    const secondResponse = await client.createResponse({
      instructions:
        "You are validating an MCP transport and gateway prototype. Explain the tool result in plain English for a non-technical operator. Be specific about what was tested and whether it passed.",
      input: [
        ...firstResponse.output,
        {
          type: "function_call_output",
          call_id: functionCall.call_id,
          output: JSON.stringify(executed.result),
        },
      ],
    });

    const assistantSummary = extractAssistantText(secondResponse);
    const record = {
      ...executed.result,
      assistantSummary:
        assistantSummary ||
        "The assistant completed the validation step, but no natural-language summary was returned.",
      model: client.model,
      provider: "openai",
      openaiResponseId: secondResponse.id,
      openaiToolCall: {
        name: functionCall.name,
        arguments: toolArgs,
      },
    };

    this.#state.results.set(step.id, record);
    this.#state.transcript.push(
      { role: "user", text: userPrompt },
      { role: "assistant", text: record.assistantSummary },
    );

    return {
      result: record,
      state: this.getState(),
    };
  }

  async runStepStream(stepId, emit) {
    const state = this.getState();
    const step = state.steps.find((candidate) => candidate.id === stepId);
    if (!step) {
      throw new Error(`Unknown validation step: ${stepId}`);
    }

    if (!state.available) {
      throw new Error(state.disabledReason);
    }

    const client = this.#resolveClient();
    const userPrompt = step.userPrompt;
    const toolName = `run_${step.id.replaceAll(/[^a-z0-9]+/gi, "_")}`;
    const instructions =
      "You are validating an MCP transport and gateway prototype. Always call the provided function tool first. After the tool output arrives, explain the result in plain English for a non-technical operator. Be specific about what was tested and whether it passed.";

    emit({
      type: "step.started",
      scenarioId: OPENAI_SCENARIO_ID,
      stepId: step.id,
      prompt: userPrompt,
      targetId: "filesystem",
    });
    emit({
      type: "openai.request.started",
      phase: "tool-selection",
      prompt: userPrompt,
      instructions,
    });

    const firstResponse = await client.createResponse({
      instructions,
      input: buildPromptText({
        transcript: this.#state.transcript,
        step,
      }),
      tools: [
        {
          type: "function",
          name: toolName,
          description: `Execute the validation action for ${step.title}.`,
          parameters: {
            type: "object",
            properties: {
              stepId: {
                type: "string",
                enum: [step.id],
              },
            },
            required: ["stepId"],
            additionalProperties: false,
          },
        },
      ],
      tool_choice: "required",
    });

    emit({
      type: "openai.response.created",
      phase: "tool-selection",
      responseId: firstResponse.id,
      model: client.model,
    });

    const functionCall = firstResponse.output?.find((item) => item.type === "function_call");
    if (!functionCall) {
      throw new Error("OpenAI validation response did not request a tool call.");
    }

    const toolArgs = safeJsonParse(functionCall.arguments, { stepId: step.id });
    emit({
      type: "openai.tool_call",
      responseId: firstResponse.id,
      name: functionCall.name,
      arguments: toolArgs,
    });

    const executed = await this.#baseRunner.runStep(toolArgs.stepId);
    emit({
      type: "validation.tool_result",
      stepId: step.id,
      output: executed.result.outputs,
    });

    const secondInstructions =
      "You are validating an MCP transport and gateway prototype. Explain the tool result in plain English for a non-technical operator. Be specific about what was tested and whether it passed.";
    emit({
      type: "openai.request.started",
      phase: "assistant-summary",
      responseId: firstResponse.id,
      instructions: secondInstructions,
    });

    let finalResponseId = null;
    let assistantSummary = "";
    for await (const event of client.createResponseStream({
      instructions: secondInstructions,
      input: [
        ...firstResponse.output,
        {
          type: "function_call_output",
          call_id: functionCall.call_id,
          output: JSON.stringify(executed.result),
        },
      ],
    })) {
      if (event.type === "response.created") {
        finalResponseId = event.payload?.response?.id ?? null;
        emit({
          type: "openai.response.created",
          phase: "assistant-summary",
          responseId: finalResponseId,
          model: client.model,
        });
        continue;
      }

      if (event.type === "response.output_text.delta") {
        const delta = event.payload?.delta ?? "";
        assistantSummary += delta;
        emit({
          type: "openai.output_text.delta",
          delta,
          content: assistantSummary,
        });
        continue;
      }

      if (event.type === "response.completed") {
        emit({
          type: "openai.response.completed",
          responseId: event.payload?.response?.id ?? finalResponseId,
        });
      }
    }

    const record = {
      ...executed.result,
      assistantSummary:
        assistantSummary.trim() ||
        "The assistant completed the validation step, but no natural-language summary was returned.",
      model: client.model,
      provider: "openai",
      openaiResponseId: finalResponseId,
      openaiToolCall: {
        name: functionCall.name,
        arguments: toolArgs,
      },
    };

    this.#state.results.set(step.id, record);
    this.#state.transcript.push(
      { role: "user", text: userPrompt },
      { role: "assistant", text: record.assistantSummary },
    );

    const payload = {
      result: record,
      state: this.getState(),
    };
    emit({
      type: "step.completed",
      payload,
    });
    return payload;
  }

  #resolveClient() {
    if (this.#client) {
      return this.#client;
    }

    this.#client = createOpenAIResponsesClient();
    return this.#client;
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

function buildPromptText({ transcript, step }) {
  const lines = [];
  if (transcript.length > 0) {
    lines.push("Prior conversation:");
    for (const turn of transcript) {
      lines.push(`${turn.role}: ${turn.text}`);
    }
    lines.push("");
  }

  lines.push(`User request: ${step.userPrompt}`);
  lines.push(`What we are testing: ${step.whatTesting}`);
  lines.push(`Expected result: ${step.expected}`);
  return lines.join("\n");
}

function extractAssistantText(response) {
  const message = response.output?.find((item) => item.type === "message");
  if (!message) {
    return "";
  }

  return (message.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
