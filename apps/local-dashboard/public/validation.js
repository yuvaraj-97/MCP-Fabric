const state = {
  scenarios: [],
  selectedScenarioId: "filesystem-conversation",
};

const elements = {
  scenarioList: document.querySelector("#scenario-list"),
  stepsList: document.querySelector("#steps-list"),
  refreshButton: document.querySelector("#refresh-button"),
  resetButton: document.querySelector("#reset-button"),
  errorBanner: document.querySelector("#error-banner"),
};

boot();

async function boot() {
  wireEvents();
  await refresh();
}

function wireEvents() {
  elements.refreshButton.addEventListener("click", refresh);
  elements.resetButton.addEventListener("click", async () => {
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
      return `
        <article class="event-item">
          <h3>Step ${index + 1}: ${escapeHtml(step.title)}</h3>
          <p><strong>Transport:</strong> ${escapeHtml(step.transport)}</p>
          <p><strong>User prompt:</strong> ${escapeHtml(step.userPrompt)}</p>
          <p><strong>What we are testing:</strong> ${escapeHtml(step.whatTesting)}</p>
          <p><strong>Expected result:</strong> ${escapeHtml(step.expected)}</p>
          <div class="controls">
            <button class="button button-primary" data-run-step="${escapeHtml(step.id)}" ${
              scenario.available === false ? "disabled" : ""
            }>Send step</button>
          </div>
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
        await postJson("/api/validation/step", {
          scenarioId: state.selectedScenarioId,
          stepId: button.getAttribute("data-run-step"),
        });
        await refresh();
      } catch (error) {
        showError(error.message);
      }
    });
  }
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
