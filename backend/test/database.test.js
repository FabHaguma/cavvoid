import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../db/database.js";
import { removeTestDirectory } from "./helpers.js";

test("versioned owner migration is durable, repeatable, and contains no authentication tables", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cavvoid-db-test-"));
  const filename = path.join(directory, "content.sqlite");
  let db;
  try {
    db = openDatabase(filename, "Fabrice");
    assert.equal(
      db.connection.prepare("PRAGMA journal_mode").get().journal_mode,
      "wal",
    );
    assert.equal(
      db.connection.prepare("PRAGMA foreign_keys").get().foreign_keys,
      1,
    );
    assert.equal(
      db.connection.prepare("PRAGMA user_version").get().user_version,
      4,
    );
    assert.deepEqual(
      { ...db.owner() },
      { id: "owner", displayName: "Fabrice" },
    );
    const created = db.connection
      .prepare("SELECT created_at FROM users")
      .get().created_at;
    db.close();
    db = openDatabase(filename, "Updated name");
    assert.equal(
      db.connection.prepare("SELECT count(*) AS count FROM users").get().count,
      1,
    );
    assert.equal(
      db.connection.prepare("SELECT created_at FROM users").get().created_at,
      created,
    );
    assert.equal(db.owner().displayName, "Updated name");
    assert.deepEqual(
      db.connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
      ["users", "items", "item_files", "file_objects", "user_preferences"],
    );
    assert.ok(
      !db.connection
        .prepare("PRAGMA table_info(users)")
        .all()
        .some((column) => /password|token/.test(column.name)),
    );
    assert.throws(() =>
      db.connection
        .prepare("INSERT INTO users VALUES (?, ?, ?, ?)")
        .run("attacker", "Other", created, created),
    );
    db.connection.exec("PRAGMA user_version = 5");
    db.close();
    db = null;
    assert.throws(() => openDatabase(filename), /newer/);
  } finally {
    db?.close();
    removeTestDirectory(directory, "cavvoid-db-test-");
  }
});
