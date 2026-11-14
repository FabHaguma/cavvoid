# CavVoid implementation plan

**Updated:** 2026-11-14\
**Source:** [PRD v1.1](cavvoid-prd.md)\
**Current state:** Milestones 1–7 complete locally; milestone 8 paths/builds are confirmed. During the guided milestone 9 rollout, both CavVoid services became healthy and Caddy validation/unsigned HTTPS redirect passed. Signed-in access exposed an unwanted per-app secret requirement. This release removes it to match Fabrice's existing shared `gatekeeper_app` snippet; updated live acceptance and device checks remain pending.

## Start here

Continue using the short [VPS update path](deploy/README.md). Keep `cavvoid.haguma.com { import gatekeeper_app frontend_cavvoid:80 }`; pull/build the app update and remove the obsolete generated secret. Then check sign-in and a text drop. Existing data is reused, and the shared snippet needs no CavVoid-specific change.

Implement one milestone per request. At the end, show the working preview or prepared files, say what was actually verified, update the status below, and stop with: **"Milestone N complete. Tell me 'Implement milestone N+1' when you are ready."** Do not begin the next milestone automatically. If required checks fail, finish the current milestone or report its specific blocker without claiming it is complete.

Milestone 8 prepares deployment files. Milestone 9 performs deployment and needs an explicit request such as **"Deploy CavVoid — milestone 9."** Include the next-milestone reminder in each completion reply.

| Milestone | Result | Depends on | Status |
|---|---|---|---|
| 1 | Local shell protected by OAuthenticator | Existing local Gatekeeper configured | Complete — 2026-11-13 |
| 2 | Text and link transfer | 1 | Complete — 2026-11-14 |
| 3 | Private files and previews | 2 | Complete — 2026-11-14 |
| 4 | Retention and automatic cleanup | 3 | Complete — 2026-11-14 |
| 5 | Real-time updates across devices | 4 | Complete — 2026-11-14 |
| 6 | Mobile PWA and offline behavior | 5 | Complete — 2026-11-14 |
| 7 | Search, settings, and local release checks | 6 | Complete locally — 2026-11-14; release limits recorded below |
| 8 | VPS deployment package and handoff | 7 | Package/host paths confirmed; VPS image builds passed |
| 9 | Requested deployment and live acceptance | 8 + deployment request | Guided rollout in progress; shared-snippet compatibility awaiting VPS retry |

## Integration decisions

- Use Fabrice's existing OAuthenticator repository, whose current application name is **Gatekeeper**. This is Caddy forward authentication, not OAuth/OIDC. Do not create OAuth registration, JWT handling, a second password form, or a CavVoid session database.
- Keep the PRD's existing React/Vite, Node.js/Express, SQLite/WAL, private filesystem, and SSE choices. This revision changes authentication and delivery sequencing; it does not migrate the proposed frontend stack.
- Keep folders simple: `frontend/` with public assets in `frontend/assets/`, `backend/`, and deployment files only when milestone 8 needs them. Keep SQLite, uploads, temporary files, secrets, and backups outside the public frontend and out of Git.
- Use native Node.js and a local `npm run dev` entry point. Bind local services to loopback. Use the real local Gatekeeper for the sign-in demonstration and disposable databases for tests; do not depend on the VPS or local Docker.
- Production path: browser → existing shared Caddy `gatekeeper_app` import → `frontend_cavvoid:80` → `backend_cavvoid:3001` on an app-private network. The VPS confirmed the names/ports and both services became healthy. Use the exact one-argument snippet already used for other private apps. No per-app authentication secret/header is required; the shared ingress network is trusted, ports stay unpublished, and gateway credentials are stripped before app handlers.
- Gatekeeper currently returns `204` or an error from `/auth/verify`, with no owner identity header. Assign the same fixed local owner on the server after the trusted boundary admits the request. Keep `items.user_id` and preferences, but never accept an owner ID from the browser.
- Gatekeeper owns its password, login throttling, cookie, session expiry, and session dashboard. CavVoid's Settings opens that dashboard for sign-out/revocation. Explain that this also affects other apps sharing that gateway session. Signing out all devices means revoking other sessions and then signing out the current one there.
- CavVoid still owns authorization of item operations, safe previews, expiration enforcement, and CSRF protection. Require the exact configured CavVoid Origin plus an application-specific header on mutations, including multipart uploads; reject cross-origin browser access.
- Gate every page/API/file/stream request. Signed-out page navigation returns through Gatekeeper login; fetch/API requests receive an error rather than HTML. Gateway denial or outage must block access. Close each SSE connection within 30 seconds and recheck through the gateway on reconnect.
- Follow Gatekeeper's cookie redaction and proxy-secret removal template for production. Do not forward gateway credentials into CavVoid. Keep application ports private and verify the boundary on the VPS rather than trusting client-supplied headers.

## Inputs and verification limits

**Production hostname supplied by Fabrice:** `https://cavvoid.haguma.com` (DNS registration reported 2026-11-14). Use this exact origin for the eventual gateway app registration and scoped Caddy block. DNS resolution, HTTPS routing, and deployment have not been verified by this milestone; local APP_ORIGIN stays on localhost until hosting work is requested.

The OAuthenticator README, `backend/app.js`, `backend/config.js`, `integration/demo-app.js`, and Caddy examples were inspected read-only while planning. Its repository is at `C:/Users/Fabrice/My_Documents/Programming/Dockered/OAuthenticator`. No credentials or private environment files were read. No running gateway, application, phone, or VPS was tested during planning.

