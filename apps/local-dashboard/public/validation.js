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
  pendingStreamedAssistantText: "",
  pendingToolCall: null,
  pendingToolResult: null,
  pendingCompletedPayload: null,
};

const elements = {
  scenarioList: document.querySelector("#scenario-list"),
  conversationStream: document.querySelector("#conversation-stream"),
  stepsList: document.querySelector("#steps-list"),
  targetSelect: document.querySelector("#target-select"),
  scenarioSelect: document.querySelector("#scenario-select"),
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
  elements.targetSelect.addEventListener("change", () => {
    const targetId = elements.targetSelect.value;
    const matching = state.scenarios.find((scenario) => scenario.targetId === targetId);
    if (matching) {
      state.selectedScenarioId = matching.id;
      render();
    }
  });
  elements.scenarioSelect.addEventListener("change", () => {
    state.selectedScenarioId = elements.scenarioSelect.value;
    render();
  });
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
  renderSelectors(selectedScenario);
  renderLiveStatus(selectedScenario);
  renderConversationStream(selectedScenario);
  renderSteps(selectedScenario);
}

function renderSelectors(selectedScenario) {
  const targets = uniqueTargets(state.scenarios);
  elements.targetSelect.innerHTML = targets
    .map(
      (target) => `
        <option value="${escapeHtml(target.targetId)}" ${
          selectedScenario?.targetId === target.targetId ? "selected" : ""
        }>${escapeHtml(target.targetLabel)}</option>
      `,
    )
    .join("");

  const activeTargetId = selectedScenario?.targetId ?? targets[0]?.targetId;
  const filteredScenarios = state.scenarios.filter((scenario) => scenario.targetId === activeTargetId);
  elements.scenarioSelect.innerHTML = filteredScenarios
    .map(
      (scenario) => `
        <option value="${escapeHtml(scenario.id)}" ${
          selectedScenario?.id === scenario.id ? "selected" : ""
        }>${escapeHtml(scenario.title)}</option>
      `,
    )
    .join("");
}

