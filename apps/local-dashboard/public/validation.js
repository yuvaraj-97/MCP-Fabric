const state = {
  scenarios: [],
  selectedScenarioId: "filesystem-conversation",
  pendingStepId: null,
  pendingScenarioId: null,
  pendingStatusIndex: 0,
  pendingStartedAt: 0,
  pendingElapsedLabel: "0.0s",
  pendingTicker: null,
  pendingPhaseTicker: null,
};

const elements = {
  scenarioList: document.querySelector("#scenario-list"),
  stepsList: document.querySelector("#steps-list"),
  refreshButton: document.querySelector("#refresh-button"),
  resetButton: document.querySelector("#reset-button"),
  errorBanner: document.querySelector("#error-banner"),
  liveStatus: document.querySelector("#live-status"),
};

const PENDING_PHASES = [
  "Request sent from the browser to the local validation server.",
  "Validation runner is preparing the transport-specific action.",
  "If this is the OpenAI scenario, the model is deciding which validation tool to call.",
  "The real MCP validation step is executing through stdio or the HTTP/SSE gateway.",
  "Waiting for the assistant summary and final result payload.",
];

boot();

async function boot() {
  wireEvents();
  await refresh();
}

function wireEvents() {
  elements.refreshButton.addEventListener("click", refresh);
  elements.resetButton.addEventListener("click", async () => {
    clearPendingState();
    await postJson("/api/validation/reset", {
      scenarioId: state.selectedScenarioId,
    });
    await refresh();
  });
}

async function refresh() {
  try {
    hideError();
    state.scenarios = await fetchJson("/api/validation/scenarios");
    render();
  } catch (error) {
    showError(error.message);
  }
}

function render() {
  const selectedScenario =
    state.scenarios.find((scenario) => scenario.id === state.selectedScenarioId) ??
    state.scenarios[0];

  if (selectedScenario) {
    state.selectedScenarioId = selectedScenario.id;
  }

  renderScenarios(selectedScenario);
  renderLiveStatus(selectedScenario);
  renderSteps(selectedScenario);
}

function renderScenarios(selectedScenario) {
  elements.scenarioList.innerHTML = state.scenarios
    .map(
      (scenario) => `
        <article class="event-item">
          <h3>${escapeHtml(scenario.title)}</h3>
          <p>${escapeHtml(scenario.audience)}</p>
          <p><strong>Scenario id:</strong> <span class="mono">${escapeHtml(scenario.id)}</span></p>
          <p><strong>Workspace:</strong> <span class="mono">${escapeHtml(scenario.rootDir)}</span></p>
          ${
            scenario.createdFile
              ? `<p><strong>Expected file:</strong> <span class="mono">${escapeHtml(scenario.createdFile.absolutePath)}</span></p>`
              : ""
          }
          <p><strong>Completed steps:</strong> ${scenario.results.length}/${scenario.steps.length}</p>
          <p><strong>Availability:</strong> ${
            scenario.available === false
              ? `<span class="mono">disabled</span> ${escapeHtml(scenario.disabledReason || "")}`
              : `<span class="mono">ready</span>`
          }</p>
          ${
            scenario.provider
              ? `<p><strong>Provider:</strong> ${escapeHtml(`${scenario.provider.name} (${scenario.provider.model})`)}</p>`
              : ""
          }
          <button class="button ${selectedScenario?.id === scenario.id ? "button-primary" : ""}" data-select-scenario="${escapeHtml(scenario.id)}">
            ${selectedScenario?.id === scenario.id ? "Selected" : "Select"}
          </button>
        </article>
      `,
    )
    .join("");

  for (const button of elements.scenarioList.querySelectorAll("[data-select-scenario]")) {
    button.addEventListener("click", async () => {
      state.selectedScenarioId = button.getAttribute("data-select-scenario");
      await refresh();
    });
  }
}

