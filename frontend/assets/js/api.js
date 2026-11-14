export class AccessError extends Error {
  constructor(status, message, signInUrl, code) {
    super(message);
    this.status = status;
    this.signInUrl = signInUrl;
    this.code = code;
  }
}

export async function apiRequest(
  pathname,
  { method = "GET", body, signal } = {},
  fetchImpl = fetch,
) {
  if (method !== "GET" && globalThis.navigator?.onLine === false)
    throw new AccessError(
      0,
      "You’re offline. Reconnect before sending. Nothing was queued.",
      undefined,
      "offline",
    );
  let response;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  try {
    response = await fetchImpl(pathname, {
      method,
      headers: {
        Accept: "application/json",
        ...(method !== "GET" ? { "X-CavVoid-Request": "1" } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AccessError(
      503,
      "We couldn’t connect. Any unsent text or files have not been saved.",
      undefined,
      "network_unavailable",
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
  if (response.status === 204) return null;
  const json = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new AccessError(
      response.status,
      json.error || "This action couldn’t be completed. Please try again.",
      json.signInUrl,
      json.code,
    );
  return json;
}

export async function getAccess(signal) {
  const json = await apiRequest("/api/auth/me", { signal });
  if (!json.owner?.id || json.authentication?.provider !== "Gatekeeper")
    throw new AccessError(
      503,
      "We couldn’t verify your access. Please try again.",
    );
  return json;
}

export const getItems = (section, page, signal, filters = {}) =>
  apiRequest(
    `/api/items?${new URLSearchParams({ section, page, ...filters })}`,
    {
      signal,
    },
  );
export const getItem = (id, signal) =>
  apiRequest(`/api/items/${encodeURIComponent(id)}`, { signal });
export const saveText = (text, submissionId, retention = "24h") =>
  apiRequest("/api/items/text", {
    method: "POST",
    body: { text, submissionId, retention },
  });
export const deleteItem = (id) =>
  apiRequest(`/api/items/${encodeURIComponent(id)}`, { method: "DELETE" });
export const updateRetention = (id, retention) =>
  apiRequest(`/api/items/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { retention },
  });
export const getStorage = (signal) => apiRequest("/api/storage", { signal });
export const getPreferences = (signal) =>
  apiRequest("/api/preferences", { signal });
export const updatePreferences = (defaultExpiration) =>
  apiRequest("/api/preferences", {
    method: "PATCH",
    body: { defaultExpiration },
  });

// Future mutating APIs must keep these guards for JSON and multipart bodies alike.
export const mutationHeaders = {
  Accept: "application/json",
  "X-CavVoid-Request": "1",
};
