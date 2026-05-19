import { runGitMulticontainerProof } from "./multicontainer-harness.js";

const gatewayBaseUrl =
  process.env.MCP_GIT_MULTICONTAINER_GATEWAY_URL ?? process.env.MCP_MULTICONTAINER_GATEWAY_URL;
const remoteServerBaseUrls = parseRemoteServerBaseUrls(
  process.env.MCP_GIT_MULTICONTAINER_SERVER_URLS ?? process.env.MCP_MULTICONTAINER_SERVER_URLS,
);

const report = await runGitMulticontainerProof({
  gatewayBaseUrl,
  remoteServerBaseUrls,
  cleanup:
    process.env.MCP_GIT_MULTICONTAINER_KEEP_ARTIFACTS !== "1" &&
    process.env.MCP_MULTICONTAINER_KEEP_ARTIFACTS !== "1",
});

console.log("Git multi-container proof completed.");
console.log(JSON.stringify(report, null, 2));

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
