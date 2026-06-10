import assert from "node:assert/strict";
import test from "node:test";

import {
  createStandaloneGatewayFromEnv,
} from "../../packages/gateway/bin/standalone-gateway.js";

test("standalone gateway boots self-contained from env and serves /health", async () => {
  const gateway = createStandaloneGatewayFromEnv({
    env: { HOST: "127.0.0.1" },
  });
  const address = await gateway.listen({ port: 0, host: "127.0.0.1" });

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.instances) && body.instances.length > 0);
  } finally {
    await gateway.close();
  }
});

test("standalone gateway honors SERVER_INSTANCES_JSON for the self-contained topology", async () => {
  const gateway = createStandaloneGatewayFromEnv({
    env: {
      HOST: "127.0.0.1",
      SERVER_INSTANCES_JSON: JSON.stringify([
        { serverInstanceId: "only-one", load: 0.1, healthy: true, acceptingNewSessions: true },
      ]),
    },
  });
  const address = await gateway.listen({ port: 0, host: "127.0.0.1" });

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    const body = await response.json();
    assert.deepEqual(
      body.instances.map((instance) => instance.serverInstanceId),
      ["only-one"],
    );
  } finally {
    await gateway.close();
  }
});

test("standalone gateway requires SERVER_INSTANCES_JSON when remote base URLs are provided", () => {
  assert.throws(
    () =>
      createStandaloneGatewayFromEnv({
        env: {
          REMOTE_BASE_URLS_JSON: JSON.stringify({ "fs-a": "http://mcp-server-a:4101" }),
        },
      }),
    /REMOTE_BASE_URLS_JSON requires SERVER_INSTANCES_JSON/,
  );
});

test("standalone gateway rejects a malformed REMOTE_BASE_URLS_JSON shape", () => {
  assert.throws(
    () =>
      createStandaloneGatewayFromEnv({
        env: {
          SERVER_INSTANCES_JSON: JSON.stringify([{ serverInstanceId: "fs-a" }]),
          REMOTE_BASE_URLS_JSON: JSON.stringify(["not", "an", "object"]),
        },
      }),
    /REMOTE_BASE_URLS_JSON must be a JSON object/,
  );
});