function renderScenarios(selectedScenario) {
  elements.scenarioList.innerHTML = state.scenarios
    .filter((scenario) => scenario.targetId === selectedScenario?.targetId)
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

function renderConversationStream(scenario) {
  if (!scenario) {
    elements.conversationStream.innerHTML = "<p>No validation scenario is selected.</p>";
    return;
  }

  const turns = [];
  const results = scenario.results ?? [];

  for (const result of results) {
    turns.push(`
      <article class="conversation-turn">
        ${renderChatBubble("user", result.title, result.userPrompt)}
        ${renderChatBubble("assistant", result.transport, result.assistantSummary)}
      </article>
    `);
  }

  if (state.pendingStepId && state.pendingScenarioId === scenario.id) {
    const pendingStep = scenario.steps.find((step) => step.id === state.pendingStepId);
    if (pendingStep) {
      turns.push(`
        <article class="conversation-turn">
          ${renderChatBubble("user", `${pendingStep.title} (sending)`, pendingStep.userPrompt)}
          ${renderPendingBubble(state.pendingStreamedAssistantText)}
        </article>
      `);
    }
  }

  elements.conversationStream.innerHTML =
    turns.length > 0
      ? turns.join("")
      : "<p>No conversation turns yet. Click <strong>Send step</strong> on the left to begin.</p>";
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
                </div>
              `
              : ""
          }
          ${
            result
              ? `
                <div class="chat-thread">
                  ${renderChatBubble("user", "Prompt sent", step.userPrompt)}
                  ${renderChatBubble("assistant", "Assistant summary", result.assistantSummary)}
                </div>
                <div class="stack">
                  ${renderDisclosure(
                    "What the browser sent",
                    renderKeyValueList([
                      ["Scenario id", scenario.id],
                      ["Step id", step.id],
                      ["Transport", step.transport],
                      ["Prompt", step.userPrompt],
                    ]),
                    true,
                  )}
                  ${
                    result.openaiToolCall
                      ? renderDisclosure(
                          "Inference and tool call",
                          `
                            ${renderKeyValueList([
                              ["Provider", result.provider || "n/a"],
                              ["Model", result.model || "n/a"],
                              ["Tool name", result.openaiToolCall.name],
                              ["Response id", result.openaiResponseId || "n/a"],
                            ])}
                            <pre>${escapeHtml(JSON.stringify(result.openaiToolCall.arguments, null, 2))}</pre>
                          `,
                        )
                      : ""
                  }
                  ${
                    result.outputs?.workspaceSnapshot
                      ? renderDisclosure(
                          "Workspace snapshot",
                          renderWorkspaceSnapshot(result.outputs.workspaceSnapshot),
                        )
                      : ""
                  }
                  ${renderDisclosure(
                    "Raw MCP and gateway output",
                    `<pre>${escapeHtml(JSON.stringify(result.outputs, null, 2))}</pre>`,
                  )}
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
        await streamValidationStep({
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

async function streamValidationStep(body) {
  const response = await fetch("/api/validation/step/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Streaming request failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let boundaryIndex = buffer.indexOf("\n\n");
    while (boundaryIndex !== -1) {
      const frame = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      const event = parseSseFrame(frame);
      if (event) {
        applyStreamEvent(event);
      }
      boundaryIndex = buffer.indexOf("\n\n");
    }
  }
}

function renderChatBubble(role, label, content) {
  return `
    <div class="chat-row chat-row-${escapeHtml(role)}">
      <div class="chat-bubble chat-bubble-${escapeHtml(role)}">
        <p class="chat-label">${escapeHtml(label)}</p>
        <div class="chat-text">${formatMultilineText(content)}</div>
      </div>
    </div>
  `;
}

function renderPendingBubble(streamedText) {
  return `
    <div class="chat-row chat-row-assistant">
      <div class="chat-bubble chat-bubble-pending">
        <p class="chat-label">Assistant is working</p>
        <div class="chat-text">
          <p>${escapeHtml(currentPendingPhase())}</p>
          <p><strong>Elapsed:</strong> ${escapeHtml(state.pendingElapsedLabel)}</p>
          ${
            state.pendingToolCall
              ? `<p><strong>Tool call:</strong> <span class="mono">${escapeHtml(state.pendingToolCall.name || state.pendingToolCall.arguments?.stepId || "validation tool")}</span></p>`
              : ""
          }
          ${
            streamedText
              ? `<p><strong>Streamed assistant text:</strong></p><div>${formatMultilineText(streamedText)}</div>`
              : `<p>The assistant text will appear here token by token as it streams back.</p>`
          }
        </div>
      </div>
    </div>
  `;
}

function renderDisclosure(title, body, open = false) {
  return `
    <details class="disclosure"${open ? " open" : ""}>
      <summary>${escapeHtml(title)}</summary>
      <div class="disclosure-body">${body}</div>
    </details>
  `;
}

function renderKeyValueList(entries) {
  return `
    <dl class="kv-list">
      ${entries
        .map(
          ([key, value]) => `
            <div class="kv-row">
              <dt>${escapeHtml(key)}</dt>
              <dd>${escapeHtml(value)}</dd>
            </div>
          `,
        )
        .join("")}
    </dl>
  `;
}

function renderWorkspaceSnapshot(snapshot) {
  if (!snapshot?.items?.length) {
    return "<p>No files or folders are present in the validation workspace yet.</p>";
  }

  return `
    <div class="workspace-list">
      ${snapshot.items
        .map(
          (item) => `
            <article class="workspace-item">
              <p><strong>${escapeHtml(item.path)}</strong></p>
              <p>${escapeHtml(item.kind)}${item.size ? `, ${item.size} bytes` : ""}</p>
              ${item.preview ? `<pre>${escapeHtml(item.preview)}</pre>` : ""}
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMultilineText(value) {
  return escapeHtml(value).replaceAll("\n", "<br>");
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
  state.pendingStreamedAssistantText = "";
  state.pendingToolCall = null;
  state.pendingToolResult = null;
  state.pendingCompletedPayload = null;
}

function currentPendingPhase() {
  return PENDING_PHASES[state.pendingStatusIndex] || PENDING_PHASES[0];
}

function applyStreamEvent(event) {
  if (event.type === "openai.output_text.delta") {
    state.pendingStreamedAssistantText = event.content;
    render();
    return;
  }

  if (event.type === "openai.tool_call") {
    state.pendingToolCall = event;
    render();
    return;
  }

  if (event.type === "validation.tool_result") {
    state.pendingToolResult = event.output;
    render();
    return;
  }

  if (event.type === "step.completed") {
    state.pendingCompletedPayload = event.payload;
    return;
  }

  if (event.type === "error") {
    throw new Error(event.error || "Streaming request failed");
  }
}

function parseSseFrame(frame) {
  const lines = frame.split(/\r?\n/);
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  return JSON.parse(dataLines.join("\n"));
}

function uniqueTargets(scenarios) {
  const seen = new Map();
  for (const scenario of scenarios) {
    if (!seen.has(scenario.targetId)) {
      seen.set(scenario.targetId, {
        targetId: scenario.targetId,
        targetLabel: scenario.targetLabel || scenario.targetId,
      });
    }
  }
  return Array.from(seen.values());
}
