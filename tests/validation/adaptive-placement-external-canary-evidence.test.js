import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildReportMarkdown,
  collectExternalCanaryEvidence,
  parseGatewaySpecs,
} from "../../validation/adaptive-placement/external-canary-evidence.js";
import {
  verifyExternalCanaryEvidence,
} from "../../validation/adaptive-placement/verify-external-canary-evidence.js";

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
  const downstreamErrorFile = join(outputDir, "source-errors.json");
  writeFileSync(
    downstreamErrorFile,
    `${JSON.stringify({ totalRequests: 100, totalErrors: 0 }, null, 2)}\n`,
    "utf8",
  );

  try {
    const report = await collectExternalCanaryEvidence({
      phase: "canary",
      gateways: [{ gatewayId: "gw-a", baseUrl: `http://127.0.0.1:${port}` }],
      outputDir,
      runId: "shared-canary-run",
      environment: "test",
      trafficWindow: "unit-test",
      workloads: ["filesystem", "git", "memory"],
      canaryClientAllowlist: ["adaptive-canary-client"],
      downstreamErrors: `gw-a=${downstreamErrorFile}`,
      baselineDownstreamErrorRate: 0,
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    assert.equal(report.summary.overallStatus, "pass");
    assert.equal(report.gateways[0].assessment.status, "pass");
    assert.equal(report.gateways[0].observability.summary.totalAdaptivePlacements, 1);

    assert.equal(report.runId, "shared-canary-run");

    const artifactDir = join(outputDir, "shared-canary-run");
    const reportMarkdown = readFileSync(
      join(artifactDir, "phase-3-external-canary-report.md"),
      "utf8",
    );
    assert.match(reportMarkdown, /Machine checks: PASS/);
    assert.match(reportMarkdown, /Result: MANUAL_DECISION_REQUIRED/);
    assert.match(reportMarkdown, /gw-a-canary-errors\.json/);
    assert.match(reportMarkdown, /gw-a/);

    const summary = JSON.parse(
      readFileSync(join(artifactDir, "canary-evidence-summary.json"), "utf8"),
    );
    assert.equal(summary.phase, "canary");
    assert.equal(summary.gateways.length, 1);
    assert.equal(summary.downstreamErrors[0].errorRate, 0);

    const downstreamErrors = JSON.parse(
      readFileSync(join(artifactDir, "gw-a-canary-errors.json"), "utf8"),
    );
    assert.equal(downstreamErrors.totalRequests, 100);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("verifyExternalCanaryEvidence requires all phase artifacts and machine checks", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "phase-3-canary-complete-evidence-"));
  const gatewayId = "gw-a";

  for (const phase of ["baseline", "canary", "rollback"]) {
    writeFileSync(
      join(evidenceDir, `${phase}-evidence-summary.json`),
      `${JSON.stringify({
        phase,
        summary: { overallStatus: "pass", reasons: [] },
        gateways: [{ gatewayId }],
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(join(evidenceDir, `${gatewayId}-${phase}-observability.json`), "{}\n", "utf8");
    writeFileSync(join(evidenceDir, `${gatewayId}-${phase}-sessions.json`), "{}\n", "utf8");
  }

  writeFileSync(join(evidenceDir, `${gatewayId}-baseline-errors.json`), "{}\n", "utf8");
  writeFileSync(join(evidenceDir, `${gatewayId}-canary-errors.json`), "{}\n", "utf8");
  writeFileSync(
    join(evidenceDir, "phase-3-external-canary-report.md"),
    [
      "# Phase 3 External Canary Report",
      "",
      "Machine checks: PASS",
      "Result: MANUAL_DECISION_REQUIRED",
      "",
    ].join("\n"),
    "utf8",
  );

  const report = verifyExternalCanaryEvidence({ evidenceDir });

  assert.equal(report.ok, true);
  assert.deepEqual(report.gatewayIds, [gatewayId]);
});

test("verifyExternalCanaryEvidence fails closed for missing approval and artifacts", () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "phase-3-canary-incomplete-evidence-"));
  writeFileSync(
    join(evidenceDir, "baseline-evidence-summary.json"),
    `${JSON.stringify({
      phase: "baseline",
      summary: { overallStatus: "review_required", reasons: ["missing downstream errors"] },
      gateways: [{ gatewayId: "gw-a" }],
    }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(evidenceDir, "phase-3-external-canary-report.md"),
    "Result: MANUAL_DECISION_REQUIRED\nOperator approval:\nReviewer approval:\n",
    "utf8",
  );

  const report = verifyExternalCanaryEvidence({
    evidenceDir,
    gatewayIds: ["gw-a"],
    requireManualApproval: true,
  });

  assert.equal(report.ok, false);
  assert.match(report.reasons.join("\n"), /missing canary-evidence-summary\.json/);
  assert.match(report.reasons.join("\n"), /machine checks are review_required/);
  assert.match(report.reasons.join("\n"), /missing gw-a-baseline-errors\.json/);
  assert.match(report.reasons.join("\n"), /final Result: PASS/);
  assert.match(report.reasons.join("\n"), /operator approval/);
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

test("baseline and canary phases require downstream error evidence", async (t) => {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (request.url === "/observability") {
      response.end(JSON.stringify({
        operatorConfig: {
          adaptivePlacementEnabled: false,
          adaptivePlacementClientAllowlistSize: 0,
        },
        summary: {
          totalRequests: 2,
          totalErrors: 0,
          totalAdaptivePlacements: 0,
          totalAdaptivePlacementMismatches: 0,
        },
        recentEvents: [],
      }));
      return;
    }
    if (request.url === "/sessions") {
      response.end(JSON.stringify({ sessions: [] }));
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
      phase: "baseline",
      gateways: [{ gatewayId: "gw-a", baseUrl: `http://127.0.0.1:${port}` }],
      writeArtifacts: false,
    });

    assert.equal(report.summary.overallStatus, "review_required");
    assert.match(report.summary.reasons.join("\n"), /requires downstream error evidence/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
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
      downstreamErrors: [{ gatewayId: "gw-a", totalRequests: 100, totalErrors: 0 }],
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

test("canary assessment flags downstream error rates above the baseline threshold", async (t) => {
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
            sessionId: "session-a",
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

  try {
    const { port } = server.address();
    const report = await collectExternalCanaryEvidence({
      phase: "canary",
      gateways: [{ gatewayId: "gw-a", baseUrl: `http://127.0.0.1:${port}` }],
      canaryClientAllowlist: ["adaptive-canary-client"],
      downstreamErrors: [{ gatewayId: "gw-a", totalRequests: 100, totalErrors: 2 }],
      baselineDownstreamErrorRate: 0.005,
      maxDownstreamErrorRateDelta: 0.005,
      writeArtifacts: false,
    });

    assert.equal(report.summary.overallStatus, "review_required");
    assert.match(report.summary.reasons.join("\n"), /downstream error rate/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
