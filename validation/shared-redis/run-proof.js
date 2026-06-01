import { runSharedRedisGatewayProof } from "./harness.js";

const report = await runSharedRedisGatewayProof({
  adaptivePlacement:
    process.env.MCP_SHARED_REDIS_ADAPTIVE_PLACEMENT === "1" ||
    process.env.MCP_SHARED_REDIS_ADAPTIVE_PLACEMENT === "true",
});
console.log(JSON.stringify(report, null, 2));

if (!report.ok) {
  console.error("Shared Redis gateway proof checks failed!");
  process.exit(1);
}
