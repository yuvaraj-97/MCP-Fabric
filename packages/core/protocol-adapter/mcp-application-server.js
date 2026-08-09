import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server as SdkServer } from "@modelcontextprotocol/sdk/server/index.js";
import { z } from "zod";
import { createSessionContext } from "../session/session-context.js";
import {
  ErrorCode,
  createErrorResponse,
  createSuccessResponse,
  isNotification,
  validateIncomingMessage,
} from "./jsonrpc-envelope.js";
import {
  ListToolsRequestSchema,
  PingRequestSchema,
  CallToolRequestSchema,
  RequestSchema,
  isJSONRPCErrorResponse,
  isJSONRPCResultResponse,
} from "@modelcontextprotocol/sdk/types.js";

export class McpApplicationServer {
  #serverInfo;
  #protocolVersion;
  #instructions;
  #tools = new Map();
  #sdkMethods = new Set(["initialize", "ping", "tools/list", "tools/call", "server/discover"]);
  #notificationLog = [];
  #maxNotificationLogEntries;
  #notificationListeners = new Set();
  #notificationEventHook;
  #sdkServer;
  #sdkClientTransport;
  #sdkReady;
  #pendingSdkResponses = new Map();
  #requestContexts = new Map();

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
    this.#initializeSdkServer();
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

    this.#sdkServer.setRequestHandler(createCustomRequestSchema(method), (request, extra) => {
      const context = this.#requestContexts.get(extra.requestId);
      return handler({
        params: cloneValue(request.params ?? {}),
        context,
        message: cloneValue(request),
      });
    });
    this.#sdkMethods.add(method);
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
    if (!this.#sdkMethods.has(message.method)) {
      throw createProtocolError(
        ErrorCode.MethodNotFound,
        `Unsupported MCP method: ${message.method}`,
      );
    }

    return this.#dispatchSdkRequest(message, context);
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

  #initializeSdkServer() {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    this.#sdkClientTransport = clientTransport;
    this.#sdkServer = new SdkServer(this.#serverInfo, {
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      instructions: this.#instructions,
    });

    this.#sdkServer.setRequestHandler(PingRequestSchema, (_request, extra) => {
      const context = this.#requestContexts.get(extra.requestId);
      return {
        ok: true,
        session: {
          sessionId: context?.sessionId,
          clientId: context?.clientId,
          transport: context?.transport,
        },
      };
    });

    this.#sdkServer.setRequestHandler(createCustomRequestSchema("server/discover"), () => {
      return {
        resultType: "complete",
        supportedVersions: ["2026-07-28", "2025-11-25"],
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        _meta: {
          "io.modelcontextprotocol/serverInfo": {
            name: this.#serverInfo.name,
            version: this.#serverInfo.version,
          },
        },
        instructions: this.#instructions,
        ttlMs: 3600000,
        cacheScope: "public",
      };
    });

    this.#sdkServer.setRequestHandler(ListToolsRequestSchema, () => {
      return {
        tools: this.listTools(),
      };
    });

    this.#sdkServer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const context = this.#requestContexts.get(extra.requestId);
      return this.#callTool(request.params, context);
    });

    this.#sdkClientTransport.onmessage = (message) => {
      if (!isJSONRPCResultResponse(message) && !isJSONRPCErrorResponse(message)) {
        return;
      }

      const pending = this.#pendingSdkResponses.get(message.id);
      if (!pending) {
        return;
      }

      this.#pendingSdkResponses.delete(message.id);
      this.#requestContexts.delete(message.id);
      pending.resolve(message);
    };

    this.#sdkReady = Promise.all([
      this.#sdkServer.connect(serverTransport),
      this.#sdkClientTransport.start(),
    ]);
  }

  async #dispatchSdkRequest(message, context) {
    await this.#sdkReady;

    const sdkMessage = normalizeSdkRequestMessage(message, {
      protocolVersion: this.#protocolVersion,
      serverInfo: this.#serverInfo,
    });

    return new Promise((resolve, reject) => {
      this.#pendingSdkResponses.set(sdkMessage.id, { resolve, reject });
      this.#requestContexts.set(sdkMessage.id, context);

      this.#sdkClientTransport
        .send(sdkMessage)
        .catch((error) => {
          this.#pendingSdkResponses.delete(sdkMessage.id);
          this.#requestContexts.delete(sdkMessage.id);
          reject(error);
        });
    }).then((response) => {
      if (response.error) {
        throw createProtocolError(
          response.error.code ?? ErrorCode.InternalError,
          response.error.message ?? "Internal error",
        );
      }

      return response.result;
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

function createProtocolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createCustomRequestSchema(method) {
  return RequestSchema.extend({
    method: z.literal(method),
    params: z.looseObject({}).optional(),
  });
}

function normalizeSdkRequestMessage(message, { protocolVersion, serverInfo }) {
  if (message.method !== "initialize") {
    return {
      jsonrpc: message.jsonrpc,
      id: message.id,
      method: message.method,
      params: cloneValue(message.params),
    };
  }

  const params =
    message.params && typeof message.params === "object" && !Array.isArray(message.params)
      ? { ...message.params }
      : {};

  return {
    jsonrpc: message.jsonrpc,
    id: message.id,
    method: message.method,
    params: {
      protocolVersion: params.protocolVersion ?? protocolVersion,
      capabilities: params.capabilities ?? {},
      clientInfo: params.clientInfo ?? {
        name: `${serverInfo.name}-client`,
        version: serverInfo.version,
      },
    },
  };
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