For milestone 1, use an existing local Gatekeeper or configure it following its README. Register CavVoid's chosen local origin in `PROTECTED_APPS` without replacing existing entries. Keep the real administrator password and proxy secret in ignored server-side configuration; commit only harmless examples. The documented defaults are Gatekeeper at `http://localhost:4000` and a protected local demo at `http://localhost:3000`; check for port conflicts before adopting these for CavVoid. Use `localhost` consistently rather than mixing it with `127.0.0.1` in browser URLs.

For milestone 8, confirm the intended CavVoid HTTPS hostname under the gateway's trusted cookie domain, the actual gateway URL/service, service-name availability, VPS app folder, and existing Caddyfile/container. The OAuthenticator deployment guide mentions `login.haguma.com` and `backend_gatekeeper:4000`; these are references to confirm, not evidence of the current live setup. Missing production details do not block milestones 1–7.

Responsive browser emulation and independent browser contexts are local checks. Actual Android/iOS installation, physical cross-device behavior, HTTPS proxy integration, and Docker persistence require the release environment. Record these as pending until tested; do not describe them as verified by emulation.

## Milestone 1 — Runnable foundation and OAuthenticator

**Outcome:** Open a local CavVoid shell through a real Gatekeeper sign-in and return to the page you requested.

1. Create the frontend/backend entry points, dependency lockfile, `.env.example`, and native `npm run dev` workflow. Add environment validation, a health check, and versioned SQLite initialization with one fixed owner record. Exclude runtime data and secrets from Git.
2. Build the first responsive dark shell with Void, Kept, Settings, an empty state, and the Drop entry point. Mark unfinished actions clearly until their milestones are implemented; show the working shell early.
3. Add a local protected entry point following OAuthenticator's native demo contract: call `/auth/verify` server-side with a timeout and manual redirect handling, set forwarding metadata from the known local origin and actual request, and keep the verification secret out of the browser. Route private requests through this boundary; never allow spoofed forwarding headers to grant access.
4. Implement `GET /api/auth/me` as a protected access probe returning the fixed owner and a configured Gatekeeper dashboard URL. Add Settings navigation to that dashboard and a clear sign-in/retry state on authorization failure or gateway outage. Clear private memory before navigating for sign-out.
5. Establish exact-Origin and request-header checks for application mutations now, then reuse them in later APIs. Do not add local login/logout/session endpoints or read Gatekeeper's database.
6. Document the shortest local start path and the small Gatekeeper app-registration change. Verify with the actual local gateway, keeping its existing registered apps intact.

**Completion checks:** Signed-out page navigation redirects and returns to the original safe local path after sign-in. Signed-out JSON requests return `401`; gateway outage denies access. Two independent browser sessions can sign in, restart within the gateway lifetime, and use Settings to open Gatekeeper. Logout/revocation blocks the next access probe. Test forged forwarding headers and disallowed mutation origins. Check the shell at desktop and phone viewport sizes. Any phone-specific behavior remains pending.

**Handoff:** Give the local preview URL, one sign-in action to try, checks performed, and the reminder to request milestone 2.

## Milestone 2 — Text and link transfers

**Outcome:** Save text in one browser session and retrieve/copy it in another after refresh.

1. Add item storage and `GET /api/items`, `POST /api/items/text`, `GET /api/items/:id`, and `DELETE /api/items/:id`, with the fixed owner applied server-side and a default page size of 30.
2. Implement the composer, multiline plain-text cards, safe URL detection/rendering, creation times, loading/empty/error states, and duplicate-submit prevention. Enforce the configurable 100 KB text limit on the server.
3. Give new items a default 24-hour expiration and introduce one shared item-access check that rejects expired or deleted items. Full retention editing and physical cleanup arrive in milestone 4.
4. Add explicit Copy and optional Paste actions with manual fallback for denied clipboard permission. Never upload clipboard content automatically. Add manual deletion and details.
5. Test persistence across a native backend restart, server validation, authorization/CSRF rejection, HTML/script escaping, unsafe URL handling, deletion, pagination, and clipboard failure behavior.

**Completion checks:** Text and links transfer in both directions between two independent sessions, whitespace survives, copying works or gives a usable fallback, and expired/deleted items cannot be read. Refresh-based retrieval is expected until milestone 5.

**Handoff:** Show a text transfer and remind Fabrice to request milestone 3.

## Milestone 3 — Private file transfers and previews

**Outcome:** Upload an image, MP3, or document and retrieve it through authenticated preview/download routes.

1. Add file metadata and private temporary/final storage. Implement streamed multipart uploads with a configurable 100 MB per-file limit and 2 GB total quota. Account for simultaneous uploads so quota checks cannot race.
2. Validate completion before finalizing a file; keep database/file updates recoverable and clean up failed/interrupted fragments. Preserve the original name as display/download metadata, never as a filesystem path.
3. Add file picker, desktop drag-and-drop, mobile selection, multiple-file selection, per-file progress, and clear success/failure states. Each selected file becomes its own item.
4. Implement authenticated downloads, image previews, supported audio playback/range requests, and safe PDF preview or download fallback. Reuse owner/expiry/deletion checks on every route. Serve active content as attachments or otherwise isolate it from the app origin.
5. Add deletion cleanup with retry bookkeeping and storage accounting. Handle disk-full errors and interrupted requests without showing corrupt uploads as complete.

**Completion checks:** Transfer an image, MP3, and arbitrary document between independent sessions. Confirm original download names, playback where supported, progress, quota/size rejection, interrupted-upload recovery, and denied signed-out preview/download/range requests. Test path traversal and active-content handling. Real phone file-picker checks remain release checks.

**Handoff:** Show one upload and retrieval, then remind Fabrice to request milestone 4.

