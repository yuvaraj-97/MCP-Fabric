import assert from "node:assert/strict";
import test from "node:test";

import { analyzeRuntimeAffinity } from "../../packages/gateway/runtime-classifier/runtime-classifier.js";

test("classifier recommends stateless for replay-safe read-only external-state work", () => {
  const recommendation = analyzeRuntimeAffinity({
    method: "tools/call",
    runtimeHints: {
      replaySafe: true,
      readOnly: true,
      externalState: true,
    },
    transport: "http-sse",
  });

  assert.equal(recommendation.phase, "recommendation-only");
  assert.equal(recommendation.automaticPlacement, false);
  assert.equal(recommendation.recommendedMode, "stateless");
  assert.equal(recommendation.effectiveRuntimeMode, "sticky");
  assert.equal(recommendation.explicitOverride, false);
  assert.ok(recommendation.scores.stateless > recommendation.scores.sticky);
  assert.ok(recommendation.reasons.some((reason) => reason.code === "replay-safe"));
});

test("classifier recommends sticky for streaming resource-handle work", () => {
  const recommendation = analyzeRuntimeAffinity({
    method: "tools/call",
    runtimeHints: {
      streaming: true,
      resourceHandles: ["browser"],
      replaySafe: false,
    },
    transport: "http-sse",
  });

  assert.equal(recommendation.recommendedMode, "sticky");
  assert.equal(recommendation.confidence, "high");
  assert.ok(recommendation.scores.sticky > recommendation.scores.stateless);
  assert.ok(recommendation.reasons.some((reason) => reason.code === "resource-handles"));
});

test("classifier reports explicit overrides without changing effective mode", () => {
  const recommendation = analyzeRuntimeAffinity({
    explicitRuntimeMode: "stateless",
    method: "tools/call",
    runtimeHints: {
      streaming: true,
      resourceHandles: ["terminal"],
      replaySafe: false,
    },
    transport: "http-sse",
  });

  assert.equal(recommendation.recommendedMode, "sticky");
  assert.equal(recommendation.effectiveRuntimeMode, "stateless");
  assert.equal(recommendation.explicitOverride, true);
  assert.ok(
    recommendation.reasons.some(
      (reason) => reason.code === "explicit-override-differs-from-recommendation",
    ),
  );
});

test("classifier treats malformed runtime hints as ignored diagnostics", () => {
  const recommendation = analyzeRuntimeAffinity({
    runtimeHints: {
      resourceHandles: ["browser", 42],
      runtimeDurationMs: -1,
      workerLoad: 2,
    },
  });

  assert.equal(recommendation.recommendedMode, "sticky");
  assert.deepEqual(recommendation.signals.invalidHints, [
    "resourceHandles",
    "runtimeDurationMs",
    "workerLoad",
  ]);
  assert.ok(
    recommendation.reasons.some((reason) => reason.code === "invalid-runtime-hints-ignored"),
  );
});

test("classifier records worker health and load telemetry without changing placement", () => {
  const recommendation = analyzeRuntimeAffinity({
    explicitRuntimeMode: "sticky",
    method: "tools/call",
    runtimeHints: {
      replaySafe: true,
      readOnly: true,
      externalState: true,
      workerHealthy: false,
      workerLoad: 0.95,
    },
    transport: "http-sse",
  });

  assert.equal(recommendation.recommendedMode, "stateless");
  assert.equal(recommendation.effectiveRuntimeMode, "sticky");
  assert.equal(recommendation.automaticPlacement, false);
  assert.equal(recommendation.signals.workerHealthy, false);
  assert.equal(recommendation.signals.workerLoad, 0.95);
  assert.ok(recommendation.reasons.some((reason) => reason.code === "worker-unhealthy"));
  assert.ok(recommendation.reasons.some((reason) => reason.code === "worker-load-high"));
});

test("classifier defaults conservatively to sticky with low confidence", () => {
  const recommendation = analyzeRuntimeAffinity();

  assert.equal(recommendation.recommendedMode, "sticky");
  assert.equal(recommendation.confidence, "low");
  assert.equal(recommendation.automaticPlacement, false);
  assert.ok(recommendation.reasons.some((reason) => reason.code === "no-runtime-signals"));
});
