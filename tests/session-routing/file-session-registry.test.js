import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { FileSessionRegistry, removeRegistryFile } from "../../packages/gateway/session-registry/file-session-registry.js";

test("file session registry persists mappings across instances", () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-registry-"));
  const filePath = join(dir, "sessions.json");

  const first = new FileSessionRegistry({ filePath });
  first.assign("session-1", "server-a", { clientId: "client-a" });

  const second = new FileSessionRegistry({ filePath });
  const record = second.get("session-1");

  assert.equal(second.storageKind(), "file");
  assert.equal(second.isDurable(), true);
  assert.equal(record.serverInstanceId, "server-a");
  assert.equal(record.metadata.clientId, "client-a");
});

test("file session registry delete persists to disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-registry-"));
  const filePath = join(dir, "sessions.json");

  const first = new FileSessionRegistry({ filePath });
  first.assign("session-1", "server-a");
  first.delete("session-1");

  const second = new FileSessionRegistry({ filePath });
  assert.equal(second.get("session-1"), undefined);
});

test("removeRegistryFile deletes the persisted registry file", () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-registry-"));
  const filePath = join(dir, "sessions.json");

  const registry = new FileSessionRegistry({ filePath });
  registry.assign("session-1", "server-a");
  removeRegistryFile(filePath);
  const fresh = new FileSessionRegistry({ filePath });
  assert.equal(fresh.list().length, 0);
});

test("file session registry prunes expired sessions on reload", () => {
  const clock = createClock();
  const dir = mkdtempSync(join(tmpdir(), "mcp-registry-"));
  const filePath = join(dir, "sessions.json");

  const first = new FileSessionRegistry({ filePath, now: clock.now });
  first.assign("session-expired", "server-a", { expiresAt: clock.now() + 100 });

  clock.advance(101);
  const second = new FileSessionRegistry({ filePath, now: clock.now });
  assert.equal(second.get("session-expired"), undefined);
  assert.equal(second.list().length, 0);
});

test("file session registry preserves disconnect grace metadata across restart", () => {
  const clock = createClock();
  const dir = mkdtempSync(join(tmpdir(), "mcp-registry-"));
  const filePath = join(dir, "sessions.json");

  const first = new FileSessionRegistry({ filePath, now: clock.now });
  first.assign("session-grace", "server-a", { expiresAt: clock.now() + 5_000 });
  first.markDisconnected("session-grace", { gracePeriodMs: 300 });

  const second = new FileSessionRegistry({ filePath, now: clock.now });
  const record = second.get("session-grace");

  assert.equal(record.metadata.connectionState, "disconnected");
  assert.equal(record.metadata.graceUntil, clock.now() + 300);
  assert.equal(second.isWithinGrace("session-grace"), true);
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
