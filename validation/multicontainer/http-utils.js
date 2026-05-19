export async function fetchJson(url, { method = "GET", headers = {}, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} from ${url}`);
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
