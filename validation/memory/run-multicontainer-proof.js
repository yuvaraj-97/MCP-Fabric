import { runMemoryMulticontainerProof } from "./multicontainer-harness.js";

const report = await runMemoryMulticontainerProof({
  gatewayBaseUrl:
    process.env.MCP_MEMORY_MULTICONTAINER_GATEWAY_URL ??
    process.env.MCP_MULTICONTAINER_GATEWAY_URL,
  remoteServerBaseUrls: parseRemoteServerBaseUrls(
    process.env.MCP_MEMORY_MULTICONTAINER_SERVER_URLS ??
      process.env.MCP_MULTICONTAINER_SERVER_URLS,
  ),
  cleanup:
    process.env.MCP_MEMORY_MULTICONTAINER_KEEP_ARTIFACTS !== "1" &&
    process.env.MCP_MULTICONTAINER_KEEP_ARTIFACTS !== "1",
});

console.log("Memory multi-container proof completed.");
console.log(JSON.stringify(report, null, 2));

function parseRemoteServerBaseUrls(value) {
  if (!value) {
    return undefined;
  }

  return value.split(",").reduce((output, pair) => {
    const [serverInstanceId, baseUrl] = pair.split("=");
    if (serverInstanceId && baseUrl) {
      output[serverInstanceId.trim()] = baseUrl.trim();
    }
    return output;
  }, {});
}
