import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";

import { McpApplicationServer } from "../../packages/core/protocol-adapter/mcp-application-server.js";

export function createGitValidationServer({
  rootDir,
  serverInfo = { name: "git-validation-server", version: "0.1.0" },
} = {}) {
  assertNonEmptyString(rootDir, "rootDir");

  const server = new McpApplicationServer({
    serverInfo,
    instructions:
      "Git-style validation server used to prove the same MCP application code can run through stdio and gateway-backed HTTP/SSE.",
  });

  server.registerTool({
    name: "git_list_files",
    title: "List repository files",
    description: "List files and directories under a relative path inside the validation repository.",
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
    name: "git_write_file",
    title: "Write repository file",
    description: "Write UTF-8 text to a relative file path inside the validation repository.",
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
    name: "git_read_file",
    title: "Read repository file",
    description: "Read UTF-8 text from a relative file path inside the validation repository.",
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
      return {
        path: relativeDisplayPath(rootDir, targetPath),
        content: readFileSync(targetPath, "utf8"),
      };
    },
  });

  server.registerTool({
    name: "git_status",
    title: "Git status",
    description: "Return git status information for the validation repository.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler() {
      const short = runGit(rootDir, ["status", "--short"]);
      const porcelain = short
        .split("\n")
        .filter(Boolean)
        .map(parseStatusLine);

      return {
        branch: runGit(rootDir, ["branch", "--show-current"]),
        clean: porcelain.length === 0,
        porcelain,
        short,
      };
    },
  });

  server.registerTool({
    name: "git_stage_paths",
    title: "Stage paths",
    description: "Stage one or more repository-relative paths with git add.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
        },
      },
      required: ["paths"],
      additionalProperties: false,
    },
    async handler({ arguments: toolArguments = {} }) {
      const paths = normalizePathsArgument(toolArguments.paths);
      runGit(rootDir, ["add", "--", ...paths]);

      return {
        stagedPaths: paths,
        status: runGit(rootDir, ["status", "--short"]),
      };
    },
  });

  server.registerTool({
    name: "git_diff_cached",
    title: "Show staged diff summary",
    description: "Return the staged file names and diff summary for the validation repository.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler() {
      return {
        stagedFiles: runGit(rootDir, ["diff", "--cached", "--name-only"])
          .split("\n")
          .filter(Boolean),
        diff: runGit(rootDir, ["diff", "--cached", "--stat"]),
      };
    },
  });

  server.registerTool({
    name: "git_stat_path",
    title: "Stat repository path",
    description: "Return file or directory metadata for a repository-relative path.",
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

export function createGitValidationApplication({
  rootDir,
  serverInstanceId = "git-validation-server",
} = {}) {
  const server = createGitValidationServer({
    rootDir,
    serverInfo: {
      name: `git-validation-${serverInstanceId}`,
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

function runGit(rootDir, args) {
  return runGitCommand(args, rootDir).trim();
}

function parseStatusLine(line) {
  return {
    indexStatus: line[0] ?? " ",
    workTreeStatus: line[1] ?? " ",
    path: line.slice(3),
  };
}

function normalizePathsArgument(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("paths must be a non-empty array");
  }

  return value.map((entry) => {
    assertNonEmptyString(entry, "paths entry");
    return entry;
  });
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
  return target.slice(root.length).replaceAll("\\", "/").replace(/^\/+/, "") || ".";
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function runGitCommand(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
    });
  } catch (error) {
    if (error?.status === 0 && typeof error.stdout === "string") {
      return error.stdout;
    }

    throw error;
  }
}
