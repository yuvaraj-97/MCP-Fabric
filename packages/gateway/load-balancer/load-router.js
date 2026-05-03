export class LoadRouter {
  #sessionRegistry;
  #loadThreshold;
  #instances = new Map();

  constructor({ sessionRegistry, loadThreshold = 0.7 } = {}) {
    if (!sessionRegistry) {
      throw new TypeError("sessionRegistry is required");
    }

    if (typeof loadThreshold !== "number" || loadThreshold < 0 || loadThreshold > 1) {
      throw new RangeError("loadThreshold must be a number between 0 and 1");
    }

    this.#sessionRegistry = sessionRegistry;
    this.#loadThreshold = loadThreshold;
  }

  upsertInstance(instance) {
    const normalized = normalizeInstance(instance);
    this.#instances.set(normalized.serverInstanceId, normalized);
    return { ...normalized };
  }

  removeInstance(serverInstanceId) {
    assertNonEmptyString(serverInstanceId, "serverInstanceId");
    this.#instances.delete(serverInstanceId);
    this.#sessionRegistry.deleteByServer(serverInstanceId);
  }

  routeSession(sessionId) {
    assertNonEmptyString(sessionId, "sessionId");

    const existing = this.#sessionRegistry.get(sessionId);
    if (existing) {
      const assigned = this.#instances.get(existing.serverInstanceId);
      if (assigned?.healthy) {
        return {
          sessionId,
          serverInstanceId: assigned.serverInstanceId,
          reusedExistingSession: true,
        };
      }
    }

    const selected = this.#selectForNewSession();
    if (!selected) {
      throw new Error("No healthy server instance is accepting new sessions");
    }

    this.#sessionRegistry.assign(sessionId, selected.serverInstanceId);
    return {
      sessionId,
      serverInstanceId: selected.serverInstanceId,
      reusedExistingSession: false,
    };
  }

  listInstances() {
    return Array.from(this.#instances.values(), (instance) => ({ ...instance }));
  }

  #selectForNewSession() {
    const candidates = Array.from(this.#instances.values())
      .filter((instance) => instance.healthy)
      .filter((instance) => instance.acceptingNewSessions)
      .filter((instance) => instance.load < this.#loadThreshold)
      .sort((left, right) => {
        if (left.load !== right.load) {
          return left.load - right.load;
        }

        return left.serverInstanceId.localeCompare(right.serverInstanceId);
      });

    return candidates[0];
  }
}

function normalizeInstance(instance) {
  if (!instance || typeof instance !== "object") {
    throw new TypeError("instance must be an object");
  }

  const {
    serverInstanceId,
    healthy = true,
    load = 0,
    acceptingNewSessions = true,
  } = instance;

  assertNonEmptyString(serverInstanceId, "serverInstanceId");

  if (typeof load !== "number" || load < 0 || load > 1) {
    throw new RangeError("load must be a number between 0 and 1");
  }

  return {
    serverInstanceId,
    healthy: Boolean(healthy),
    load,
    acceptingNewSessions: Boolean(acceptingNewSessions),
  };
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}
