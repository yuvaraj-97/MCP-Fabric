import { createServer } from "node:http";

import { createGitValidationApplication } from "../../examples/shared/git-validation-server.js";
import { snapshotGitValidationWorkspace } from "./workspace.js";

const port = Number.parseInt(process.env.PORT ?? "0", 10);
const host = process.env.HOST ?? "127.0.0.1";
const rootDir = process.env.ROOT_DIR;
const serverInstanceId = process.env.SERVER_INSTANCE_ID ?? "git-remote";

if (!rootDir) {
  throw new TypeError("ROOT_DIR is required");
}

const application = createGitValidationApplication({
  rootDir,
  serverInstanceId,
});

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host ?? "127.0.0.1"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        serverInstanceId,
        rootDir,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/workspace") {
      sendJson(response, 200, snapshotGitValidationWorkspace(rootDir));
      return;
    }

    if (request.method === "POST" && url.pathname === "/message") {
      const body = await readJsonBody(request);
      const envelope = await application.handleMessage(body.message, body.context ?? {});
      sendJson(response, 200, envelope);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, host, () => {
  const address = server.address();
  console.log(JSON.stringify({
    type: "ready",
    kind: "git-remote-server",
    serverInstanceId,
    host,
    port: address.port,
    rootDir,
  }));
});

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}