## Milestone 4 — Retention, Keep, and automatic cleanup

**Outcome:** Items expire when expected, while kept items remain available.

1. Add `PATCH /api/items/:id` and composer/item controls for 10 minutes, 1 hour, 24 hours, 7 days, and Keep. Calculate and store UTC timestamps on the server.
2. Implement the Kept view, pin/unpin without copying files, and a fresh 24-hour expiration on unpin by default.
3. Enforce expiry in listing, details, previews, downloads, and mutation paths. Remove expired cards from the visible feed without relying on the cleanup worker for access denial.
4. Run cleanup at startup and at least hourly. Retry failed physical deletions using durable bookkeeping, reconcile interrupted work, and maintain correct quota usage until bytes are actually removed.
5. Test boundary timestamps, kept items, unpinning, repeated cleanup, filesystem failures, restart recovery, and expiry during concurrent operations using controlled test time rather than waiting an hour.

**Completion checks:** Expired content is inaccessible immediately even with cleanup paused; cleanup removes files and records normally, retries failures, and never deletes a kept item. Manual deletion revokes access immediately even if physical removal needs a retry.

**Handoff:** Demonstrate Keep and expiration, then remind Fabrice to request milestone 5.

## Milestone 5 — Real-time synchronization

**Outcome:** Changes in one active session appear in the others without manual refresh.

1. Implement protected `/api/events` with `item.created`, `item.updated`, `item.deleted`, and `storage.updated`. Send minimal identifiers/metadata and fetch private content through checked APIs.
2. Update feeds for create/delete/retention/expiry changes, deduplicate events, and fetch authoritative state after reconnect or page resume.
3. Close every SSE response within 30 seconds regardless of event traffic; reconnect through the gateway. On connection failure, probe access and distinguish authentication failure from network trouble. Stop reconnect loops and clear private memory after access ends.
4. Handle heartbeats, backoff, slow/disconnected clients, and cleanup of abandoned connections. Already displayed data and an in-flight download cannot be remotely recalled; explain this limit accurately.
5. Test two independent signed-in sessions for normal updates and at least five concurrent clients for delivery. Test network interruption, duplicate events, gateway outage, logout/revocation with an already-open stream, and session expiry.

**Completion checks:** Active local clients update within the PRD's two-second target under normal test conditions, reconnect to correct state, and an existing stream stops within 30 seconds of revocation with reconnection denied. Measure the behavior rather than assuming an initial proxy check covers a long-lived stream.

**Handoff:** Show two browser sessions updating together and remind Fabrice to request milestone 6.

## Milestone 6 — Mobile PWA and offline behavior

**Outcome:** CavVoid has a usable mobile layout and a locally verified PWA shell.

1. Complete touch-friendly navigation, Drop composer, safe-area spacing, responsive previews, keyboard behavior, and portrait/landscape layouts.
2. Add manifest, required icons, standalone display mode, and a service worker that caches only an explicit list of safe static shell assets. Do not cache API/auth responses, private content, downloads, or gateway redirects.
3. Add a branded offline state and reconnect/resume refresh. Never report an unsent upload as successful; offline upload queues remain out of scope.
4. Ensure a cached shell cannot reveal previously loaded items or bypass a fresh authenticated API check. Test logout, expired sessions, offline launch, return online, and service-worker updates.
5. Inspect desktop and phone viewport sizes. Check manifest/service-worker behavior and local installability where supported by the test browser. Record physical Android/iOS installation and sleep/resume as pending for milestone 9.

**Completion checks:** Local responsive and offline/resume tests pass, private responses stay out of the service-worker cache, and the signed-out shell reveals no item data. Describe local PWA readiness separately from real-device installation, which requires the HTTPS release.

**Handoff:** Show the mobile layout/offline state and remind Fabrice to request milestone 7.

## Milestone 7 — Search, settings, and local release checks

**Outcome:** The local MVP is ready for deployment preparation.

1. Add search by text/filename, type and Void/Kept filters, sort order, and pagination. Scope every result to the server-selected owner.
2. Implement storage statistics and preferences APIs/UI, including used storage, counts, quota/size limits, and saved default expiration. Keep the quota enforced from milestone 3; this milestone exposes its controls and status. Keep Gatekeeper as the session dashboard.
3. Complete user-facing errors for connectivity, ended sessions, uploads, missing/expired files, clipboard permissions, and unsupported previews. Check accessibility, focus, readable contrast, and destructive-action feedback.
4. Run meaningful unit/integration checks for authentication-boundary handling, CSRF, retention, quota races, files, and cleanup. Run local end-to-end transfer flows with independent browser contexts and disposable data. Recheck the PRD's latency and five-client targets under stated local conditions.
5. Review production assumptions: no frontend secrets, private storage, safe filenames/headers, no sensitive logging, safe cache policy, CSP, and bounded SSE. Update acceptance tracking with passed local checks and pending physical-device/VPS checks.
6. Put the shortest verified start/use instructions first in the README and document data paths, limits, backup expectations, and known verification limits.

**Completion checks:** Local release checks pass, the main journeys work at desktop/mobile sizes, and all unfinished production/device checks are named. Light theme, QR pairing, Android Share Target, and other post-MVP features remain outside this plan.

**Handoff:** Show the local release candidate and remind Fabrice to request milestone 8 for deployment preparation.

## Milestone 8 — VPS deployment preparation

**Outcome:** Reviewable deployment files and a short handoff for Fabrice's existing VPS; no rollout yet.

