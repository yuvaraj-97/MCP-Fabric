import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { FileSessionRegistry, removeRegistryFile } from "../../packages/gateway/session-registry/file-session-registry.js";

test("file session registry persists mappings across instances", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-registry-"));
  const filePath = join(dir, "sessions.json");

  const first = new FileSessionRegistry({ filePath });
  const assigned = first.assign("session-1", "server-a", { clientId: "client-a" });
  assert.equal(assigned.serverInstanceId, "server-a");
  await first.flush();

  const second = new FileSessionRegistry({ filePath });
  const record = second.get("session-1");

  assert.equal(second.storageKind(), "file");
  assert.equal(second.isDurable(), true);
  assert.equal(record.serverInstanceId, "server-a");
  assert.equal(record.metadata.clientId, "client-a");
});

test("file session registry delete persists to disk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-registry-"));
  const filePath = join(dir, "sessions.json");

  const first = new FileSessionRegistry({ filePath });
  first.assign("session-1", "server-a");
  assert.equal(first.delete("session-1"), true);
  await first.flush();

  const second = new FileSessionRegistry({ filePath });
  assert.equal(second.get("session-1"), undefined);
});

test("removeRegistryFile deletes the persisted registry file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-registry-"));
  const filePath = join(dir, "sessions.json");

  const registry = new FileSessionRegistry({ filePath });
  registry.assign("session-1", "server-a");
  await registry.flush();
  removeRegistryFile(filePath);
  const fresh = new FileSessionRegistry({ filePath });
  assert.equal(fresh.list().length, 0);
});

test("file session registry prunes expired sessions on reload", async () => {
  const clock = createClock();
  const dir = mkdtempSync(join(tmpdir(), "mcp-registry-"));
  const filePath = join(dir, "sessions.json");

  const first = new FileSessionRegistry({ filePath, now: clock.now });
  first.assign("session-expired", "server-a", { expiresAt: clock.now() + 100 });
  await first.flush();

  clock.advance(101);
  const second = new FileSessionRegistry({ filePath, now: clock.now });
  assert.equal(second.get("session-expired"), undefined);
  assert.equal(second.list().length, 0);
  await second.flush();
});

test("file session registry preserves disconnect grace metadata across restart", async () => {
  const clock = createClock();
  const dir = mkdtempSync(join(tmpdir(), "mcp-registry-"));
  const filePath = join(dir, "sessions.json");

  const first = new FileSessionRegistry({ filePath, now: clock.now });
  first.assign("session-grace", "server-a", { expiresAt: clock.now() + 5_000 });
  first.markDisconnected("session-grace", { gracePeriodMs: 300 });
  await first.flush();

  const second = new FileSessionRegistry({ filePath, now: clock.now });
  const record = second.get("session-grace");

  assert.equal(record.metadata.connectionState, "disconnected");
  assert.equal(record.metadata.graceUntil, clock.now() + 300);
  assert.equal(second.isWithinGrace("session-grace"), true);
});

test("file session registry coalesces async persistence without changing synchronous reads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-registry-"));
  const filePath = join(dir, "sessions.json");

  const registry = new FileSessionRegistry({ filePath });
  registry.assign("session-1", "server-a", { generation: 1 });
  const latest = registry.assign("session-1", "server-b", { generation: 2 });

  assert.equal(latest.serverInstanceId, "server-b");
  assert.equal(registry.get("session-1").serverInstanceId, "server-b");

  await registry.flush();
  const persisted = JSON.parse(readFileSync(filePath, "utf8"));
  assert.deepEqual(
    persisted.sessions.map((record) => ({
      sessionId: record.sessionId,
      serverInstanceId: record.serverInstanceId,
      generation: record.metadata.generation,
    })),
    [{ sessionId: "session-1", serverInstanceId: "server-b", generation: 2 }],
  );
});

function createClock(start = 1_700_000_000_000) {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
      return current;
    },
  };
}
