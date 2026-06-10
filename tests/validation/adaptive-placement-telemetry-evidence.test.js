import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  generateRunId,
  persistTelemetrySummary,
} from "../../validation/adaptive-placement/telemetry-evidence.js";

test("persistTelemetrySummary writes a durable summary record under <baseDir>/<run-id>", () => {
  const baseDir = mkdtempSync(join(tmpdir(), "phase-4-telemetry-evidence-"));
  const summary = { ok: true, status: "pass", metrics: { totalAdaptivePlacementMismatches: 0 } };

  const result = persistTelemetrySummary({
    summary,
    baseDir,
    runId: "20260610-150232",
    now: new Date("2026-06-10T15:02:32.000Z"),
  });

  assert.equal(result.runId, "20260610-150232");
  assert.equal(result.summaryPath, join(baseDir, "20260610-150232", "telemetry-summary.json"));

  const written = JSON.parse(readFileSync(result.summaryPath, "utf8"));
  assert.equal(written.schemaVersion, 1);
  assert.equal(written.runId, "20260610-150232");
  assert.equal(written.capturedAt, "2026-06-10T15:02:32.000Z");
  assert.deepEqual(written.summary, summary);
});

test("persistTelemetrySummary generates a timestamp run-id when none is provided", () => {
  const baseDir = mkdtempSync(join(tmpdir(), "phase-4-telemetry-evidence-"));
  const now = new Date("2026-06-10T15:02:32.000Z");

  const result = persistTelemetrySummary({ summary: { ok: true }, baseDir, now });

  assert.equal(result.runId, "20260610-150232");
  assert.equal(generateRunId(now), "20260610-150232");
});

test("persistTelemetrySummary sanitizes path-traversal characters in run-id", () => {
  const baseDir = mkdtempSync(join(tmpdir(), "phase-4-telemetry-evidence-"));

  const result = persistTelemetrySummary({
    summary: { ok: true },
    baseDir,
    runId: "../../escape attempt",
  });

  assert.equal(result.runId, "------escape-attempt");
  assert.ok(result.runDir.startsWith(baseDir), "run dir must stay inside the base dir");
});

test("persistTelemetrySummary rejects a missing summary", () => {
  assert.throws(() => persistTelemetrySummary({}), /requires a summary object/);
});