1. Confirm the hostname, gateway origin, chosen VPS checkout folder, Caddy layout/container, and current service/network configuration from available project or read-only host evidence. Resolve only missing values that prevent an exact handoff; never present placeholders as verified settings.
2. Create Docker/Nginx/Compose files with unique services `frontend_cavvoid:80` and `backend_cavvoid:3001` after conflict checks. Keep `caddy_network` external for the ingress-facing service and use an app-private network for backend traffic. Publish no extra host ports. Add health checks, restart policy, identifiable image tags, persistent database/uploads mounts, and excluded build-context secrets/data.
3. Route APIs and SSE before frontend fallback, preserve `/api/`, align upload limits/timeouts, and prevent SSE buffering. Ensure all public application traffic first crosses Caddy's gateway check.
4. Prepare only the affected CavVoid Caddy block in the actual shared-config style, following Gatekeeper's verification metadata, cookie redaction, secret removal, and timeouts. Specify where the block belongs and the exact Caddy validation/reload commands from the actual setup. Preserve other routes and the existing login host.
5. Document adding just CavVoid's exact HTTPS origin to Gatekeeper's existing `PROTECTED_APPS`, matching the cookie domain, preserving other registered apps, and applying only the needed gateway configuration update.
6. Write the familiar handoff: laptop commit/push by Fabrice → SSH → pull/build in the chosen VPS folder. Give the domain and exact Docker service/internal port for Caddy before startup, plus backup/restore, migration, smoke-test, and rollback instructions. Preparing this handoff does not authorize pushing or deploying.
7. Run native checks locally. Record Docker/Compose/Caddy runtime validation and container persistence as pending until run on the intended VPS; do not probe for or require local Docker.

**Completion checks:** The package matches the actual confirmed topology, contains no credentials, and names the VPS commands and remaining live tests accurately. No production configuration has been changed.

**Handoff:** Link the prepared files and say: **"Milestone 8 complete. Tell me 'Deploy CavVoid — milestone 9' when you want the VPS rollout."** If production identifiers are still missing, report milestone 8 as awaiting those specific inputs instead of complete.

## Milestone 9 — Deploy only when requested; verify live

**Outcome:** CavVoid is live on the requested HTTPS hostname and verified with the existing gateway.

1. After Fabrice explicitly requests deployment, confirm the release is pushed and available in the chosen VPS checkout. Inspect the target read-only, preserve the previous release, and make a consistent backup of any existing app data before migrations.
2. On that VPS, validate Compose and the affected shared Caddy configuration without exposing secrets. Apply only the required CavVoid app registration and site block, then build/start the scoped services. Avoid unrelated service restarts or network/volume changes.
3. Verify HTTPS, safe sign-in/return navigation, API authorization errors, logout/revocation/expiry, and gateway outage behavior. Test forged headers, direct-port bypass attempts, cross-origin mutations, and the 30-second SSE boundary against the real proxy setup.
4. Perform phone → PC and PC → phone text/image/document/audio flows, retention/deletion, interrupted connectivity, and Android/iOS installation and resume on the physical devices available. Record unavailable device checks explicitly; do not mark them passed.
5. Check container restart persistence, cleanup, disk/quota behavior, backup/restore procedure, and relevant logs. If rollout fails, make a scoped correction or restore the previous compatible release without overwriting newer user data.
6. Mark PRD acceptance boxes only for checks actually performed. Report the verified live URL, release identity, and remaining device/platform limitations. A release with required acceptance checks still pending must be reported that way.

**Completion checks:** The requested live setup passes its required authentication, transfer, retention, synchronization, persistence, and device acceptance checks. Complete the release record; there is no next milestone reminder after this final milestone.

## Completion record

At each milestone handoff, update its status and append a short record here with the completion date, changed files, verified command/preview, checks performed, outstanding environment-specific checks, and the next milestone prompt. Do not mark an entire PRD acceptance criterion complete from a mock or an unperformed live test.

### Milestone 1 — Complete, 2026-11-13

- **Delivered:** React/Vite dark responsive shell with Void, Kept, Settings, a clearly labeled coming-soon Drop dialog, and a Settings link to the existing Gatekeeper dashboard. Added Express, a fixed-owner SQLite migration, protected `/api/auth/me`, loopback readiness, config validation, exact-Origin/request-header mutation guards, and denied access on failed verification. No duplicate CavVoid password or session storage.
- **Local setup:** `npm run setup:local` reuses the real OAuthenticator server and built UI from its existing checkout with separately generated `.local/` credentials/database. The original gateway environment, registered apps, and database were preserved. `npm run dev` launches the local services at `http://localhost:3000` and `http://localhost:4000` with native Node.js. The password location and start steps are in [README.md](README.md).
- **Verified:** Frontend build; 13 backend checks; one integration test against actual Gatekeeper code using disposable databases. Covered independent HTTP-client sessions, persistent cookies after gateway restart, revocation, logout, expiry, safe return URLs, gateway outage, forged owner/forwarding metadata, private page/asset/API boundaries, mutation checks including multipart, repeatable migrations, and fixed-owner persistence. Dependency installation reported zero vulnerabilities.
- **Browser checks:** Real Gatekeeper login and return to CavVoid, logout/re-login with the original Kept path/query preserved, Settings → Gatekeeper dashboard, and the coming-soon Drop dialog. Desktop and 360px/390px phone layouts were inspected; no horizontal overflow was found and visible text was at least 14px.
- **Limits:** Independent-session persistence is tested through real HTTP clients and a gateway restart; an OS/browser process restart was not separately performed. Physical phones, PWA installation, production proxy isolation, and deployment remain pending. Transfers remain out of scope until milestone 2. This foundation is explicitly loopback-only and refuses production startup.
- **Next prompt:** **"Implement milestone 2."** Stop here until Fabrice requests it.

