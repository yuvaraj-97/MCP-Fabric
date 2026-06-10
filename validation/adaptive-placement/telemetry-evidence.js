import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

export const DEFAULT_TELEMETRY_EVIDENCE_DIR = "validation-artifacts/phase-4-telemetry";
const SUMMARY_FILE_NAME = "telemetry-summary.json";

/**
 * Persist a Phase 4 telemetry quality summary as durable evidence under
 * `validation-artifacts/phase-4-telemetry/<run-id>/telemetry-summary.json`.
 *
 * This is telemetry-only evidence capture: it never alters routing, runtime
 * modes, or adaptive-placement defaults. The destination defaults to the
 * git-ignored `validation-artifacts/` tree so captured runs never pollute the
 * tracked worktree.
 */
export function persistTelemetrySummary({
  summary,
  baseDir = DEFAULT_TELEMETRY_EVIDENCE_DIR,
  runId,
  now = new Date(),
} = {}) {
  if (!summary || typeof summary !== "object") {
    throw new TypeError("persistTelemetrySummary requires a summary object");
  }

  const resolvedRunId = normalizeRunId(runId) ?? generateRunId(now);
  const runDir = resolve(baseDir, resolvedRunId);
  const summaryPath = join(runDir, SUMMARY_FILE_NAME);

  const record = {
    schemaVersion: 1,
    runId: resolvedRunId,
    capturedAt: now.toISOString(),
    summary,
  };

  mkdirSync(runDir, { recursive: true });
  writeFileSync(summaryPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  return { runId: resolvedRunId, runDir, summaryPath, record };
}

export function generateRunId(now = new Date()) {
  const iso = now.toISOString();
  // 2026-06-10T15:02:32.123Z -> 20260610-150232
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}`;
}

function normalizeRunId(runId) {
  if (typeof runId !== "string") {
    return undefined;
  }
  const trimmed = runId.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  // Keep run-ids filesystem-safe and free of path traversal: dots are dropped
  // so no run-id can form a `..` segment regardless of the resolved base dir.
  return trimmed.replace(/[^A-Za-z0-9_-]/g, "-");
}
