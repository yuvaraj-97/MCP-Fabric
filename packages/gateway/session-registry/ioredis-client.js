import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function createIoredisClient({
  url,
  RedisCtor,
  options = {},
} = {}) {
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new TypeError("redisUrl is required when sessionRegistryBackend=redis");
  }

  const EffectiveRedisCtor = RedisCtor ?? loadIoredisCtor();
  return new EffectiveRedisCtor(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    ...options,
  });
}

function loadIoredisCtor() {
  try {
    return require("ioredis");
  } catch (error) {
    const missing = new Error(
      'The Redis session registry requires the "ioredis" package. Run "npm install" before using sessionRegistryBackend=redis.',
    );
    missing.cause = error;
    throw missing;
  }
}