### Milestone 2 — Complete, 2026-11-14

- **Delivered:** Item migration/store and authenticated list/create/details/delete routes. Added a working Drop composer, plain-text/link cards, explicit Paste, Copy with manual full-text/selection fallback, confirmation before deletion, loading/error/retry states, and 30-item pagination. The server sets the fixed owner and 24-hour expiry and enforces the configurable `MAX_TEXT_BYTES` limit (default 102400 bytes). Identical active-submission retries return the same item without extending its expiry.
- **Files:** Added `backend/items.js`, `backend/db/migrations/002-items.sql`, `shared/text.js`, frontend transfer/clipboard/icon modules, and targeted tests; updated the existing app, config, shell, styles, and README. Existing gateway authentication and local data are preserved.
- **Verified commands:** `npm run build`, `npm test` (25 passing checks), and `npm run test:gatekeeper` (one passing integration test). Checked UTF-8 boundaries and escaped JSON, whitespace preservation, independent owner scoping, denied/expired/deleted access, mutation guards, idempotent retries, safe links, pagination, clipboard failures, migration from version 1, and a real native backend process restart. The real Gatekeeper test transfers text and links in both directions between separate signed-in HTTP clients and checks deletion/revocation.
- **Browser checks:** A real note was retrieved in another tab; copying and pasting it back preserved its exact whitespace without auto-submitting. A save interrupted by a development-server restart retained the draft and retried into one item. Full-text selection works, script/HTML-like content produces no executable elements or unsafe links, and deletion confirmation is present. Desktop and 360px/390px layouts were checked. The disposable rendering-check drop was removed through its authenticated API and returned 404 afterward.
- **Limits:** Browser tabs share an authentication profile; independent sessions are covered by the real-Gatekeeper integration. Physical phone/PC transfers remain a release check. Receiving browsers use Refresh; live events are milestone 5. Files are milestone 3; Keep/custom expiration and physical expired-record cleanup remain milestone 4. Submission deduplication is scoped to an existing item, not a permanent ledger after deletion. No deployment was performed.
- **Next prompt:** **"Implement milestone 3."** Stop here until Fabrice requests it.

### Milestone 3 — Complete, 2026-11-14

- **Delivered:** Streaming multipart file uploads with a 100 MB default per-file limit and 2 GB file quota, atomic reservations, private staging/final storage, byte-count/hash validation, metadata, safe filenames, and idempotent upload retries. Added authenticated previews/downloads/ranges, actual image/audio cards, safe PDF/active-file download fallback, file details, and manual deletion with durable physical-cleanup retries. The file composer supports multiple selection, drag/drop handling, per-file progress, cancellation, and explicit upload confirmation.
- **Files:** Added `backend/files.js`, migration `003-files.sql`, `shared/file-types.js`, browser upload/file components, and file-focused tests; extended the existing app/store/config/server, composer, styles, and local environment example. The existing content migration path, owner, notes, and Gatekeeper setup were preserved.
- **Verified:** `npm run build`; `npm test` (39 passing checks); `npm run test:gatekeeper` (one passing integration test). File checks include complete/empty/oversized/malformed uploads, signed-out/expired/range access, safe attachment behavior, path handling, parallel quota reservations including separate SQLite connections, interrupted streams, ENOSPC, failed rename/unlink, charged pending deletions, retries, crash/orphan recovery, and file persistence across a native backend process restart. Independent real Gatekeeper clients transfer images, MP3 data, and PDF documents and lose access after revocation.
- **Browser checks:** Selected PNG, MP3, PDF, and TXT together; each finished with a confirmed 100% state. PNG loaded at its actual dimensions; the MP3 player reached a playable state and played; a browser PDF download preserved its filename and matched its 600-byte source. Desktop, 360px, and 390px layouts were checked. Saved local previews are in ignored `.local/previews/`.
- **Limits:** Browser file selection and multiple uploads are verified; native OS drag/drop and physical phone file selection remain unverified. The implemented drop handlers do not upload without confirmation. PDF is download-only. Expired content is denied immediately, but physical expiration cleanup remains milestone 4; live synchronization remains milestone 5. `cavvoid.haguma.com` is recorded as the user-supplied production hostname with DNS registration reported; no DNS resolution, Caddy route, gateway production app registration, or VPS rollout was performed.
- **Next prompt:** **"Implement milestone 4."** Stop here until Fabrice requests it.

### Milestone 4 — Complete, 2026-11-14

