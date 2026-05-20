import { createSessionContext } from "../session/session-context.js";
import {
  ErrorCode,
  createErrorResponse,
  createSuccessResponse,
  isNotification,
  toSdkEnvelope,
  validateIncomingMessage,
} from "./jsonrpc-envelope.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  PingRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export class McpApplicationServer {
  #serverInfo;
  #protocolVersion;
  #instructions;
  #tools = new Map();
  #methodHandlers = new Map();
  #notificationLog = [];
  #maxNotificationLogEntries;
  #notificationListeners = new Set();
  #notificationEventHook;

  constructor({
    serverInfo = { name: "mcp-application-server", version: "0.1.0" },
    protocolVersion = "2025-03-26",
    instructions = "Transport-neutral MCP-compatible application server.",
    maxNotificationLogEntries = 500,
    onNotificationEvent,
  } = {}) {
    validateServerInfo(serverInfo);
    assertNonEmptyString(protocolVersion, "protocolVersion");
    assertNonEmptyString(instructions, "instructions");
    assertPositiveInteger(maxNotificationLogEntries, "maxNotificationLogEntries");
    if (onNotificationEvent !== undefined && typeof onNotificationEvent !== "function") {
      throw new TypeError("onNotificationEvent must be a function");
    }

    this.#serverInfo = { ...serverInfo };
    this.#protocolVersion = protocolVersion;
    this.#instructions = instructions;
    this.#maxNotificationLogEntries = maxNotificationLogEntries;
    this.#notificationEventHook = onNotificationEvent ?? null;
  }

  registerTool(definition) {
    const normalized = normalizeToolDefinition(definition);
    this.#tools.set(normalized.name, normalized);
    return publicToolDefinition(normalized);
  }

  registerMethod(method, handler) {
    assertNonEmptyString(method, "method");
    if (typeof handler !== "function") {
      throw new TypeError("method handler must be a function");
    }

    this.#methodHandlers.set(method, handler);
    return method;
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

  getNotificationLogState() {
    return {
      size: this.#notificationLog.length,
      maxEntries: this.#maxNotificationLogEntries,
    };
  }

  subscribeToNotificationEvents(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("notification event listener must be a function");
    }

    this.#notificationListeners.add(listener);
    return () => {
      this.#notificationListeners.delete(listener);
    };
  }

  async handleMessage(message, contextInput = {}) {
    const messageValidationError = validateIncomingMessage(message);
    if (messageValidationError) {
      return createErrorResponse(null, ErrorCode.InvalidRequest, messageValidationError);
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
        error.code ?? ErrorCode.InternalError,
        error.message ?? "Internal error",
      );
    }
  }

  async #dispatchRequest(message, context) {
    const customHandler = this.#methodHandlers.get(message.method);
    if (customHandler) {
      return customHandler({
        params: cloneValue(message.params ?? {}),
        context,
        message: cloneValue(message),
      });
    }

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
        validateSdkRequest(PingRequestSchema, message, "ping request");
        return {
          ok: true,
          session: {
            sessionId: context.sessionId,
            clientId: context.clientId,
            transport: context.transport,
          },
        };
      case "tools/list":
        validateSdkRequest(ListToolsRequestSchema, message, "tools/list request");
        return {
          tools: this.listTools(),
        };
      case "tools/call":
        validateSdkRequest(CallToolRequestSchema, message, "tools/call request");
        return this.#callTool(message.params, context);
      default:
        throw createProtocolError(ErrorCode.MethodNotFound, `Unsupported MCP method: ${message.method}`);
    }
  }

  async #callTool(params, context) {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      throw createProtocolError(ErrorCode.InvalidParams, "tools/call params must be an object");
    }

    const { name, arguments: toolArguments = {} } = params;
    assertNonEmptyString(name, "tool name");

    if (!toolArguments || typeof toolArguments !== "object" || Array.isArray(toolArguments)) {
      throw createProtocolError(ErrorCode.InvalidParams, "tool arguments must be an object");
    }

    const tool = this.#tools.get(name);
    if (!tool) {
      throw createProtocolError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
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
    const entry = {
      method: message.method,
      params: cloneValue(message.params ?? {}),
      context,
      receivedAt: Date.now(),
    };

    this.#notificationLog.push(entry);
    const droppedEntries = Math.max(this.#notificationLog.length - this.#maxNotificationLogEntries, 0);
    if (droppedEntries > 0) {
      this.#notificationLog.splice(0, droppedEntries);
    }

    this.#emitNotificationEvent({
      eventType: "notification.recorded",
      receivedAt: entry.receivedAt,
      notification: entry,
      log: {
        size: this.#notificationLog.length,
        maxEntries: this.#maxNotificationLogEntries,
        droppedEntries,
      },
    });
  }

  #emitNotificationEvent(event) {
    const payload = cloneValue(event);

    if (this.#notificationEventHook) {
      this.#notificationEventHook(payload);
    }

    for (const listener of this.#notificationListeners) {
      listener(cloneValue(event));
    }
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

function validateSdkRequest(schema, message, label) {
  const result = schema.safeParse(toSdkEnvelope(message));
  if (!result.success) {
    throw createProtocolError(
      ErrorCode.InvalidParams,
      `${label} failed MCP SDK validation: ${result.error.issues[0]?.message ?? "invalid request"}`,
    );
  }

  return result.data;
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

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
}

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}
