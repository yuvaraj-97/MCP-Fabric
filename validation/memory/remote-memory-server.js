import { createServer } from "node:http";

import {
  createFileBackedMemoryValidationStore,
  createMemoryValidationApplication,
} from "../../examples/shared/memory-validation-server.js";

const port = Number.parseInt(process.env.PORT ?? "0", 10);
const storeFile = process.env.STORE_FILE;
const serverInstanceId = process.env.SERVER_INSTANCE_ID ?? "mem-remote";

if (!storeFile) {
  throw new TypeError("STORE_FILE is required");
}

const application = createMemoryValidationApplication({
  store: createFileBackedMemoryValidationStore({ filePath: storeFile }),
  serverInstanceId,
});

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host ?? "127.0.0.1"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        serverInstanceId,
        storeFile,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/memory") {
      sendJson(response, 200, {
        namespaces: applicationStoreSnapshot(),
      });
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

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  console.log(JSON.stringify({
    type: "ready",
    kind: "memory-remote-server",
    serverInstanceId,
    port: address.port,
    storeFile,
  }));
});

function applicationStoreSnapshot() {
  return createFileBackedMemoryValidationStore({ filePath: storeFile }).snapshot();
}

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