- **Delivered:** `PATCH /api/items/:id`, composer retention for text/files, Keep/Unkeep on cards, details-based expiration editing, and a working Kept view. Policies are 10 minutes, 1 hour, 24 hours, 7 days, and Keep. UTC deadlines are server-calculated; unkeep starts a fresh 24 hours. Keeping updates the original record without copying files. Existing schema version 3 already supports these fields.
- **Cleanup:** Startup and 30-second expiry sweeps atomically remove expired item/metadata records and queue physical file deletion. Keep/PATCH and cleanup share write transactions. Failed unlink retains durable retry bookkeeping and charged quota until the bytes are removed. Existing upload-lease and orphan recovery remain in place. The feed removes expired cards and closes their details/deletion dialogs independently of the worker; expired items cannot be kept or extended.
- **Files:** Added `shared/retention.js`, frontend retention components, and controlled-time retention tests; extended item/file stores, app routes, text/upload APIs, cards, composer, styles, real-Gatekeeper integration, restart tests, and README. Existing user notes and gateway setup are preserved.
- **Verified commands:** `npm run build`, `npm test` (48 passing checks), and `npm run test:gatekeeper` (one passing integration test). Coverage includes all policies, midnight/exact-boundary timestamps, paused cleanup, owner/auth/CSRF checks, expired mutations/ranges, Keep/unkeep, no duplicate file/quota charge, concurrent upload/cleanup, separate SQLite connections, repeated sweeps, quota held through failed deletion, retry after reopening, scheduled cleanup, and a real native backend stop/start preserving Keep and removing overdue content.
- **Browser checks:** Created a kept note through the real local Gatekeeper, observed it in Kept, unkept it with a fresh 24-hour deadline, edited it to 10 minutes, and kept it again. A previous demo image also previews in Kept. Desktop, 360px/390px phone layouts, composer/details controls, and 720px reflow were checked without horizontal overflow; selects are 16px. A separate disposable in-memory preview with mocked gateway verification and cleanup paused demonstrated a short expiry closing the open details dialog and removing its card while kept content stayed available. Its expired API returned 410; that test server was stopped. Saved screenshots are in ignored `.local/previews/`.
- **Limits:** Browser sleep can delay visible removal until execution resumes; already copied/downloaded content and in-flight transfers cannot be recalled. Backups have separate retention. Other-device updates still require Refresh until milestone 5. Physical phones, PWA installation, and production deployment remain pending. No DNS, VPS, Caddy, or production gateway configuration changed.
- **Next prompt:** **"Implement milestone 5."** Stop here until Fabrice requests it.

### Milestone 5 — Complete, 2026-11-14

- **Delivered:** Protected same-origin `/api/events` with item-created/updated/deleted and storage invalidations after commits. Events contain IDs rather than private text, filenames, or bytes. Streams have 10-second heartbeats, a fixed 25-second lifetime, bounded connection count, slow-consumer disconnection, and shutdown/disconnect cleanup. New connections pass Gatekeeper and reconcile authoritative state rather than replaying content.
- **Browser behavior:** Live connection status, deduplication and burst coalescing, automatic feed/detail reconciliation, Keep/unkeep across views, preserved drafts, access probing on failure, exponential retry/backoff, offline/resume handling, and a silent-connection watchdog. Access denial stops streams/retries and clears private state. A generation guard prevents an older successful access probe from restoring a view after a newer denial.
- **Files:** Added `backend/events.js`, frontend `live-sync.js`, an HTTP event test client, and SSE/client-recovery tests. Updated stores, app/server lifecycle, feed, shell/styles, real-Gatekeeper tests, package test command, README, and PRD status. No dependencies or schema migration were needed.
- **Verified commands:** `npm run build`, `npm test` (62 passing checks), and `npm run test:gatekeeper` (one passing integration test). Coverage includes five clients, actual commits, text/files/storage, metadata minimization, origin/owner/auth boundaries, expiry cleanup, duplicates, reconnect state, backoff, watchdog, offline/resume, cancellation, heartbeat/deadline under traffic, slow clients, and shutdown. Actual independent Gatekeeper sessions exercise revocation/logout/expiry/outage with open streams.
- **Measurements:** Five real Gatekeeper sessions received create notifications within 93.6 ms maximum in the measured local run. Maximum stream lifetime was 25,081 ms despite ongoing traffic; revoked/logout reconnects returned 401. A browser save appeared in the receiving tab in 488 ms without Refresh. These measurements are local and do not establish VPS or physical-device performance.
- **Browser checks:** Two tabs through the real local gateway demonstrated create, Keep/unkeep, an updated open details dialog, and an unsent draft surviving incoming changes. A separate disposable in-memory preview with mocked verification demonstrated outage recovery/missed-item catch-up and complete removal of private composer/text/draft after denial. Its server was stopped. Desktop, 360px/390px phone widths, and 720px reflow had no horizontal overflow; status text is 14px. Saved proof is in ignored `.local/previews/`; the new demo note is kept.
- **Limits:** One backend process owns the memory-only notification hub; multi-worker deployment needs shared event delivery. Browser sleep/network/backoff can delay updates until reconnection/resume. Already displayed/downloaded content and in-flight transfers cannot be recalled. Full offline/PWA behavior, detailed storage settings, physical phones, and production proxy/runtime validation remain in later milestones. No deployment was performed.
- **Next prompt:** **"Implement milestone 6."** Stop here until Fabrice requests it.

### Milestone 6 — Complete, 2026-11-14

