// Only incoming, unsent Android shares use this temporary store. Server drops,
// credentials and API responses never enter it. The worker build inlines this
// dependency-free module so receipt also works when the app is not running.
export const SHARE_TTL_MS = 10 * 60 * 1000;
export const SHARE_FILE_BYTES = 100 * 1024 * 1024;
export const SHARE_TEXT_BYTES = 102400;
export const SHARE_MAX_FILES = 10;
const SHARE_DATABASE = "cavvoid-incoming-shares";
const SHARE_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function shareFailure(code) {
  const error = new Error("Incoming share could not be received.");
  error.code = code;
  return error;
}

export function sharePayload(form) {
  const field = (name) =>
    typeof form.get(name) === "string" ? form.get(name) : "";
  const text = field("text"),
    url = field("url"),
    title = field("title");
  const combined =
    [text, url && !text.includes(url) ? url : ""]
      .filter((part) => part.trim())
      .join("\n") || title;
  const files = form.getAll("files").filter((file) => file instanceof Blob);
  if (
    files.length > SHARE_MAX_FILES ||
    files.reduce((total, file) => total + file.size, 0) > SHARE_FILE_BYTES ||
    new TextEncoder().encode(combined).length > SHARE_TEXT_BYTES
  )
    throw shareFailure("too-large");
  if (!combined.trim() && !files.length) throw shareFailure("empty");
  return {
    text: combined,
    files: files.map((file) => ({
      name: file.name || "Shared file",
      type: file.type,
      lastModified: file.lastModified || Date.now(),
      blob: file,
    })),
    bytes:
      files.reduce((total, file) => total + file.size, 0) +
      new TextEncoder().encode(combined).length,
  };
}

function shareTransaction(factory, action) {
  return new Promise((resolve, reject) => {
    if (!factory) return reject(shareFailure("storage"));
    const opening = factory.open(SHARE_DATABASE, 1);
    opening.onupgradeneeded = () =>
      opening.result.createObjectStore("drafts", { keyPath: "id" });
    opening.onerror = () => reject(shareFailure("storage"));
    opening.onblocked = () => reject(shareFailure("storage"));
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction("drafts", "readwrite");
      let result;
      transaction.oncomplete = () => {
        database.close();
        resolve(result);
      };
      transaction.onabort = () => {
        database.close();
        reject(shareFailure("storage"));
      };
      transaction.onerror = () => {};
      try {
        action(transaction.objectStore("drafts"), (value) => {
          result = value;
        });
      } catch {
        transaction.abort();
      }
    };
  });
}

export async function stageShare(
  form,
  {
    factory = globalThis.indexedDB,
    now = Date.now(),
    id = globalThis.crypto.randomUUID(),
  } = {},
) {
  if (!SHARE_ID.test(id)) throw shareFailure("invalid");
  const payload = sharePayload(form);
  return shareTransaction(factory, (store, done) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const existing = request.result.sort((a, b) => a.expiresAt - b.expiresAt);
      const active = [];
      for (const draft of existing) {
        if (draft.expiresAt <= now) store.delete(draft.id);
        else active.push(draft);
      }
      let bytes = active.reduce((sum, draft) => sum + draft.bytes, 0);
      while (
        active.length >= 5 ||
        bytes + payload.bytes > 2 * (SHARE_FILE_BYTES + SHARE_TEXT_BYTES)
      ) {
        const oldest = active.shift();
        if (!oldest) break;
        bytes -= oldest.bytes;
        store.delete(oldest.id);
      }
      store.put({ ...payload, id, expiresAt: now + SHARE_TTL_MS });
      done(id);
    };
  });
}

export function takeShare(
  id,
  { factory = globalThis.indexedDB, now = Date.now() } = {},
) {
  if (!SHARE_ID.test(id || "")) return Promise.resolve(null);
  return shareTransaction(factory, (store, done) => {
    const request = store.get(id);
    request.onsuccess = () => {
      const draft = request.result;
      store.delete(id);
      done(draft?.expiresAt > now ? draft : null);
    };
  });
}

export function expireShares({
  factory = globalThis.indexedDB,
  now = Date.now(),
} = {}) {
  return shareTransaction(factory, (store) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (cursor.value.expiresAt <= now) cursor.delete();
      cursor.continue();
    };
  });
}

export const shareMessages = {
  "too-large":
    "That share is too large. Share up to 10 files (100 MB total) or 100 KB of text at a time.",
  empty: "No text or files arrived. Try sharing the item to CavVoid again.",
  storage:
    "Your phone could not hold that share. Free some space, reopen CavVoid and share it again.",
  expired:
    "That incoming share is no longer available. Share it to CavVoid again.",
};

export async function receiveShare(location, options) {
  const url = new URL(location);
  if (url.searchParams.has("share-error"))
    return {
      message:
        shareMessages[url.searchParams.get("share-error")] ||
        shareMessages.empty,
    };
  const id = url.searchParams.get("share");
  if (!id) return null;
  try {
    const draft = await takeShare(id, options);
    if (!draft) return { message: shareMessages.expired };
    return {
      text: draft.text,
      files: draft.files.map(
        (file) =>
          new File([file.blob], file.name, {
            type: file.type,
            lastModified: file.lastModified,
          }),
      ),
    };
  } catch {
    return { message: shareMessages.storage };
  }
}
