import { createSessionContext } from "../../core/session/session-context.js";

export class StdioTransportAdapter {
  #server;
  #input;
  #output;
  #error;
  #contextFactory;
  #buffer = "";
  #started = false;

  constructor({
    server,
    input = process.stdin,
    output = process.stdout,
    error = process.stderr,
    contextFactory = defaultContextFactory,
  } = {}) {
    if (!server || typeof server.handleMessage !== "function") {
      throw new TypeError("server with handleMessage(message, context) is required");
    }
    if (typeof contextFactory !== "function") {
      throw new TypeError("contextFactory must be a function");
    }

    this.#server = server;
    this.#input = input;
    this.#output = output;
    this.#error = error;
    this.#contextFactory = contextFactory;
  }

  start() {
    if (this.#started) {
      return this;
    }

    this.#started = true;
    this.#input.setEncoding?.("utf8");
    this.#input.on("data", async (chunk) => {
      this.#buffer += chunk.toString();
      await this.#drainBuffer();
    });

    return this;
  }

  stop() {
    this.#started = false;
    this.#input.removeAllListeners?.("data");
  }

  async handleFrame(frame, contextInput) {
    let message;
    try {
      message = JSON.parse(frame);
    } catch (error) {
      this.#error.write(`Invalid JSON input: ${error.message}\n`);
      return {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: "Parse error",
        },
      };
    }

    return this.handleMessage(message, contextInput);
  }

  async handleMessage(message, contextInput) {
    const context = this.#contextFactory(message, contextInput);
    return this.#server.handleMessage(message, context);
  }

  async sendNotification(method, params, contextInput) {
    const response = await this.handleMessage(
      {
        jsonrpc: "2.0",
        method,
        params,
      },
      contextInput,
    );

    if (response) {
      this.#writeFrame(response);
    }
  }

  async #drainBuffer() {
    while (true) {
      const parsed = readFrameFromBuffer(this.#buffer);
      if (!parsed) {
        return;
      }

      this.#buffer = parsed.remaining;
      const response = await this.handleFrame(parsed.body);
      if (response) {
        this.#writeFrame(response);
      }
    }
  }

  #writeFrame(message) {
    const payload = JSON.stringify(message);
    this.#output.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
  }
}

function defaultContextFactory(message, contextInput = {}) {
  if (contextInput) {
    return createSessionContext({
      clientId: contextInput.clientId ?? "stdio-client",
      sessionId: contextInput.sessionId ?? sessionIdFromMessage(message),
      transport: "stdio",
      metadata: contextInput.metadata ?? {},
    });
  }

  return createSessionContext({
    clientId: "stdio-client",
    sessionId: sessionIdFromMessage(message),
    transport: "stdio",
  });
}

function readFrameFromBuffer(buffer) {
  const separatorIndex = buffer.indexOf("\r\n\r\n");
  if (separatorIndex === -1) {
    return null;
  }

  const headerBlock = buffer.slice(0, separatorIndex);
  const contentLengthMatch = headerBlock.match(/Content-Length:\s*(\d+)/i);
  if (!contentLengthMatch) {
    throw new Error("Missing Content-Length header");
  }

  const contentLength = Number(contentLengthMatch[1]);
  const bodyStart = separatorIndex + 4;
  const bodyEnd = bodyStart + contentLength;
  if (buffer.length < bodyEnd) {
    return null;
  }

  return {
    body: buffer.slice(bodyStart, bodyEnd),
    remaining: buffer.slice(bodyEnd),
  };
}

function sessionIdFromMessage(message) {
  const incomingSessionId = message?.params?.sessionId;
  if (typeof incomingSessionId === "string" && incomingSessionId.trim().length > 0) {
    return incomingSessionId.trim();
  }

  const incomingId = message?.id;
  if (typeof incomingId === "string" && incomingId.trim().length > 0) {
    return `stdio-${incomingId.trim()}`;
  }
  if (typeof incomingId === "number") {
    return `stdio-${incomingId}`;
  }

  return "stdio-session";
}
