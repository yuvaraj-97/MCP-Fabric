import assert from "node:assert/strict";
import test from "node:test";

import { createRemoteHttpApplication } from "../../packages/transports/http-sse/remote-http-application.js";

test("remote HTTP application forwards MCP messages and tracks initialized sessions", async () => {
  const requests = [];
  const application = createRemoteHttpApplication({
    serverInstanceId: "remote-a",
    baseUrl: "http://remote-a:4100",
    fetchImpl: async (url, options) => {
      requests.push({
        url,
        body: JSON.parse(options.body),
      });
      return {
        ok: true,
        async json() {
          return {
            jsonrpc: "2.0",
            id: 1,
            result: {
              ok: true,
            },
          };
        },
      };
    },
  });

  assert.equal(application.getSessionState("session-1"), undefined);
  const envelope = await application.handleMessage(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      sessionId: "session-1",
    },
    {
      sessionId: "session-1",
      transport: "http-sse",
    },
  );

  assert.equal(envelope.result.ok, true);
  assert.deepEqual(application.getSessionState("session-1"), { sessionId: "session-1" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "http://remote-a:4100/message");
  assert.equal(requests[0].body.message.method, "initialize");
});
