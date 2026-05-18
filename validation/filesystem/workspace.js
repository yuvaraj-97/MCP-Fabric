import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export function createFilesystemValidationWorkspace(name) {
  const rootDir = resolve(process.cwd(), "validation-artifacts", name);
  rmSync(rootDir, { recursive: true, force: true });
  mkdirSync(rootDir, { recursive: true });
  return rootDir;
}

export function describeFilesystemValidationFile(rootDir, relativePath = "notes/filesystem-note.txt") {
  return {
    rootDir,
    relativePath,
    absolutePath: join(rootDir, relativePath),
  };
}

export function snapshotFilesystemValidationWorkspace(rootDir) {
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
      const absolutePath = join(currentPath, entry.name);
      const relativePath = relative(rootDir, absolutePath) || ".";
      if (entry.isDirectory()) {
        items.push({
          path: relativePath,
          kind: "directory",
        });
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
