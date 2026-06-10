import { runMemoryMulticontainerProof } from "./multicontainer-harness.js";

const report = await runMemoryMulticontainerProof({
  gatewayBaseUrl:
    process.env.MCP_MEMORY_MULTICONTAINER_GATEWAY_URL ??
    process.env.MCP_MULTICONTAINER_GATEWAY_URL,
  remoteServerBaseUrls: parseRemoteServerBaseUrls(
    process.env.MCP_MEMORY_MULTICONTAINER_SERVER_URLS ??
      process.env.MCP_MULTICONTAINER_SERVER_URLS,
  ),
  storeFile:
    process.env.MCP_MEMORY_MULTICONTAINER_STORE_FILE ??
    process.env.MCP_MULTICONTAINER_MEMORY_STORE_FILE,
  cleanup:
    process.env.MCP_MEMORY_MULTICONTAINER_KEEP_ARTIFACTS !== "1" &&
    process.env.MCP_MULTICONTAINER_KEEP_ARTIFACTS !== "1",
  adaptivePlacement:
    process.env.MCP_MEMORY_MULTICONTAINER_ADAPTIVE_PLACEMENT === "1" ||
    process.env.MCP_MEMORY_MULTICONTAINER_ADAPTIVE_PLACEMENT === "true" ||
    process.env.MCP_MULTICONTAINER_ADAPTIVE_PLACEMENT === "1" ||
    process.env.MCP_MULTICONTAINER_ADAPTIVE_PLACEMENT === "true",
});

console.log("Memory multi-container proof completed.");
console.log(JSON.stringify(report, null, 2));

if (!report.ok || Object.values(report.checks).some(check => !check)) {
  console.error("Memory multi-container proof checks failed!");
  process.exit(1);
}

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
