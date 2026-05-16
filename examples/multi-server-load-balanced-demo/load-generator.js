const target = process.argv[2] ?? "http://127.0.0.1:3001";
const concurrency = Number(process.argv[3] ?? "25");
const totalRequests = Number(process.argv[4] ?? "100");

const startedAt = Date.now();
const latencies = [];
const results = [];

await Promise.all(
  Array.from({ length: totalRequests }, async (_, index) => {
    while (inFlight(results) >= concurrency) {
      await sleep(10);
    }

    const marker = { done: false };
    results.push(marker);

    const requestStartedAt = Date.now();
    try {
      const initializeResponse = await send(target, {
        method: "initialize",
        params: { clientId: `load-test-${index}` },
      });

      const echoResponse = await send(target, {
        method: "echo",
        sessionId: initializeResponse.sessionId,
        params: { message: `burst-${index}` },
      });

      latencies.push(Date.now() - requestStartedAt);
      marker.done = true;
      marker.serverInstanceId = echoResponse.serverInstanceId;
    } catch (error) {
      latencies.push(Date.now() - requestStartedAt);
      marker.done = true;
      marker.error = error instanceof Error ? error.message : String(error);
    }
  }),
);

const distribution = {};
let failures = 0;
for (const result of results) {
  if (result.error) {
    failures += 1;
    continue;
  }

  distribution[result.serverInstanceId] = (distribution[result.serverInstanceId] ?? 0) + 1;
}

latencies.sort((left, right) => left - right);
console.log(JSON.stringify({
  target,
  totalRequests,
  concurrency,
  failures,
  distribution,
  durationMs: Date.now() - startedAt,
  latencyMs: {
    min: latencies[0] ?? 0,
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    max: latencies.at(-1) ?? 0,
  },
}, null, 2));

async function send(baseUrl, body) {
  const response = await fetch(`${baseUrl}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function percentile(values, ratio) {
  if (values.length === 0) {
    return 0;
  }

  const index = Math.min(values.length - 1, Math.floor(values.length * ratio));
  return values[index];
}

function inFlight(results) {
  return results.filter((result) => !result.done).length;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
