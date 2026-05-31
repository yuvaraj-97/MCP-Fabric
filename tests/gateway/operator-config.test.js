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
      MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED: "1",
    },
  });

  assert.equal(config.port, 4999);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.serverCount, 4);
  assert.equal(config.loadThreshold, 0.75);
  assert.equal(config.autoScaleThreshold, 0.8);
  assert.equal(config.sessionTtlMs, 90_000);
  assert.equal(config.reconnectGracePeriodMs, 12_000);
  assert.equal(config.onDisconnect, "cancel");
  assert.equal(config.allowPublicBind, false);
  assert.equal(config.enforceStartupSecurityAudit, true);
  assert.equal(config.sessionRegistryBackend, "file");
  assert.equal(config.sessionRegistryRedisKey, "mcp:gateway:sessions");
  assert.equal(config.adaptivePlacementEnabled, true);
});

test("operator config parses a valid disconnect policy override", () => {
  const config = operatorConfigFromEnv({
    env: {
      MCP_GATEWAY_ON_DISCONNECT: "queue",
      HOST: "0.0.0.0",
      MCP_GATEWAY_AUTOSCALE_THRESHOLD: "0.91",
      MCP_GATEWAY_ALLOW_PUBLIC_BIND: "1",
      MCP_GATEWAY_ENFORCE_STARTUP_SECURITY_AUDIT: "0",
    },
  });

  assert.equal(config.onDisconnect, "queue");
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.autoScaleThreshold, 0.91);
  assert.equal(config.allowPublicBind, true);
  assert.equal(config.enforceStartupSecurityAudit, false);
});

test("operator config parses session registry backend overrides", () => {
  const config = operatorConfigFromEnv({
    env: {
      MCP_GATEWAY_SESSION_REGISTRY_BACKEND: "redis",
      MCP_GATEWAY_SESSION_REGISTRY_REDIS_KEY: "mcp:custom:sessions",
      MCP_GATEWAY_SESSION_REGISTRY_REDIS_URL: "redis://127.0.0.1:6379",
      MCP_GATEWAY_SESSION_REGISTRY_FILE: "/tmp/mcp-sessions.json",
    },
  });

  assert.equal(config.sessionRegistryBackend, "redis");
  assert.equal(config.sessionRegistryRedisKey, "mcp:custom:sessions");
  assert.equal(config.sessionRegistryRedisUrl, "redis://127.0.0.1:6379");
  assert.equal(config.sessionRegistryFilePath, "/tmp/mcp-sessions.json");
});

test("operator config rejects invalid threshold values", () => {
  assert.throws(
    () =>
      operatorConfigFromEnv({
        env: { MCP_GATEWAY_LOAD_THRESHOLD: "1.2" },
      }),
    /loadThreshold must be between 0 and 1/,
  );

  assert.throws(
    () =>
      operatorConfigFromEnv({
        env: { MCP_GATEWAY_AUTOSCALE_THRESHOLD: "1.2" },
      }),
    /autoScaleThreshold must be between 0 and 1/,
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

  assert.throws(
    () =>
      operatorConfigFromEnv({
        env: { MCP_GATEWAY_ON_DISCONNECT: "pause" },
      }),
    /onDisconnect must be one of: "cancel", "queue"/,
  );

  assert.throws(
    () =>
      operatorConfigFromEnv({
        env: { MCP_GATEWAY_ALLOW_PUBLIC_BIND: "maybe" },
      }),
    /Expected a boolean environment value/,
  );

  assert.throws(
    () =>
      operatorConfigFromEnv({
        env: { MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED: "maybe" },
      }),
    /Expected a boolean environment value/,
  );

  assert.throws(
    () =>
      operatorConfigFromEnv({
        env: { MCP_GATEWAY_SESSION_REGISTRY_BACKEND: "database" },
      }),
    /sessionRegistryBackend must be one of: "memory", "file", "redis"/,
  );

  assert.throws(
    () =>
      operatorConfigFromEnv({
        env: { MCP_GATEWAY_SESSION_REGISTRY_FILE: "   " },
      }),
    /sessionRegistryFilePath must be a non-empty string when provided/,
  );

  assert.throws(
    () =>
      operatorConfigFromEnv({
        env: { MCP_GATEWAY_SESSION_REGISTRY_REDIS_KEY: "   " },
      }),
    /sessionRegistryRedisKey must be a non-empty string/,
  );

  assert.throws(
    () =>
      operatorConfigFromEnv({
        env: { MCP_GATEWAY_SESSION_REGISTRY_REDIS_URL: "   " },
      }),
    /sessionRegistryRedisUrl must be a non-empty string when provided/,
  );
});

test("demo server instance generation honors configured server count", () => {
  const instances = createDemoServerInstances({ serverCount: 4 });

  assert.equal(instances.length, 4);
  assert.equal(instances[0].serverInstanceId, "server-a");
  assert.equal(instances[3].serverInstanceId, "server-d");
});

test("operator config parses adaptive placement client allowlist from environment", () => {
  const config = operatorConfigFromEnv({
    env: {
      MCP_GATEWAY_ADAPTIVE_PLACEMENT_CLIENT_ALLOWLIST: "client-1, client-2, client-3",
    },
  });

  assert.deepEqual(config.adaptivePlacementClientAllowlist, ["client-1", "client-2", "client-3"]);
});

test("operator config parses alternative env var for adaptive placement client allowlist", () => {
  const config = operatorConfigFromEnv({
    env: {
      MCP_OPERATOR_ADAPTIVE_PLACEMENT_CLIENT_ALLOWLIST: "app-a,app-b",
    },
  });

  assert.deepEqual(config.adaptivePlacementClientAllowlist, ["app-a", "app-b"]);
});

test("operator config returns empty allowlist when env var is empty", () => {
  const config = operatorConfigFromEnv({
    env: {
      MCP_GATEWAY_ADAPTIVE_PLACEMENT_CLIENT_ALLOWLIST: "  ",
    },
  });

  assert.deepEqual(config.adaptivePlacementClientAllowlist, []);
});

test("operator config rejects invalid adaptive placement client allowlist", () => {
  assert.throws(
    () =>
      operatorConfigFromEnv({
        env: {
          MCP_GATEWAY_ADAPTIVE_PLACEMENT_CLIENT_ALLOWLIST: "client-1,,client-2",
        },
      }),
    /adaptivePlacementClientAllowlist contains empty client ID/,
  );
});

test("operator config preserves explicit allowlist in resolve", () => {
  const config = resolveOperatorConfig({
    config: {
      adaptivePlacementClientAllowlist: ["explicit-client-1", "explicit-client-2"],
    },
  });

  assert.deepEqual(config.adaptivePlacementClientAllowlist, [
    "explicit-client-1",
    "explicit-client-2",
  ]);
});
