import { runFilesystemMulticontainerProof } from "./harness.js";

const gatewayBaseUrl = process.env.MCP_MULTICONTAINER_GATEWAY_URL;
const remoteServerBaseUrls = parseRemoteServerBaseUrls(process.env.MCP_MULTICONTAINER_SERVER_URLS);

const report = await runFilesystemMulticontainerProof({
  gatewayBaseUrl,
  remoteServerBaseUrls,
  cleanup: process.env.MCP_MULTICONTAINER_KEEP_ARTIFACTS !== "1",
  adaptivePlacement:
    process.env.MCP_MULTICONTAINER_ADAPTIVE_PLACEMENT === "1" ||
    process.env.MCP_MULTICONTAINER_ADAPTIVE_PLACEMENT === "true",
});

console.log("Filesystem multi-container proof completed.");
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
