import Busboy from "busboy";
import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { ItemError, requireAvailableItem } from "./items.js";
import { OWNER_ID } from "./db/database.js";
import { projectRoot } from "./config.js";
import { retentionPolicy } from "../shared/retention.js";
import { readPreferences } from "./preferences.js";
export { previewKind } from "../shared/file-types.js";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const LEASE_MS = 180000;

export function safeFilename(filename) {
  let name = path.posix
    .basename(path.win32.basename(filename || "file"))
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .trim()
    .replace(/[. ]+$/, "");
  name = Array.from(name).slice(0, 180).join("");
  if (!name || name === "." || name === "..") name = "file";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    name = "_" + name;
  return name;
}

export function detectedMime(prefix) {
  if (
    prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255)
    return "image/jpeg";
  if (/^GIF8[79]a/.test(prefix.subarray(0, 6).toString("ascii")))
    return "image/gif";
  if (
    prefix.subarray(0, 4).toString() === "RIFF" &&
    prefix.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  if (
    prefix.subarray(0, 4).toString() === "RIFF" &&
    prefix.subarray(8, 12).toString() === "WAVE"
  )
    return "audio/wav";
  if (
    prefix.subarray(0, 3).toString() === "ID3" ||
    (prefix[0] === 255 && (prefix[1] & 0xe0) === 0xe0 && (prefix[1] & 6) !== 0)
  )
    return "audio/mpeg";
  if (prefix.subarray(0, 4).toString() === "OggS") return "audio/ogg";
  if (prefix.subarray(4, 8).toString() === "ftyp") return "audio/mp4";
  if (prefix.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  return "application/octet-stream";
}

export class FileStore {
  constructor(
    database,
    config,
    { clock = Date.now, fsOps = {}, notify = () => {} } = {},
  ) {
    this.db = database.connection;
    this.config = config;
    this.clock = clock;
    this.notify = notify;
    this.ops = {
      unlinkSync,
      renameSync,
      statSync,
      createWriteStream,
      ...fsOps,
    };
    this.ephemeral = !config.filesDirectory;
    const directory =
      config.filesDirectory ||
      mkdtempSync(path.join(os.tmpdir(), "cavvoid-storage-"));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.directory = realpathSync(directory);
    const publicRoot = realpathSync(path.join(projectRoot, "frontend"));
    if (!path.relative(publicRoot, this.directory).startsWith(".."))
      throw new Error("File storage cannot be inside the frontend.");
    this.temporary = path.join(this.directory, "tmp");
    this.objects = path.join(this.directory, "objects");
    for (const dir of [this.temporary, this.objects]) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (realpathSync(dir) !== dir)
        throw new Error(
          "File storage subdirectories must not be symbolic links.",
        );
    }
    this.active = new Set();
    this.reconcileOrphans();
    this.repair();
    this.timer = setInterval(() => {
      try {
        this.repair();
      } catch (error) {
        console.error("File cleanup failed:", error.code || error.name);
      }
    }, 30000);
    this.timer.unref();
  }
  paths(id) {
    if (!uuid.test(id)) throw new ItemError(404, "This file is not available.");
    return {
      temporary: path.join(this.temporary, id + ".part"),
      final: path.join(this.objects, id + ".blob"),
    };
  }
  usage(ownerId) {
    return this.db
      .prepare(
        `SELECT coalesce(sum(charged_bytes),0) AS usedBytes,
      coalesce(sum(CASE WHEN state='uploading' THEN charged_bytes ELSE 0 END),0) AS reservedBytes,
      coalesce(sum(CASE WHEN state='deleting' THEN charged_bytes ELSE 0 END),0) AS pendingDeletionBytes FROM file_objects ${ownerId === undefined ? "" : "WHERE user_id=?"}`,
      )
      .get(...(ownerId === undefined ? [] : [ownerId]));
  }
  reconcileOrphans() {
    const orphans = new Map();
    for (const [directory, extension] of [
      [this.temporary, ".part"],
      [this.objects, ".blob"],
    ]) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const id = entry.name.slice(0, -extension.length);
        if (
          !entry.isFile() ||
          !entry.name.endsWith(extension) ||
          !uuid.test(id) ||
          this.db.prepare("SELECT id FROM file_objects WHERE id = ?").get(id)
        )
          continue;
        orphans.set(
          id,
          (orphans.get(id) || 0) +
            this.ops.statSync(path.join(directory, entry.name)).size,
        );
      }
    }
    for (const [id, bytes] of orphans)
      this.db
        .prepare(
          `INSERT OR IGNORE INTO file_objects
      (id,user_id,storage_name,charged_bytes,state,created_at) VALUES (?,?,?,?,'deleting',?)`,
        )
        .run(
          id,
          OWNER_ID,
          id + ".blob",
          bytes,
          new Date(this.clock()).toISOString(),
        );
  }
  cleanupObject(id) {
    const row = this.db
      .prepare("SELECT * FROM file_objects WHERE id = ? AND state = ?")
      .get(id, "deleting");
    if (!row) return;
    try {
      for (const filename of Object.values(this.paths(id))) {
        try {
          this.ops.unlinkSync(filename);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      this.db
        .prepare("DELETE FROM file_objects WHERE id = ? AND state = ?")
        .run(id, "deleting");
      this.notify(row.user_id, "storage.updated");
    } catch (error) {
      const attempts = row.delete_attempts + 1;
      this.db
        .prepare(
          "UPDATE file_objects SET delete_attempts = ?, next_retry_at = ?, last_error = ? WHERE id = ?",
        )
        .run(
          attempts,
          this.clock() +
            Math.min(1800000, 30000 * 2 ** Math.min(attempts - 1, 6)),
          error.code || "IO_ERROR",
          id,
        );
    }
  }
  repair() {
    this.expire();
    for (const row of this.db
      .prepare(
        `SELECT id,user_id FROM file_objects WHERE state='uploading' AND lease_until <= ?`,
      )
      .all(this.clock())) {
      if (!this.active.has(row.id)) {
        this.db
          .prepare(
            `UPDATE file_objects SET state='deleting',next_retry_at=0 WHERE id=?`,
          )
          .run(row.id);
        this.notify(row.user_id, "storage.updated");
      }
    }
    for (const row of this.db
      .prepare(
        `SELECT id FROM file_objects WHERE state='deleting' AND next_retry_at <= ?`,
      )
      .all(this.clock()))
      this.cleanupObject(row.id);
  }
  expire() {
    // Retention changes and expiry selection share a write transaction. A Keep
    // committed first is preserved; once expired, an item cannot be resurrected.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const now = new Date(this.clock()).toISOString();
      const expired = "is_kept=0 AND (expires_at IS NULL OR expires_at<=?)";
      const removed = this.db
        .prepare(`SELECT id,user_id FROM items WHERE ${expired}`)
        .all(now);
      this.db
        .prepare(
          `UPDATE file_objects SET state='deleting',lease_until=NULL,next_retry_at=0
        WHERE state='ready' AND EXISTS (SELECT 1 FROM items
          WHERE items.id=file_objects.id AND items.user_id=file_objects.user_id AND ${expired})`,
        )
        .run(now);
      this.db.prepare(`DELETE FROM items WHERE ${expired}`).run(now);
      this.db.exec("COMMIT");
      for (const row of removed) {
        this.notify(row.user_id, "item.deleted", row.id);
        this.notify(row.user_id, "storage.updated");
      }
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  remove(ownerId, id) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const item = requireAvailableItem(
        this.db,
        ownerId,
        id,
        new Date(this.clock()).toISOString(),
      );
      if (item.type !== "file")
        throw new ItemError(400, "This is not a file drop.");
      this.db
        .prepare("DELETE FROM items WHERE id=? AND user_id=?")
        .run(id, ownerId);
      this.db
        .prepare(
          `UPDATE file_objects SET state='deleting',lease_until=NULL,next_retry_at=0 WHERE id=? AND user_id=?`,
        )
        .run(id, ownerId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.notify(ownerId, "item.deleted", id);
    this.notify(ownerId, "storage.updated");
    this.cleanupObject(id);
  }
  content(ownerId, id) {
    const item = requireAvailableItem(
      this.db,
      ownerId,
      id,
      new Date(this.clock()).toISOString(),
    );
    if (item.type !== "file" || !item.file)
      throw new ItemError(404, "This file is not available.");
    const filename = this.paths(id).final;
    let stats;
    try {
      stats = this.ops.statSync(filename);
    } catch {
      throw new ItemError(
        503,
        "This file is temporarily unavailable. Try again.",
      );
    }
    if (!stats.isFile() || stats.size !== item.file.size)
      throw new ItemError(503, "This file could not be read safely.");
    return { item, filename };
  }
  reserve(ownerId, id, size) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db
        .prepare("SELECT * FROM file_objects WHERE id=?")
        .get(id);
      if (existing) {
        if (
          existing.user_id === ownerId &&
          existing.state === "ready" &&
          existing.charged_bytes === size
        ) {
          const item = requireAvailableItem(
            this.db,
            ownerId,
            id,
            new Date(this.clock()).toISOString(),
          );
          this.db.exec("COMMIT");
          return item;
        }
        throw new ItemError(
          409,
          "This upload is already in progress or no longer available. Refresh your drops before trying again.",
        );
      }
      const usage = this.usage();
      if (usage.usedBytes + size > this.config.storageQuotaBytes)
        throw new ItemError(
          507,
          usage.pendingDeletionBytes
            ? "Space is still being released from deleted files. Try again shortly."
            : usage.reservedBytes
              ? "Other uploads are using the remaining space. Let them finish or cancel an upload before trying again."
              : "Your storage quota is full. Delete a file and try again.",
        );
      this.db
        .prepare(
          `INSERT INTO file_objects (id,user_id,storage_name,charged_bytes,state,lease_until,created_at)
        VALUES (?,?,?,?,'uploading',?,?)`,
        )
        .run(
          id,
          ownerId,
          id + ".blob",
          size,
          this.clock() + LEASE_MS,
          new Date(this.clock()).toISOString(),
        );
      this.db.exec("COMMIT");
      this.notify(ownerId, "storage.updated");
      return null;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async upload(req, ownerId) {
    const retention =
      req.get("X-Retention") ??
      readPreferences(this.db, ownerId).defaultExpiration;
    if (!retentionPolicy(retention, this.clock()))
      throw new ItemError(
        400,
        "Choose 10m, 1h, 24h, 7d, or keep for retention.",
      );
    const id = req.get("X-Upload-Id") || "";
    const sizeHeader = req.get("X-File-Size");
    const expected = Number(sizeHeader);
    if (
      !uuid.test(id) ||
      !/^\d+$/.test(sizeHeader || "") ||
      !Number.isSafeInteger(expected)
    )
      throw new ItemError(
        400,
        "Choose a file with a valid size and upload ID.",
      );
    if (expected > this.config.maxFileBytes)
      throw new ItemError(
        413,
        `This file exceeds the ${Math.ceil(this.config.maxFileBytes / 1048576)} MB limit.`,
      );
    if (!req.is("multipart/form-data"))
      throw new ItemError(415, "Use the file picker to upload a file.");
    const maxTransport = expected + 16384;
    if (Number(req.get("Content-Length") || 0) > maxTransport)
      throw new ItemError(413, "The upload is larger than its declared size.");
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        preservePath: true,
        defParamCharset: "utf8",
        limits: {
          files: 1,
          fields: 0,
          parts: 2,
          fileSize: this.config.maxFileBytes + 1,
          headerPairs: 32,
        },
      });
    } catch {
      throw new ItemError(
        400,
        "The upload is malformed. Choose the file again.",
      );
    }
    const previous = this.reserve(ownerId, id, expected);
    if (previous) {
      let consumed = 0;
      req.on("data", (chunk) => {
        consumed += chunk.length;
        if (consumed > maxTransport) req.destroy();
      });
      req.resume();
      return { item: previous, duplicate: true };
    }
    this.active.add(id);
    const filenames = this.paths(id);
    let firstError,
      fileStream,
      writer,
      writing,
      bytes = 0,
      rawBytes = 0,
      prefix = Buffer.alloc(0),
      originalName,
      lastLease = this.clock();
    const hash = createHash("sha256");
    const fail = (error) => {
      firstError ||= error;
      req.unpipe(parser);
      req.resume();
      fileStream?.destroy(error);
      writer?.destroy(error);
      if (!parser.destroyed) parser.destroy(error);
    };
    const abort = () =>
      fail(
        new ItemError(
          400,
          "The upload was interrupted. Choose Retry to check or finish it.",
        ),
      );
    const rawData = (chunk) => {
      rawBytes += chunk.length;
      if (rawBytes > maxTransport)
        fail(
          new ItemError(413, "The upload is larger than its declared size."),
        );
    };
    try {
      await new Promise((resolve) => {
        parser.on("error", (error) => {
          firstError ||= error;
          resolve();
        });
        parser.on("close", resolve);
        parser.on("filesLimit", () =>
          fail(new ItemError(400, "Upload one file per request.")),
        );
        parser.on("fieldsLimit", () =>
          fail(new ItemError(400, "Unexpected upload fields.")),
        );
        parser.on("partsLimit", () =>
          fail(new ItemError(400, "Unexpected multipart content.")),
        );
        parser.on("file", (field, stream, info) => {
          // Destroying the parser can also emit an error on a rejected file stream.
          stream.on("error", (error) => {
            firstError ||= error;
          });
          if (field !== "file" || fileStream || !info.filename) {
            stream.resume();
            fail(new ItemError(400, "Choose exactly one file."));
            return;
          }
          fileStream = stream;
          originalName = safeFilename(info.filename);
          stream.on("limit", () =>
            fail(new ItemError(413, "The file is too large.")),
          );
          const meter = new Transform({
            transform: (chunk, encoding, callback) => {
              try {
                bytes += chunk.length;
                if (bytes > expected || bytes > this.config.maxFileBytes)
                  return callback(
                    new ItemError(
                      413,
                      "The file is larger than its declared size.",
                    ),
                  );
                if (prefix.length < 4096)
                  prefix = Buffer.concat([
                    prefix,
                    chunk.subarray(0, 4096 - prefix.length),
                  ]);
                hash.update(chunk);
                if (this.clock() - lastLease > 10000) {
                  this.db
                    .prepare(
                      `UPDATE file_objects SET lease_until=? WHERE id=? AND state='uploading'`,
                    )
                    .run(this.clock() + LEASE_MS, id);
                  lastLease = this.clock();
                }
                callback(null, chunk);
              } catch (error) {
                callback(error);
              }
            },
          });
          try {
            writer = this.ops.createWriteStream(filenames.temporary, {
              flags: "wx",
              mode: 0o600,
            });
            writing = pipeline(stream, meter, writer).catch(fail);
          } catch (error) {
            fail(error);
          }
        });
        req.once("aborted", abort);
        req.once("error", fail);
        req.on("data", rawData);
        req.setTimeout(120000, abort);
        req.pipe(parser);
      });
      await writing;
      if (firstError) throw firstError;
      if (
        !fileStream ||
        bytes !== expected ||
        fileStream.truncated ||
        req.aborted
      )
        throw new ItemError(
          400,
          "The upload was incomplete. Choose the file again.",
        );
      const mime = detectedMime(prefix);
      this.ops.renameSync(filenames.temporary, filenames.final);
      const now = new Date(this.clock()).toISOString();
      // File lifetime starts only when its complete bytes have been stored.
      const policy = retentionPolicy(retention, Date.parse(now));
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db
          .prepare(
            `INSERT INTO items (id,user_id,type,created_at,updated_at,expires_at,submission_id,is_kept) VALUES (?,?,'file',?,?,?,?,?)`,
          )
          .run(
            id,
            ownerId,
            now,
            now,
            policy.expiresAt,
            id,
            Number(policy.isKept),
          );
        this.db
          .prepare(
            `INSERT INTO item_files (id,item_id,storage_name,original_filename,mime_type,file_size,sha256,created_at) VALUES (?,?,?,?,?,?,?,?)`,
          )
          .run(
            id,
            id,
            id + ".blob",
            originalName,
            mime,
            bytes,
            hash.digest("hex"),
            now,
          );
        this.db
          .prepare(
            `UPDATE file_objects SET state='ready',lease_until=NULL,charged_bytes=? WHERE id=?`,
          )
          .run(bytes, id);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      this.notify(ownerId, "item.created", id);
      this.notify(ownerId, "storage.updated");
      return {
        item: requireAvailableItem(this.db, ownerId, id, now),
        duplicate: false,
      };
    } catch (error) {
      this.db
        .prepare(
          `UPDATE file_objects SET state='deleting',lease_until=NULL,next_retry_at=0 WHERE id=? AND state='uploading'`,
        )
        .run(id);
      this.cleanupObject(id);
      this.notify(ownerId, "storage.updated");
      if (error instanceof ItemError) throw error;
      if (error.code === "ENOSPC")
        throw new ItemError(
          507,
          "The server disk is full. The incomplete upload was not published.",
        );
      throw new ItemError(
        error.code ? 503 : 400,
        error.code
          ? "The file could not be stored. Try again."
          : "The upload was malformed or interrupted. Try again.",
      );
    } finally {
      req.removeListener("aborted", abort);
      req.removeListener("error", fail);
      req.removeListener("data", rawData);
      req.setTimeout(0);
      this.active.delete(id);
    }
  }
  close() {
    clearInterval(this.timer);
    if (this.ephemeral) {
      const target = realpathSync(this.directory),
        root = realpathSync(os.tmpdir());
      if (
        path.dirname(target) !== root ||
        !path.basename(target).startsWith("cavvoid-storage-")
      )
        throw new Error(
          "Refusing to remove storage outside its temporary test root.",
        );
      rmSync(target, { recursive: true, force: true });
    }
  }
}
