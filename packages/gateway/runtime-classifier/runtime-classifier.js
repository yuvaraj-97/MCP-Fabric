import { RUNTIME_MODES, normalizeRuntimeMode } from "../load-balancer/load-router.js";

const DEFAULT_TRANSPORT = "unknown";
const LONG_DURATION_MS = 30_000;
const EXPENSIVE_INITIALIZATION_MS = 5_000;

export function analyzeRuntimeAffinity({
  explicitRuntimeMode,
  existingRuntimeMode,
  method,
  runtimeHints = {},
  transport = DEFAULT_TRANSPORT,
} = {}) {
  const effectiveRuntimeMode = normalizeRuntimeMode(
    explicitRuntimeMode ?? existingRuntimeMode ?? RUNTIME_MODES.STICKY,
  );
  const normalizedHints = normalizeRuntimeHints(runtimeHints);
  const reasons = [];
  const stickyScore = scoreStickyTendency({ hints: normalizedHints, method, reasons, transport });
  const statelessScore = scoreStatelessTendency({ hints: normalizedHints, method, reasons });
  const recommendedMode =
    statelessScore > stickyScore ? RUNTIME_MODES.STATELESS : RUNTIME_MODES.STICKY;
  const confidence = confidenceFromScores({ recommendedMode, statelessScore, stickyScore });
  const explicitOverride = explicitRuntimeMode !== undefined && explicitRuntimeMode !== recommendedMode;

  if (explicitOverride) {
    reasons.push({
      code: "explicit-override-differs-from-recommendation",
      message: `Explicit runtime mode ${explicitRuntimeMode} overrides recommendation ${recommendedMode}.`,
      weight: 0,
    });
  }

  if (reasons.length === 0) {
    reasons.push({
      code: "no-runtime-signals",
      message: "No runtime affinity signals were declared; default recommendation remains sticky.",
      weight: 0,
    });
  }

  return {
    phase: "recommendation-only",
    automaticPlacement: false,
    transport,
    method: method ?? null,
    effectiveRuntimeMode,
    explicitRuntimeMode: explicitRuntimeMode ?? null,
    existingRuntimeMode: existingRuntimeMode ?? null,
    recommendedMode,
    confidence,
    scores: {
      stateless: statelessScore,
      sticky: stickyScore,
    },
    signals: normalizedHints,
    reasons,
    explicitOverride,
  };
}

export function normalizeRuntimeHints(runtimeHints = {}) {
  const invalidHints = [];
  if (!runtimeHints || typeof runtimeHints !== "object" || Array.isArray(runtimeHints)) {
    return {
      streaming: false,
      resourceHandles: [],
      replaySafe: null,
      externalState: null,
      readOnly: null,
      runtimeDurationMs: null,
      initializationCostMs: null,
      invalidHints: ["runtimeHints"],
    };
  }

  const resourceHandles = normalizeStringArray({
    invalidHints,
    name: "resourceHandles",
    value: runtimeHints.resourceHandles,
  });
  return {
    streaming: Boolean(runtimeHints.streaming),
    resourceHandles,
    replaySafe:
      typeof runtimeHints.replaySafe === "boolean" ? runtimeHints.replaySafe : null,
    externalState:
      typeof runtimeHints.externalState === "boolean" ? runtimeHints.externalState : null,
    readOnly: typeof runtimeHints.readOnly === "boolean" ? runtimeHints.readOnly : null,
    runtimeDurationMs: normalizeOptionalNonNegativeNumber({
      invalidHints,
      name: "runtimeDurationMs",
      value: runtimeHints.runtimeDurationMs,
    }),
    initializationCostMs: normalizeOptionalNonNegativeNumber({
      invalidHints,
      name: "initializationCostMs",
      value: runtimeHints.initializationCostMs,
    }),
    invalidHints,
  };
}

