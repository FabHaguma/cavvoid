import { ItemError } from "./items.js";
import { retentionOptions } from "../shared/retention.js";

export function readPreferences(db, ownerId) {
  return {
    defaultExpiration:
      db
        .prepare(
          "SELECT default_expiration FROM user_preferences WHERE user_id=?",
        )
        .get(ownerId)?.default_expiration || "24h",
  };
}

export function savePreferences(db, ownerId, body, now) {
  if (
    !body ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !retentionOptions.some((option) => option.value === body.defaultExpiration)
  )
    throw new ItemError(
      400,
      "Choose a default expiration: 10m, 1h, 24h, 7d, or keep.",
    );
  db.prepare(
    `INSERT INTO user_preferences (user_id,default_expiration,updated_at) VALUES (?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET default_expiration=excluded.default_expiration,updated_at=excluded.updated_at`,
  ).run(ownerId, body.defaultExpiration, new Date(now).toISOString());
  return readPreferences(db, ownerId);
}
