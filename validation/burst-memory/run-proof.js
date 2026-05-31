import { createHttpSseGatewayController } from "../../packages/transports/http-sse/gateway-server.js";

const DEFAULT_SESSION_COUNT = 5_000;
const DEFAULT_CONCURRENCY = 100;
const DEFAULT_SESSION_TTL_MS = 1_000;
const DEFAULT_MAX_PEAK_HEAP_GROWTH_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_RETAINED_HEAP_GROWTH_BYTES = 48 * 1024 * 1024;

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await runBurstMemoryProof({
    sessionCount: readPositiveInteger("MCP_BURST_SESSION_COUNT", DEFAULT_SESSION_COUNT),
    concurrency: readPositiveInteger("MCP_BURST_CONCURRENCY", DEFAULT_CONCURRENCY),
    sessionTtlMs: readPositiveInteger("MCP_BURST_SESSION_TTL_MS", DEFAULT_SESSION_TTL_MS),
  });
  console.log(JSON.stringify(report, null, 2));
}

export async function runBurstMemoryProof({
  sessionCount = DEFAULT_SESSION_COUNT,
  concurrency = DEFAULT_CONCURRENCY,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
  maxPeakHeapGrowthBytes = DEFAULT_MAX_PEAK_HEAP_GROWTH_BYTES,
  maxRetainedHeapGrowthBytes = DEFAULT_MAX_RETAINED_HEAP_GROWTH_BYTES,
} = {}) {
  const clock = createClock();
  const controller = createHttpSseGatewayController({
    now: clock.now,
    sessionTtlMs,
    serverInstances: [{ serverInstanceId: "burst-a", load: 0.1, healthy: true }],
    createApplication({ serverInstanceId }) {
      return createStatelessProofApplication({ serverInstanceId });
    },
  });

  forceGc();
  const baseline = captureMemory("baseline");
  let peak = baseline;

  await runInBatches({
    total: sessionCount,
    concurrency,
    async task(index) {
      await controller.handleGatewayMessage({
        method: "initialize",
        sessionId: `burst-session-${index}`,
        params: { clientId: "burst-memory-proof" },
      });
      const current = captureMemory("during-burst");
      if (current.heapUsedBytes > peak.heapUsedBytes) {
        peak = current;
      }
    },
  });

  const afterBurst = captureMemory("after-burst");
  const activeSessionsAfterBurst = (await controller.sessionRegistry.list()).length;
  clock.advance(sessionTtlMs + 1);
  const prunedSessions = await controller.sessionRegistry.pruneExpired();
  forceGc();
  const afterPrune = captureMemory("after-prune");
  const activeSessionsAfterPrune = (await controller.sessionRegistry.list()).length;

  const peakHeapGrowthBytes = Math.max(peak.heapUsedBytes, afterBurst.heapUsedBytes) - baseline.heapUsedBytes;
  const retainedHeapGrowthBytes = afterPrune.heapUsedBytes - baseline.heapUsedBytes;
  const ok =
    activeSessionsAfterBurst === sessionCount &&
    prunedSessions === sessionCount &&
    activeSessionsAfterPrune === 0 &&
    peakHeapGrowthBytes <= maxPeakHeapGrowthBytes &&
    retainedHeapGrowthBytes <= maxRetainedHeapGrowthBytes;

  const report = {
    ok,
    sessionCount,
    concurrency,
    sessionTtlMs,
    activeSessionsAfterBurst,
    prunedSessions,
    activeSessionsAfterPrune,
    memory: {
      baseline,
      peak,
      afterBurst,
      afterPrune,
      peakHeapGrowthBytes,
      retainedHeapGrowthBytes,
      maxPeakHeapGrowthBytes,
      maxRetainedHeapGrowthBytes,
    },
  };

  if (!ok) {
    throw Object.assign(new Error("Burst memory proof failed"), { report });
  }

  return report;
}

async function runInBatches({ total, concurrency, task }) {
  for (let start = 0; start < total; start += concurrency) {
    const end = Math.min(start + concurrency, total);
    await Promise.all(
      Array.from({ length: end - start }, (_, offset) => task(start + offset)),
    );
  }
}

function createStatelessProofApplication({ serverInstanceId }) {
  return {
    getSessionState() {
      return { serverInstanceId };
    },
    async handleMessage(message) {
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          serverInstanceId,
          ok: true,
        },
      };
    },
  };
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
    globalThis.gc();
  }
}

function createClock(start = Date.now()) {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
      return current;
    },
  };
}

function readPositiveInteger(name, fallback) {
  const rawValue = process.env[name];
  if (rawValue === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return parsed;
}
