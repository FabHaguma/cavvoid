import { randomUUID } from "node:crypto";
import { safeLink, textBytes } from "../shared/text.js";
import { previewKind } from "../shared/file-types.js";
import { retentionPolicy } from "../shared/retention.js";
import { typeOptions, sortOptions, sectionOptions } from "../shared/search.js";

export class ItemError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fields = `id, type, text_content AS text, is_kept AS isKept,
  created_at AS createdAt, updated_at AS updatedAt, expires_at AS expiresAt`;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const serialize = (row, db) => ({
  ...row,
  isKept: Boolean(row.isKept),
  url: row.type === "link" ? safeLink(row.text) : null,
  ...(row.type === "file" ? { file: fileMetadata(db, row.id) } : {}),
});

function fileMetadata(db, id) {
  const file = db
    .prepare(
      `SELECT original_filename AS name,mime_type AS mimeType,file_size AS size,sha256 FROM item_files WHERE item_id=?`,
    )
    .get(id);
  if (!file)
    throw new ItemError(503, "File information is temporarily unavailable.");
  return { ...file, previewKind: previewKind(file.mimeType) };
}

export function requireAvailableItem(db, ownerId, id, now) {
  if (!uuid.test(id))
    throw new ItemError(404, "This drop is no longer available.");
  const row = db
    .prepare(`SELECT ${fields} FROM items WHERE id = ? AND user_id = ?`)
    .get(id, ownerId);
  if (!row) throw new ItemError(404, "This drop is no longer available.");
  if (!row.isKept && (!row.expiresAt || row.expiresAt <= now))
    throw new ItemError(
      410,
      "This drop has expired and is no longer available.",
    );
  return serialize(row, db);
}

