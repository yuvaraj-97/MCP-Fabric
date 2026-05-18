const state = {
  snapshot: null,
};

const elements = {
  problemStatement: document.querySelector("#problem-statement"),
  conceptGrid: document.querySelector("#concept-grid"),
  implementedCopy: document.querySelector("#implemented-copy"),
  plannedCopy: document.querySelector("#planned-copy"),
  improvementList: document.querySelector("#improvement-list"),
  codeAddedList: document.querySelector("#code-added-list"),
  testProofList: document.querySelector("#test-proof-list"),
  walkthroughList: document.querySelector("#walkthrough-list"),
  summaryStrip: document.querySelector("#summary-strip"),
  instanceGrid: document.querySelector("#instance-grid"),
  sessionTable: document.querySelector("#session-table"),
  runtimeSummary: document.querySelector("#runtime-summary"),
  runtimePolicyCopy: document.querySelector("#runtime-policy-copy"),
  runtimeSessionTable: document.querySelector("#runtime-session-table"),
  runtimeEventLog: document.querySelector("#runtime-event-log"),
  eventLog: document.querySelector("#event-log"),
  createSessionButton: document.querySelector("#create-session-button"),
  routeSessionInput: document.querySelector("#route-session-input"),
  routeSessionButton: document.querySelector("#route-session-button"),
  createRuntimeSessionButton: document.querySelector("#create-runtime-session-button"),
  runtimeSessionInput: document.querySelector("#runtime-session-input"),
  runtimeEchoButton: document.querySelector("#runtime-echo-button"),
  runtimeDisconnectButton: document.querySelector("#runtime-disconnect-button"),
  restartRuntimeButton: document.querySelector("#restart-runtime-button"),
  resetButton: document.querySelector("#reset-button"),
};

boot();

async function boot() {
  wireEvents();
  await refreshState();
}

function wireEvents() {
  elements.createSessionButton.addEventListener("click", async () => {
    await runAction(() => postJson("/api/sessions", {}));
  });

  elements.routeSessionButton.addEventListener("click", async () => {
    const sessionId = elements.routeSessionInput.value.trim();
    if (!sessionId) {
      alert("Enter a session id first.");
      return;
    }

    await runAction(() => postJson("/api/route", { sessionId }));
  });

  elements.resetButton.addEventListener("click", async () => {
    await runAction(() => postJson("/api/reset", {}));
  });

  elements.createRuntimeSessionButton.addEventListener("click", async () => {
    await runAction(() => postJson("/api/runtime/sessions", {}));
  });

  elements.runtimeEchoButton.addEventListener("click", async () => {
    const sessionId = elements.runtimeSessionInput.value.trim();
    if (!sessionId) {
      alert("Enter a runtime session id first.");
      return;
    }

    await runAction(() => postJson("/api/runtime/echo", { sessionId }));
  });

  elements.runtimeDisconnectButton.addEventListener("click", async () => {
    const sessionId = elements.runtimeSessionInput.value.trim();
    if (!sessionId) {
      alert("Enter a runtime session id first.");
      return;
    }

    await runAction(() => postJson("/api/runtime/disconnect", { sessionId }));
  });

  elements.restartRuntimeButton.addEventListener("click", async () => {
    await runAction(() => postJson("/api/runtime/restart", {}));
  });
}

async function refreshState() {
  state.snapshot = await fetchJson("/api/state");
  render();
}

function render() {
  const snapshot = state.snapshot;
  const { dashboard } = snapshot;

  elements.problemStatement.textContent = dashboard.problem;
  elements.implementedCopy.textContent = dashboard.status.implemented;
  elements.plannedCopy.textContent = dashboard.status.planned;

  renderConcepts(dashboard.concepts);
  renderImprovementList(dashboard.improvements);
  renderSimpleList(elements.codeAddedList, dashboard.codeAdded);
  renderSimpleList(elements.testProofList, dashboard.testProof);
  renderWalkthrough(dashboard.walkthrough);
  renderSummary(snapshot.summary, snapshot.operatorConfig);
  renderInstances(snapshot.instances, snapshot.loadThreshold);
  renderSessions(snapshot.sessions);
  renderRuntime(snapshot.runtime);
  renderEvents(snapshot.events);
}

function renderConcepts(concepts) {
  elements.conceptGrid.innerHTML = concepts
    .map(
      (concept) => `
        <article class="concept-card">
          <h3>${escapeHtml(concept.title)}</h3>
          <p>${escapeHtml(concept.body)}</p>
        </article>
      `,
    )
    .join("");
}

