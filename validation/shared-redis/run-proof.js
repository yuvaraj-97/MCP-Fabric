import { runSharedRedisGatewayProof } from "./harness.js";

const report = await runSharedRedisGatewayProof();
console.log(JSON.stringify(report, null, 2));
