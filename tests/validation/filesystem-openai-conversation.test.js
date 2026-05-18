import assert from "node:assert/strict";
import test from "node:test";

import { OpenAIFilesystemConversationRunner } from "../../validation/filesystem/openai-conversation-runner.js";

test("OpenAI filesystem conversation runner executes a validation step through a tool call", async () => {
  const requests = [];
  const runner = new OpenAIFilesystemConversationRunner({
    client: {
      model: "gpt-5",
      async createResponse(body) {
        requests.push(body);
        if (!Array.isArray(body.input)) {
          return {
            id: "resp_1",
            output: [
              {
                type: "function_call",
                name: "run_stdio_initialize_and_discover",
                arguments: JSON.stringify({
                  stepId: "stdio-initialize-and-discover",
                }),
                call_id: "call_1",
              },
            ],
          };
        }

        return {
          id: "resp_2",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "The assistant used the stdio validation tool, confirmed initialization, and explained the result clearly.",
                },
              ],
            },
          ],
        };
      },
    },
  });

  const executed = await runner.runStep("stdio-initialize-and-discover");

  assert.equal(executed.result.provider, "openai");
  assert.equal(executed.result.transport, "stdio");
  assert.match(executed.result.assistantSummary, /assistant used the stdio validation tool/i);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].tool_choice, "required");
  assert.equal(requests[0].tools[0].name, "run_stdio_initialize_and_discover");
  assert.ok(Array.isArray(requests[1].input));
  assert.equal(requests[1].input.at(-1).type, "function_call_output");
  assert.equal(executed.state.transcript.length, 2);
});
