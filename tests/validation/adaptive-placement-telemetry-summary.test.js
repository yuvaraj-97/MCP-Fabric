import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createTelemetryQualitySummary,
  loadTelemetryInputs,
} from "../../validation/adaptive-placement/telemetry-summary.js";

test("telemetry summary passes for explainable fallbacks and zero mismatches", () => {
  const summary = createTelemetryQualitySummary({
    reports: [
      {
        label: "sustained-report",
        summary: {
          totalRequests: 10,
          adaptivePlacements: 5,
          fallbacks: 2,
          mismatches: 0,
          phase2Drifts: 5,
          highConfidenceRecommendations: 8,
        },
        gateways: [
          {
            gatewayId: "gateway-a",
            observability: {
              recentEvents: [
                {
                  eventType: "adaptive.placement.fallback",
                  runtimeModeSource: "explicit",
                },
                {
                  eventType: "runtime.recommendation",
                  runtimeRecommendation: { confidence: "high" },
                },
              ],
            },
          },
        ],
      },
      {
        label: "shared-redis-report",
        checks: {
          crossGatewayReuse: true,
          adaptiveCrossGatewayMetadata: true,
        },
      },
    ],
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.status, "pass");
  assert.equal(summary.metrics.totalAdaptivePlacementMismatches, 0);
  assert.equal(summary.metrics.fallbackReasons.explicit, 1);
  assert.equal(summary.metrics.crossGatewayMetadata.pass, 1);
  assert.equal(summary.metrics.phase2DriftCount, 5);
});

test("telemetry summary fails closed for mismatches and invalid classifier fallbacks", () => {
  const summary = createTelemetryQualitySummary({
    reports: [
      {
        label: "bad-canary",
        gateways: [
          {
            gatewayId: "gateway-a",
            observability: {
              summary: {
                totalRequests: 4,
                totalAdaptivePlacementMismatches: 1,
              },
              recentEvents: [
                {
                  eventType: "adaptive.placement.fallback",
                  runtimeModeSource: "invalid-classifier-recommendation",
                },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.status, "review_required");
  assert.equal(summary.metrics.totalAdaptivePlacementMismatches, 1);
  assert.equal(summary.metrics.invalidClassifierFallbacks, 1);
  assert.match(summary.reasons.join("\n"), /unexpected fallback source invalid-classifier-recommendation/);
  assert.match(summary.reasons.join("\n"), /adaptive placement mismatches observed: 1/);
});

test("telemetry summary loads external canary evidence directory summaries", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "phase-4-telemetry-summary-"));

  writeFileSync(
    join(evidenceDir, "baseline-evidence-summary.json"),
    JSON.stringify({
      phase: "baseline",
      gateways: [
        {
          gatewayId: "gateway-a",
          observability: {
            summary: {
              totalRequests: 1,
              totalAdaptivePlacementMismatches: 0,
            },
            recentEvents: [],
          },
        },
      ],
    }),
    "utf8",
  );
  writeFileSync(
    join(evidenceDir, "canary-evidence-summary.json"),
    JSON.stringify({
      phase: "canary",
      gateways: [
        {
          gatewayId: "gateway-a",
          observability: {
            summary: {
              totalRequests: 1,
              totalAdaptivePlacements: 1,
              totalAdaptivePlacementDrifts: 1,
              totalAdaptivePlacementMismatches: 0,
            },
            recentEvents: [
              {
                eventType: "adaptive.placement.applied",
                runtimeRecommendation: {
                  confidence: "high",
                  adaptivePlacement: {
                    applied: true,
                    driftFromPhase2Mode: true,
                    runtimeModeSource: "adaptive-classifier",
                  },
                },
              },
            ],
          },
        },
      ],
    }),
    "utf8",
  );

  const summary = createTelemetryQualitySummary({ evidenceDir });
  const loaded = loadTelemetryInputs(evidenceDir);

  assert.equal(summary.ok, true);
  assert.equal(summary.inputCount, 2);
  assert.equal(summary.metrics.totalRequests, 2);
  assert.equal(summary.metrics.totalAdaptivePlacements, 1);
  assert.equal(summary.metrics.phase2DriftCount, 1);
  assert.equal(loaded.length, 2);
});

test("telemetry summary fails for downstream and retained-heap regressions when evidence includes thresholds", () => {
  const summary = createTelemetryQualitySummary({
    reports: [
      {
        label: "canary-errors",
        baselineDownstreamErrorRate: 0.001,
        maxDownstreamErrorRateDelta: 0,
        downstreamErrors: [
          {
            gatewayId: "gateway-a",
            errorRate: 0.002,
          },
        ],
      },
      {
        label: "load-report",
        memory: {
          retainedHeapGrowthBytes: 6_000_000,
          maxRetainedHeapGrowthBytes: 5_242_880,
        },
      },
    ],
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.metrics.downstreamErrors.regressions.length, 1);
  assert.equal(summary.metrics.memory.retainedHeapExceeded.length, 1);
  assert.match(summary.reasons.join("\n"), /downstream error regressions observed: 1/);
  assert.match(summary.reasons.join("\n"), /retained heap ceiling exceeded: 1/);
});

test("telemetry summary can enforce a high-confidence threshold", () => {
  const summary = createTelemetryQualitySummary({
    minHighConfidenceRatio: 0.75,
    reports: [
      {
        label: "confidence-report",
        summary: {
          highConfidenceRecommendations: 1,
        },
        gateways: [
          {
            observability: {
              recentEvents: [
                {
                  eventType: "runtime.recommendation",
                  runtimeRecommendation: { confidence: "low" },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.metrics.confidence.highRatio, 0.5);
  assert.match(summary.reasons.join("\n"), /high-confidence recommendation ratio/);
});
