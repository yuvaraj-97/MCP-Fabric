import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { McpApplicationServer } from "../../packages/core/protocol-adapter/mcp-application-server.js";

export function createMemoryValidationServer({
  store = createMemoryValidationStore(),
  serverInfo = { name: "memory-validation-server", version: "0.1.0" },
} = {}) {
  const server = new McpApplicationServer({
    serverInfo,
    instructions:
      "Memory-style validation server used to prove the same MCP application code can run through stdio and gateway-backed HTTP/SSE with sticky sessions and failover.",
  });

  server.registerTool({
    name: "memory_remember",
    title: "Remember a fact",
    description: "Store a short fact under a namespace and key.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: { type: "string" },
        key: { type: "string" },
        value: { type: "string" },
      },
      required: ["namespace", "key", "value"],
      additionalProperties: false,
    },
    async handler({ arguments: toolArguments = {} }) {
      return store.remember({
        namespace: toolArguments.namespace,
        key: toolArguments.key,
        value: toolArguments.value,
      });
    },
  });

  server.registerTool({
    name: "memory_recall",
    title: "Recall a fact",
    description: "Read a stored fact by namespace and key.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: { type: "string" },
        key: { type: "string" },
      },
      required: ["namespace", "key"],
      additionalProperties: false,
    },
    async handler({ arguments: toolArguments = {} }) {
      return store.recall({
        namespace: toolArguments.namespace,
        key: toolArguments.key,
      });
    },
  });

  server.registerTool({
    name: "memory_list",
    title: "List facts",
    description: "List stored facts for a namespace.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: { type: "string" },
      },
      required: ["namespace"],
      additionalProperties: false,
    },
    async handler({ arguments: toolArguments = {} }) {
      return store.list({
        namespace: toolArguments.namespace,
      });
    },
  });

  server.registerTool({
    name: "memory_forget",
    title: "Forget a fact",
    description: "Delete a stored fact by namespace and key.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: { type: "string" },
        key: { type: "string" },
      },
      required: ["namespace", "key"],
      additionalProperties: false,
    },
    async handler({ arguments: toolArguments = {} }) {
      return store.forget({
        namespace: toolArguments.namespace,
        key: toolArguments.key,
      });
    },
  });

  return server;
}

export function createMemoryValidationApplication({
  store = createMemoryValidationStore(),
  serverInstanceId = "memory-validation-server",
} = {}) {
  const server = createMemoryValidationServer({
    store,
    serverInfo: {
      name: `memory-validation-${serverInstanceId}`,
      version: "0.1.0",
    },
  });
  const sessions = new Set();

  return {
    serverInstanceId,
    getSessionState(sessionId) {
      return sessions.has(sessionId) ? { sessionId } : undefined;
    },
    async handleMessage(message, context = {}) {
      const effectiveSessionId = context.sessionId ?? message?.sessionId;
      if (message?.method === "initialize" && effectiveSessionId) {
        sessions.add(effectiveSessionId);
      }
      if (effectiveSessionId && sessions.has(effectiveSessionId)) {
        sessions.add(effectiveSessionId);
      }

      return server.handleMessage(message, context);
    },
  };
}

export function createMemoryValidationStore() {
  const namespaces = new Map();

  return {
    remember({ namespace, key, value }) {
      assertNonEmptyString(namespace, "namespace");
      assertNonEmptyString(key, "key");
      assertNonEmptyString(value, "value");

      const bucket = getOrCreateNamespace(namespace);
      const existing = bucket.get(key);
      const record = {
        namespace,
        key,
        value,
        entryId: existing?.entryId ?? randomUUID(),
        updatedAt: new Date().toISOString(),
      };
      bucket.set(key, record);
      return { ...record };
    },
    recall({ namespace, key }) {
      assertNonEmptyString(namespace, "namespace");
      assertNonEmptyString(key, "key");

      const bucket = namespaces.get(namespace);
      const record = bucket?.get(key);
      return {
        namespace,
        key,
        found: Boolean(record),
        value: record?.value ?? null,
        entryId: record?.entryId ?? null,
      };
    },
    list({ namespace }) {
      assertNonEmptyString(namespace, "namespace");

      const bucket = namespaces.get(namespace);
      const entries = bucket
        ? [...bucket.values()]
            .map((record) => ({
              key: record.key,
              value: record.value,
              entryId: record.entryId,
              updatedAt: record.updatedAt,
            }))
            .sort((left, right) => left.key.localeCompare(right.key))
        : [];

      return {
        namespace,
        count: entries.length,
        entries,
      };
    },
    forget({ namespace, key }) {
      assertNonEmptyString(namespace, "namespace");
      assertNonEmptyString(key, "key");

      const bucket = namespaces.get(namespace);
      const deleted = bucket ? bucket.delete(key) : false;
      if (bucket && bucket.size === 0) {
        namespaces.delete(namespace);
      }

      return {
        namespace,
        key,
        deleted,
      };
    },
    snapshot() {
      return [...namespaces.entries()]
        .map(([namespace, bucket]) => ({
          namespace,
          entries: [...bucket.values()]
            .map((record) => ({
              key: record.key,
              value: record.value,
              entryId: record.entryId,
              updatedAt: record.updatedAt,
            }))
            .sort((left, right) => left.key.localeCompare(right.key)),
        }))
        .sort((left, right) => left.namespace.localeCompare(right.namespace));
    },
  };

  function getOrCreateNamespace(namespace) {
    let bucket = namespaces.get(namespace);
    if (!bucket) {
      bucket = new Map();
      namespaces.set(namespace, bucket);
    }
    return bucket;
  }
}

