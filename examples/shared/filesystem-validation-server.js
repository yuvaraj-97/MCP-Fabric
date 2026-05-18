import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";

import { McpApplicationServer } from "../../packages/core/protocol-adapter/mcp-application-server.js";

export function createFilesystemValidationServer({
  rootDir,
  serverInfo = { name: "filesystem-validation-server", version: "0.1.0" },
} = {}) {
  assertNonEmptyString(rootDir, "rootDir");

  const server = new McpApplicationServer({
    serverInfo,
    instructions:
      "Filesystem-style validation server used to prove the same MCP application code can run through stdio and gateway-backed HTTP/SSE.",
  });

  server.registerTool({
    name: "fs_list",
    title: "List files",
    description: "List files and directories under a relative path inside the validation root.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      additionalProperties: false,
    },
    async handler({ arguments: toolArguments = {} }) {
      const targetPath = resolveSafePath(rootDir, toolArguments.path ?? ".");
      const entries = readdirSync(targetPath, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      }));

      return {
        path: relativeDisplayPath(rootDir, targetPath),
        entries,
      };
    },
  });

  server.registerTool({
    name: "fs_write_text",
    title: "Write text file",
    description: "Write UTF-8 text to a relative file path inside the validation root.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    async handler({ arguments: toolArguments = {} }) {
      const targetPath = resolveSafePath(rootDir, toolArguments.path);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, toolArguments.content, "utf8");

      return {
        path: relativeDisplayPath(rootDir, targetPath),
        bytesWritten: Buffer.byteLength(toolArguments.content, "utf8"),
      };
    },
  });

  server.registerTool({
    name: "fs_read_text",
    title: "Read text file",
    description: "Read UTF-8 text from a relative file path inside the validation root.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    async handler({ arguments: toolArguments = {} }) {
      const targetPath = resolveSafePath(rootDir, toolArguments.path);
      const content = readFileSync(targetPath, "utf8");
      return {
        path: relativeDisplayPath(rootDir, targetPath),
        content,
      };
    },
  });

  server.registerTool({
    name: "fs_stat",
    title: "Stat path",
    description: "Return file or directory metadata for a relative path inside the validation root.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    async handler({ arguments: toolArguments = {} }) {
      const targetPath = resolveSafePath(rootDir, toolArguments.path);
      const stats = statSync(targetPath);
      return {
        path: relativeDisplayPath(rootDir, targetPath),
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        size: stats.size,
      };
    },
  });

  return server;
}

export function createFilesystemValidationApplication({
  rootDir,
  serverInstanceId = "filesystem-validation-server",
} = {}) {
  const server = createFilesystemValidationServer({
    rootDir,
    serverInfo: {
      name: `filesystem-validation-${serverInstanceId}`,
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

function resolveSafePath(rootDir, relativePath) {
  assertNonEmptyString(relativePath, "path");
  const root = resolve(rootDir);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("Path escapes the validation root");
  }

  return target;
}

function relativeDisplayPath(rootDir, targetPath) {
  const root = resolve(rootDir);
  const target = resolve(targetPath);
  return normalize(target.slice(root.length) || ".").replaceAll("\\", "/").replace(/^\/+/, "") || ".";
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}