- **Delivered:** Standalone web app manifest, 192/512px and maskable icons, Apple touch icon, gated service-worker registration, install guidance, and an explicit Update & reload action. A build-generated, versioned allowlist caches only nine static shell assets in the current build. APIs, authentication responses, events, previews, downloads, mutations, and gateway redirects never enter the service-worker cache. No dependency or schema change was needed.
- **Offline and resume:** A cold offline launch shows the branded reconnect screen without item data or transfer controls. Cached code always performs a fresh authenticated access probe before opening private views. Known offline state clears private memory and the composer; online/page resume rechecks access and refreshes authoritative state. Transient startup failures retry with bounded backoff. Offline text/file submissions are rejected without sending, queuing, or reporting success. Unsent drafts are memory-only and are discarded on reload, offline view exit, or resume access reset.
- **Mobile:** Safe-area spacing, 44px touch controls, portrait/landscape navigation, scrollable dialogs with an accessible close toolbar, and VisualViewport-aware composer height/focused-field scrolling. Supporting text is at least 14px and inputs/selects are 16px in the inspected layouts.
- **Files:** Added `frontend/assets/pwa/`, `pwa.js`, `pwa.jsx`, `service-worker.js`, `scripts/pwa-build.js`, `scripts/generate-icons.js`, and `backend/test/pwa.test.js`. Extended Vite, the authenticated static route, frontend access/transfer handling, shell/styles, tests, README, and PRD status. Existing content and Gatekeeper configuration were preserved.
- **Verified commands:** `npm run build`; `npm test` (79 passing checks, including nested cases); `npm run test:gatekeeper` (one passing integration test). New coverage checks manifest/icons/versioning, exact cache contents, sequential body consumption, failed/redirected/wrong-type installation rollback, shell response markers, network-only private routes, offline mutations, cache cleanup, and explicit per-tab update activation. The real Gatekeeper test continues to cover independent sessions, logout/revocation/expiry/outage and bounded streams.
- **Browser checks:** The normal preview uses the real local Gatekeeper; its installed worker cache contained exactly nine safe static assets. A separate disposable in-memory preview with mocked verification passed cold offline reload with its HTTP listener stopped, automatic authenticated recovery, cached-shell denial without private content, and a waiting update followed by explicit activation and old-cache removal. Its registration/cache were cleared and server stopped. Desktop, 360px/390px portrait, 844×390 landscape, 720px reflow, and a 390×390 keyboard-space simulation were inspected without horizontal overflow. Copy/Unkeep targets measured 44px after the final build. Proof is in ignored `.local/previews/`.
- **Limits:** The embedded test browser did not offer a native install prompt. Physical Android/iOS installation, actual standalone launch, OS keyboard/sleep/resume, HTTPS proxy behavior, and deployment remain release checks. Viewport emulation does not establish those results. Browsers can evict static caches; online access is required to prepare them again. Already downloaded/copied content cannot be recalled. No DNS, VPS, Caddy, or production gateway configuration changed.
- **Next prompt:** **"Implement milestone 7."** Stop here until Fabrice requests it.

### Milestone 7 — Complete locally, 2026-11-14

- **Delivered:** Owner/expiry-scoped literal search across text and filenames, content-type and Void/Kept/both filters, stable newest/oldest pagination, clear/no-result feedback, detailed storage/limits/counts, and saved default expiration. Migration 4 preserves existing content and adds only content preferences. Default changes apply to new text/files without changing existing items or an open composer. Metadata-only `preferences.updated` invalidations refresh other clients. No new dependency was needed.
- **Errors/accessibility:** Retained network/auth/upload/clipboard/expired-item feedback and safe download fallback; failed previews now recheck availability and offer retry. Deletion removes the card before reconciliation and confirms completion across devices. Details remember their trigger before disabling it for the access check, restoring keyboard focus after close; deletion falls back to the main region when its trigger disappears.
- **Files:** Added `backend/preferences.js`, `backend/db/migrations/004-preferences.sql`, `shared/search.js`, `frontend/assets/js/settings.jsx`, and release tests. Extended database/app/file/item stores, events/client recovery, APIs, composer/feed/styles, migration/restart/real-Gatekeeper tests, README, and PRD tracking.
- **Verified commands:** `npm run build`; `npm test` (84 passing checks including nested cases); `npm run test:gatekeeper` (one passing integration test); `npm audit --json` (zero known vulnerabilities). Covered validation/injection/owner boundaries, strict/CSRF-protected preferences, default retention for text/files, statistics, migration from version 3, native restart persistence, five clients, and the existing authentication/quota/retention/files/cache/cleanup suite. The final browser build was audited for actual local credential values and temporary QA artifacts.
- **Measurements:** Five independently signed-in HTTP clients using real Gatekeeper and disposable data received notifications within 63.9 ms maximum. Text submission took 61.2 ms and retrieval 9.0 ms; maximum stream lifetime under traffic was 25,072.9 ms. These are measured local Windows/Node 22 checks, not production benchmarks.
- **Browser checks:** Actual local gateway preview passed text/filename search, empty states, filters, date ordering, saving/receiving defaults, unchanged open-composer choice, exact-whitespace copy, cross-tab receipt/deletion, keyboard dialog/cancel/skip/focus behavior, and final update activation. The disposable note was deleted and original 24-hour default/counts restored; existing content was preserved. Desktop, 360px/390px portrait, 844×390 landscape, and 720px reflow had no horizontal overflow. Settings text was at least 14px, fields 16px, and checked active text met computed contrast requirements. Final captured console errors/warnings were empty. Proof is in ignored `.local/previews/`.
- **Security/release review:** Server-only secrets, fixed owner, parameterized queries, private/generated file paths, safe headers, CSRF/CORS boundary, no private browser persistence, static-only cache, CSP, bounded SSE, and error-code-only application logging were reviewed. Data paths, quotas, consistent stopped-app backup expectations, API contracts, and runtime limits are documented. The native preview still refuses production startup; no VPS, DNS, Caddy, production gateway, commit/push, or deployment change was made.
- **Verification limits:** GUI tabs share a browser profile; independent sessions/transfers are verified by real-Gatekeeper HTTP clients. A native Chrome GUI attempt stopped because its URL could not be reliably identified, so independent browser-profile/cross-browser GUI coverage is still unverified. Physical phones, standalone installation, actual OS keyboard/sleep/resume, native 200% zoom/screen-reader behavior, production proxy isolation/logs, Docker persistence, and live backup/restore remain release checks. The 720px check is a reflow approximation, not native browser zoom. These limits do not represent passed PRD live acceptance.
- **Next prompt:** **"Implement milestone 8."** Stop here until Fabrice requests it. Milestone 8 prepares the VPS package; it does not deploy.

### Milestone 8 — Package prepared; awaiting host confirmation, 2026-11-14