function scoreStickyTendency({ hints, method, reasons, transport }) {
  let score = 0;

  if (transport === "http-sse") {
    score += 1;
    reasons.push({
      code: "http-sse-transport",
      message: "HTTP/SSE transport benefits from session continuity diagnostics.",
      weight: 1,
    });
  }

  if (method === "initialize") {
    score += 1;
    reasons.push({
      code: "initialization-request",
      message: "Initialization creates or refreshes session lifecycle state.",
      weight: 1,
    });
  }

  if (hints.streaming) {
    score += 3;
    reasons.push({
      code: "streaming",
      message: "Streaming workloads tend to require runtime affinity.",
      weight: 3,
    });
  }

  if (hints.resourceHandles.length > 0) {
    score += 4;
    reasons.push({
      code: "resource-handles",
      message: "Resource handles usually require the same runtime while active.",
      weight: 4,
      resources: [...hints.resourceHandles],
    });
  }

  if (hints.replaySafe === false) {
    score += 3;
    reasons.push({
      code: "replay-unsafe",
      message: "Replay-unsafe workloads should avoid transparent reassignment.",
      weight: 3,
    });
  }

  if (typeof hints.runtimeDurationMs === "number" && hints.runtimeDurationMs >= LONG_DURATION_MS) {
    score += 2;
    reasons.push({
      code: "long-running",
      message: "Long-running workloads tend to benefit from runtime affinity.",
      weight: 2,
    });
  }

  if (
    typeof hints.initializationCostMs === "number" &&
    hints.initializationCostMs >= EXPENSIVE_INITIALIZATION_MS
  ) {
    score += 2;
    reasons.push({
      code: "expensive-initialization",
      message: "Expensive initialization favors preserving runtime affinity.",
      weight: 2,
    });
  }

  return score;
}

function scoreStatelessTendency({ hints, method, reasons }) {
  let score = 0;

  if (method && method !== "initialize") {
    score += 1;
    reasons.push({
      code: "follow-up-request",
      message: "Non-initialization requests can be stateless when replay and state contracts allow it.",
      weight: 1,
    });
  }

  if (hints.replaySafe === true) {
    score += 3;
    reasons.push({
      code: "replay-safe",
      message: "Replay-safe workloads are better candidates for stateless routing.",
      weight: 3,
    });
  }

  if (hints.readOnly === true) {
    score += 2;
    reasons.push({
      code: "read-only",
      message: "Read-only workloads are better candidates for stateless routing.",
      weight: 2,
    });
  }

  if (hints.externalState === true) {
    score += 2;
    reasons.push({
      code: "external-state",
      message: "External state reduces the need for runtime-local affinity.",
      weight: 2,
    });
  }

  if (
    hints.streaming === false &&
    hints.resourceHandles.length === 0 &&
    (hints.replaySafe === true || hints.readOnly === true || hints.externalState === true)
  ) {
    score += 1;
    reasons.push({
      code: "no-local-continuity-signals",
      message: "No streaming or resource-handle signals were declared.",
      weight: 1,
    });
  }

  if (hints.invalidHints.length > 0) {
    reasons.push({
      code: "invalid-runtime-hints-ignored",
      message: "One or more malformed runtime hints were ignored for recommendation diagnostics.",
      weight: 0,
      invalidHints: [...hints.invalidHints],
    });
  }

  return score;
}

function confidenceFromScores({ recommendedMode, statelessScore, stickyScore }) {
  const winningScore =
    recommendedMode === RUNTIME_MODES.STATELESS ? statelessScore : stickyScore;
  const losingScore =
    recommendedMode === RUNTIME_MODES.STATELESS ? stickyScore : statelessScore;
  const spread = winningScore - losingScore;

  if (spread >= 4) {
    return "high";
  }

  if (spread >= 2) {
    return "medium";
  }

  return "low";
}

function normalizeStringArray({ invalidHints, name, value }) {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    invalidHints.push(name);
    return [];
  }

  return [...value];
}

function normalizeOptionalNonNegativeNumber({ invalidHints, name, value }) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "number" || value < 0 || !Number.isFinite(value)) {
    invalidHints.push(name);
    return null;
  }

  return value;
}
