export function createGatewayObserver({ limit = 100, now = () => Date.now() } = {}) {
  const events = [];
  const counters = {
    totalEvents: 0,
    totalRequests: 0,
    totalErrors: 0,
    totalRejectedRequests: 0,
    totalInitializations: 0,
    totalStickyReuses: 0,
    totalReassignments: 0,
    totalReconnections: 0,
    totalStreamAttachments: 0,
    totalStreamDetachments: 0,
    totalInstanceUpdates: 0,
    totalRuntimeRecommendations: 0,
    totalRuntimeOverrideWarnings: 0,
    totalAdaptivePlacements: 0,
    totalAdaptivePlacementDrifts: 0,
  };

  return {
    record(eventType, payload = {}) {
      counters.totalEvents += 1;
      applyCounterSideEffects(counters, eventType, payload);

      const entry = {
        id: `gateway-event-${counters.totalEvents}`,
        timestamp: new Date(now()).toISOString(),
        eventType,
        ...payload,
      };
      events.unshift(entry);
      if (events.length > limit) {
        events.length = limit;
      }

      return { ...entry };
    },
    summary() {
      return {
        ...counters,
        recentEventCount: events.length,
      };
    },
    listEvents({ limit: nextLimit } = {}) {
      const slice = typeof nextLimit === "number" ? events.slice(0, nextLimit) : events;
      return slice.map((entry) => ({ ...entry }));
    },
    clear() {
      events.length = 0;
      for (const key of Object.keys(counters)) {
        counters[key] = 0;
      }
    },
  };
}

function applyCounterSideEffects(counters, eventType, payload) {
  if (eventType === "request.received") {
    counters.totalRequests += 1;
    if (payload.method === "initialize") {
      counters.totalInitializations += 1;
    }
  }

  if (eventType === "request.rejected" || eventType === "request.failed") {
    counters.totalErrors += 1;
  }

  if (eventType === "request.rejected") {
    counters.totalRejectedRequests += 1;
  }

  if (eventType === "route.completed") {
    if (payload.reusedExistingSession) {
      counters.totalStickyReuses += 1;
    }

    if (
      typeof payload.recoveryAction === "string" &&
      payload.recoveryAction.includes("reassign")
    ) {
      counters.totalReassignments += 1;
    }

    if (
      typeof payload.recoveryAction === "string" &&
      payload.recoveryAction.includes("reconnect")
    ) {
      counters.totalReconnections += 1;
    }
  }

  if (eventType === "stream.attached") {
    counters.totalStreamAttachments += 1;
  }

  if (eventType === "stream.detached") {
    counters.totalStreamDetachments += 1;
  }

  if (eventType === "instance.updated") {
    counters.totalInstanceUpdates += 1;
  }

  if (eventType === "runtime.recommendation") {
    counters.totalRuntimeRecommendations += 1;
    if (payload.runtimeRecommendation?.explicitOverride) {
      counters.totalRuntimeOverrideWarnings += 1;
    }
  }

  if (eventType === "adaptive.placement.applied") {
    counters.totalAdaptivePlacements += 1;
    if (payload.driftFromPhase2Mode) {
      counters.totalAdaptivePlacementDrifts += 1;
    }
  }
}