export function createFileBackedMemoryValidationStore({ filePath }) {
  if (typeof filePath !== "string" || filePath.trim().length === 0) {
    throw new TypeError("filePath must be a non-empty string");
  }

  ensureStoreFile(filePath);

  return {
    remember({ namespace, key, value }) {
      assertNonEmptyString(namespace, "namespace");
      assertNonEmptyString(key, "key");
      assertNonEmptyString(value, "value");

      const state = readState(filePath);
      const bucket = getOrCreateStateNamespace(state, namespace);
      const existing = bucket.entries.find((entry) => entry.key === key);
      const record = {
        namespace,
        key,
        value,
        entryId: existing?.entryId ?? randomUUID(),
        updatedAt: new Date().toISOString(),
      };

      bucket.entries = bucket.entries.filter((entry) => entry.key !== key);
      bucket.entries.push(record);
      bucket.entries.sort((left, right) => left.key.localeCompare(right.key));
      writeState(filePath, state);
      return { ...record };
    },
    recall({ namespace, key }) {
      assertNonEmptyString(namespace, "namespace");
      assertNonEmptyString(key, "key");

      const state = readState(filePath);
      const bucket = state.namespaces.find((entry) => entry.namespace === namespace);
      const record = bucket?.entries.find((entry) => entry.key === key);

      return {
        namespace,
        key,
        found: Boolean(record),
        value: record?.value ?? null,
        entryId: record?.entryId ?? null,
      };
    },
    list({ namespace }) {
      assertNonEmptyString(namespace, "namespace");

      const state = readState(filePath);
      const bucket = state.namespaces.find((entry) => entry.namespace === namespace);
      const entries = bucket
        ? bucket.entries.map((record) => ({
            key: record.key,
            value: record.value,
            entryId: record.entryId,
            updatedAt: record.updatedAt,
          }))
        : [];

      return {
        namespace,
        count: entries.length,
        entries,
      };
    },
    forget({ namespace, key }) {
      assertNonEmptyString(namespace, "namespace");
      assertNonEmptyString(key, "key");

      const state = readState(filePath);
      const bucket = state.namespaces.find((entry) => entry.namespace === namespace);
      let deleted = false;

      if (bucket) {
        const before = bucket.entries.length;
        bucket.entries = bucket.entries.filter((entry) => entry.key !== key);
        deleted = before !== bucket.entries.length;
      }

      state.namespaces = state.namespaces.filter((entry) => entry.entries.length > 0);
      writeState(filePath, state);

      return {
        namespace,
        key,
        deleted,
      };
    },
    snapshot() {
      return readState(filePath).namespaces.map((bucket) => ({
        namespace: bucket.namespace,
        entries: bucket.entries.map((record) => ({
          key: record.key,
          value: record.value,
          entryId: record.entryId,
          updatedAt: record.updatedAt,
        })),
      }));
    },
  };
}

function ensureStoreFile(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
  try {
    readState(filePath);
  } catch {
    writeState(filePath, { namespaces: [] });
  }
}

function readState(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const parsed = raw.trim().length > 0 ? JSON.parse(raw) : { namespaces: [] };
  return normalizeState(parsed);
}

function writeState(filePath, state) {
  writeFileSync(filePath, JSON.stringify(normalizeState(state), null, 2));
}

function normalizeState(state) {
  const namespaces = Array.isArray(state?.namespaces) ? state.namespaces : [];
  return {
    namespaces: namespaces
      .map((bucket) => ({
        namespace: String(bucket.namespace ?? ""),
        entries: Array.isArray(bucket.entries)
          ? bucket.entries
              .map((record) => ({
                key: String(record.key ?? ""),
                value: String(record.value ?? ""),
                entryId: String(record.entryId ?? ""),
                updatedAt: String(record.updatedAt ?? ""),
              }))
              .filter((record) => record.key.length > 0)
              .sort((left, right) => left.key.localeCompare(right.key))
          : [],
      }))
      .filter((bucket) => bucket.namespace.length > 0)
      .sort((left, right) => left.namespace.localeCompare(right.namespace)),
  };
}

function getOrCreateStateNamespace(state, namespace) {
  let bucket = state.namespaces.find((entry) => entry.namespace === namespace);
  if (!bucket) {
    bucket = { namespace, entries: [] };
    state.namespaces.push(bucket);
    state.namespaces.sort((left, right) => left.namespace.localeCompare(right.namespace));
  }

  return bucket;
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}
