import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import {
  sharePayload,
  stageShare,
  takeShare,
  expireShares,
  receiveShare,
  SHARE_TTL_MS,
  SHARE_FILE_BYTES,
  SHARE_TEXT_BYTES,
  shareMessages,
} from "../../frontend/assets/js/share-target.js";

function form(fields = {}, files = []) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  for (const file of files) data.append("files", file);
  return data;
}

test("incoming text handles Android URL-in-text, title fallback and mixed Unicode without duplicating links", () => {
  assert.equal(
    sharePayload(
      form({ text: "https://example.com/page", title: "Page title" }),
    ).text,
    "https://example.com/page",
  );
  assert.equal(
    sharePayload(form({ text: "A note 🔐", url: "https://example.com" })).text,
    "A note 🔐\nhttps://example.com",
  );
  assert.equal(
    sharePayload(
      form({ text: "See https://example.com", url: "https://example.com" }),
    ).text,
    "See https://example.com",
  );
  assert.equal(
    sharePayload(form({ title: "Shared title" })).text,
    "Shared title",
  );
  assert.throws(() => sharePayload(form({ text: " \n" })), { code: "empty" });
  assert.throws(
    () =>
      sharePayload(form({ text: new File(["not a text field"], "text.txt") })),
    { code: "empty" },
  );
});

test("device-local handoff survives a new reader, restores file metadata/bytes and is consumed once", async () => {
  const factory = new IDBFactory(),
    id = randomUUID(),
    now = 100;
  const source = new File(["Private bytes 🔐"], "Private picture.png", {
    type: "image/png",
    lastModified: 1234,
  });
  await stageShare(form({ text: "Private text" }, [source]), {
    factory,
    id,
    now,
  });
  const received = await receiveShare(
    "https://cavvoid.haguma.com/?share=" + id,
    { factory, now: now + 1 },
  );
  assert.equal(received.text, "Private text");
  assert.equal(received.files[0].name, source.name);
  assert.equal(received.files[0].type, source.type);
  assert.equal(received.files[0].lastModified, source.lastModified);
  assert.equal(await received.files[0].text(), await source.text());
  assert.equal(await takeShare(id, { factory, now }), null);
  assert.deepEqual(
    await receiveShare("https://cavvoid.haguma.com/?share=" + id, {
      factory,
      now,
    }),
    { message: shareMessages.expired },
  );
});

test("concurrent windows cannot claim the same incoming share twice", async () => {
  const factory = new IDBFactory();
  const id = await stageShare(form({ text: "one handoff" }), { factory });
  const claims = await Promise.all([
    takeShare(id, { factory }),
    takeShare(id, { factory }),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
});

test("shares expire at ten minutes and old records are removed on the next cleanup or capture", async () => {
  const factory = new IDBFactory(),
    now = 100;
  const expired = await stageShare(form({ text: "old input" }), {
    factory,
    now,
  });
  assert.equal(
    await takeShare(expired, { factory, now: now + SHARE_TTL_MS }),
    null,
  );
  const old = await stageShare(form({ text: "another old input" }), {
    factory,
    now,
  });
  const fresh = await stageShare(form({ text: "fresh input" }), {
    factory,
    now: now + SHARE_TTL_MS,
  });
  await expireShares({ factory, now: now + SHARE_TTL_MS });
  assert.equal(
    await takeShare(old, { factory, now: now + SHARE_TTL_MS }),
    null,
  );
  assert.equal(
    (await takeShare(fresh, { factory, now: now + SHARE_TTL_MS })).text,
    "fresh input",
  );
});

test("pending input count is bounded and the oldest share is discarded first", async () => {
  const factory = new IDBFactory(),
    ids = [];
  for (let index = 0; index < 6; index++)
    ids.push(
      await stageShare(form({ text: String(index) }), {
        factory,
        now: index + 1,
      }),
    );
  assert.equal(await takeShare(ids[0], { factory, now: 10 }), null);
  for (let index = 1; index < 6; index++)
    assert.equal(
      (await takeShare(ids[index], { factory, now: 10 })).text,
      String(index),
    );
});

test("incoming payload limits count UTF-8 bytes, file count and total file size before storing", async () => {
  const factory = new IDBFactory();
  await assert.rejects(
    stageShare(form({ text: "🔐".repeat(SHARE_TEXT_BYTES / 4 + 1) }), {
      factory,
    }),
    { code: "too-large" },
  );
  await assert.rejects(
    stageShare(
      form(
        {},
        Array.from({ length: 11 }, () => new File(["x"], "x.txt")),
      ),
      { factory },
    ),
    { code: "too-large" },
  );
  const large = new Blob(["Virtual fixture: no 100MB allocation required"]);
  Object.defineProperty(large, "size", {
    value: SHARE_FILE_BYTES + 1,
    configurable: true,
  });
  assert.throws(() => sharePayload({ get: () => "", getAll: () => [large] }), {
    code: "too-large",
  });
  const ids = [];
  Object.defineProperty(large, "size", { value: SHARE_FILE_BYTES });
  for (let index = 0; index < 3; index++)
    ids.push(
      await stageShare(
        { get: () => "", getAll: () => [large] },
        { factory, now: index + 1 },
      ),
    );
  assert.equal(await takeShare(ids[0], { factory, now: 5 }), null);
  assert.ok(await takeShare(ids[2], { factory, now: 5 }));
});

test("unavailable storage, invalid IDs and error URLs reveal no shared content", async () => {
  await assert.rejects(
    stageShare(form({ text: "Private input" }), { factory: null }),
    { code: "storage" },
  );
  assert.equal(await takeShare("not-an-id", { factory: null }), null);
  assert.equal(
    await receiveShare("https://cavvoid.haguma.com/", { factory: null }),
    null,
  );
  assert.deepEqual(
    await receiveShare(
      "https://cavvoid.haguma.com/?share-error=Private%20input",
      { factory: null },
    ),
    { message: shareMessages.empty },
  );
});
