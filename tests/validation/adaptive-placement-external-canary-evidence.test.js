import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildReportMarkdown,
  collectExternalCanaryEvidence,
  parseGatewaySpecs,
} from "../../validation/adaptive-placement/external-canary-evidence.js";

test("parseGatewaySpecs supports explicit IDs and generated IDs", () => {
  assert.deepEqual(parseGatewaySpecs("gw-a=http://127.0.0.1:3000, http://127.0.0.1:3001"), [
    { gatewayId: "gw-a", baseUrl: "http://127.0.0.1:3000" },
    { gatewayId: "gateway-2", baseUrl: "http://127.0.0.1:3001" },
  ]);
});

test("external canary evidence captures gateway snapshots and writes report artifacts", async (t) => {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (request.url === "/observability") {
      response.end(JSON.stringify({
        operatorConfig: {
          adaptivePlacementEnabled: true,
          adaptivePlacementClientAllowlistSize: 1,
        },
        summary: {
          totalRequests: 3,
          totalErrors: 0,
          totalAdaptivePlacements: 1,
          totalAdaptivePlacementDrifts: 1,
          totalAdaptivePlacementStateless: 1,
          totalAdaptivePlacementSticky: 0,
          totalAdaptivePlacementFallbacks: 0,
          totalAdaptivePlacementMismatches: 0,
        },
        recentEvents: [
          {
            eventType: "adaptive.placement.applied",
            clientId: "adaptive-canary-client",
            runtimeModeSource: "adaptive-classifier",
          },
        ],
      }));
      return;
    }
    if (request.url === "/sessions") {
      response.end(JSON.stringify({
        instances: [{ serverInstanceId: "gw-a", healthy: true, load: 0.1 }],
        sessions: [
          {
            sessionId: "session-a",
            serverInstanceId: "gw-a",
            metadata: {
              clientId: "adaptive-canary-client",
              runtimeMode: "stateless",
              runtimeModeSource: "adaptive-classifier",
            },
          },
        ],
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error?.code === "EPERM" && error?.syscall === "listen") {
      server.close();
      t.skip("sandbox blocks local listeners for external canary evidence proof");
      return;
    }
    throw error;
  }
  const { port } = server.address();
  const outputDir = mkdtempSync(join(tmpdir(), "phase-3-canary-evidence-test-"));

  try {
    const report = await collectExternalCanaryEvidence({
      phase: "canary",
      gateways: [{ gatewayId: "gw-a", baseUrl: `http://127.0.0.1:${port}` }],
      outputDir,
      environment: "test",
      trafficWindow: "unit-test",
      workloads: ["filesystem", "git", "memory"],
      canaryClientAllowlist: ["adaptive-canary-client"],
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    assert.equal(report.summary.overallStatus, "pass");
    assert.equal(report.gateways[0].assessment.status, "pass");
    assert.equal(report.gateways[0].observability.summary.totalAdaptivePlacements, 1);

    const artifactDir = join(outputDir, "2026-06-01T000000-000Z");
    const reportMarkdown = readFileSync(
      join(artifactDir, "phase-3-external-canary-report.md"),
      "utf8",
    );
    assert.match(reportMarkdown, /Machine checks: PASS/);
    assert.match(reportMarkdown, /Result: MANUAL_DECISION_REQUIRED/);
    assert.match(reportMarkdown, /gw-a/);

    const summary = JSON.parse(
      readFileSync(join(artifactDir, "canary-evidence-summary.json"), "utf8"),
    );
    assert.equal(summary.phase, "canary");
    assert.equal(summary.gateways.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("buildReportMarkdown marks failed machine checks as review required", () => {
  const markdown = buildReportMarkdown({
    generatedAt: "2026-06-01T00:00:00.000Z",
    environment: "test",
    trafficWindow: "unit-test",
    workloads: [],
    canaryClientAllowlist: [],
    phase: "baseline",
    summary: {
      overallStatus: "review_required",
      reasons: ["gateway-a: baseline observed adaptive placements"],
    },
    gateways: [
      {
        gatewayId: "gateway-a",
        observability: {
          operatorConfig: { adaptivePlacementEnabled: true },
          summary: { totalRequests: 1, totalAdaptivePlacements: 1 },
          recentEvents: [],
        },
        assessment: { status: "review_required", reasons: [] },
      },
    ],
  });

  assert.match(markdown, /Machine checks: REVIEW_REQUIRED/);
  assert.match(markdown, /Result: MANUAL_DECISION_REQUIRED/);
  assert.match(markdown, /baseline observed adaptive placements/);
});

test("canary assessment flags adaptive sessions outside the explicit allowlist", async (t) => {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (request.url === "/observability") {
      response.end(JSON.stringify({
        operatorConfig: {
          adaptivePlacementEnabled: true,
          adaptivePlacementClientAllowlistSize: 1,
        },
        summary: {
          totalRequests: 2,
          totalErrors: 0,
          totalAdaptivePlacements: 1,
          totalAdaptivePlacementMismatches: 0,
        },
        recentEvents: [],
      }));
      return;
    }
    if (request.url === "/sessions") {
      response.end(JSON.stringify({
        sessions: [
          {
            sessionId: "session-outside-allowlist",
            metadata: {
              clientId: "rogue-canary-looking-client",
              runtimeMode: "stateless",
              runtimeModeSource: "adaptive-classifier",
            },
          },
        ],
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error?.code === "EPERM" && error?.syscall === "listen") {
      server.close();
      t.skip("sandbox blocks local listeners for external canary evidence proof");
      return;
    }
    throw error;
  }

  try {
    const { port } = server.address();
    const report = await collectExternalCanaryEvidence({
      phase: "canary",
      gateways: [{ gatewayId: "gw-a", baseUrl: `http://127.0.0.1:${port}` }],
      canaryClientAllowlist: ["allowed-client"],
      writeArtifacts: false,
    });

    assert.equal(report.summary.overallStatus, "review_required");
    assert.match(
      report.summary.reasons.join("\n"),
      /outside the captured canary allowlist/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
