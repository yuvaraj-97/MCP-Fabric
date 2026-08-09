export const DEFAULT_GATEWAY_OPERATOR_CONFIG = Object.freeze({
  port: 3000,
  host: "127.0.0.1",
  serverCount: 3,
  loadThreshold: 0.7,
  autoScaleThreshold: 0.8,
  sessionTtlMs: 5 * 60 * 1000,
  reconnectGracePeriodMs: 30 * 1000,
  onDisconnect: "cancel",
  allowPublicBind: false,
  enforceStartupSecurityAudit: true,
  sessionRegistryBackend: "memory",
  sessionRegistryFilePath: undefined,
  sessionRegistryRedisKey: "mcp:gateway:sessions",
  sessionRegistryRedisUrl: undefined,
  adaptivePlacementEnabled: false,
  adaptivePlacementClientAllowlist: [],
  stateHandleKeys: ["browser_id", "sandbox_id", "shell_id", "transaction_id", "workspace_id", "model_handle", "agent_id"],
});

export const DEFAULT_DASHBOARD_OPERATOR_CONFIG = Object.freeze({
  port: 4321,
  host: "127.0.0.1",
  serverCount: 3,
  loadThreshold: 0.7,
  autoScaleThreshold: 0.8,
  sessionTtlMs: 60 * 1000,
  reconnectGracePeriodMs: 15 * 1000,
  onDisconnect: "cancel",
  allowPublicBind: false,
  enforceStartupSecurityAudit: true,
  sessionRegistryBackend: "file",
  sessionRegistryFilePath: undefined,
  sessionRegistryRedisKey: "mcp:gateway:sessions",
  sessionRegistryRedisUrl: undefined,
  adaptivePlacementEnabled: false,
  adaptivePlacementClientAllowlist: [],
  stateHandleKeys: ["browser_id", "sandbox_id", "shell_id", "transaction_id", "workspace_id", "model_handle", "agent_id"],
});

const ALLOWED_ON_DISCONNECT_VALUES = new Set(["cancel", "queue"]);
const ALLOWED_SESSION_REGISTRY_BACKENDS = new Set(["memory", "file", "redis"]);

export function resolveOperatorConfig({
  config = {},
  defaults = DEFAULT_GATEWAY_OPERATOR_CONFIG,
} = {}) {
  const resolved = {
    port: config.port ?? defaults.port,
    host: config.host ?? defaults.host,
    serverCount: config.serverCount ?? defaults.serverCount,
    loadThreshold: config.loadThreshold ?? defaults.loadThreshold,
    autoScaleThreshold: config.autoScaleThreshold ?? defaults.autoScaleThreshold,
    sessionTtlMs: config.sessionTtlMs ?? defaults.sessionTtlMs,
    reconnectGracePeriodMs:
      config.reconnectGracePeriodMs ?? defaults.reconnectGracePeriodMs,
    onDisconnect: config.onDisconnect ?? defaults.onDisconnect,
    allowPublicBind: config.allowPublicBind ?? defaults.allowPublicBind,
    enforceStartupSecurityAudit:
      config.enforceStartupSecurityAudit ?? defaults.enforceStartupSecurityAudit,
    sessionRegistryBackend:
      config.sessionRegistryBackend ?? defaults.sessionRegistryBackend,
    sessionRegistryFilePath:
      config.sessionRegistryFilePath ?? defaults.sessionRegistryFilePath,
    sessionRegistryRedisKey:
      config.sessionRegistryRedisKey ?? defaults.sessionRegistryRedisKey,
    sessionRegistryRedisUrl:
      config.sessionRegistryRedisUrl ?? defaults.sessionRegistryRedisUrl,
    adaptivePlacementEnabled:
      config.adaptivePlacementEnabled ?? defaults.adaptivePlacementEnabled,
    adaptivePlacementClientAllowlist:
      config.adaptivePlacementClientAllowlist ?? defaults.adaptivePlacementClientAllowlist,
    stateHandleKeys:
      config.stateHandleKeys ?? defaults.stateHandleKeys,
  };

  validateOperatorConfig(resolved);
  return Object.freeze({
    ...resolved,
    adaptivePlacementClientAllowlist: Object.freeze([
      ...resolved.adaptivePlacementClientAllowlist,
    ]),
    stateHandleKeys: Object.freeze([
      ...resolved.stateHandleKeys,
    ]),
  });
}

