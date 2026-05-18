import assert from "node:assert/strict";
import test from "node:test";

import {
  createDemoServerInstances,
  DEFAULT_DASHBOARD_OPERATOR_CONFIG,
  DEFAULT_GATEWAY_OPERATOR_CONFIG,
  operatorConfigFromEnv,
  resolveOperatorConfig,
} from "../../packages/gateway/config/operator-config.js";

test("operator config uses gateway defaults when no overrides are provided", () => {
  const config = resolveOperatorConfig();

  assert.deepEqual(config, DEFAULT_GATEWAY_OPERATOR_CONFIG);
});

test("operator config parses valid environment overrides", () => {
  const config = operatorConfigFromEnv({
    defaults: DEFAULT_DASHBOARD_OPERATOR_CONFIG,
    env: {
      PORT: "4999",
      MCP_GATEWAY_DEFAULT_SERVER_COUNT: "4",
      MCP_GATEWAY_LOAD_THRESHOLD: "0.75",
      MCP_GATEWAY_SESSION_TTL_MS: "90000",
      MCP_GATEWAY_RECONNECT_GRACE_MS: "12000",
    },
  });

  assert.equal(config.port, 4999);
  assert.equal(config.serverCount, 4);
  assert.equal(config.loadThreshold, 0.75);
  assert.equal(config.sessionTtlMs, 90_000);
  assert.equal(config.reconnectGracePeriodMs, 12_000);
});

test("operator config rejects invalid threshold values", () => {
  assert.throws(
    () =>
      operatorConfigFromEnv({
        env: { MCP_GATEWAY_LOAD_THRESHOLD: "1.2" },
      }),
    /loadThreshold must be between 0 and 1/,
  );
});

test("operator config rejects non-positive lifecycle and fleet values", () => {
  assert.throws(
    () =>
      operatorConfigFromEnv({
        env: { MCP_GATEWAY_DEFAULT_SERVER_COUNT: "0" },
      }),
    /serverCount must be a positive integer/,
  );

  assert.throws(
    () =>
      operatorConfigFromEnv({
        env: { MCP_GATEWAY_SESSION_TTL_MS: "-5" },
      }),
    /sessionTtlMs must be a positive integer/,
  );

  assert.throws(
    () =>
      operatorConfigFromEnv({
        env: { MCP_GATEWAY_RECONNECT_GRACE_MS: "0" },
      }),
    /reconnectGracePeriodMs must be a positive integer/,
  );
});

test("demo server instance generation honors configured server count", () => {
  const instances = createDemoServerInstances({ serverCount: 4 });

  assert.equal(instances.length, 4);
  assert.equal(instances[0].serverInstanceId, "server-a");
  assert.equal(instances[3].serverInstanceId, "server-d");
});
