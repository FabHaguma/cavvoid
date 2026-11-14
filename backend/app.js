import express from "express";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/database.js";
import { requireMutationOrigin, signInUrl, verifyGateway } from "./gateway.js";
import { createItemStore, ItemError } from "./items.js";
import { FileStore, previewKind } from "./files.js";
import { EventHub } from "./events.js";
import { readPreferences, savePreferences } from "./preferences.js";

function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
}

function denyAccess(req, res, status, config) {
  const unavailable = status === 503;
  const title = unavailable
    ? "Your sign-in service is unavailable."
    : status === 403
      ? "We couldn’t open your space."
      : "Sign in to your private space.";
  const message = unavailable
    ? "Your Void stays private. Try again when the connection is back."
    : status === 403
      ? "Gatekeeper couldn’t approve access to CavVoid. Check your sign-in service and try again."
      : "Your session has ended. Sign in again to continue.";
  if (
    !(req.get("Accept") || "").includes("text/html") ||
    req.path.startsWith("/api")
  ) {
    return res.status(status).json({
      code: unavailable ? "gateway_unavailable" : "access_denied",
      error: message,
      signInUrl: signInUrl(config),
    });
  }
  const nonce = randomBytes(16).toString("base64");
  res.set(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
  );
  return res
    .status(status)
    .type("html")
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CavVoid · ${escapeHtml(title)}</title><style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b10;color:#f5f3ff;font:16px/1.65 system-ui,sans-serif;padding:28px}main{max-width:520px}small{font-size:14px;color:#b5a1fa;letter-spacing:.08em}h1{font-size:clamp(28px,6vw,42px);line-height:1.15;letter-spacing:-.04em}p{color:#aaa7ba}nav{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}a{display:inline-block;color:#fff;text-decoration:none;background:#7860d5;border-radius:12px;padding:12px 20px}a+a{background:#22212c}</style></head><body><main><small>CAVVOID · PRIVATE SPACE</small><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><nav><a href="${escapeHtml(config.appOrigin + req.originalUrl)}">Try again</a><a href="${escapeHtml(signInUrl(config))}">Go to sign-in</a></nav></main></body></html>`,
    );
}

