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
    return this.#routeSession(sessionId, { includeTrace: false });
  }

  explainRoute(sessionId) {
    return this.#routeSession(sessionId, { includeTrace: true });
  }

  #routeSession(sessionId, { includeTrace }) {
    assertNonEmptyString(sessionId, "sessionId");
    const trace = [];

    const existing = this.#sessionRegistry.get(sessionId);
    trace.push({
      type: "lookup",
      sessionId,
      existingServerInstanceId: existing?.serverInstanceId ?? null,
    });

    if (existing) {
      const assigned = this.#instances.get(existing.serverInstanceId);
      if (assigned?.healthy) {
        trace.push({
          type: "reuse-existing-session",
          serverInstanceId: assigned.serverInstanceId,
          load: assigned.load,
        });

        return finalizeDecision(
          {
            sessionId,
            serverInstanceId: assigned.serverInstanceId,
            reusedExistingSession: true,
          },
          trace,
          includeTrace,
        );
      }

      trace.push({
        type: "existing-session-reassignment-required",
        previousServerInstanceId: existing.serverInstanceId,
        reason: assigned ? "instance-unhealthy" : "instance-missing",
      });
    }

    const selected = this.#selectForNewSession(trace);
    if (!selected) {
      trace.push({
        type: "no-instance-selected",
        reason: "no-healthy-instance-accepting-new-sessions",
      });

      const error = new Error("No healthy server instance is accepting new sessions");
      error.trace = trace;
      throw error;
    }

    this.#sessionRegistry.assign(sessionId, selected.serverInstanceId);
    trace.push({
      type: "session-assigned",
      sessionId,
      serverInstanceId: selected.serverInstanceId,
      reusedExistingSession: false,
    });

    return finalizeDecision(
      {
        sessionId,
        serverInstanceId: selected.serverInstanceId,
        reusedExistingSession: false,
      },
      trace,
      includeTrace,
    );
  }

  listInstances() {
    return Array.from(this.#instances.values(), (instance) => ({ ...instance }));
  }

  #selectForNewSession(trace) {
    const candidates = [];
    for (const instance of this.#instances.values()) {
      const reasons = [];
      if (!instance.healthy) {
        reasons.push("instance is unhealthy");
      }
      if (!instance.acceptingNewSessions) {
        reasons.push("instance is not accepting new sessions");
      }
      if (instance.load >= this.#loadThreshold) {
        reasons.push(`instance load ${instance.load} is at or above threshold ${this.#loadThreshold}`);
      }

      const eligible = reasons.length === 0;
      trace.push({
        type: "instance-evaluated",
        serverInstanceId: instance.serverInstanceId,
        healthy: instance.healthy,
        load: instance.load,
        acceptingNewSessions: instance.acceptingNewSessions,
        eligible,
        reasons,
      });

      if (eligible) {
        candidates.push(instance);
      }
    }

    candidates.sort((left, right) => {
      if (left.load !== right.load) {
        return left.load - right.load;
      }

      return left.serverInstanceId.localeCompare(right.serverInstanceId);
    });

    if (candidates[0]) {
      trace.push({
        type: "instance-selected",
        serverInstanceId: candidates[0].serverInstanceId,
        load: candidates[0].load,
      });
    }

    return candidates[0];
  }
}

function finalizeDecision(result, trace, includeTrace) {
  if (!includeTrace) {
    return result;
  }

  return {
    ...result,
    trace: trace.map((entry) => ({ ...entry, reasons: entry.reasons ? [...entry.reasons] : undefined })),
  };
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
