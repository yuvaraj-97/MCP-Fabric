import assert from "node:assert/strict";

import { createHttpSseGatewayController } from "../../packages/transports/http-sse/gateway-server.js";

const DEFAULT_SESSION_COUNT = 5_000;
const DEFAULT_CONCURRENCY = 100;
const BASE_MAX_PEAK_HEAP_GROWTH_BYTES = 64 * 1024 * 1024;
const MAX_PEAK_HEAP_GROWTH_BYTES_PER_SESSION = 16 * 1024;
const BASE_MAX_RETAINED_HEAP_GROWTH_BYTES = 24 * 1024 * 1024;
const MAX_RETAINED_HEAP_GROWTH_BYTES_PER_SESSION = 4 * 1024;
const RECENT_EVENT_LIMIT = 100;

const STATELESS_HINTS = {
  replaySafe: true,
  readOnly: true,
  externalState: true,
};

export async function runAdaptivePlacementLoadValidation({
  sessionCount = DEFAULT_SESSION_COUNT,
  concurrency = DEFAULT_CONCURRENCY,
  maxPeakHeapGrowthBytes,
  maxRetainedHeapGrowthBytes,
} = {}) {
  assertPositiveInteger("sessionCount", sessionCount);
  assertPositiveInteger("concurrency", concurrency);
  const effectiveMaxPeakHeapGrowthBytes =
    maxPeakHeapGrowthBytes ?? defaultMaxPeakHeapGrowthBytes(sessionCount);
  const effectiveMaxRetainedHeapGrowthBytes =
    maxRetainedHeapGrowthBytes ?? defaultMaxRetainedHeapGrowthBytes(sessionCount);

  const controller = createHttpSseGatewayController({
    operatorConfig: {
      adaptivePlacementEnabled: true,
      adaptivePlacementClientAllowlist: ["canary-client"],
    },
    serverInstances: [
      { serverInstanceId: "server-a", load: 0.1, healthy: true },
      { serverInstanceId: "server-b", load: 0.2, healthy: true },
      { serverInstanceId: "server-c", load: 0.3, healthy: true },
    ],
  });

  forceGc();
  const baseline = captureMemory("baseline");
  let peak = baseline;

  await runInBatches({
    total: sessionCount,
    concurrency,
    async task(index) {
      const request = createLoadRequest(index);
      await controller.handleGatewayMessage(request);
    },
    afterBatch() {
      const current = captureMemory("during-load");
      if (current.heapUsedBytes > peak.heapUsedBytes) {
        peak = current;
      }
    },
  });

  const afterLoad = captureMemory("after-load");
  forceGc();
  const afterGc = captureMemory("after-gc");
  const observability = controller.describeObservability();
  const expected = expectedCounts(sessionCount);
  const peakHeapGrowthBytes = Math.max(peak.heapUsedBytes, afterLoad.heapUsedBytes) - baseline.heapUsedBytes;
  const retainedHeapGrowthBytes = afterGc.heapUsedBytes - baseline.heapUsedBytes;

  const report = {
    ok: true,
    sessionCount,
    concurrency,
    expected,
    observed: {
      totalInitializations: observability.summary.totalInitializations,
      totalRuntimeRecommendations: observability.summary.totalRuntimeRecommendations,
      totalEvents: observability.summary.totalEvents,
      totalAdaptivePlacements: observability.summary.totalAdaptivePlacements,
      totalAdaptivePlacementStateless: observability.summary.totalAdaptivePlacementStateless,
      totalAdaptivePlacementSticky: observability.summary.totalAdaptivePlacementSticky,
      totalAdaptivePlacementFallbacks: observability.summary.totalAdaptivePlacementFallbacks,
      totalAdaptivePlacementMismatches: observability.summary.totalAdaptivePlacementMismatches,
      totalRuntimeOverrideWarnings: observability.summary.totalRuntimeOverrideWarnings,
      recentEventCount: observability.summary.recentEventCount,
    },
    invariants: {
      placementsPlusFallbacksMatchesInitializations:
        observability.summary.totalAdaptivePlacements +
          observability.summary.totalAdaptivePlacementFallbacks ===
        observability.summary.totalInitializations,
      recentEventsBounded:
        observability.summary.recentEventCount <= RECENT_EVENT_LIMIT,
      mismatchesRemainZero:
        observability.summary.totalAdaptivePlacementMismatches === 0,
      allAdaptivePlacementsAreStateless:
        observability.summary.totalAdaptivePlacements ===
        observability.summary.totalAdaptivePlacementStateless,
      noUnexpectedStickyAdaptivePlacements:
        observability.summary.totalAdaptivePlacementSticky === 0,
      everyInitializationHasRecommendation:
        observability.summary.totalRuntimeRecommendations ===
        observability.summary.totalInitializations,
      expectedEventCountMatches:
        observability.summary.totalEvents === expected.totalEvents,
    },
    memory: {
      baseline,
      peak,
      afterLoad,
      afterGc,
      peakHeapGrowthBytes,
      retainedHeapGrowthBytes,
      maxPeakHeapGrowthBytes: effectiveMaxPeakHeapGrowthBytes,
      maxRetainedHeapGrowthBytes: effectiveMaxRetainedHeapGrowthBytes,
    },
  };

  assertAdaptivePlacementLoadReport(report);
  return report;
}