export function createApp({
  config = loadConfig(),
  database,
  fetchImpl,
  clock = Date.now,
  fileOptions = {},
  eventOptions = {},
} = {}) {
  const db =
    database || openDatabase(config.databasePath, config.ownerDisplayName);
  const app = express();
  const events = new EventHub(eventOptions);
  const notify = (ownerId, type, id) => events.publish(ownerId, type, id);
  const files = new FileStore(db, config, { clock, ...fileOptions, notify });
  const items = createItemStore(db, {
    maxTextBytes: config.maxTextBytes,
    clock,
    notify,
  });
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; worker-src 'self'; manifest-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    if (
      req.headers.host !== config.appHost ||
      !req.originalUrl.startsWith("/") ||
      req.originalUrl.startsWith("//") ||
      /[\\\x00-\x1f]/.test(req.originalUrl)
    ) {
      return res
        .status(421)
        .json({ error: `Open CavVoid at ${config.appOrigin}.` });
    }
    next();
  });
  // Internal readiness; no owner information and no content.
  app.get("/health", (req, res) => {
    db.health();
    res.json({ status: "ok" });
  });
  app.use("/api", requireMutationOrigin(config));
  app.use(async (req, res, next) => {
    const result = await verifyGateway(req, config, fetchImpl);
    if (result.location) return res.redirect(302, result.location);
    if (!result.allowed) return denyAccess(req, res, result.status, config);
    // Gateway credentials and all caller-supplied assertions stop at this boundary.
    delete req.headers.cookie;
    for (const key of Object.keys(req.headers)) {
      if (
        key.startsWith("x-forwarded-") ||
        key.startsWith("x-gatekeeper-") ||
        key === "x-user-id" ||
        key === "x-cavvoid-ingress" ||
        key === "x-auth-request-user"
      )
        delete req.headers[key];
    }
    req.owner = db.owner();
    next();
  });
  app.get("/api/auth/me", (req, res) => {
    res.json({
      owner: req.owner,
      authentication: {
        provider: "Gatekeeper",
        managementUrl: config.gatewayUrl + "/",
      },
      limits: {
        maxTextBytes: config.maxTextBytes,
        maxFileBytes: config.maxFileBytes,
        storageQuotaBytes: config.storageQuotaBytes,
      },
      preferences: readPreferences(db.connection, req.owner.id),
    });
  });
  app.get("/api/items", (req, res) =>
    res.json(items.list(req.owner.id, req.query)),
  );
  app.get("/api/events", (req, res) => {
    if (
      (req.get("Origin") && req.get("Origin") !== config.appOrigin) ||
      req.get("Sec-Fetch-Site") === "cross-site"
    )
      return res.status(403).json({ error: "Open live updates from CavVoid." });
    events.connect(req, res, req.owner.id);
  });
  app.post(
    "/api/items/text",
    (req, res, next) => {
      if (!req.is("application/json"))
        return res.status(415).json({ error: "Send this drop as JSON." });
      next();
    },
    express.json({ limit: config.maxTextBytes * 6 + 4096, strict: true }),
    (req, res) => {
      const body = req.body;
      const result = items.create(
        req.owner.id,
        body && typeof body === "object" && !Array.isArray(body)
          ? {
              ...body,
              retention:
                body.retention === undefined
                  ? readPreferences(db.connection, req.owner.id)
                      .defaultExpiration
                  : body.retention,
            }
          : body,
      );
      res.status(result.duplicate ? 200 : 201).json(result);
    },
  );
  app.post("/api/items/file", async (req, res) => {
    const result = await files.upload(req, req.owner.id);
    if (!res.destroyed) res.status(result.duplicate ? 200 : 201).json(result);
  });
  app.get("/api/storage", (req, res) =>
    res.json({
      ...files.usage(req.owner.id),
      quotaBytes: config.storageQuotaBytes,
      maxFileBytes: config.maxFileBytes,
      maxTextBytes: config.maxTextBytes,
      counts: db.connection
        .prepare(
          `SELECT count(*) AS total,
        coalesce(sum(CASE WHEN is_kept=0 THEN 1 ELSE 0 END),0) AS temporary,
        coalesce(sum(CASE WHEN is_kept=1 THEN 1 ELSE 0 END),0) AS kept
        FROM items WHERE user_id=? AND (is_kept=1 OR expires_at>?)`,
        )
        .get(req.owner.id, new Date(clock()).toISOString()),
    }),
  );
  app.get("/api/preferences", (req, res) =>
    res.json(readPreferences(db.connection, req.owner.id)),
  );
  app.patch(
    "/api/preferences",
    (req, res, next) => {
      if (!req.is("application/json"))
        return res.status(415).json({ error: "Send preferences as JSON." });
      next();
    },
    express.json({ limit: 1024, strict: true }),
    (req, res) => {
      const preferences = savePreferences(
        db.connection,
        req.owner.id,
        req.body,
        clock(),
      );
      notify(req.owner.id, "preferences.updated");
      res.json(preferences);
    },
  );
  const serveFile = (preview) => (req, res, next) => {
    const { item, filename } = files.content(req.owner.id, req.params.id);
    if (preview && !previewKind(item.file.mimeType))
      throw new ItemError(415, "Download this file to open it safely.");
    if (preview) res.set("Content-Disposition", "inline");
    else res.attachment(item.file.name);
    res.set(
      "Content-Security-Policy",
      "default-src 'none'; sandbox; frame-ancestors 'none'",
    );
    res.sendFile(
      filename,
      {
        acceptRanges: true,
        cacheControl: false,
        lastModified: false,
        headers: {
          "Content-Type": preview
            ? item.file.mimeType
            : "application/octet-stream",
          "Cache-Control": "no-store",
        },
      },
      (error) => {
        if (!error || res.destroyed) return;
        if (res.headersSent) {
          res.destroy();
          return;
        }
        next(
          new ItemError(
            error.status === 416 ? 416 : 503,
            error.status === 416
              ? "This file range is not available."
              : "The file could not be read. Try again.",
          ),
        );
      },
    );
  };
  app.get("/api/items/:id/download", serveFile(false));
  app.get("/api/items/:id/preview", serveFile(true));
  app.get("/api/items/:id", (req, res) =>
    res.json({ item: items.get(req.owner.id, req.params.id) }),
  );
  app.patch(
    "/api/items/:id",
    (req, res, next) => {
      if (!req.is("application/json"))
        return res.status(415).json({ error: "Send retention as JSON." });
      next();
    },
    express.json({ limit: 1024, strict: true }),
    (req, res) =>
      res.json({ item: items.update(req.owner.id, req.params.id, req.body) }),
  );
  app.delete("/api/items/:id", (req, res) => {
    const item = items.get(req.owner.id, req.params.id);
    if (item.type === "file") files.remove(req.owner.id, req.params.id);
    else items.remove(req.owner.id, req.params.id);
    res.sendStatus(204);
  });
  // Login and sessions remain in Gatekeeper.
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "This feature is not available yet." }),
  );
  if (!config.production) {
    app.use(
      express.static(config.frontendPath, {
        index: false,
        dotfiles: "deny",
        etag: false,
        cacheControl: false,
        setHeaders(res, filename) {
          if (path.basename(filename) === "pwa-shell.html")
            res.setHeader("X-CavVoid-Shell", "static");
          if (path.basename(filename) === "sw.js")
            res.setHeader("Service-Worker-Allowed", "/");
        },
      }),
    );
    app.get(["/", "/kept", "/settings"], (req, res) => {
      const index = path.join(config.frontendPath, "index.html");
      if (!existsSync(index))
        return res.status(503).json({
          error: "Build the frontend with npm run build, or start npm run dev.",
        });
      res.sendFile(index);
    });
  }
  app.use((req, res) => res.status(404).json({ error: "Page not found." }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof ItemError)
      return res.status(error.status).json({ error: error.message });
    if (error.type === "entity.too.large")
      return res
        .status(413)
        .json({ error: "This drop is too large. Try a shorter text." });
    if (error instanceof SyntaxError && "body" in error)
      return res
        .status(400)
        .json({ error: "The drop could not be read. Send valid JSON." });
    console.error("CavVoid request failed:", error.code || error.name);
    res
      .status(503)
      .json({ error: "CavVoid is temporarily unavailable. Try again." });
  });
  return {
    app,
    database: db,
    files,
    events,
    close: () => {
      events.close();
      files.close();
      db.close();
    },
  };
}
