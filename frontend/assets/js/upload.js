import { AccessError } from "./api.js";

export function uploadFile(
  file,
  id,
  {
    onProgress,
    signal,
    retention = "24h",
    xhrFactory = () => new XMLHttpRequest(),
    isOnline = () => globalThis.navigator?.onLine !== false,
  } = {},
) {
  return new Promise((resolve, reject) => {
    if (!isOnline())
      return reject(
        new AccessError(
          0,
          "You’re offline. Reconnect and choose Upload files when ready. Nothing was queued.",
          undefined,
          "offline",
        ),
      );
    const xhr = xhrFactory();
    const abort = () => xhr.abort();
    const finish = (callback) => (value) => {
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const succeed = finish(resolve),
      fail = finish(reject);
    xhr.open("POST", "/api/items/file");
    xhr.timeout = 20 * 60 * 1000;
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("X-CavVoid-Request", "1");
    xhr.setRequestHeader("X-File-Size", String(file.size));
    xhr.setRequestHeader("X-Upload-Id", id);
    xhr.setRequestHeader("X-Retention", retention);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress?.(
          Math.min(99, Math.round((event.loaded / event.total) * 100)),
        );
    };
    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = {};
      }
      if (![200, 201].includes(xhr.status) || !data.item?.file)
        return fail(
          new AccessError(
            xhr.status || 503,
            data.error ||
              "The upload could not be confirmed. Refresh or retry the same file.",
            data.signInUrl,
          ),
        );
      onProgress?.(100);
      succeed(data);
    };
    xhr.onerror = xhr.ontimeout = () =>
      fail(
        new AccessError(
          503,
          "Connection lost. Retry checks this same upload without creating another copy.",
        ),
      );
    xhr.onabort = () =>
      fail(
        new AccessError(
          0,
          "Cancelled. Refresh to check whether this upload completed.",
        ),
      );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return fail(new AccessError(0, "Upload cancelled."));
    const body = new FormData();
    body.append("file", file, file.name);
    xhr.send(body);
  });
}
