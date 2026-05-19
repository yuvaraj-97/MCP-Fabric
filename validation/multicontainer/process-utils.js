import { createServer } from "node:net";
import { spawn } from "node:child_process";

export async function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

export function spawnNodeProcess(scriptPath, { cwd, env = {} } = {}) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdoutLines = [];
  const stderrLines = [];
  let stdoutBuffer = "";
  let stderrBuffer = "";

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    stdoutBuffer = drainLines(stdoutBuffer, stdoutLines);
  });

  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString("utf8");
    stderrBuffer = drainLines(stderrBuffer, stderrLines);
  });

  return {
    child,
    stdoutLines,
    stderrLines,
    async waitForReady({ timeoutMs = 15_000, match = defaultReadyMatcher } = {}) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        for (const line of stdoutLines) {
          const payload = match(line);
          if (payload) {
            return payload;
          }
        }

        if (child.exitCode !== null) {
          throw new Error(
            `Process ${scriptPath} exited before readiness.\nstdout:\n${stdoutLines.join("\n")}\nstderr:\n${stderrLines.join("\n")}`,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      throw new Error(
        `Timed out waiting for ${scriptPath} readiness.\nstdout:\n${stdoutLines.join("\n")}\nstderr:\n${stderrLines.join("\n")}`,
      );
    },
    async stop() {
      if (child.exitCode !== null) {
        return;
      }

      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
        }, 2_000);

        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    },
  };
}

function drainLines(buffer, output) {
  let current = buffer;
  while (true) {
    const newlineIndex = current.indexOf("\n");
    if (newlineIndex < 0) {
      return current;
    }

    const line = current.slice(0, newlineIndex).trim();
    if (line) {
      output.push(line);
    }
    current = current.slice(newlineIndex + 1);
  }
}

function defaultReadyMatcher(line) {
  try {
    const payload = JSON.parse(line);
    return payload?.type === "ready" ? payload : null;
  } catch {
    return null;
  }
}