export function assertAdaptivePlacementLoadReport(report) {
  assert.equal(report.ok, true);
  assert.equal(report.observed.totalInitializations, report.sessionCount);
  assert.equal(report.observed.totalRuntimeRecommendations, report.sessionCount);
  assert.equal(report.observed.totalEvents, report.expected.totalEvents);
  assert.equal(report.observed.totalAdaptivePlacements, report.expected.adaptivePlacements);
  assert.equal(
    report.observed.totalAdaptivePlacementStateless,
    report.expected.adaptivePlacements,
  );
  assert.equal(report.observed.totalAdaptivePlacementSticky, 0);
  assert.equal(report.observed.totalAdaptivePlacementFallbacks, report.expected.fallbacks);
  assert.equal(report.observed.totalRuntimeOverrideWarnings, report.expected.explicitOverrides);
  assert.equal(report.observed.totalAdaptivePlacementMismatches, 0);
  assert.equal(report.invariants.placementsPlusFallbacksMatchesInitializations, true);
  assert.equal(report.invariants.recentEventsBounded, true);
  assert.equal(report.invariants.mismatchesRemainZero, true);
  assert.equal(report.invariants.allAdaptivePlacementsAreStateless, true);
  assert.equal(report.invariants.noUnexpectedStickyAdaptivePlacements, true);
  assert.equal(report.invariants.everyInitializationHasRecommendation, true);
  assert.equal(report.invariants.expectedEventCountMatches, true);
  assert.ok(
    report.memory.peakHeapGrowthBytes <= report.memory.maxPeakHeapGrowthBytes,
    `peak heap growth ${report.memory.peakHeapGrowthBytes} exceeded ${report.memory.maxPeakHeapGrowthBytes}`,
  );
  assert.ok(
    report.memory.retainedHeapGrowthBytes <= report.memory.maxRetainedHeapGrowthBytes,
    `retained heap growth ${report.memory.retainedHeapGrowthBytes} exceeded ${report.memory.maxRetainedHeapGrowthBytes}`,
  );
}

function createLoadRequest(index) {
  const pattern = index % 4;
  if (pattern === 0 || pattern === 1) {
    return {
      method: "initialize",
      sessionId: `load-canary-${index}`,
      params: {
        clientId: "canary-client",
        runtimeHints: STATELESS_HINTS,
      },
    };
  }

  if (pattern === 2) {
    return {
      method: "initialize",
      sessionId: `load-control-${index}`,
      params: {
        clientId: "control-client",
        runtimeHints: STATELESS_HINTS,
      },
    };
  }

  return {
    method: "initialize",
    sessionId: `load-explicit-${index}`,
    params: {
      clientId: "canary-client",
      runtimeMode: "sticky",
      runtimeHints: STATELESS_HINTS,
    },
  };
}

function expectedCounts(sessionCount) {
  let adaptivePlacements = 0;
  let fallbacks = 0;
  let explicitOverrides = 0;
  for (let index = 0; index < sessionCount; index += 1) {
    const pattern = index % 4;
    if (pattern === 0 || pattern === 1) {
      adaptivePlacements += 1;
    } else {
      fallbacks += 1;
    }
    if (pattern === 3) {
      explicitOverrides += 1;
    }
  }

  return {
    adaptivePlacements,
    fallbacks,
    explicitOverrides,
    totalEvents: sessionCount * 4,
  };
}

async function runInBatches({ total, concurrency, task, afterBatch }) {
  for (let start = 0; start < total; start += concurrency) {
    const end = Math.min(start + concurrency, total);
    await Promise.all(
      Array.from({ length: end - start }, (_, offset) => task(start + offset)),
    );
    afterBatch?.();
  }
}

function captureMemory(label) {
  const usage = process.memoryUsage();
  return {
    label,
    heapUsedBytes: usage.heapUsed,
    rssBytes: usage.rss,
  };
}

function forceGc() {
  if (typeof globalThis.gc === "function") {
    for (let index = 0; index < 3; index += 1) {
      globalThis.gc();
    }
  }
}

function assertPositiveInteger(name, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
}

function defaultMaxPeakHeapGrowthBytes(sessionCount) {
  return (
    BASE_MAX_PEAK_HEAP_GROWTH_BYTES +
    sessionCount * MAX_PEAK_HEAP_GROWTH_BYTES_PER_SESSION
  );
}

function defaultMaxRetainedHeapGrowthBytes(sessionCount) {
  return (
    BASE_MAX_RETAINED_HEAP_GROWTH_BYTES +
    sessionCount * MAX_RETAINED_HEAP_GROWTH_BYTES_PER_SESSION
  );
}