export function createItemStore(
  database,
  { maxTextBytes, clock = Date.now, notify = () => {} },
) {
  const db = database.connection;
  const timestamp = () => new Date(clock()).toISOString();
  return {
    list(ownerId, query) {
      const page = query.page === undefined ? 1 : Number(query.page);
      const limit = query.limit === undefined ? 30 : Number(query.limit);
      const section = query.section === undefined ? "void" : query.section;
      const type = query.type === undefined ? "all" : query.type;
      const sort = query.sort === undefined ? "newest" : query.sort;
      const q = query.q === undefined ? "" : query.q;
      if (
        !Number.isInteger(page) ||
        page < 1 ||
        page > 1000000 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !sectionOptions.some((option) => option[0] === section) ||
        !typeOptions.some((option) => option[0] === type) ||
        !sortOptions.some((option) => option[0] === sort) ||
        typeof q !== "string" ||
        q.length > 200 ||
        Object.values(query).some((value) => typeof value !== "string")
      ) {
        throw new ItemError(
          400,
          "Use valid filters, a search up to 200 characters, and a page size from 1 to 100.",
        );
      }
      const now = timestamp();
      const params = [ownerId, now];
      let where = "user_id = ? AND (is_kept = 1 OR expires_at > ?)";
      if (section !== "all") {
        where += " AND is_kept = ?";
        params.push(Number(section === "kept"));
      }
      if (["text", "link", "file"].includes(type)) {
        where += " AND type = ?";
        params.push(type);
      }
      if (["image", "audio", "document"].includes(type)) {
        const image = "'image/png','image/jpeg','image/gif','image/webp'";
        const audio = "'audio/mpeg','audio/wav','audio/ogg','audio/mp4'";
        where += ` AND type = 'file' AND EXISTS (SELECT 1 FROM item_files f WHERE f.item_id=items.id AND f.mime_type ${type === "document" ? `NOT IN (${image},${audio})` : `IN (${type === "image" ? image : audio})`})`;
      }
      if (q.trim()) {
        where +=
          " AND (instr(lower(coalesce(text_content,'')),lower(?)) > 0 OR EXISTS (SELECT 1 FROM item_files f WHERE f.item_id=items.id AND instr(lower(f.original_filename),lower(?)) > 0))";
        params.push(q.trim(), q.trim());
      }
      const direction = sort === "oldest" ? "ASC" : "DESC";
      const { total } = db
        .prepare(`SELECT count(*) AS total FROM items WHERE ${where}`)
        .get(...params);
      const items = db
        .prepare(
          `SELECT ${fields} FROM items WHERE ${where} ORDER BY created_at ${direction}, id ${direction} LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, (page - 1) * limit)
        .map((row) => serialize(row, db));
      return {
        items,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        serverTime: now,
      };
    },
    get(ownerId, id) {
      return requireAvailableItem(db, ownerId, id, timestamp());
    },
    create(ownerId, body) {
      if (
        !body ||
        Array.isArray(body) ||
        typeof body !== "object" ||
        Object.keys(body).some(
          (key) => !["text", "submissionId", "retention"].includes(key),
        ) ||
        typeof body.text !== "string" ||
        !body.text.trim() ||
        !uuid.test(body.submissionId || "")
      ) {
        throw new ItemError(
          400,
          "Enter some text or a link and a valid submission ID.",
        );
      }
      if (textBytes(body.text) > maxTextBytes)
        throw new ItemError(
          413,
          `This drop exceeds the ${Math.ceil(maxTextBytes / 1024)} KB text limit.`,
        );
      const now = timestamp();
      const policy = retentionPolicy(body.retention, Date.parse(now));
      if (!policy)
        throw new ItemError(
          400,
          "Choose 10m, 1h, 24h, 7d, or keep for retention.",
        );
      const existing = db
        .prepare("SELECT id FROM items WHERE user_id = ? AND submission_id = ?")
        .get(ownerId, body.submissionId);
      if (existing) {
        const item = requireAvailableItem(db, ownerId, existing.id, now);
        if (item.text !== body.text)
          throw new ItemError(
            409,
            "This submission was already used for different text. Open a new drop.",
          );
        return { item, duplicate: true };
      }
      const id = randomUUID();
      db.prepare(
        `INSERT INTO items (id, user_id, type, text_content, created_at, updated_at, expires_at, submission_id, is_kept)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        ownerId,
        safeLink(body.text) ? "link" : "text",
        body.text,
        now,
        now,
        policy.expiresAt,
        body.submissionId,
        Number(policy.isKept),
      );
      notify(ownerId, "item.created", id);
      return {
        item: requireAvailableItem(db, ownerId, id, now),
        duplicate: false,
      };
    },
    update(ownerId, id, body) {
      if (
        !body ||
        Array.isArray(body) ||
        typeof body !== "object" ||
        Object.keys(body).length !== 1 ||
        !Object.hasOwn(body, "retention")
      )
        throw new ItemError(
          400,
          "Send a retention choice: 10m, 1h, 24h, 7d, or keep.",
        );
      db.exec("BEGIN IMMEDIATE");
      try {
        // Check time after taking the write lock: an expired drop cannot be revived.
        const now = timestamp();
        requireAvailableItem(db, ownerId, id, now);
        const policy = retentionPolicy(body.retention, Date.parse(now));
        if (!policy || body.retention === undefined)
          throw new ItemError(
            400,
            "Choose 10m, 1h, 24h, 7d, or keep for retention.",
          );
        db.prepare(
          "UPDATE items SET is_kept=?, expires_at=?, updated_at=? WHERE id=? AND user_id=?",
        ).run(Number(policy.isKept), policy.expiresAt, now, id, ownerId);
        const item = requireAvailableItem(db, ownerId, id, now);
        db.exec("COMMIT");
        notify(ownerId, "item.updated", id);
        return item;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    remove(ownerId, id) {
      const item = requireAvailableItem(db, ownerId, id, timestamp());
      if (item.type === "file")
        throw new ItemError(409, "Use file deletion for this drop.");
      db.prepare("DELETE FROM items WHERE id = ? AND user_id = ?").run(
        id,
        ownerId,
      );
      notify(ownerId, "item.deleted", id);
    },
  };
}
