import { FileSessionRegistry } from "./file-session-registry.js";
import { MemorySessionRegistry } from "./memory-session-registry.js";
import { RedisSessionRegistry } from "./redis-session-registry.js";

export function createSessionRegistry({
  backend = "memory",
  filePath,
  now,
  redisClient,
  redisKey,
} = {}) {
  if (backend === "memory") {
    return new MemorySessionRegistry({ now });
  }

  if (backend === "file") {
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      throw new TypeError("filePath is required when sessionRegistryBackend=file");
    }

    return new FileSessionRegistry({ filePath, now });
  }

  if (backend === "redis") {
    return new RedisSessionRegistry({
      client: redisClient,
      key: redisKey,
      now,
    });
  }

  throw new RangeError(`Unsupported session registry backend: ${backend}`);
}
