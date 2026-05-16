import { createSessionContext } from "../session/session-context.js";

export class McpApplicationServer {
  #serverInfo;
  #protocolVersion;
  #instructions;
  #tools = new Map();
  #notificationLog = [];

  constructor({
    serverInfo = { name: "mcp-application-server", version: "0.1.0" },
    protocolVersion = "2025-03-26",
    instructions = "Transport-neutral MCP-compatible application server.",
  } = {}) {
    validateServerInfo(serverInfo);
    assertNonEmptyString(protocolVersion, "protocolVersion");
    assertNonEmptyString(instructions, "instructions");

    this.#serverInfo = { ...serverInfo };
    this.#protocolVersion = protocolVersion;
    this.#instructions = instructions;
  }

  registerTool(definition) {
    const normalized = normalizeToolDefinition(definition);
    this.#tools.set(normalized.name, normalized);
    return publicToolDefinition(normalized);
  }

  listTools() {
    return Array.from(this.#tools.values(), publicToolDefinition);
  }

  listNotifications() {
    return this.#notificationLog.map((entry) => ({
      ...entry,
      context: {
        ...entry.context,
        metadata: { ...entry.context.metadata },
      },
      params: cloneValue(entry.params),
    }));
  }

  async handleMessage(message, contextInput = {}) {
    const messageValidationError = validateIncomingMessage(message);
    if (messageValidationError) {
      return createErrorResponse(null, -32600, messageValidationError);
    }

    const context = createSessionContext(contextInput);

    if (isNotification(message)) {
      await this.#handleNotification(message, context);
      return null;
    }

    try {
      const result = await this.#dispatchRequest(message, context);
      return createSuccessResponse(message.id, result);
    } catch (error) {
      return createErrorResponse(
        message.id,
        error.code ?? -32603,
        error.message ?? "Internal error",
      );
    }
  }

  async #dispatchRequest(message, context) {
    switch (message.method) {
      case "initialize":
        return {
          protocolVersion: this.#protocolVersion,
          serverInfo: { ...this.#serverInfo },
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          instructions: this.#instructions,
        };
      case "ping":
        return {
          ok: true,
          session: {
            sessionId: context.sessionId,
            clientId: context.clientId,
            transport: context.transport,
          },
        };
      case "tools/list":
        return {
          tools: this.listTools(),
        };
      case "tools/call":
        return this.#callTool(message.params, context);
      default:
        throw createProtocolError(-32601, `Unsupported MCP method: ${message.method}`);
    }
  }

  async #callTool(params, context) {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      throw createProtocolError(-32602, "tools/call params must be an object");
    }

    const { name, arguments: toolArguments = {} } = params;
    assertNonEmptyString(name, "tool name");

    if (!toolArguments || typeof toolArguments !== "object" || Array.isArray(toolArguments)) {
      throw createProtocolError(-32602, "tool arguments must be an object");
    }

    const tool = this.#tools.get(name);
    if (!tool) {
      throw createProtocolError(-32601, `Unknown tool: ${name}`);
    }

    const structuredContent = await tool.handler({
      arguments: cloneValue(toolArguments),
      context,
    });

    return {
      content: [
        {
          type: "text",
          text: renderToolText(name, structuredContent, context),
        },
      ],
      structuredContent,
      isError: false,
    };
  }

  async #handleNotification(message, context) {
    this.#notificationLog.push({
      method: message.method,
      params: cloneValue(message.params ?? {}),
      context,
      receivedAt: Date.now(),
    });
  }
}

function renderToolText(name, structuredContent, context) {
  return JSON.stringify(
    {
      tool: name,
      sessionId: context.sessionId,
      result: structuredContent,
    },
    null,
    2,
  );
}

function normalizeToolDefinition(definition) {
  if (!definition || typeof definition !== "object") {
    throw new TypeError("tool definition must be an object");
  }

  const {
    name,
    title = definition.name,
    description,
    inputSchema = {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
    handler,
  } = definition;

  assertNonEmptyString(name, "tool name");
  assertNonEmptyString(title, "tool title");
  assertNonEmptyString(description, "tool description");

  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) {
    throw new TypeError("tool inputSchema must be an object");
  }

  if (typeof handler !== "function") {
    throw new TypeError("tool handler must be a function");
  }

  return {
    name,
    title,
    description,
    inputSchema: cloneValue(inputSchema),
    handler,
  };
}

function publicToolDefinition(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: cloneValue(tool.inputSchema),
  };
}

function validateIncomingMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return "Incoming message must be an object";
  }
  if (message.jsonrpc !== "2.0") {
    return "Incoming message must use JSON-RPC 2.0";
  }
  if (typeof message.method !== "string" || message.method.length === 0) {
    return "Incoming message must include a method";
  }

  return null;
}

function isNotification(message) {
  return !Object.hasOwn(message, "id");
}

function createSuccessResponse(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function createErrorResponse(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

function createProtocolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateServerInfo(serverInfo) {
  if (!serverInfo || typeof serverInfo !== "object" || Array.isArray(serverInfo)) {
    throw new TypeError("serverInfo must be an object");
  }

  assertNonEmptyString(serverInfo.name, "serverInfo.name");
  assertNonEmptyString(serverInfo.version, "serverInfo.version");
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw createProtocolError(-32602, `${name} must be a non-empty string`);
  }
}

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}