export function operatorConfigFromEnv({
  env = process.env,
  defaults = DEFAULT_GATEWAY_OPERATOR_CONFIG,
} = {}) {
  return resolveOperatorConfig({
    defaults,
    config: {
      port: parseOptionalNumber(env.PORT),
      host: env.HOST ?? env.MCP_GATEWAY_HOST ?? env.MCP_OPERATOR_HOST,
      serverCount: parseOptionalNumber(
        env.MCP_GATEWAY_DEFAULT_SERVER_COUNT ?? env.MCP_OPERATOR_SERVER_COUNT,
      ),
      loadThreshold: parseOptionalNumber(
        env.MCP_GATEWAY_LOAD_THRESHOLD ?? env.MCP_OPERATOR_MAX_LOAD,
      ),
      autoScaleThreshold: parseOptionalNumber(
        env.MCP_GATEWAY_AUTOSCALE_THRESHOLD ?? env.MCP_OPERATOR_AUTOSCALE_THRESHOLD,
      ),
      sessionTtlMs: parseOptionalNumber(
        env.MCP_GATEWAY_SESSION_TTL_MS ?? env.MCP_OPERATOR_SESSION_TTL_MS,
      ),
      reconnectGracePeriodMs: parseOptionalNumber(
        env.MCP_GATEWAY_RECONNECT_GRACE_MS ?? env.MCP_OPERATOR_RECONNECT_GRACE_MS,
      ),
      onDisconnect:
        env.MCP_GATEWAY_ON_DISCONNECT ?? env.MCP_OPERATOR_ON_DISCONNECT,
      allowPublicBind: parseOptionalBoolean(
        env.MCP_GATEWAY_ALLOW_PUBLIC_BIND ?? env.MCP_OPERATOR_ALLOW_PUBLIC_BIND,
      ),
      enforceStartupSecurityAudit: parseOptionalBoolean(
        env.MCP_GATEWAY_ENFORCE_STARTUP_SECURITY_AUDIT ??
          env.MCP_OPERATOR_ENFORCE_STARTUP_SECURITY_AUDIT,
      ),
      sessionRegistryBackend:
        env.MCP_GATEWAY_SESSION_REGISTRY_BACKEND ??
        env.MCP_OPERATOR_SESSION_REGISTRY_BACKEND,
      sessionRegistryFilePath:
        env.MCP_GATEWAY_SESSION_REGISTRY_FILE ??
        env.MCP_OPERATOR_SESSION_REGISTRY_FILE,
      sessionRegistryRedisKey:
        env.MCP_GATEWAY_SESSION_REGISTRY_REDIS_KEY ??
        env.MCP_OPERATOR_SESSION_REGISTRY_REDIS_KEY,
      sessionRegistryRedisUrl:
        env.MCP_GATEWAY_SESSION_REGISTRY_REDIS_URL ??
        env.MCP_OPERATOR_SESSION_REGISTRY_REDIS_URL ??
        env.REDIS_URL,
      adaptivePlacementEnabled: parseOptionalBoolean(
        env.MCP_GATEWAY_ADAPTIVE_PLACEMENT_ENABLED ??
          env.MCP_OPERATOR_ADAPTIVE_PLACEMENT_ENABLED,
      ),
      adaptivePlacementClientAllowlist: parseClientAllowlist(
        env.MCP_GATEWAY_ADAPTIVE_PLACEMENT_CLIENT_ALLOWLIST ??
          env.MCP_OPERATOR_ADAPTIVE_PLACEMENT_CLIENT_ALLOWLIST,
      ),
      stateHandleKeys: env.MCP_GATEWAY_STATE_HANDLE_KEYS ?? env.MCP_OPERATOR_STATE_HANDLE_KEYS
        ? (env.MCP_GATEWAY_STATE_HANDLE_KEYS ?? env.MCP_OPERATOR_STATE_HANDLE_KEYS).split(",").map(k => k.trim())
        : undefined,
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
  assertNonEmptyString(config.host, "host");
  assertPositiveInteger(config.serverCount, "serverCount");

  if (typeof config.loadThreshold !== "number" || Number.isNaN(config.loadThreshold)) {
    throw new TypeError("loadThreshold must be a number");
  }

  if (config.loadThreshold < 0 || config.loadThreshold > 1) {
    throw new RangeError("loadThreshold must be between 0 and 1");
  }

  if (
    typeof config.autoScaleThreshold !== "number" ||
    Number.isNaN(config.autoScaleThreshold)
  ) {
    throw new TypeError("autoScaleThreshold must be a number");
  }

  if (config.autoScaleThreshold < 0 || config.autoScaleThreshold > 1) {
    throw new RangeError("autoScaleThreshold must be between 0 and 1");
  }

  assertPositiveInteger(config.sessionTtlMs, "sessionTtlMs");
  assertPositiveInteger(config.reconnectGracePeriodMs, "reconnectGracePeriodMs");

  if (!ALLOWED_ON_DISCONNECT_VALUES.has(config.onDisconnect)) {
    throw new RangeError('onDisconnect must be one of: "cancel", "queue"');
  }

  if (typeof config.allowPublicBind !== "boolean") {
    throw new TypeError("allowPublicBind must be a boolean");
  }

  if (typeof config.enforceStartupSecurityAudit !== "boolean") {
    throw new TypeError("enforceStartupSecurityAudit must be a boolean");
  }

  if (!ALLOWED_SESSION_REGISTRY_BACKENDS.has(config.sessionRegistryBackend)) {
    throw new RangeError('sessionRegistryBackend must be one of: "memory", "file", "redis"');
  }

  if (
    config.sessionRegistryFilePath !== undefined &&
    (typeof config.sessionRegistryFilePath !== "string" ||
      config.sessionRegistryFilePath.trim().length === 0)
  ) {
    throw new TypeError("sessionRegistryFilePath must be a non-empty string when provided");
  }

  assertNonEmptyString(config.sessionRegistryRedisKey, "sessionRegistryRedisKey");

  if (
    config.sessionRegistryRedisUrl !== undefined &&
    (typeof config.sessionRegistryRedisUrl !== "string" ||
      config.sessionRegistryRedisUrl.trim().length === 0)
  ) {
    throw new TypeError("sessionRegistryRedisUrl must be a non-empty string when provided");
  }

  if (typeof config.adaptivePlacementEnabled !== "boolean") {
    throw new TypeError("adaptivePlacementEnabled must be a boolean");
  }

  if (!Array.isArray(config.adaptivePlacementClientAllowlist)) {
    throw new TypeError("adaptivePlacementClientAllowlist must be an array");
  }

  for (const clientId of config.adaptivePlacementClientAllowlist) {
    if (typeof clientId !== "string" || clientId.trim().length === 0) {
      throw new TypeError("adaptivePlacementClientAllowlist items must be non-empty strings");
    }
  }

  if (!Array.isArray(config.stateHandleKeys)) {
    throw new TypeError("stateHandleKeys must be an array");
  }

  for (const key of config.stateHandleKeys) {
    if (typeof key !== "string" || key.trim().length === 0) {
      throw new TypeError("stateHandleKeys items must be non-empty strings");
    }
  }
}

function parseClientAllowlist(value) {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  if (typeof value !== "string") {
    throw new TypeError("adaptivePlacementClientAllowlist must be a string or undefined");
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return [];
  }

  return trimmed.split(",").map((id) => {
    const cleaned = id.trim();
    if (!cleaned) {
      throw new TypeError("adaptivePlacementClientAllowlist contains empty client ID");
    }
    return cleaned;
  });
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

function parseOptionalBoolean(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (value === "true" || value === "1") {
    return true;
  }

  if (value === "false" || value === "0") {
    return false;
  }

  throw new TypeError(`Expected a boolean environment value, received ${value}`);
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}
