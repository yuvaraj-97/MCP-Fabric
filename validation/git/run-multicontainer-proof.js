import { runGitMulticontainerProof } from "./multicontainer-harness.js";

const gatewayBaseUrl =
  process.env.MCP_GIT_MULTICONTAINER_GATEWAY_URL ?? process.env.MCP_MULTICONTAINER_GATEWAY_URL;
const remoteServerBaseUrls = parseRemoteServerBaseUrls(
  process.env.MCP_GIT_MULTICONTAINER_SERVER_URLS ?? process.env.MCP_MULTICONTAINER_SERVER_URLS,
);
const rootDir =
  process.env.MCP_GIT_MULTICONTAINER_ROOT_DIR ?? process.env.MCP_MULTICONTAINER_ROOT_DIR;

const report = await runGitMulticontainerProof({
  gatewayBaseUrl,
  remoteServerBaseUrls,
  rootDir,
  cleanup:
    process.env.MCP_GIT_MULTICONTAINER_KEEP_ARTIFACTS !== "1" &&
    process.env.MCP_MULTICONTAINER_KEEP_ARTIFACTS !== "1",
  initializeRoot:
    process.env.MCP_GIT_MULTICONTAINER_INITIALIZE_ROOT === "1" ||
    process.env.MCP_GIT_MULTICONTAINER_INITIALIZE_ROOT === "true",
  adaptivePlacement:
    process.env.MCP_GIT_MULTICONTAINER_ADAPTIVE_PLACEMENT === "1" ||
    process.env.MCP_GIT_MULTICONTAINER_ADAPTIVE_PLACEMENT === "true" ||
    process.env.MCP_MULTICONTAINER_ADAPTIVE_PLACEMENT === "1" ||
    process.env.MCP_MULTICONTAINER_ADAPTIVE_PLACEMENT === "true",
});

console.log("Git multi-container proof completed.");
console.log(JSON.stringify(report, null, 2));

if (!report.ok || Object.values(report.checks).some(check => !check)) {
  console.error("Git multi-container proof checks failed!");
  process.exit(1);
}

function parseRemoteServerBaseUrls(raw) {
  if (!raw) {
    return undefined;
  }

  return Object.fromEntries(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [serverInstanceId, baseUrl] = entry.split("=");
        return [serverInstanceId, baseUrl];
      }),
  );
}
