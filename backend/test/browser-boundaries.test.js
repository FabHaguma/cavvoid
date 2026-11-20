import test from "node:test";
import assert from "node:assert/strict";
import { safeLink, textBytes, textParts } from "../../shared/text.js";
import { clipboardContent, copyText, readClipboard } from "../../frontend/assets/js/clipboard.js";
import { apiRequest } from "../../frontend/assets/js/api.js";
import { uploadFile } from "../../frontend/assets/js/upload.js";

test("file progress stays below completion until a successful server response", async () => {
  const xhr = {
    upload: {},
    headers: {},
    open() {},
    setRequestHeader(name, value) {
      this.headers[name] = value;
    },
    send(body) {
      this.body = body;
    },
  };
  const progress = [];
  const pending = uploadFile(new File(["data"], "demo.txt"), "upload-id", {
    xhrFactory: () => xhr,
    onProgress: (value) => progress.push(value),
    retention: "7d",
  });
  xhr.upload.onprogress({ lengthComputable: true, loaded: 100, total: 100 });
  assert.deepEqual(progress, [99]);
  assert.equal(xhr.headers["X-File-Size"], "4");
  assert.equal(xhr.headers["X-Upload-Id"], "upload-id");
  assert.equal(xhr.headers["X-Retention"], "7d");
  assert.equal(xhr.headers["X-CavVoid-Request"], "1");
  assert.equal(xhr.headers["Content-Type"], undefined);
  xhr.status = 201;
  xhr.responseText = JSON.stringify({
    item: { id: "saved", file: { name: "demo.txt" } },
  });
  xhr.onload();
  assert.equal((await pending).item.id, "saved");
  assert.deepEqual(progress, [99, 100]);
});

test("rejected and cancelled uploads cannot report successful completion", async () => {
  for (const status of [401, 413, 507]) {
    const xhr = { upload: {}, open() {}, setRequestHeader() {}, send() {} };
    const pending = uploadFile(new File(["data"], "demo.txt"), "upload-id", {
      xhrFactory: () => xhr,
    });
    xhr.status = status;
    xhr.responseText = JSON.stringify({ error: "Rejected by server" });
    xhr.onload();
    await assert.rejects(pending, (error) => error.status === status);
  }
  const controller = new AbortController();
  const xhr = {
    upload: {},
    open() {},
    setRequestHeader() {},
    send() {},
    abort() {
      this.onabort();
    },
  };
  const pending = uploadFile(new File(["data"], "demo.txt"), "upload-id", {
    xhrFactory: () => xhr,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, (error) => error.status === 0);
});

test("link rendering permits only explicit HTTP/S links and preserves the original text segments", () => {
  for (const text of [
    "javascript:alert(1)",
    "data:text/html,test",
    "//example.com",
    "https://owner:password@example.com",
    'https://example.com/" onclick="test',
    "java\nscript:alert(1)",
  ])
    assert.equal(safeLink(text), null);
  assert.equal(
    safeLink(" https://example.com/path?q=1 "),
    "https://example.com/path?q=1",
  );
  const text =
    "<script>test</script>\nVisit https://example.com, and javascript:alert(1).";
  const parts = textParts(text);
  assert.equal(parts.map((part) => part.text).join(""), text);
  assert.deepEqual(
    parts.filter((part) => part.href).map((part) => part.href),
    ["https://example.com/"],
  );
  assert.equal(textBytes("🕳"), 4);
  const longUrl = "https://example.com/" + "path".repeat(200);
  const preview = textParts(longUrl, 50);
  assert.equal(preview.find((part) => part.href).href, longUrl);
  assert.equal(preview.map((part) => part.text).join("").length, 51);
});

test("clipboard success preserves exact text; denial/absence require a manual fallback", async () => {
  let copied;
  const text = "A note\n  with spacing";
  await copyText(text, {
    writeText: async (value) => {
      copied = value;
    },
  });
  assert.equal(copied, text);
  assert.deepEqual(await readClipboard({ readText: async () => text }), {
    files: [],
    text,
  });
  await assert.rejects(copyText(text, {}), /manually/);
  await assert.rejects(
    copyText(text, {
      writeText: async () => {
        throw new Error("Permission denied");
      },
    }),
    /denied/,
  );
  await assert.rejects(readClipboard({}), /Paste/);
  await assert.rejects(
    readClipboard({
      readText: async () => {
        throw new Error("Permission denied");
      },
    }),
    /denied/,
  );
});

test("native paste uses the copied file before accompanying text and accepts link-only data", () => {
  const image = new File(["pixels"], "copied.png", { type: "image/png" });
  const url = "https://example.com/photo";
  const getData = (type) => type === "text/plain" ? url : "";
  assert.deepEqual(clipboardContent({ files: [image], getData }), {
    files: [image],
    text: "",
  });
  assert.deepEqual(clipboardContent({
    files: [],
    items: [{ kind: "file", getAsFile: () => image }],
    getData,
  }), { files: [image], text: "" });
  assert.deepEqual(clipboardContent({
    getData: (type) => type === "text/uri-list" ? `# Copied link\r\n${url}\r\n` : "",
  }), { files: [], text: url });
});

test("the Paste button reads image bytes or exact plain text and supports a text-only fallback", async () => {
  const image = new Blob(["pixels"], { type: "image/png" });
  const text = "  https://example.com/photo\n";
  const item = {
    types: ["text/plain", "image/png"],
    async getType(type) {
      return type === "image/png" ? image : new Blob([text]);
    },
  };
  const result = await readClipboard({ read: async () => [item] });
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].name, "clipboard-image.png");
  assert.equal(result.files[0].type, image.type);
  assert.deepEqual(await result.files[0].bytes(), await image.bytes());
  assert.equal(result.text, "");
  assert.deepEqual(await readClipboard({
    read: async () => [{ ...item, types: ["text/plain"] }],
  }), { files: [], text });
  assert.deepEqual(await readClipboard({
    read: async () => { throw new Error("Rich clipboard unavailable"); },
    readText: async () => text,
  }), { files: [], text });
});

test("browser requests keep CSRF headers, private cache policy, and one immutable submission ID", async () => {
  const payload = { text: "Unsent draft", submissionId: "same-on-retry" };
  const calls = [];
  const fake = async (url, options) => {
    calls.push(options);
    return new Response('{"item":{"id":"saved"}}', { status: 201 });
  };
  await apiRequest("/api/items/text", { method: "POST", body: payload }, fake);
  await apiRequest("/api/items/text", { method: "POST", body: payload }, fake);
  assert.equal(calls[0].headers["X-CavVoid-Request"], "1");
  assert.equal(calls[0].cache, "no-store");
  assert.equal(calls[0].credentials, "same-origin");
  assert.equal(calls[0].body, calls[1].body);
  await assert.rejects(
    apiRequest(
      "/api/items/text",
      { method: "POST", body: payload },
      async () => {
        throw new TypeError("offline");
      },
    ),
    /unsent text/,
  );
  await assert.rejects(
    apiRequest(
      "/api/items",
      {},
      async () => new Response('{"error":"Session ended"}', { status: 401 }),
    ),
    (error) => error.status === 401 && error.message === "Session ended",
  );
  assert.equal(
    await apiRequest(
      "/api/items/id",
      { method: "DELETE" },
      async () => new Response(null, { status: 204 }),
    ),
    null,
  );
});
