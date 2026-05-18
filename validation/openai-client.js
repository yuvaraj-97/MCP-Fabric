import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_API_BASE = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5";

export function createOpenAIResponsesClient({
  apiKey = resolveOpenAIApiKey(),
  model = process.env.OPENAI_MODEL || DEFAULT_MODEL,
  apiBase = process.env.OPENAI_API_BASE || DEFAULT_API_BASE,
} = {}) {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY was not found in the environment or .env file.");
  }

  return {
    apiBase,
    model,
    async createResponse(body) {
      const response = await fetch(`${apiBase}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          ...body,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          `OpenAI API request failed (${response.status}): ${payload.error?.message ?? JSON.stringify(payload)}`,
        );
      }

      return payload;
    },
    async *createResponseStream(body) {
      const response = await fetch(`${apiBase}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          stream: true,
          ...body,
        }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(
          `OpenAI API request failed (${response.status}): ${payload.error?.message ?? JSON.stringify(payload)}`,
        );
      }

      if (!response.body) {
        throw new Error("OpenAI API stream did not return a response body.");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let boundaryIndex = buffer.indexOf("\n\n");
        while (boundaryIndex !== -1) {
          const frame = buffer.slice(0, boundaryIndex);
          buffer = buffer.slice(boundaryIndex + 2);
          const event = parseSseFrame(frame);
          if (event) {
            yield event;
          }
          boundaryIndex = buffer.indexOf("\n\n");
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        const event = parseSseFrame(buffer);
        if (event) {
          yield event;
        }
      }
    },
  };
}

export function resolveOpenAIApiKey({
  env = process.env,
  dotenvPath = ".env",
} = {}) {
  if (env.OPENAI_API_KEY) {
    return env.OPENAI_API_KEY;
  }

  const resolvedPath = resolve(dotenvPath);
  if (!existsSync(resolvedPath)) {
    return undefined;
  }

  const raw = readFileSync(resolvedPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (key !== "OPENAI_API_KEY") {
      continue;
    }

    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    return value || undefined;
  }

  return undefined;
}

function parseSseFrame(frame) {
  const lines = frame.split(/\r?\n/);
  let eventType = "message";
  const dataLines = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      eventType = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  const rawData = dataLines.join("\n");
  if (rawData === "[DONE]") {
    return { type: "done" };
  }

  try {
    const payload = JSON.parse(rawData);
    return {
      type: eventType,
      payload,
    };
  } catch {
    return {
      type: eventType,
      payload: rawData,
    };
  }
}
