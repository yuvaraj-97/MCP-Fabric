# Standalone MCP-Fabric gateway image.
#
# This image runs the gateway as an independent process. It does NOT bundle
# backend MCP servers; point it at remote MCP servers with REMOTE_BASE_URLS_JSON
# + SERVER_INSTANCES_JSON, or run it self-contained (demo applications) for
# evaluation. See docs/standalone-gateway.md and docs/deployment-guide.md.
FROM node:20-slim

WORKDIR /app

# Install production dependencies only (ioredis, zod, @modelcontextprotocol/sdk).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# The gateway runs entirely from the packages/ tree.
COPY packages ./packages

# Container networking requires binding all interfaces. The startup security
# audit deliberately fails closed on a public bind unless the operator opts in,
# so the gateway must run behind an authenticating/TLS-terminating proxy (or on
# a trusted private network) and set MCP_GATEWAY_ALLOW_PUBLIC_BIND=true. Keeping
# the secure default in the image means a naive `docker run` refuses to expose an
# unauthenticated gateway. See docs/standalone-gateway.md#security.
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/gateway/bin/standalone-gateway.js"]
