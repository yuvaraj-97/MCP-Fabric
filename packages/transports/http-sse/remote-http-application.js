export function createRemoteHttpApplication({
  serverInstanceId,
  baseUrl,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!serverInstanceId) {
    throw new TypeError("serverInstanceId is required");
  }
  if (!baseUrl) {
    throw new TypeError("baseUrl is required");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetch implementation is required");
  }

  const knownSessions = new Set();
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  return {
    serverInstanceId,
    getSessionState(sessionId) {
      return knownSessions.has(sessionId) ? { sessionId } : undefined;
    },
    async handleMessage(message, context = {}) {
      const effectiveSessionId = context.sessionId ?? message?.sessionId;
      const response = await fetchImpl(`${normalizedBaseUrl}/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          context,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? `Remote MCP request failed with status ${response.status}`);
      }

      if (effectiveSessionId && (message?.method === "initialize" || payload?.result)) {
        knownSessions.add(effectiveSessionId);
      }

      return payload;
    },
  };
}
