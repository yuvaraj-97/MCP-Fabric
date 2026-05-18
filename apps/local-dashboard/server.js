import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_DASHBOARD_OPERATOR_CONFIG,
  operatorConfigFromEnv,
} from "../../packages/gateway/config/operator-config.js";
import { LocalDemoController } from "../../packages/gateway/demo/local-demo-controller.js";
import { ValidationController } from "../../validation/controller.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");

export function createDashboardServer({
  operatorConfig = operatorConfigFromEnv({
    defaults: DEFAULT_DASHBOARD_OPERATOR_CONFIG,
  }),
  port = operatorConfig.port,
} = {}) {
  const controller = new LocalDemoController({ operatorConfig });
  const validationController = new ValidationController();
  const handler = createDashboardHandler({ controller, validationController });

  const server = createServer(handler);

  return {
    controller,
    validationController,
    start() {
      return new Promise((resolve) => {
        server.listen(port, "127.0.0.1", () => {
          resolve(server.address());
        });
      });
    },
    stop() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
    server,
  };
}

export function createDashboardHandler({
  operatorConfig = operatorConfigFromEnv({
    defaults: DEFAULT_DASHBOARD_OPERATOR_CONFIG,
  }),
  controller = new LocalDemoController({ operatorConfig }),
  validationController = new ValidationController(),
} = {}) {
  return async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);

      if (request.method === "GET" && url.pathname === "/api/state") {
        return writeJson(response, 200, controller.getState());
      }

      if (request.method === "POST" && url.pathname === "/api/reset") {
        return writeJson(response, 200, controller.reset());
      }

      if (request.method === "POST" && url.pathname === "/api/sessions") {
        const body = await readJsonBody(request);
        return writeJson(response, 200, controller.createSession(body.sessionId));
      }

      if (request.method === "POST" && url.pathname === "/api/route") {
        const body = await readJsonBody(request);
        return writeJson(response, 200, controller.routeSession(body.sessionId));
      }

      if (request.method === "POST" && url.pathname === "/api/runtime/sessions") {
        const body = await readJsonBody(request);
        return writeJson(response, 200, await controller.createRuntimeSession(body.clientId));
      }

      if (request.method === "POST" && url.pathname === "/api/runtime/echo") {
        const body = await readJsonBody(request);
        return writeJson(response, 200, await controller.echoRuntimeSession(body.sessionId, body.message));
      }

      if (request.method === "POST" && url.pathname === "/api/runtime/disconnect") {
        const body = await readJsonBody(request);
        return writeJson(response, 200, controller.disconnectRuntimeSession(body.sessionId));
      }

      if (request.method === "POST" && url.pathname === "/api/runtime/restart") {
        return writeJson(response, 200, controller.restartRuntimeController());
      }

      if (request.method === "GET" && url.pathname === "/api/runtime/observability") {
        return writeJson(response, 200, controller.getState().runtime.observability);
      }

      if (request.method === "GET" && url.pathname === "/api/validation/scenarios") {
        return writeJson(response, 200, validationController.listScenarios());
      }

      if (request.method === "POST" && url.pathname === "/api/validation/reset") {
        const body = await readJsonBody(request);
        return writeJson(response, 200, validationController.resetScenario(body.scenarioId));
      }

      if (request.method === "POST" && url.pathname === "/api/validation/step") {
        const body = await readJsonBody(request);
        return writeJson(
          response,
          200,
          await validationController.runStep(body.scenarioId, body.stepId),
        );
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/instances/")) {
        const serverInstanceId = decodeURIComponent(url.pathname.replace("/api/instances/", ""));
        const body = await readJsonBody(request);
        return writeJson(response, 200, controller.updateInstance(serverInstanceId, body));
      }

      if (request.method === "GET") {
        return serveStaticAsset(url.pathname, response);
      }

      writeJson(response, 405, { error: "Method not allowed" });
    } catch (error) {
      writeJson(response, 400, {
        error: error.message,
      });
    }
  };
}

async function serveStaticAsset(pathname, response) {
  const assetPath = pathname === "/" ? "/index.html" : pathname;
  const resolvedPath = path.join(PUBLIC_DIR, assetPath);

  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    writeJson(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    const file = await readFile(resolvedPath);
    response.writeHead(200, {
      "content-type": contentTypeFor(resolvedPath),
    });
    response.end(file);
  } catch {
    writeJson(response, 404, { error: "Not found" });
  }
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }

  return "text/plain; charset=utf-8";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dashboard = createDashboardServer();
  dashboard.start().then((address) => {
    const effectivePort =
      typeof address === "object" && address ? address.port : DEFAULT_DASHBOARD_OPERATOR_CONFIG.port;
    console.log(`Local MCP dashboard running at http://127.0.0.1:${effectivePort}`);
  });
}
