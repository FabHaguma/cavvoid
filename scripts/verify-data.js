import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createReadStream, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Offline restore verification only: no migrations, expiry cleanup or data writes.
export async function verifyData(databasePath, filesDirectory) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    if (db.prepare("PRAGMA user_version").get().user_version !== 4)
      throw new Error("Use an image compatible with this backup's schema.");
    if (
      db
        .prepare("PRAGMA quick_check")
        .all()
        .some((row) => row.quick_check !== "ok") ||
      db.prepare("PRAGMA foreign_key_check").all().length
    )
      throw new Error("SQLite integrity check failed.");
    const rows = db
      .prepare(
        "SELECT f.storage_name,f.file_size,f.sha256,i.user_id FROM item_files f JOIN items i ON i.id=f.item_id WHERE i.type='file'",
      )
      .all();
    if (
      rows.length !==
        db.prepare("SELECT count(*) AS n FROM items WHERE type='file'").get()
          .n ||
      rows.length !==
        db.prepare("SELECT count(*) AS n FROM item_files").get().n ||
      rows.length !==
        db
          .prepare("SELECT count(*) AS n FROM file_objects WHERE state='ready'")
          .get().n
    )
      throw new Error("File metadata is incomplete.");
    const objects = path.resolve(filesDirectory, "objects");
    if (rows.length && realpathSync(objects) !== objects)
      throw new Error("Restore file paths must not use symbolic links.");
    let bytes = 0;
    for (const row of rows) {
      if (
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\.blob$/i.test(
          row.storage_name,
        ) ||
        !/^[a-f0-9]{64}$/.test(row.sha256)
      )
        throw new Error("Invalid generated file metadata.");
      const ledger = db
        .prepare(
          "SELECT charged_bytes FROM file_objects WHERE storage_name=? AND state='ready' AND user_id=?",
        )
        .get(row.storage_name, row.user_id);
      if (!ledger || ledger.charged_bytes !== row.file_size)
        throw new Error("Stored file quota ledger is inconsistent.");
      const filename = path.join(objects, row.storage_name);
      const stats = lstatSync(filename);
      if (!stats.isFile() || stats.size !== row.file_size)
        throw new Error("Restored file size check failed.");
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(filename)) hash.update(chunk);
      if (hash.digest("hex") !== row.sha256)
        throw new Error("Restored file hash check failed.");
      bytes += stats.size;
    }
    return {
      database: "ok",
      schemaVersion: 4,
      fileItems: rows.length,
      verifiedFileBytes: bytes,
      unfinishedUploads: db
        .prepare(
          "SELECT count(*) AS n FROM file_objects WHERE state='uploading'",
        )
        .get().n,
      pendingDeletionObjects: db
        .prepare(
          "SELECT count(*) AS n FROM file_objects WHERE state='deleting'",
        )
        .get().n,
    };
  } finally {
    db.close();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  try {
    if (args.length !== 4 || args[0] !== "--database" || args[2] !== "--files")
      throw new Error(
        "Usage: node scripts/verify-data.js --database <stopped restored SQLite file> --files <restored files directory>",
      );
    console.log(JSON.stringify(await verifyData(args[1], args[3])));
  } catch (error) {
    console.error("Restore verification failed:", error.code || error.message);
    process.exitCode = 1;
  }
}