function renderSteps(scenario) {
  if (!scenario) {
    elements.stepsList.innerHTML = "<p>No validation scenarios are available.</p>";
    return;
  }

  const resultById = new Map((scenario.results ?? []).map((result) => [result.id, result]));
  elements.stepsList.innerHTML = scenario.steps
    .map((step, index) => {
      const result = resultById.get(step.id);
      const isPending =
        state.pendingScenarioId === scenario.id && state.pendingStepId === step.id;
      return `
        <article class="event-item">
          <h3>Step ${index + 1}: ${escapeHtml(step.title)}</h3>
          <p><strong>Transport:</strong> ${escapeHtml(step.transport)}</p>
          <p><strong>User prompt:</strong> ${escapeHtml(step.userPrompt)}</p>
          <p><strong>What we are testing:</strong> ${escapeHtml(step.whatTesting)}</p>
          <p><strong>Expected result:</strong> ${escapeHtml(step.expected)}</p>
          <div class="controls">
            <button class="button button-primary" data-run-step="${escapeHtml(step.id)}" ${
              scenario.available === false || state.pendingStepId ? "disabled" : ""
            }>${isPending ? "Running..." : "Send step"}</button>
          </div>
          ${
            isPending
              ? `
                <div class="status-block status-pending">
                  <h3>Live progress</h3>
                  <p><strong>Current phase:</strong> ${escapeHtml(currentPendingPhase())}</p>
                  <p><strong>Elapsed:</strong> ${escapeHtml(state.pendingElapsedLabel)}</p>
                  <p><strong>Prompt sent:</strong> ${escapeHtml(step.userPrompt)}</p>
                </div>
              `
              : ""
          }
          ${
            result
              ? `
                <div class="status-block">
                  <h3>Assistant summary</h3>
                  <p>${escapeHtml(result.assistantSummary)}</p>
                </div>
                <div class="status-block">
                  <h3>Output</h3>
                  <pre>${escapeHtml(JSON.stringify(result.outputs, null, 2))}</pre>
                </div>
              `
              : '<p>This step has not been run yet.</p>'
          }
        </article>
      `;
    })
    .join("");

  for (const button of elements.stepsList.querySelectorAll("[data-run-step]")) {
    button.addEventListener("click", async () => {
      try {
        hideError();
        beginPendingState(state.selectedScenarioId, button.getAttribute("data-run-step"));
        await postJson("/api/validation/step", {
          scenarioId: state.selectedScenarioId,
          stepId: button.getAttribute("data-run-step"),
        });
        clearPendingState();
        await refresh();
      } catch (error) {
        clearPendingState();
        showError(error.message);
      }
    });
  }
}

function renderLiveStatus(scenario) {
  if (!state.pendingStepId || state.pendingScenarioId !== scenario?.id) {
    elements.liveStatus.hidden = true;
    elements.liveStatus.innerHTML = "";
    return;
  }

  const step = scenario.steps.find((candidate) => candidate.id === state.pendingStepId);
  if (!step) {
    elements.liveStatus.hidden = true;
    elements.liveStatus.innerHTML = "";
    return;
  }

  elements.liveStatus.hidden = false;
  elements.liveStatus.innerHTML = `
    <h3>Validation request in progress</h3>
    <p><strong>Scenario:</strong> ${escapeHtml(scenario.title)}</p>
    <p><strong>Step:</strong> ${escapeHtml(step.title)}</p>
    <p><strong>Status:</strong> ${escapeHtml(currentPendingPhase())}</p>
    <p><strong>Elapsed:</strong> ${escapeHtml(state.pendingElapsedLabel)}</p>
    <p><strong>Prompt already sent:</strong> ${escapeHtml(step.userPrompt)}</p>
  `;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}

async function postJson(url, body) {
  return fetchJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showError(message) {
  elements.errorBanner.hidden = false;
  elements.errorBanner.innerHTML = `<h3>Validation error</h3><p>${escapeHtml(message)}</p>`;
}

function hideError() {
  elements.errorBanner.hidden = true;
  elements.errorBanner.innerHTML = "";
}

function beginPendingState(scenarioId, stepId) {
  clearPendingState();
  state.pendingScenarioId = scenarioId;
  state.pendingStepId = stepId;
  state.pendingStatusIndex = 0;
  state.pendingStartedAt = Date.now();
  state.pendingElapsedLabel = "0.0s";
  state.pendingTicker = window.setInterval(() => {
    state.pendingElapsedLabel = `${((Date.now() - state.pendingStartedAt) / 1000).toFixed(1)}s`;
    render();
  }, 120);
  state.pendingPhaseTicker = window.setInterval(() => {
    state.pendingStatusIndex = Math.min(
      state.pendingStatusIndex + 1,
      PENDING_PHASES.length - 1,
    );
    render();
  }, 1800);
  render();
}

function clearPendingState() {
  if (state.pendingTicker) {
    window.clearInterval(state.pendingTicker);
  }
  if (state.pendingPhaseTicker) {
    window.clearInterval(state.pendingPhaseTicker);
  }
  state.pendingTicker = null;
  state.pendingPhaseTicker = null;
  state.pendingStepId = null;
  state.pendingScenarioId = null;
  state.pendingStatusIndex = 0;
  state.pendingStartedAt = 0;
  state.pendingElapsedLabel = "0.0s";
}

function currentPendingPhase() {
  return PENDING_PHASES[state.pendingStatusIndex] || PENDING_PHASES[0];
}