function renderImprovementList(improvements) {
  elements.improvementList.innerHTML = improvements
    .map(
      (item) => `
        <article class="concept-card">
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.body)}</p>
        </article>
      `,
    )
    .join("");
}

function renderWalkthrough(items) {
  elements.walkthroughList.innerHTML = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderSimpleList(target, items) {
  target.innerHTML = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderSummary(summary, operatorConfig) {
  const cards = [
    { label: "Instances", value: summary.totalInstances },
    { label: "Healthy", value: summary.healthyInstances },
    { label: "Over threshold", value: summary.overloadedInstances },
    { label: "Active sessions", value: summary.activeSessions },
    { label: "Max load", value: operatorConfig.loadThreshold.toFixed(2) },
    { label: "Default fleet", value: operatorConfig.serverCount },
  ];

  elements.summaryStrip.innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card">
          <strong>${escapeHtml(String(card.value))}</strong>
          <span>${escapeHtml(card.label)}</span>
        </article>
      `,
    )
    .join("");
}

function renderInstances(instances, loadThreshold) {
  elements.instanceGrid.innerHTML = instances
    .map((instance) => {
      const healthyBadge = instance.healthy
        ? '<span class="badge badge-healthy">Healthy</span>'
        : '<span class="badge badge-unhealthy">Unhealthy</span>';
      const loadBadge =
        instance.load >= loadThreshold
          ? '<span class="badge badge-overloaded">Above threshold</span>'
          : '<span class="badge badge-healthy">Can take new sessions</span>';

      return `
        <article class="instance-card" data-instance-id="${escapeHtml(instance.serverInstanceId)}">
          <div class="instance-meta">
            <div>
              <strong class="mono">${escapeHtml(instance.serverInstanceId)}</strong>
              <p>Current load: ${escapeHtml(instance.load.toFixed(2))}</p>
            </div>
            <div>${healthyBadge} ${loadBadge}</div>
          </div>
          <div class="instance-controls">
            <label>
              <span>Load slider</span>
              <input type="range" min="0" max="1" step="0.01" value="${escapeHtml(String(instance.load))}" data-field="load" />
            </label>
            <div class="toggle-row">
              <label>
                <input type="checkbox" data-field="healthy" ${instance.healthy ? "checked" : ""} />
                Healthy
              </label>
              <label>
                <input type="checkbox" data-field="acceptingNewSessions" ${instance.acceptingNewSessions ? "checked" : ""} />
                Accepting new sessions
              </label>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  for (const card of elements.instanceGrid.querySelectorAll("[data-instance-id]")) {
    const serverInstanceId = card.getAttribute("data-instance-id");
    const loadInput = card.querySelector('[data-field="load"]');
    const healthyInput = card.querySelector('[data-field="healthy"]');
    const acceptingInput = card.querySelector('[data-field="acceptingNewSessions"]');

    loadInput.addEventListener("change", () =>
      patchInstance(serverInstanceId, {
        load: Number(loadInput.value),
      }),
    );
    healthyInput.addEventListener("change", () =>
      patchInstance(serverInstanceId, {
        healthy: healthyInput.checked,
      }),
    );
    acceptingInput.addEventListener("change", () =>
      patchInstance(serverInstanceId, {
        acceptingNewSessions: acceptingInput.checked,
      }),
    );
  }
}

function renderSessions(sessions) {
  if (sessions.length === 0) {
    elements.sessionTable.innerHTML = '<p>No sessions yet. Create one to start the demo.</p>';
    return;
  }

  elements.sessionTable.innerHTML = `
    <div class="session-table">
      ${sessions
        .map(
          (session) => `
            <article class="session-row">
              <div>
                <strong class="mono">${escapeHtml(session.sessionId)}</strong>
                <p>Created ${escapeHtml(new Date(session.createdAt).toLocaleString())}</p>
              </div>
              <div>
                <strong class="mono">${escapeHtml(session.serverInstanceId)}</strong>
                <p>Sticky target for future requests</p>
              </div>
              <button class="button" data-route-session="${escapeHtml(session.sessionId)}">Route again</button>
            </article>
          `,
        )
        .join("")}
    </div>
  `;

  for (const button of elements.sessionTable.querySelectorAll("[data-route-session]")) {
    button.addEventListener("click", async () => {
      const sessionId = button.getAttribute("data-route-session");
      await postJson("/api/route", { sessionId });
      await refreshState();
    });
  }
}

function renderEvents(events) {
  elements.eventLog.innerHTML = events
    .map(
      (event) => `
        <article class="event-item">
          <h3>${escapeHtml(event.title)}</h3>
          <p>${escapeHtml(event.summary)}</p>
          <p>${escapeHtml(new Date(event.timestamp).toLocaleString())}</p>
          <ol>${event.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
        </article>
      `,
    )
    .join("");
}

function renderRuntime(runtime) {
  elements.runtimePolicyCopy.textContent = runtime.policy;
  const summaryCards = [
    { label: "Gateway instances", value: runtime.instances.length },
    { label: "Gateway sessions", value: runtime.sessions.length },
    { label: "Latest runtime session", value: runtime.latestSessionId ?? "none" },
    { label: "Registry mode", value: runtime.registry.mode },
    { label: "Durable", value: runtime.registry.durable ? "yes" : "no" },
    { label: "Max load", value: runtime.registry.loadThreshold.toFixed(2) },
    { label: "Session TTL", value: formatDuration(runtime.registry.sessionTtlMs) },
    { label: "Reconnect grace", value: formatDuration(runtime.registry.reconnectGracePeriodMs) },
  ];

  elements.runtimeSummary.innerHTML = summaryCards
    .map(
      (card) => `
        <article class="summary-card">
          <strong>${escapeHtml(String(card.value))}</strong>
          <span>${escapeHtml(card.label)}</span>
        </article>
      `,
    )
    .join("");

  if (runtime.sessions.length === 0) {
    elements.runtimeSessionTable.innerHTML = `<p>${escapeHtml(runtime.body)}</p>`;
  } else {
    elements.runtimeSessionTable.innerHTML = `
      <div class="session-table">
        ${runtime.sessions
          .map(
            (session) => `
              <article class="session-row">
                <div>
                  <strong class="mono">${escapeHtml(session.sessionId)}</strong>
                  <p>Assigned by the real in-process gateway controller</p>
                </div>
                <div>
                  <strong class="mono">${escapeHtml(session.serverInstanceId)}</strong>
                  <p>Sticky target for runtime transport flow</p>
                </div>
                <div>
                  <p>state=${escapeHtml(session.metadata.connectionState ?? "active")}</p>
                  <p>ttl=${escapeHtml(formatDurationRemaining(session.metadata.expiresAt))}</p>
                  <p>grace=${escapeHtml(formatTimestamp(session.metadata.graceUntil))}</p>
                </div>
                <button class="button" data-runtime-session="${escapeHtml(session.sessionId)}">Runtime echo</button>
              </article>
            `,
          )
          .join("")}
      </div>
    `;

    for (const button of elements.runtimeSessionTable.querySelectorAll("[data-runtime-session]")) {
      button.addEventListener("click", async () => {
        const sessionId = button.getAttribute("data-runtime-session");
        await runAction(() => postJson("/api/runtime/echo", { sessionId }));
      });
    }
  }

  elements.runtimeEventLog.innerHTML = runtime.events
    .map(
      (event) => `
        <article class="event-item">
          <h3>${escapeHtml(event.title)}</h3>
          <p>${escapeHtml(event.summary)}</p>
          <p>${escapeHtml(new Date(event.timestamp).toLocaleString())}</p>
          ${
            Array.isArray(event.details) && event.details.length > 0
              ? `<ol>${event.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}</ol>`
              : ""
          }
        </article>
      `,
    )
    .join("");
}

async function patchInstance(serverInstanceId, body) {
  await runAction(() =>
    fetchJson(`/api/instances/${encodeURIComponent(serverInstanceId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function postJson(url, body) {
  return fetchJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}

async function runAction(action) {
  try {
    await action();
    await refreshState();
  } catch (error) {
    alert(error.message || "Request failed");
    await refreshState();
  }
}

function formatDuration(durationMs) {
  if (typeof durationMs !== "number" || Number.isNaN(durationMs)) {
    return "unknown";
  }

  if (durationMs % 1000 === 0) {
    return `${durationMs / 1000}s`;
  }

  return `${durationMs}ms`;
}

function formatDurationRemaining(timestamp) {
  if (typeof timestamp !== "number") {
    return "none";
  }

  const remainingMs = Math.max(0, timestamp - Date.now());
  return formatDuration(remainingMs);
}

function formatTimestamp(timestamp) {
  if (typeof timestamp !== "number") {
    return "none";
  }

  return new Date(timestamp).toLocaleTimeString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
