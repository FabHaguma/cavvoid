# CavVoid

Your private pocket between devices. **Drop it in. Pull it out.**

**Open:** [http://localhost:3000](http://localhost:3000) while the local demo is running.

**Try:** Drag a file onto CavVoid or paste a copied image to start uploading. Paste text or a link to open a draft, then select **Drop into Void** to save it. The local demo password is `ADMIN_PASSWORD` in the ignored `.local/gatekeeper.env` file.

**Next:** Deploy the [phone-picker fix](deploy/README.md) using the existing VPS update commands. Then close any unfinished composer, refresh CavVoid online, and accept **Update & reload** if offered. Choosing files inside CavVoid needs no installation or reinstall. Physical phone verification of the fix is pending.

Text, links, and private file transfers work through Gatekeeper, with live updates, search, filters, storage settings, details, deletion, and pages of 30 drops. The initial default expiration is 24 hours; save another default or choose 10 minutes, 1 hour, 24 hours, 7 days, or Keep for each drop. Expired drops are denied immediately, with cleanup at startup and every 30 seconds. Limits initially are 100 KB text, 100 MB per file, and 2 GB file storage, including reservations and pending physical deletions. Refresh remains available as a manual fallback. The responsive PWA and offline shell work locally; physical phone installation and standalone launch remain [release checks](IMPLEMENTATION_PLAN.md).

**Production hostname:** [cavvoid.haguma.com](https://cavvoid.haguma.com), supplied by Fabrice with DNS registration reported. This is still a loopback-only local preview; DNS resolution, HTTPS routing, gateway registration, and deployment have not been verified or changed here.

## Run locally

Prerequisites: Node.js **22.15 or later**, npm, and the existing OAuthenticator repository with its backend dependencies installed and frontend built. The default source location is `../../Dockered/OAuthenticator` relative to this repository. The setup uses Gatekeeper's actual server and UI with a separate local database; it does not change that repository's `.env`, registered apps, or sessions.

On the laptop, in `C:\Users\Fabrice\My_Documents\Programming\NodeJs\cavvoid`:

```powershell
npm ci
npm run setup:local
npm run dev
```

Run setup once. It creates ignored `.env` and `.local/gatekeeper.env` files with random local credentials and registers only this isolated demo. Existing settings are preserved if setup is run again. Once set up, **`npm run dev` is the only start command**: it starts Gatekeeper at port 4000, builds/watches the frontend, and starts CavVoid at port 3000. Keep the terminal open; use Ctrl+C to stop the owned processes. Frontend changes rebuild automatically; refresh online and select **Update & reload** when offered to activate the new offline assets. Close the composer first. Backend changes restart automatically.

If OAuthenticator is elsewhere:

```powershell
npm run setup:local -- --gatekeeper-repo "C:\path\to\OAuthenticator"
```

If ports 3000/4000 are occupied, stop your previous demo or change `APP_ORIGIN` / `GATEKEEPER_URL` in `.env` and the matching `PORT`, `GATEKEEPER_URL`, and `PROTECTED_APPS` in `.local/gatekeeper.env`. Use **localhost consistently** in the browser. Cookies for `localhost` and `127.0.0.1` are different. The demo credentials are for this machine only, not the VPS.

## Use an already-running local Gatekeeper

For a local gateway you already manage, copy `.env.example` to `.env`, set `GATEKEEPER_PROXY_SECRET` to that gateway's `PROXY_AUTH_SECRET`, and leave `LOCAL_GATEKEEPER_REPO` empty. Both origins must be different `http://localhost:<port>` URLs. The existing local Gatekeeper must allow the exact CavVoid origin in `PROTECTED_APPS`:

```json
{"id":"cavvoid","name":"CavVoid","url":"http://localhost:3000"}
```

Append this entry to its current JSON array without replacing other apps. Keep the local `COOKIE_DOMAIN` blank. Restart that local gateway to apply its configuration, then run `npm run dev` here. Do not point development tests at the VPS.

## What authentication does

In local development, network requests for CavVoid pages, static assets, and private API routes go through a server-side call to Gatekeeper's private `/auth/verify`. Signed-out browser navigation opens Gatekeeper and preserves the requested safe URL. APIs return `401` rather than login HTML. Incorrect gateway responses, timeouts, or an unavailable gateway deny access. A previously prepared service worker can serve only static shell assets without a connection; opening private views still requires a fresh authenticated API check.

CavVoid selects one fixed content owner on the server. It has no password form, password database, session-token database, OAuth client, or JWT flow. Caller-supplied owner/forwarding headers do not grant access. Settings opens Gatekeeper's own dashboard for logout and session revocation, with a reminder that these actions also affect other apps using that session.

Every API mutation must pass the common exact-Origin and `X-CavVoid-Request: 1` checks, including multipart uploads. `/health` exposes only database readiness, with no identity/content; development binds to loopback, and the prepared production topology keeps it on the backend-private network. Public Nginx `/health` returns 404. Cross-origin access is not enabled.

Production uses the existing shared Caddy `gatekeeper_app` snippet. Caddy checks Gatekeeper before every public request; Nginx/Node require no extra app secret or authentication header. The shared Docker ingress network is trusted, and only Nginx joins it; Node stays on the app-private network with no published host port. Explicit `AUTH_MODE=trusted-ingress`, HTTPS origins and absolute persistent paths remain required. Startup rejects local gateway credentials; the proxy strips gateway cookies/key headers and the app ignores client identity assertions. Local development retains direct native Gatekeeper verification. See the [deployment instructions](deploy/README.md).

## Data and commands

- `frontend/`: React interface; source styles, JavaScript, and the logo are in `frontend/assets/`. Edit [theme.css](frontend/assets/css/theme.css) to change the app's palette. Vite generates the ignored `frontend/dist/`.
- `backend/`: Express entry point, gateway boundary, and versioned SQLite migration. `DATABASE_PATH` defaults to the ignored `backend/data/cavvoid.sqlite`, outside the public frontend.
- `.local/`: isolated Gatekeeper database and credentials, ignored by Git. Its account/session data belongs to Gatekeeper; CavVoid never reads or modifies that database.
- `scripts/`: native setup and local launcher. Gatekeeper source is reused from its existing checkout rather than copied into CavVoid.
- `integration/`: tests against that real gateway implementation, using disposable data.
- `shared/text.js`: shared UTF-8 size checks and safe HTTP(S) link parsing, with no remote link previews or URL fetching.

The content database uses UTC timestamps, WAL, foreign keys, a busy timeout, and `PRAGMA user_version` migrations. Initialization creates only the fixed owner, with no password/session columns. Preserve database directories when restarting. A consistent SQLite backup must include committed WAL state; copying only an active `.sqlite` file is insufficient. Full backup/restore and hosting instructions arrive with deployment preparation.

```powershell
npm run build             # Build the browser interface
npm start                 # Serve the built app; local Gatekeeper must already be running
npm test                  # Data, auth, clipboard boundaries, migration, and restart checks
npm run test:gatekeeper   # Real Gatekeeper integration using disposable databases
```

The project uses Node's built-in SQLite API. Node 22.15 prints an experimental SQLite warning; it is expected on that runtime. See the [version-matched Node documentation](https://nodejs.org/download/release/v22.15.0/docs/api/sqlite.html). No local Docker or separate database service is required.

## Text transfers and API

`MAX_TEXT_BYTES` in `.env` defaults to `102400` (100 × 1024 bytes). Restart the backend after changing it. The composer gets the actual limit from `/api/auth/me`; the server enforces decoded UTF-8 size, including multibyte characters, independently of the browser. Line breaks, indentation, and trailing spaces are stored as entered. Only explicit HTTP(S) URLs become clickable; markup and unsafe schemes stay text, and preview links keep their full destination even when their visible text is shortened.

The composer disables repeat submits while saving. A fresh UUID `submissionId` identifies each draft; retries of unchanged text reuse that ID and return the existing active item without extending its expiry. Editing the draft starts a new submission. This duplicate protection applies while the original item exists; it is not a permanent submission ledger after deletion.

All routes below require gateway approval; POST/PATCH/DELETE also require the exact configured CavVoid Origin and `X-CavVoid-Request: 1`.

| Method | Route | Behavior |
|---|---|---|
| GET | `/api/items?page=1&limit=30&section=void` | Owner-scoped search, type/section filtering and sorting; page size is 1–100; see query options below |
| GET | `/api/events` | Protected same-origin SSE notifications; reconnect and fetch current items rather than replaying old content |
| POST | `/api/items/text` | JSON `{ "text": "your note", "submissionId": "a UUID", "retention": "24h" }`; retention is optional; `201` for a new item, `200` for an unchanged retry |
| GET | `/api/items/:id` | Full current drop and metadata; `410` if expired, `404` if missing/deleted |
| PATCH | `/api/items/:id` | JSON `{ "retention": "10m" }`; update an active text, link, or file; returns `{ item }` |
| DELETE | `/api/items/:id` | Delete an active text/link/file drop; `204` after logical removal |

List responses include `items`, `page`, `limit`, `total`, `totalPages`, and UTC `serverTime`. Item responses contain `id`, `type`, exact `text`, safe `url` or null, `createdAt`, `updatedAt`, `expiresAt`, and `isKept`. Clients choose a supported retention value; ownership, timestamps, and type remain server-controlled. Invalid input returns `400`, unsupported body type `415`, oversized text `413`, and a reused submission ID with changed text `409`.

Expiry is enforced in listing, details, retry, PATCH, and delete access independently of cleanup. Active deletion removes the text record immediately. Copy checks availability again before accessing the clipboard. If clipboard access is denied/unavailable, full text and a Select text action provide the manual fallback. Paste text or a link from the main screen or either composer tab. Review the draft and choose **Drop into Void** to save it.

Migration `002-items.sql` upgrades the milestone 1 database without replacing its owner. Tests cover migration from version 1, reopening content, and stopping/restarting a real native backend process. No credentials or private drafts are stored in browser storage.

## File transfers and storage

Drag files onto the main CavVoid screen or anywhere in the open composer to start uploading immediately. Pasting a copied image also starts an upload. Files selected with **Choose files** or received through Android Share can be reviewed before selecting **Upload files**. Multiple files become separate drops; two uploads run at a time, with individual progress, cancellation, and retry states. A retry uses the same upload ID to check an already-completed transfer without creating another copy.

On a phone, open CavVoid online and sign in, then:

1. Tap **New drop → Files & media → Choose files**.
2. Select a photo or file in the phone's picker and confirm with its **Done**, **Select**, or equivalent action if shown. CavVoid should keep the composer open and show the filename with **Ready to upload**. Cancelling the picker keeps any files already selected.
3. Scroll inside the composer if needed, tap **Upload files**, and wait for **Uploaded** and the completion message before tapping **Done**.

This works in the browser and in the installed app. Installation is only needed for the separate [Android Share → CavVoid workflow](#android-share-menu). Returning from a picker used to clear the entire composer; that was an app bug, independent of installation.

`MAX_FILE_BYTES` defaults to `104857600` (100 MB), and `STORAGE_QUOTA_BYTES` to `2147483648` (2 GB). `FILES_PATH` defaults to `files/` beside the configured content database, normally `backend/data/files/`. All must stay outside the frontend. Existing `.env` files can omit these settings to use the defaults. Restart the backend after changing them.

| Method | Route | Behavior |
|---|---|---|
| POST | `/api/items/file` | One multipart `file` part; exact Origin, `X-CavVoid-Request: 1`, `X-File-Size` in bytes, and UUID `X-Upload-Id` are required; omitted `X-Retention` uses the saved default |
| GET | `/api/items/:id/download` | Authorized attachment with the original safe filename; byte ranges are supported |
| GET | `/api/items/:id/preview` | Authorized, byte-detected image/audio content; unsupported/active formats return `415` |
| GET | `/api/storage` | File bytes used/reserved/pending deletion, quota, and upload limit |

File item JSON adds `file: { name, mimeType, size, sha256, previewKind }`. Valid filename basenames, including Unicode, are retained; path components/control characters are sanitized. Physical names are generated UUIDs rather than uploaded filenames. Client MIME labels are ignored. PNG/JPEG/GIF/WebP and supported MP3/WAV/OGG/MP4 audio can preview; PDFs, HTML, SVG, and other file types download as attachments. PDF download is the current safe preview fallback. Every preview, download, and range request rechecks gateway approval, ownership, and expiry.

SQLite reserves the declared file size before streaming and validates the actual byte count before publishing an item. Quota checks and reservations happen in one transaction, including across database connections. Progress stays below 100% until the server confirms a completed item. Files stream into private temporary storage and are renamed only after completion; metadata and the ready-state ledger are committed together.

The `file_objects` ledger charges uploading, stored, and pending-deletion bytes. Deleting an active file removes its item/access immediately; failed physical deletion is retried with backoff and keeps quota charged until the bytes are removed. Uploads renew a three-minute lease while data flows. Cancelled/interrupted uploads are cleaned promptly; a crashed upload is swept after its lease expires (checked at startup and every 30 seconds). Recognizable orphan files are recovered into deletion bookkeeping. Expired files follow the same durable deletion path and remain charged until physical removal succeeds.

For a consistent simple local backup, stop CavVoid and preserve the full database and private file directories together, including configured custom paths. Do not copy only an active main SQLite file or discard the physical-storage ledger. The [VPS handoff](deploy/README.md#data-backup-and-rollback) includes stopped-volume backups and an isolated restore procedure. No local Docker is required.

The streaming parser follows [Busboy's documented multipart limits and error events](https://github.com/mscdex/busboy#api), with Node streams for bounded buffering.

## Retention and cleanup

Use `10m`, `1h`, `24h`, `7d`, or `keep` for the text `retention` property, file `X-Retention` header, and PATCH `retention` property. Missing creation choices use the owner's saved default, initially `24h`; PATCH requires exactly one explicit retention property. All deadlines are calculated as UTC durations on the server. File lifetime starts at completed upload, not at selection or first byte. A batch uses the chosen policy for each file; retries preserve each file's original choice and do not extend an existing item's deadline or override later retention edits.

Keep sets `isKept: true` and `expiresAt: null` on the original item. The Kept view lists those items separately without copying the file or charging extra quota. Unkeep applies `24h` from the server's current time, independently of the saved creation default. Applying another duration also starts at the time of the update; applying a duration to a kept item returns it to Void. The item's ID, original creation time, content, and file bytes stay the same.

At `expiresAt <= server time`, list/details/preview/download/range/retry/mutation checks deny access. An expired item cannot be kept or extended. Before cleanup, direct access returns `410`; after removal it returns `404`. The current feed uses server time to remove expired cards and close their details/confirmation dialogs without waiting for the cleanup worker. Browser suspension can delay visual updates until execution resumes. A transfer already in progress or content already copied/downloaded cannot be recalled.

Startup and a 30-second worker sweep expired records. A write transaction selects only unkept, expired items, queues file deletion in `file_objects`, and removes the item and its metadata. Keep/PATCH takes the same write lock, so a committed Keep is preserved. Physical unlink happens afterward; failures retain quota and persist retry attempts, an errno, and exponential backoff from 30 seconds up to 30 minutes. Restart resumes that bookkeeping. Kept items have no automatic deletion. Cleanup affects active app storage; copies, backups, OS/browser artifacts, and already-downloaded files have their own retention. No new schema migration is needed beyond version 3's existing retention fields and deletion ledger.

## Live synchronization

`GET /api/events` verifies Gatekeeper before opening a stream. It sends `item.created`, `item.updated`, and `item.deleted` with only `{ id }`, plus `storage.updated` and `preferences.updated` with `{}`. Notifications are sent after committed changes, including file reservations/completion/deletion, cleanup, and saved defaults. Text, filenames, file bytes, preference values, credentials, and cookies stay out of events. Reads still pass through the protected APIs. Caller-supplied identity does not change the owner, and cross-origin stream requests are denied.

Each connection starts with `sync.ready` and closes after 25 seconds, even under continuous event traffic. Comment heartbeats run every 10 seconds. The client closes EventSource before retrying, probes `/api/auth/me`, and reconnects through Gatekeeper; `401`/`403` stops automatic reconnection and clears the private interface and drafts. Leaving for sign-out/pagehide closes the stream and cancels pending retries. A late successful sign-in probe cannot restore a view after a newer access denial.

Every connection and page resume fetches authoritative state, including any open details/deletion dialog. Event IDs combine a process UUID and sequence number. The browser deduplicates the last 256 IDs and coalesces notifications for 80 ms; list results remain authoritative, so duplicate or missed notifications cannot create duplicate cards. Local drafts and dialogs stay mounted through ordinary feed updates. Expiration also uses each client's server-adjusted timer, independently of the cleanup notification.

Network/gateway failure shows a reconnecting state and retries with exponential backoff of about 1–30 seconds plus small jitter. Known offline state pauses streams/retries and clears the private view until online/resume. A watchdog recovers a silent transport. Previously displayed content can remain visible during an undetected connection failure, but all new API access still requires gateway approval. Reconnection reconciles missed changes. Settings refreshes storage and saved defaults on live invalidations; an already-open composer keeps its chosen expiration.

The hub is memory-only and scoped to one backend process. It keeps no event/content replay log; `Last-Event-ID` does not request historical data. Backend restarts reconnect to fresh state. Run one CavVoid backend instance; multiple workers would need shared event delivery before scaling. Slow consumers are disconnected on write backpressure instead of accumulating a queue, and there is a cap of 100 open streams per process. Browser suspension can delay visible updates until resume; downloaded/copied content and in-flight transfers cannot be recalled. Production proxy/SSE validation remains a deployment check.

The stream format follows the [HTML EventSource standard](https://html.spec.whatwg.org/multipage/server-sent-events.html), and backpressure follows the pinned [Node 22 HTTP response API](https://nodejs.org/download/release/v22.15.0/docs/api/http.html#responsewritechunk-encoding-callback).

## Mobile PWA and offline launch

Open CavVoid online and sign in once to prepare its static shell. **Settings → CavVoid on this device** reports readiness. When available, **Install app** opens the browser's own installation prompt. On iPhone/iPad, open the HTTPS release in Safari, choose **Share → Add to Home Screen**, and enable **Open as Web App** if offered; see [Apple's instructions](https://support.apple.com/guide/iphone/bookmark-a-website-iph42ab2f3a7/27/ios/27). Installation depends on the browser; the embedded local preview did not offer a native install prompt. Localhost is a development exception; production requires HTTPS. Physical phone installation is still pending.

The [manifest](frontend/assets/pwa/manifest.webmanifest) defines a stable app ID/start URL, standalone mode, unrestricted orientation, dark theme, and 192px/512px/maskable/Apple icons derived from the existing logo. Regenerate PNGs with `node scripts/generate-icons.js` after changing that logo's geometry. The manifest follows the [Web App Manifest standard](https://www.w3.org/TR/appmanifest/).

The build emits a versioned service worker and a content-free `pwa-shell.html`. Only its explicit allowlist is cached: current JS, CSS, logo, manifest, four icons, and the shell (nine entries in this build). Installation requires successful same-origin, nonredirected responses with the expected MIME types and a server marker for the shell. Any failed/denied/redirected asset aborts installation and removes its incomplete cache. Installation requests consume each response body before requesting the next asset and have a 20-second abort deadline. Existing HTTP authentication errors are preserved. APIs, authentication pages, SSE, uploads, previews, downloads/ranges, and unknown/query asset paths stay network-only; private responses never become shell fallbacks. The behavior uses the [Service Worker standard](https://w3c.github.io/ServiceWorker/#fetch-event).

A cold offline launch displays **Your Void is offline** with a reconnect action and no cached drops. The app always checks `/api/auth/me` before initially showing private views, including from a cached shell. Known offline state and navigation away clear the private interface, selected files, and composer. Returning from a file picker or refocusing the current page rechecks access while retaining the open composer, chosen files, unsent text, and expiration choice; a failed access check still clears the private view. Cancelled or superseded checks cannot overwrite the latest access result. Transient startup network/gateway failures retry from 5 seconds up to 30 seconds, and online/focus/resume triggers another check. Offline text/file submissions are rejected without sending, queuing, or reporting completion. Manual drafts are memory-only and discarded on reload or when the private view is cleared; incoming Android shares use the limited handoff described below until opened in the composer. Previously copied/downloaded files cannot be recalled.

Updates wait until **Update & reload** is selected; it is disabled while the composer is open. Only the requesting window reloads automatically. Activation removes older CavVoid shell caches, leaving other applications' caches alone. The browser may evict shell storage, in which case online access is needed to prepare it again. Server items and credentials are never written to localStorage, IndexedDB, or service-worker caches. Only incoming, unsent Android shares use temporary IndexedDB storage; private server responses remain network-only.

Mobile layouts include 44px touch controls, safe-area insets, portrait/landscape navigation, and scrollable dialogs with a sticky close toolbar. Composer height follows the visual viewport and scrolls the focused field into view as available height changes. Actual OS keyboard and sleep/resume behavior must still be checked on physical devices.

Phone-picker fix verification: **100 automated checks**, the production build, and the real local Gatekeeper integration test pass. Before the fix, a Chrome reproduction lost the composer after a visibility/focus return; the same sequence now keeps it open and completes the image upload. Local Chrome checks at 360×740, 390×844, 844×390, and 1440×1000 cover selection, cancellation, return events before/after selection, retained text/expiration, explicit upload, byte-exact image preview/download, and removal of the composer after session denial. The Upload button was reachable without horizontal overflow; no page errors occurred. These browser checks use simulated phone lifecycle events and mocked Gatekeeper approval with the real disposable upload backend; the separate integration test exercises independent real Gatekeeper sessions. Physical Android/iOS picker behavior and the deployed update remain unverified.

## Android Share menu

After deploying this release, open `https://cavvoid.haguma.com` in **Chrome on Android**, sign in, then use **Install app** from Chrome's menu or CavVoid Settings. Open another app, choose **Share → CavVoid**, review the prefilled **Drop** composer and choose **Drop into Void** or **Upload files**. This requires an installed PWA, as described in [Chrome's Web Share Target guide](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target). A bookmarked shortcut alone does not register a share target. If an older installation does not appear after the update, remove that installed app and install it again from Chrome so Android receives the new manifest. Server drops remain on the VPS.

The manifest accepts text, links, photos and files using a multipart POST to `/share-target`. Its service worker receives the input locally and redirects to the existing gated `/` page with only an opaque draft ID; shared content never appears in the URL or Gatekeeper return URL. After the normal access check, the app consumes the draft once and opens the composer. An expired session can return through Gatekeeper before the draft is read. From a cached signed-out shell, **Sign in** reopens the current protected page, preserving the handoff ID. Uploads use the existing authenticated APIs and CSRF checks, with your saved expiration default and normal file/quota limits. Android Share drafts require confirmation and upload only while online.

Receipt accepts up to 10 files totaling 100 MB and up to 100 KB UTF-8 text. The temporary store holds at most five pending shares, totaling about 200 MB. Shares expire after 10 minutes; expired bytes are removed on the next receipt/app launch, and a claimed draft is deleted immediately. If the browser evicts storage, the share expires, or storage is full, the app explains how to share again. Once the composer opens, ordinary in-memory draft rules apply. Mixed text/file shares use separate tabs; sending text retains the file queue, including files already sent.

Verification: **97 native checks** and the production build passed. Isolated real Chrome sessions received multipart shares through the built worker, restored a link and file in the composer, and submitted both to a disposable local backend. At 390×844 and 1440×1000 there was no horizontal overflow or page error; supporting dialog text/controls measured at least 14px. That browser fixture mocks authentication and does not establish physical Android installation, OS share-picker behavior, or live Gatekeeper acceptance. Android is the requested target; iOS still uses copy/paste or file selection.

## Search and settings

Enter text or a filename in **Find a drop**, then press Enter or **Search**. **Look in** selects Void, Kept, or both; **Content type** selects text, links, all files, images, audio, or other files. Images/audio use the supported detected preview types; PDFs and other download-only formats are other files. Choose newest or oldest first. Filters reset pagination to page 1; **Clear filters** returns to the current navigation section. Empty results show a specific message. Search terms stay in page memory rather than the browser address/history; the authenticated API request still carries the query.

`GET /api/items` accepts `q` (up to 200 characters), `type=all|text|link|file|image|audio|document`, `section=void|kept|all`, `sort=newest|oldest`, `page` (1–1000000), and `limit` (1–100, default 30). Defaults are Void, all types, newest first, page 1. Search uses literal substrings, so `%` and `_` are ordinary characters, with SQLite's built-in ASCII case-insensitive comparison; non-ASCII case variants are not folded. SQL values are bound and sort/type options are allowlisted. Owner and expiry checks apply before searching/counting. Pagination has a stable creation-time/ID order but is not a frozen snapshot during concurrent changes.

Settings shows charged file bytes, upload reservations, pending physical deletion, quota, file/text limits, and active total/Void/Kept item counts. Counts exclude expired records even before cleanup; bytes awaiting physical cleanup stay charged. Text lives in SQLite and does not consume the file-byte quota. Limits are server configuration, not browser-editable quota controls.

| Method | Route | Result |
|---|---|---|
| GET | `/api/storage` | `usedBytes`, `reservedBytes`, `pendingDeletionBytes`, `quotaBytes`, `maxFileBytes`, `maxTextBytes`, `counts: { total, temporary, kept }` |
| GET | `/api/preferences` | `{ "defaultExpiration": "24h" }` or the owner's saved choice |
| PATCH | `/api/preferences` | Exactly `{ "defaultExpiration": "10m" }`, `1h`, `24h`, `7d`, or `keep`; JSON, exact Origin and mutation header required |

Migration `004-preferences.sql` adds owner-scoped defaults and upgrades existing content in place. Preferences survive reopening and a native backend restart. Omitting retention on text/file creation uses that saved default; an explicit choice overrides it. Changing the default leaves existing drops, retries, and an open composer's selection intact. New composers pick up saved choices from other connected clients. Gatekeeper remains the device/session dashboard; no second authentication system or light theme was added.

## Local release checks — milestone 7

This record describes milestone 7 at completion. Current deployment preparation and production-mode limits are below.

`npm run build`, `npm test` (**84 passing checks**, including nested cases), and `npm run test:gatekeeper` (**one passing integration test**) passed: **85 checks total**. `npm audit --json` reported zero known dependency vulnerabilities. New checks cover combined literal text/filename search, type/section/sort filters, stable filtered pages, owner/expiry enforcement, malformed and injected query parameters, authenticated statistics/preferences, CSRF and strict preference validation, default application to text/files, metadata-only preference events, migration from version 3, and restart persistence. The existing quota races, interrupted uploads, disk-full/finalization errors, cleanup retries, cache isolation, auth boundaries, clipboard fallback, and bounded SSE checks remain passing.

Against five independently signed-in HTTP clients using actual Gatekeeper code and disposable data, maximum notification delivery was **63.9 ms**; text submission was **61.2 ms**, retrieval **9.0 ms**, and maximum stream lifetime **25,072.9 ms** under ongoing traffic. These measured local Windows/Node 22 results meet the local one-second text/two-second event targets; they do not establish VPS or physical-device performance.

Browser checks through the real local gateway covered text/filename search, empty-result feedback, type/section filters, oldest-first ordering, saving a one-hour default, its use by a new composer, preserving that composer's choice after a remote default change, and restoring the original 24-hour default. A disposable note appeared in another tab without Refresh, copied with exact whitespace, and disappeared from both tabs after confirmation. Existing content and storage counts were preserved. Keyboard checks covered Enter, Escape, Skip to content, cancellation, return to the details trigger, and focus on main content when deletion removes the trigger. The details access check initially lost focus while disabling its button; this was corrected and verified in the browser. Failed previews recheck item access and provide a retry/error message; unsupported formats retain safe download guidance.

Desktop, 360px/390px portrait, 844×390 landscape, and 720px reflow were checked without horizontal overflow. Settings text was at least 14px, inputs/selects 16px, and the checked active text passed the computed 4.5:1 contrast check; the decorative breadcrumb slash is excluded. The final preview had no captured console errors/warnings. Screenshots are in ignored `.local/previews/milestone-7-*.png`. Reflow at 720px approximates a 1440px desktop at 200% zoom; native browser zoom and a screen reader were not separately exercised.

Security review confirmed server-side gateway credentials, fixed ownership, parameterized queries, private file paths and generated blob names, safe filename/download headers, same-origin/CSRF checks, no private browser persistence, explicit static-only shell caching, and CSP without unsafe inline/eval scripts. Worker/manifest sources are explicitly restricted to self. CavVoid request/cleanup logs record error codes/names rather than item text, filenames, queries, cookies, or credentials. Production proxy/access logs still need review on the VPS. The final build was checked for actual local credential values and temporary QA artifacts.

GUI checks used separate tabs sharing one browser profile. Independent session isolation and transfers were checked by real-Gatekeeper HTTP clients, not by separate browser profiles. The attempted native Chrome GUI check stopped because its current URL could not be reliably identified; independent browser-profile/cross-browser GUI checks remain unverified. Physical Android/iOS transfer, install/standalone launch, keyboard and sleep/resume, actual 200% browser zoom, production HTTPS/Caddy isolation and direct-port bypass checks, container persistence, and live backup/restore remain release checks. The PRD's live acceptance boxes remain pending. Production startup was disabled at milestone 7; milestone 8 added the explicitly configured ingress mode. Deployment started afterward; see the current rollout status below.

## Deployment preparation — milestone 8, awaiting host confirmation

Open [deploy/README.md](deploy/README.md) for known facts and missing host identifiers, the scoped CavVoid Caddy draft, GitHub → SSH → pull/build workflow, gateway registration, proxy/health checks, backup/restore and compatible image rollback. The package includes Docker/Nginx/Compose files, build-context exclusions, a private runtime generator, an environment example and a read-only VPS inventory helper. Selected upstreams are `frontend_cavvoid:80` and `backend_cavvoid:3001`; their live availability remains unverified. No host ports are published. The whole `/data` directory persists on `cavvoid_cavvoid_data`.

The original package passed 88 native checks, one real local Gatekeeper integration test and the frontend build. The readiness correction added one native regression check. The shared-snippet update replaces extra-proof admission tests with the actual production contract: no app credential required, fixed server-selected owner, preserved Host/CSRF/stream checks, and automatic removal of obsolete secrets from optional settings. Docker runtime checks run on the VPS, never the laptop.

After the shared-snippet change, all **89 native checks**, the **real local Gatekeeper integration test** and `npm run build` passed. Updated signed-in VPS acceptance remains pending.

`scripts/prepare-production.js` is now an optional settings helper: it preserves limits, updates the release tag and removes the obsolete app secret. Normal releases need only Git pull and Compose build/up, with an identifiable `CAVVOID_RELEASE`; the verified login origin and limits have defaults. `scripts/verify-data.js` still checks an isolated stopped restore read-only without migrations or private content output. VPS paths, initial image builds/health, Caddy validation and the signed-out HTTPS redirect are confirmed. Updated signed-in behavior, persistence/backup and physical-device acceptance remain pending. See the [current deployment status](deploy/README.md).

## Verification for milestone 6

This record describes milestone 6 at completion; current release checks are above.

`npm run build`, `npm test` (**79 passing checks**, including nested cases), and `npm run test:gatekeeper` (**one passing integration test**) pass: **80 checks total**. New tests exercise manifest/icons/version changes, the cache allowlist, bounded response consumption, failed installation rollback, redirected/login/wrong-origin/wrong-type responses, authenticated shell markers, network-only private routes, offline text/file rejection, obsolete-cache cleanup, and explicit per-window update reloads. Real Gatekeeper sessions still cover logout, revocation, expiry, and outage with active streams; the measured five-client notification maximum was 50.9 ms and longest stream 25,090.8 ms in this local run.

The normal browser preview uses the real local Gatekeeper; its cache audit showed exactly nine safe static entries. A disposable in-memory preview with mocked verification passed a cold reload while its HTTP listener was stopped, showed no item data, recovered automatically after the listener returned, denied a cached shell fresh private access, and activated a waiting update only after the explicit action. Old-version cache removal was checked, then the fixture registration/cache were removed and its server stopped. These lifecycle checks do not substitute for real production authentication or physical devices.

Desktop, 360px/390px portrait, 844×390 landscape, 720px reflow, text/file composers, and a 390×390 reduced-height keyboard simulation were inspected without horizontal overflow. Final Copy/Unkeep controls measured 44px; supporting text was at least 14px and inputs/selects 16px. Screenshots are in ignored `.local/previews/`, including `milestone-6-offline-phone.png` and `milestone-6-settings-phone.png`. Existing drops were preserved. Native install/standalone launch, actual phone keyboard/sleep/resume, HTTPS/VPS/proxy integration, and deployment remain unverified; no production configuration changed.

## Verification for milestone 5

This record describes milestone 5 at completion; current PWA behavior is documented above.

`npm run build`, `npm test` (62 passing checks), and `npm run test:gatekeeper` (one passing integration test) pass. Tests cover five concurrent clients, committed text/file/retention/deletion/storage events, metadata-only frames, owner isolation, unauthorized/cross-origin denial, duplicate events, missed changes, heartbeat/deadline behavior under traffic, slow/disconnected consumers, shutdown, network/gateway outage, backoff, watchdog recovery, offline/resume, pending-probe cancellation, and stopped reconnects after access denial. A browser timer-binding regression found during UI checks has targeted coverage.

Five independently signed-in real Gatekeeper clients received a create notification within **93.6 ms** maximum in the measured local run. Their longest stream lasted **25,081 ms** under continuous event traffic; revoked/logged-out reconnects returned `401`, expired access was denied, and new streams during gateway outage returned `503`. These are local HTTP delivery/lifetime measurements, not VPS or physical-device results.

In two actual browser tabs using the real local gateway, a saved note appeared in the receiving tab in **488 ms** without Refresh. Keep updated an already-open details dialog, Unkeep returned the note to Void, and incoming updates preserved an unsent draft. A separate disposable in-memory preview with mocked gateway verification demonstrated outage/reconnect catch-up and session-denial removal of the private composer, note text, and draft; that server was stopped. Desktop, 360px/390px phone widths, and 720px reflow were checked without horizontal overflow; status text is 14px. The milestone 5 demo note is in Kept; existing notes are preserved. Physical phones, PWA installation/offline launch, and production deployment remain pending.

## Verification for milestone 4

The records below describe each earlier milestone's state at completion.

`npm run build`, `npm test` (48 passing checks), and `npm run test:gatekeeper` (one passing integration test) pass. Controlled-time tests cover all policies, UTC/midnight boundaries, exact expiry with cleanup paused, denied expired PATCH/Keep/ranges, unkeep, unchanged file/hash/quota, concurrent uploads and cleanup, two database connections, repeated sweeps, quota rejection during failed unlink, successful retry after reopening, scheduled startup cleanup, and a native backend process restart. Real Gatekeeper sessions observe each other's Keep/unkeep changes through the protected API.

Browser checks cover creation with Keep, the Kept view, unkeep to a fresh 24 hours, changing an existing deadline to 10 minutes, kept image preview, and text/file composer retention controls. A separate in-memory fixture with a mocked gateway and cleanup paused verified automatic card removal and closing an open details dialog at a short test deadline; the kept fixture remained available. That fixture was stopped afterward. The normal preview uses the real local Gatekeeper. Desktop, 360px/390px phone layouts, and 720px reflow have no horizontal overflow; selects are 16px. Physical phones and production deployment remain unverified. Existing user notes were preserved; the milestone 4 demo note and previous demo image are in Kept.

## Verification for milestone 3

The records below describe each earlier milestone's state at completion.

The frontend build, 39 backend/browser-boundary checks, and one real-Gatekeeper integration test pass. Checks include safe attachment headers, filenames/path traversal, byte-exact image/audio/document transfers, ranges, expired/signed-out access, size limits, multipart errors, cancellation, quota races across database connections, disk-full writes, failed finalization/deletion, durable retries, stale/orphan recovery, and files surviving a native backend restart. Upload progress does not report completion on server failure or cancellation.

In the actual browser, four files were selected together and each reached confirmed 100% completion. The PNG preview loaded, the MP3 played, and a PDF downloaded with its original filename and matched all source bytes. Desktop and 360px/390px phone layouts are checked. Browser picker/multiple selection is verified; native OS drag-and-drop and physical phone picker behavior were not separately exercised. The real-Gatekeeper test covers file transfers between independent signed-in sessions. The demo files are disposable local fixtures; existing notes were preserved. No production changes were made.

## Verification for milestone 1

The milestone 1–2 records below describe their state at completion; current functionality is summarized above.

The frontend build passed. Thirteen backend checks and the real-Gatekeeper integration test passed, including independent sessions, cookie reuse after a gateway restart, logout, revocation, expiry, forged headers, JSON authorization errors, gateway failure, and mutation Origin/header checks. The content database migration was reopened and checked for persistence and a single fixed owner.

The actual browser sign-in/return flow, Settings handoff, logout, deep-link return, Drop dialog, and Void/Kept/Settings layouts were checked at desktop and narrow phone viewport sizes. Phone emulation is not physical-device testing. OS/browser process restart, physical Android/iOS behavior, PWA installation, production Caddy isolation, and VPS deployment remain unverified and belong to later checks. The service-worker and transfer features are not implemented yet.

See the [PRD](cavvoid-prd.md) and [implementation plan](IMPLEMENTATION_PLAN.md). After each milestone, Codex reports its result, reminds you to request the next, and waits.

## Verification for milestone 2

The frontend build, 25 automated backend/browser-boundary checks, and the real-Gatekeeper integration test pass. Checks include exact whitespace, UTF-8 limits, duplicate/retried submissions, 30-item pagination, expiry at the boundary, deletion, private API access, cross-origin rejection, safe links, markup handling, clipboard permission failure, migration, and a native backend process restart. Separate real Gatekeeper sessions transfer text and links in both directions and observe deletion/revocation.

Browser checks cover saving/retrying a draft, retrieving it in another tab, exact clipboard copy → Paste round-trip, full text/manual selection, safe rendering of script-like text, and the deletion confirmation. Desktop and 360px/390px layouts are checked. Browser tabs share a profile; independent authentication sessions are exercised by the integration test. Physical phone/PC transfers, live synchronization, cleanup, PWA installation, and production proxy deployment remain pending.