- **Prepared:** Multi-stage Dockerfile for Vite/Nginx and Node 22; Compose project `cavvoid`, services `frontend_cavvoid:80` / `backend_cavvoid:3001`, required identifiable image tags, health/restart policies, no host ports, read-only roots, external `caddy_network` only on Nginx, an app-private internal backend network and whole-directory persistent data. Build-context exclusions and LF shell rules are included.
- **Production boundary:** Explicit HTTPS/trusted-ingress mode checks separate app proof in Nginx/Node and denies missing/forged admission. Gateway verification stays at Caddy, with its cookie/secret removed before CavVoid. Exact Host, fixed owner, CSRF, expiry and quota remain enforced. Local development still verifies with the actual local gateway. Production now requires explicit secure configuration and absolute persistent paths instead of unconditionally refusing startup.
- **Proxy/tooling:** Prepared path-preserving APIs, unbuffered SSE/uploads/downloads, aligned body limits, scoped SPA routes, manifest/worker/shell headers and privacy-conscious logging. Added only a CavVoid Caddy draft, a secret-preserving private runtime generator, read-only VPS inventory helper, stopped-volume backup instructions and an isolated SQLite/ledger/file-hash restore checker. Detailed familiar handoff and compatible image rollback are in `deploy/README.md`.
- **Verified locally:** `npm run build`, `npm test` (88 passing checks), `npm run test:gatekeeper` (one passing integration test), final targeted production/config/access checks, Compose YAML parsing/formatting, and syntax-only Git Bash checks for both shell scripts. No local Docker was probed or used. Real-gateway native measurements: text submit 235.5 ms/retrieve 57.5 ms; max five-session notification 236.7 ms; max stream 25,094.1 ms. These are not production-proxy measurements.
- **Host evidence:** Git remote `https://github.com/FabHaguma/cavvoid.git`; hostname supplied by Fabrice. Local shared-ingress Compose names `caddy_proxy` and a Caddyfile mounted at `/etc/caddy/Caddyfile`. Local OAuthenticator references `https://login.haguma.com`, `backend_gatekeeper:4000` and `haguma.com` cookie scope. These references do not confirm current live folders, imports, mounted file path, service/network/volume availability or actual gateway settings.
- **Required to finish milestone 8:** Chosen VPS checkout/SSH target; actual Caddy container and host/container config paths, including which shared file owns the site; actual gateway origin/upstream/checkout/env/Compose paths; and read-only service/network/volume conflict evidence. An input request was sent while preparation continued. Unresolved values are visibly marked in the draft, not presented as verified commands.
- **Pending on the VPS after a deployment request:** Image builds/Compose validation, Nginx and actual shared Caddy validation, proof/cookie/network isolation, HTTPS/DNS, data-volume ownership/recreation, backend DNS refresh, backup/restore runtime checks and physical devices. No production config, gateway registration, DNS, shared ingress, commit/push or deployment changed.
- **Handoff status:** Milestone 8 is **awaiting those host details**, not complete. Once confirmed and the exact handoff is finished, remind Fabrice: **"Milestone 8 complete. Tell me 'Deploy CavVoid — milestone 9' when you want the VPS rollout."** Do not start milestone 9 from this preparation request.

### VPS rollout progress — 2026-11-14

- Fabrice requested commit/push and began the guided VPS rollout. Release `acf3d78bc2d6864318a1a5c39326f9cc7e242d72` was pushed to `main`, cloned into `/home/fabrice/Projects/cavvoid`, and both images built successfully. The live inventory confirmed Caddy/Gatekeeper on `caddy_network`, with no CavVoid services before creation.
- Confirmed Caddy container/mount: `caddy_proxy`, `/home/fabrice/Projects/caddy/Caddyfile` → `/etc/caddy/Caddyfile`. Gateway checkout: `/home/fabrice/Projects/OAuthenticator`. The existing Gatekeeper app-list update passed native configuration validation in its image, and its backend returned healthy.
- Initial CavVoid startup created its scoped network/data volume. Backend logs showed normal server startup, but its health probe failed. Native reproduction showed Node fetch replacing the configured Host with loopback; the protected public-host guard returned an error to the probe. Switched to a bounded core-HTTP readiness script and added a production-guard regression test. No authentication bypass, volume reset or secret rotation is required. Application health through the corrected image and subsequent live/device acceptance remain pending.

### Shared Gatekeeper snippet correction — 2026-11-14

- Both `0dc131d` images became healthy on the VPS. The real Caddyfile validated, `caddy_proxy` restarted, and unauthenticated HTTPS navigation redirected to Gatekeeper. Signed-in access returned Nginx 403; the frontend served correctly with the old app-specific header.
- Fabrice explicitly requires the shared `gatekeeper_app` snippet used by his other private apps: `cavvoid.haguma.com { import gatekeeper_app frontend_cavvoid:80 }`. This supersedes milestone 8's separate app-proof design and its associated Caddy instructions. The pasted Gateway key was redacted, not a production credential.
- Removed app-secret generation/validation and the header requirement from production Node, Nginx, Compose and deployment examples. Optional settings migration removes the old field and preserves limits. The PRD and active handoff now use the shared snippet; the historical milestone records above describe earlier implementations.
- Production trusts the existing Caddy Gatekeeper boundary and trusted shared Docker ingress network. Only Nginx joins that network; the backend remains private with no host ports. Fixed-owner selection, exact Host, CSRF, safe file handling and bounded SSE remain. Local development still verifies against the real local Gatekeeper.
- Validation passed: 89 native checks, one real local Gatekeeper integration test (independent sessions, revocation, logout, expiry and outage), and frontend production build. Updated image runtime and signed-in live acceptance remain pending on the VPS; no local Docker was used.
