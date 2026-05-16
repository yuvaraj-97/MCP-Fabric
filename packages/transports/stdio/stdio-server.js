import readline from "node:readline";

import { createDemoApplication } from "../../core/protocol-adapter/demo-application.js";

export function startStdioServer({
  input = process.stdin,
  output = process.stdout,
  error = process.stderr,
  serverInstanceId = process.env.SERVER_INSTANCE_ID ?? "stdio-server-1",
} = {}) {
  const app = createDemoApplication({ serverInstanceId });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  rl.on("line", async (line) => {
    if (!line.trim()) {
      return;
    }

    try {
      const message = JSON.parse(line);
      const response = await app.handleRequest({
        method: message.method,
        params: message.params,
        sessionId: message.sessionId,
        emitEvent: (event, payload) => {
          writeJsonLine(output, {
            jsonrpc: "2.0",
            method: "event",
            params: {
              event,
              payload,
              serverInstanceId,
            },
          });
        },
      });

      writeJsonLine(output, {
        jsonrpc: "2.0",
        id: message.id ?? null,
        result: response,
      });
    } catch (cause) {
      const errorPayload = {
        jsonrpc: "2.0",
        id: null,
        error: {
          message: cause instanceof Error ? cause.message : String(cause),
        },
      };

      writeJsonLine(output, errorPayload);
      error.write(`${errorPayload.error.message}\n`);
    }
  });

  return {
    close() {
      rl.close();
    },
  };
}

function writeJsonLine(stream, payload) {
  stream.write(`${JSON.stringify(payload)}\n`);
}

if (import.meta.url === new URL(process.argv[1], "file://").href) {
  startStdioServer();
}
