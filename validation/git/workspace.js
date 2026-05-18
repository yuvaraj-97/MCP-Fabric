import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, resolve } from "node:path";

export function createGitValidationWorkspace(name) {
  const rootDir = resolve(process.cwd(), "validation-artifacts", name);
  rmSync(rootDir, { recursive: true, force: true });
  mkdirSync(rootDir, { recursive: true });

  runGitCommand(["init", "--initial-branch=main"], rootDir);
  runGitCommand(["config", "user.name", "Validation Bot"], rootDir);
  runGitCommand(["config", "user.email", "validation@example.com"], rootDir);

  writeFileSync(join(rootDir, "README.md"), "# Git validation workspace\n", "utf8");
  runGitCommand(["add", "README.md"], rootDir);
  runGitCommand(["commit", "-m", "Initial validation commit"], rootDir);

  return rootDir;
}

export function describeGitValidationFile(rootDir, relativePath = "notes/git-change.txt") {
  return {
    rootDir,
    relativePath,
    absolutePath: join(rootDir, relativePath),
  };
}

export function snapshotGitValidationWorkspace(rootDir) {
  const items = [];

  walk(rootDir);

  return {
    rootDir,
    exists: existsSync(rootDir),
    items,
  };

  function walk(currentPath) {
    if (!existsSync(currentPath)) {
      return;
    }

    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      if (entry.name === ".git") {
        continue;
      }

      const absolutePath = join(currentPath, entry.name);
      const relativePath = relative(rootDir, absolutePath) || ".";
      if (entry.isDirectory()) {
        items.push({ path: relativePath, kind: "directory" });
        walk(absolutePath);
        continue;
      }

      const stats = statSync(absolutePath);
      items.push({
        path: relativePath,
        kind: "file",
        size: stats.size,
        preview: readPreview(absolutePath, stats.size),
      });
    }
  }
}

function readPreview(absolutePath, size) {
  if (size > 4096) {
    return `[preview skipped for file larger than 4096 bytes: ${size} bytes]`;
  }

  return readFileSync(absolutePath, "utf8");
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
