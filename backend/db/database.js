import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

// This is a content owner, not an authentication account or a gateway identity.
export const OWNER_ID = "owner";

export function openDatabase(filename, displayName = "Owner") {
  if (filename !== ":memory:")
    mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  try {
    db.exec(
      "PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;",
    );
    const version = db.prepare("PRAGMA user_version").get().user_version;
    if (version > 4)
      throw new Error("The database is newer than this CavVoid version.");
    db.exec("BEGIN IMMEDIATE");
    try {
      if (version < 1)
        db.exec(
          readFileSync(
            new URL("./migrations/001-owner.sql", import.meta.url),
            "utf8",
          ),
        );
      if (version < 2)
        db.exec(
          readFileSync(
            new URL("./migrations/002-items.sql", import.meta.url),
            "utf8",
          ),
        );
      if (version < 3)
        db.exec(
          readFileSync(
            new URL("./migrations/003-files.sql", import.meta.url),
            "utf8",
          ),
        );
      if (version < 4)
        db.exec(
          readFileSync(
            new URL("./migrations/004-preferences.sql", import.meta.url),
            "utf8",
          ),
        );
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at
        WHERE users.display_name != excluded.display_name`,
      ).run(OWNER_ID, displayName, now, now);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return {
      connection: db,
      owner() {
        return db
          .prepare(
            "SELECT id, display_name AS displayName FROM users WHERE id = ?",
          )
          .get(OWNER_ID);
      },
      health() {
        db.prepare("SELECT 1").get();
      },
      close() {
        db.close();
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
