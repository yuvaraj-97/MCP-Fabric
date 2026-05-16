export async function invokeHttpHandler(handler, { method, url, headers = {}, body, onClose } = {}) {
  const listeners = new Map();
  const request = {
    method,
    url,
    headers,
    on(event, callback) {
      listeners.set(event, callback);
    },
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) {
        const raw = typeof body === "string" ? body : JSON.stringify(body);
        yield Buffer.from(raw);
      }
    },
  };

  let statusCode = 200;
  const responseHeaders = {};
  const chunks = [];
  let ended = false;
  const response = {
    writeHead(nextStatusCode, nextHeaders = {}) {
      statusCode = nextStatusCode;
      Object.assign(responseHeaders, nextHeaders);
    },
    write(chunk = "") {
      chunks.push(String(chunk));
    },
    end(chunk = "") {
      if (chunk) {
        chunks.push(String(chunk));
      }
      ended = true;
    },
  };

  await handler(request, response);

  if (onClose && listeners.has("close")) {
    listeners.get("close")();
  }

  return {
    statusCode,
    headers: responseHeaders,
    chunks,
    get body() {
      return chunks.join("");
    },
    ended,
    close() {
      const closeListener = listeners.get("close");
      if (closeListener) {
        closeListener();
      }
    },
  };
}

export function parseJsonBody(response) {
  return JSON.parse(response.body || "{}");
}

export function parseSseEvents(rawBody) {
  return rawBody
    .split("\n\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const lines = entry.split("\n");
      const event = lines.find((line) => line.startsWith("event:"))?.slice("event:".length).trim();
      const data = lines.find((line) => line.startsWith("data:"))?.slice("data:".length).trim();
      return {
        event,
        data: data ? JSON.parse(data) : null,
      };
    });
}
