export const DEFAULT_GATEWAY_OPERATOR_CONFIG = Object.freeze({
  port: 3000,
  serverCount: 3,
  loadThreshold: 0.7,
  sessionTtlMs: 5 * 60 * 1000,
  reconnectGracePeriodMs: 30 * 1000,
});

export const DEFAULT_DASHBOARD_OPERATOR_CONFIG = Object.freeze({
  port: 4321,
  serverCount: 3,
  loadThreshold: 0.7,
  sessionTtlMs: 60 * 1000,
  reconnectGracePeriodMs: 15 * 1000,
});

export function resolveOperatorConfig({
  config = {},
  defaults = DEFAULT_GATEWAY_OPERATOR_CONFIG,
} = {}) {
  const resolved = {
    port: config.port ?? defaults.port,
    serverCount: config.serverCount ?? defaults.serverCount,
    loadThreshold: config.loadThreshold ?? defaults.loadThreshold,
    sessionTtlMs: config.sessionTtlMs ?? defaults.sessionTtlMs,
    reconnectGracePeriodMs:
      config.reconnectGracePeriodMs ?? defaults.reconnectGracePeriodMs,
  };

  validateOperatorConfig(resolved);
  return Object.freeze({ ...resolved });
}

export function operatorConfigFromEnv({
  env = process.env,
  defaults = DEFAULT_GATEWAY_OPERATOR_CONFIG,
} = {}) {
  return resolveOperatorConfig({
    defaults,
    config: {
      port: parseOptionalNumber(env.PORT),
      serverCount: parseOptionalNumber(
        env.MCP_GATEWAY_DEFAULT_SERVER_COUNT ?? env.MCP_OPERATOR_SERVER_COUNT,
      ),
      loadThreshold: parseOptionalNumber(
        env.MCP_GATEWAY_LOAD_THRESHOLD ?? env.MCP_OPERATOR_MAX_LOAD,
      ),
      sessionTtlMs: parseOptionalNumber(
        env.MCP_GATEWAY_SESSION_TTL_MS ?? env.MCP_OPERATOR_SESSION_TTL_MS,
      ),
      reconnectGracePeriodMs: parseOptionalNumber(
        env.MCP_GATEWAY_RECONNECT_GRACE_MS ?? env.MCP_OPERATOR_RECONNECT_GRACE_MS,
      ),
    },
  });
}

export function createDemoServerInstances({
  serverCount = DEFAULT_DASHBOARD_OPERATOR_CONFIG.serverCount,
} = {}) {
  assertPositiveInteger(serverCount, "serverCount");

  return Array.from({ length: serverCount }, (_, index) => ({
    serverInstanceId: `server-${String.fromCharCode(97 + index)}`,
    healthy: true,
    load: demoLoadFor(index),
    acceptingNewSessions: true,
  }));
}

function demoLoadFor(index) {
  const demoLoads = [0.22, 0.48, 0.82];
  return demoLoads[index] ?? Math.min(0.18 + index * 0.11, 0.95);
}

function validateOperatorConfig(config) {
  assertPositiveInteger(config.port, "port");
  assertPositiveInteger(config.serverCount, "serverCount");

  if (typeof config.loadThreshold !== "number" || Number.isNaN(config.loadThreshold)) {
    throw new TypeError("loadThreshold must be a number");
  }

  if (config.loadThreshold < 0 || config.loadThreshold > 1) {
    throw new RangeError("loadThreshold must be between 0 and 1");
  }

  assertPositiveInteger(config.sessionTtlMs, "sessionTtlMs");
  assertPositiveInteger(config.reconnectGracePeriodMs, "reconnectGracePeriodMs");
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new TypeError(`Expected a numeric environment value, received ${value}`);
  }

  return parsed;
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}
