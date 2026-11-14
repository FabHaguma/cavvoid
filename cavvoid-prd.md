# CavVoid — Product Requirements Document (PRD)

**Version:** 1.1\
**Status:** Proposed MVP\
**Revision:** 2026-11-13 — OAuthenticator integration and milestone implementation plan\
**Platform:** Web Application + Progressive Web App (PWA)\
**Primary User:** Single private user, multiple devices\
**Deployment:** Self-hosted VPS using Docker\
**Intended production origin:** `https://cavvoid.haguma.com` — DNS registration reported by Fabrice; deployment/routing not yet verified.\
**Product Tagline:** Drop it in. Pull it out.

---

## 1. Product Overview

### 1.1 Product Description

CavVoid is a private, web-based cross-device content transfer and temporary storage application.

It allows users to send text, links, images, audio, documents, and other files from one device and retrieve them from another, regardless of whether both devices are online simultaneously.

CavVoid acts as a personal digital holding space, allowing users to control how long each item remains available.

The application will work through standard web browsers on desktop and mobile. On smartphones, it will offer an installable Progressive Web App (PWA) experience.

### 1.2 Problem Statement

Transferring small pieces of information between personal devices often involves inconvenient workarounds:

- Sending messages to yourself through messaging applications.
- Emailing links, images, or documents to yourself.
- Uploading files to cloud storage and manually retrieving them.
- Connecting devices through USB cables.
- Using device-specific synchronization tools that may not work across operating systems.

These methods introduce unnecessary steps and often retain content longer than necessary.

### 1.3 Proposed Solution

CavVoid will provide a centralized, private, temporary digital inbox.

Users can:

1. Drop content into CavVoid from any authenticated device.
2. Access that content from another authenticated device.
3. Copy, preview, or download the content.
4. Delete content manually or allow it to expire.
5. Pin selected items for longer-term storage.

The application's primary design principle is **minimal effort between sending and retrieving content**.

---

## 2. Product Goals

### 2.1 Primary Goals

- Enable simple, reliable cross-device content transfer.
- Support multiple content types through one unified interface.
- Provide a mobile-first PWA experience.
- Allow users to define item expiration times.
- Synchronize changes across active devices in real time.
- Maintain user privacy through authentication and secure storage.
- Run efficiently on a small VPS.

### 2.2 Secondary Goals

- Minimize clicks and navigation.
- Make copying and downloading content fast.
- Support dragging and dropping files.
- Provide convenient access to previously saved content.
- Avoid external cloud storage dependencies.
- Establish an architecture that can be expanded later.

### 2.3 Non-Goals for MVP

The initial version will not include:

- Public file-sharing links.
- Multi-user collaboration.
- Automatic system-wide clipboard monitoring.
- Native Android or iOS applications.
- Peer-to-peer file transfers.
- End-to-end encryption.
- Offline file uploads.
- File version history.
- External cloud storage integration.
- Browser extensions.

These capabilities may be evaluated after the core application is functional.

---

## 3. Target Users and Platforms

### 3.1 Primary User

CavVoid will initially be a single-user application.

The user may access the same private CavVoid account from several devices, including phones, laptops, and desktop computers.

### 3.2 Supported Platforms

| Platform | Access Method | Priority |
|---|---|---|
| Windows | Chrome, Edge, Firefox | High |
| Android | Chrome, installed PWA | High |
| iOS | Safari, Home Screen PWA | High |
| macOS | Modern browser | Medium |
| Linux | Modern browser | Medium |
| Tablets | Responsive browser or PWA | Medium |

### 3.3 Core Usage Scenario

A user finds an image on their phone but wants to use it on their computer.

They open CavVoid on their phone, upload the image, and select the default expiration.

The image appears immediately in CavVoid on the computer.

The user downloads it and can delete it or allow automatic expiration.

The same workflow applies in reverse.

---

## 4. Product Structure

CavVoid will organize content into three logical areas.

### 4.1 Void — Temporary Items

The default destination for all new content.

Items in the Void have expiration times and will be deleted automatically unless pinned.

### 4.2 Kept — Saved Items

Items that the user explicitly chooses to retain.

Kept items remain available until manually deleted or moved back into temporary storage.

### 4.3 Settings

Controls for account security, devices, storage usage, expiration defaults, and application preferences.

A separate transfer history or trash section is not required for the MVP.

---

## 5. Functional Requirements

### FR-01: Authentication

**Priority: P0 — Required**

CavVoid must restrict access to its single private owner through Fabrice's existing **OAuthenticator**, currently implemented as **Gatekeeper**.

Gatekeeper is a central authentication gateway using Caddy `forward_auth`. Despite the repository name, it is not an OAuth/OIDC provider; this integration does not require OAuth clients, authorization codes, JWTs, or a second CavVoid login system.

Requirements:

- Delegate account setup, password verification and storage, login throttling, session cookies, session expiry, and session revocation to Gatekeeper. CavVoid must not collect or store passwords or maintain a duplicate authentication-session database.
- Register CavVoid's exact origin in Gatekeeper's `PROTECTED_APPS`. Production requires HTTPS subdomains under the same trusted parent domain and a matching `COOKIE_DOMAIN`. The actual CavVoid hostname must be confirmed before deployment.
- Gate every CavVoid page and private request through Caddy, including APIs, uploads, previews, downloads, file range requests, and the SSE connection. Caddy calls Gatekeeper's private `/auth/verify` endpoint before forwarding a request.
- Redirect signed-out browser page navigations to Gatekeeper's login page and return to the original allowlisted CavVoid URL after login. API requests must receive an authorization error rather than login HTML.
- Support simultaneous device sessions and browser restarts using Gatekeeper's persistent cookies, within its configured session lifetime. Do not introduce a separate CavVoid session lifetime.
- Provide a Settings link to Gatekeeper's dashboard for **Manage sign-in / Sign out**. Session listing, individual revocation, and signing out other sessions happen on Gatekeeper's origin using its existing UI. To end all sessions, revoke other sessions and then sign out the current session there. These actions affect other apps using the same Gatekeeper session too.
- Clear the current tab's private in-memory state and close its event stream when leaving for sign-out, or after detecting an expired/revoked session. Recheck access on resume and handle authorization failures with a clear sign-in action.
- Keep CavVoid's upstream services private so requests cannot bypass Caddy. Overwrite verification metadata at the trusted ingress; never trust browser-supplied identity or forwarding headers. Redact `gatekeeper_session` and remove the proxy-secret header before forwarding to CavVoid, following Gatekeeper's Caddy template.
- In the prepared production mode, Caddy overwrites a separate `X-CavVoid-Ingress` proof after successful verification; Nginx and Node check the app-specific secret. Gatekeeper's credentials never become CavVoid runtime credentials. Only Nginx joins `caddy_network`; the backend is on the app-private network with no published host port. This proof supplements required ingress/network isolation and must be tested on the actual VPS. Local development retains direct native gateway verification.
- Block access if Gatekeeper is unavailable or verification fails; never fall back to an anonymous or development identity in production.
- Map every successfully gated request to a fixed, server-selected CavVoid owner record. Gatekeeper currently returns an allow/deny result, not a per-user identity. Clients must not choose `user_id` or gain access by submitting a header. Multi-user identity integration remains out of scope.
- Enforce CavVoid's own CSRF protection on all state-changing endpoints, including multipart uploads: require the exact configured CavVoid `Origin` and an application-specific request header, and reject cross-origin access. Gatekeeper's login protection does not replace these checks.
- Limit each SSE connection to at most 30 seconds, then reconnect through the gateway to recheck access. Logout, revocation, or expiry blocks the next checked request; an existing stream can remain open only until that limit. Already displayed/downloaded data cannot be recalled, and a download already in progress may finish.
- Provide a native localhost integration using Gatekeeper's existing demo verification pattern. Use `localhost` consistently and keep secrets server-side; local development must not require Docker or Caddy.

The existing OAuthenticator repository is at `C:/Users/Fabrice/My_Documents/Programming/Dockered/OAuthenticator`. Its README and `integration/Caddyfile.example` are the integration references. Gatekeeper owns secure administrator provisioning; CavVoid has no public registration or password-reset page. The documented production trial uses `login.haguma.com`; its current live configuration has not been verified for this PRD revision.

### FR-02: Text and Link Transfer

**Priority: P0**

Users must be able to submit text and URLs.

Requirements:

- Provide a prominent text input area.
- Support multiline text.
- Preserve line breaks and whitespace.
- Detect URLs and categorize them as links.
- Display clickable URLs safely.
- Provide one-click copying.
- Allow manual deletion.
- Allow items to be pinned.
- Display creation time and expiration information.

Text should be stored as plain text rather than interpreted as executable HTML.

**Maximum text size:** 100 KB per item, configurable.

### FR-03: File Upload

**Priority: P0**

Users must be able to upload files from supported devices.

Supported examples:

- Images: JPG, PNG, WebP, GIF.
- Audio: MP3, WAV, M4A.
- Documents: PDF, TXT, DOCX, XLSX.
- Archives: ZIP.
- Other general-purpose files.

Requirements:

- Provide a file picker.
- Support drag-and-drop on desktop.
- Support mobile file selection.
- Support selecting images from the phone's photo library.
- Allow selecting multiple files in one operation.
- Display individual upload progress.
- Show success or failure states.
- Validate file sizes and enforce upload limits.
- Preserve the original file name for downloads.
- Store files privately on the server.

**Default maximum file size:** 100 MB per file, configurable.

Multiple selected files will be created as separate CavVoid items. Folder uploads are outside MVP scope.

### FR-04: Content Retrieval

**Priority: P0**

Users must be able to access content from any authenticated device.

Text items:

- Display the content.
- Copy to the device clipboard.
- Allow expanding long text.

Image items:

- Show image previews.
- Support viewing the full image.
- Provide download functionality.

Audio items:

- Display file metadata.
- Provide an embedded audio player when the browser supports the format.
- Provide download functionality.

Other files:

- Display filename, type, and size.
- Provide a download button.
- Open PDFs in a secure preview where supported, or offer download.

All downloads must require authorization.

### FR-05: Expiration Management

**Priority: P0**

Every temporary item must have an expiration policy.

Available expiration options:

| Option | Behavior |
|---|---|
| 10 minutes | Short-lived transfer |
| 1 hour | Quick transfer |
| 24 hours | Default |
| 7 days | Extended temporary storage |
| Keep | No automatic expiration |

Requirements:

- New items default to 24-hour expiration.
- Users can select another duration before submission.
- Users can change expiration after submission.
- Expiration is calculated on the server.
- Expired items become inaccessible immediately once their expiration timestamp is reached.
- Expired database records and physical files are cleaned up automatically.
- Pinned items do not expire.
- Users can unpin items.

When an item is unpinned, the application assigns a fresh 24-hour expiration by default.

The cleanup process should run at least once per hour, while API access checks enforce expiration immediately.

### FR-06: Pinning and Retention

**Priority: P0**

Users must be able to move temporary items into long-term storage.

Requirements:

- Provide a Pin or Keep action on each item.
- Kept items appear in the Kept section.
- Kept items do not expire automatically.
- Allow items to return to temporary storage.
- Allow permanent manual deletion.

Pinning changes the item's retention policy rather than creating a second copy.

### FR-07: Real-Time Synchronization

**Priority: P0**

Changes made on one device should appear on other active devices.

Requirements:

- Broadcast newly created items.
- Broadcast deletions.
- Broadcast pin and expiration changes.
- Automatically update connected clients.
- Reconnect after temporary connection interruptions.
- Fetch the current authoritative state after reconnection.
- Avoid duplicate items caused by repeated events.

The initial implementation should use Server-Sent Events (SSE).

The application does not require continuous background execution on mobile devices. When reopened or resumed, it must refresh its content from the server.

### FR-08: Item Management

**Priority: P0**

Each item must provide actions appropriate to its content type.

Required actions:

- Copy text or link.
- Download a file.
- Preview supported content.
- Pin or unpin.
- Change expiration.
- Delete.
- View item details.

Deletion must remove the item from the active interface immediately and revoke future access.

Physical file deletion should occur as part of the deletion process, with retry handling for filesystem failures.

### FR-09: Searching and Filtering

**Priority: P1 — Recommended for MVP**

The application should provide:

- Search by text content.
- Search by file name.
- Filter by content type.
- Filter temporary versus kept items.
- Sort newest-first or oldest-first.

Search should operate only on authenticated items owned by the user.

Full-text indexing is optional for the first release.

### FR-10: Storage Management

**Priority: P1**

The Settings interface should display:

- Total storage used.
- Number of stored items.
- Temporary item count.
- Kept item count.
- Configured upload size limit.
- Configured storage quota.

The backend must reject uploads that would exceed the configured quota.

**Initial suggested quota:** 2 GB, configurable.

---

## 6. Progressive Web App Requirements

### PWA-01: Installability

**Priority: P0**

CavVoid must support installation as a PWA on compatible devices.

Requirements:

- Provide a valid web application manifest.
- Include application name and short name.
- Include installable icons in required sizes.
- Support a standalone display mode.
- Define application theme and background colors.
- Register a service worker.
- Serve the application exclusively over HTTPS.

Application metadata:

- Name: CavVoid
- Short name: CavVoid
- Display: standalone
- Primary theme: dark
- Orientation: responsive, not locked

### PWA-02: Mobile Interface

**Priority: P0**

The interface must be mobile-first.

Requirements:

- Large touch-friendly controls.
- Minimal navigation.
- A prominent Drop action.
- Responsive content cards.
- Easy access to the device file picker.
- Mobile-friendly image and audio previews.
- Safe-area support for devices with display cutouts.
- Functional portrait and landscape layouts.
- Avoid unnecessary page reloads.

### PWA-03: Offline Behavior

**Priority: P1**

The installed PWA should display a branded offline state when the network is unavailable.

Requirements:

- Cache the application shell and essential static assets.
- Display a clear offline indicator.
- Do not pretend unsent content has been uploaded.
- Do not cache private files or sensitive item content by default.
- Automatically reconnect and refresh once connectivity returns.

Offline upload queues and offline content libraries are excluded from the MVP.

### PWA-04: System Sharing Integration

**Priority: P2 — Post-MVP**

On compatible Android browsers, CavVoid should integrate with the operating system's Share menu using the Web Share Target API.

Example:

1. User opens a picture in their phone gallery.
2. User selects Share.
3. User chooses CavVoid.
4. CavVoid opens a submission screen with the shared content.
5. User confirms the upload.

The feature must respect platform compatibility.

On iOS, the baseline workflow remains manual copying, pasting, or choosing files within CavVoid.

### PWA-05: Clipboard Interaction

**Priority: P0**

CavVoid must support copying text into the device clipboard through explicit user interaction.

It may also offer a Paste from Clipboard action where browser permissions allow it.

Requirements:

- Handle permission denials gracefully.
- Provide manual paste as a fallback.
- Never continuously monitor the system clipboard.
- Never upload clipboard data without explicit user confirmation.

---

## 7. User Interface and Experience

### 7.1 Design Direction

CavVoid will use a minimalist interface inspired by a cave, void, or black hole.

Design characteristics:

- Dark theme by default.
- Deep black and charcoal backgrounds.
- Purple or blue accent colors.
- Subtle gradients and restrained visual effects.
- Rounded content cards.
- Clear typography.
- Consistent iconography.
- Minimal distractions.

The visual theme should not reduce usability or contrast.

### 7.2 Mobile Navigation

The mobile PWA should use three primary navigation destinations:

**Void | Kept | Settings**

A prominent floating or bottom-positioned **Drop (+)** action should be visible from the main content screens.

The Drop action opens a composer with options for text and file submission.

### 7.3 Desktop Layout

The desktop interface should provide:

- Sidebar navigation.
- Main content feed.
- Prominent text/file composer.
- Search and filters.
- Item actions.
- Storage indicator.

The design should allow comfortable use from both narrow and wide browser windows.

### 7.4 Item Cards

Every item should appear as a card.

Common card elements:

- Content type icon.
- Preview or content excerpt.
- Creation timestamp.
- Device label, where available.
- Expiration status.
- Relevant action buttons.

Examples:

**Text Item**

> Remember to update the Docker configuration.

Actions: Copy | Keep | Delete

**Link Item**

> https://example.com/article

Actions: Open | Copy | Keep | Delete

**File Item**

> presentation.pdf — 2.4 MB

Actions: Download | Keep | Delete

### 7.5 Empty States

The application should present helpful empty states.

Examples:

- **Your Void is empty.** Drop something to get started.
- **Nothing kept yet.** Pin items you want to keep.
- **You're offline.** Reconnect to access your Void.

---

## 8. User Flows

### Flow A: Phone to PC

1. User copies text on their phone.
2. User opens the CavVoid PWA.
3. User selects Drop.
4. User pastes the content.
5. User confirms the expiration duration.
6. User submits.
7. Server stores the item.
8. PC receives a real-time update or retrieves the item on reopening.
9. User copies the content on the PC.

**Success condition:** Content is transferred without using email, messaging applications, or local network pairing.

### Flow B: PC to Phone

1. User opens CavVoid on their PC.
2. User drags an image into the upload area.
3. User submits the image.
4. Server stores the file.
5. User opens the CavVoid PWA on their phone.
6. User previews or downloads the image.

### Flow C: Keep an Item

1. User locates an item in the Void.
2. User selects Keep.
3. System removes its automatic expiration.
4. Item appears in the Kept section.
5. Item remains until manually deleted or unpinned.

### Flow D: Automatic Expiration

1. User submits an item with a 10-minute expiration.
2. Server calculates `expires_at`.
3. Item remains accessible during the permitted period.
4. On expiration, API requests reject access.
5. Connected clients remove the expired item from their feeds.
6. The cleanup worker deletes the associated file and metadata.

### Flow E: Delete an Item

1. User selects Delete.
2. Application asks for confirmation where appropriate.
3. Backend revokes access.
4. Item disappears from connected devices.
5. Associated file data is deleted from active storage.

---

## 9. Technical Architecture

### 9.1 Recommended Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite |
| Styling | CSS Modules |
| PWA | Web App Manifest + Service Worker |
| Backend | Node.js + Express |
| Database | SQLite with WAL |
| File Storage | VPS filesystem |
| Authentication | OAuthenticator / Gatekeeper via Caddy `forward_auth`; gateway-owned sessions |
| Real-Time | Server-Sent Events |
| Reverse Proxy | Caddy |
| Deployment | Docker Compose |
| Testing | Vitest, React Testing Library, Jest/Supertest or equivalent |

### 9.2 Architecture Overview

The architecture will consist of:

**Authentication / Ingress Layer**

Caddy verifies each request with the existing Gatekeeper service, then forwards approved requests to private CavVoid upstreams. Gatekeeper owns credentials and sessions. CavVoid owns its single-user content and enforces mutation safety and content access policies. The native local entry point mirrors Gatekeeper's verification contract for development.

**Client Layer**

React application running in a browser or installed PWA.

**API Layer**

Express backend handling uploads, retrieval, metadata, expiration, and synchronization behind the authenticated ingress. It does not implement a separate password login or gateway session store.

**Database Layer**

SQLite storing application data and file metadata.

**Storage Layer**

A private directory on the VPS filesystem containing uploaded files.

**Background Worker**

A scheduled cleanup process that deletes expired content.

### 9.3 Storage Design

Uploaded files should be stored outside the public web root.

Files must use internally generated identifiers rather than trusting user-supplied filenames as filesystem paths.

Prepared production file directory:

`/data/files/objects/` (private staged uploads use `/data/files/tmp/`)

SQLite database:

`/data/cavvoid.sqlite` (persist the whole `/data` volume, including SQLite sidecars)

Original filenames should be stored in metadata and used only for display and authorized downloads.

All persistent data should reside on Docker volumes or explicitly mounted host directories.

Files must never be exposed through a publicly accessible static directory.

### 9.4 Database Schema

#### users

| Field | Type |
|---|---|
| id | TEXT, primary key; fixed server-selected owner ID |
| display_name | TEXT |
| created_at | DATETIME |
| updated_at | DATETIME |

Create one local owner record during database initialization. It exists for item ownership and preferences, not authentication. Never derive this ID from request data or assume Gatekeeper supplies an identity header.

#### Authentication sessions — external to CavVoid

Gatekeeper owns its account and `gateway_sessions` tables in its own SQLite database. CavVoid has no `password_hash`, raw gateway token, or authentication `sessions` table and must not read or modify Gatekeeper's database. Device labels on items are optional descriptive metadata, not session identity or authorization evidence.

#### items

| Field | Type |
|---|---|
| id | UUID / TEXT, primary key |
| user_id | UUID / TEXT |
| type | TEXT: text, link, file |
| text_content | TEXT, nullable |
| is_kept | BOOLEAN |
| created_at | DATETIME |
| updated_at | DATETIME |
| expires_at | DATETIME, nullable |
| source_device | TEXT, nullable |
| submission_id | UUID / TEXT; unique with user_id; identifies retries of the same draft |

#### item_files

| Field | Type |
|---|---|
| id | UUID / TEXT, primary key |
| item_id | UUID / TEXT, unique |
| original_filename | TEXT |
| storage_name | TEXT; generated UUID filename |
| mime_type | TEXT |
| file_size | INTEGER |
| sha256 | TEXT; digest of completed upload bytes |
| created_at | DATETIME |

For MVP, each file item has one associated file. Multiple-file submissions create multiple items.

#### user_preferences

| Field | Type |
|---|---|
| user_id | UUID / TEXT, primary key |
| default_expiration | TEXT; `10m`, `1h`, `24h`, `7d`, or `keep` |
| updated_at | TEXT; UTC timestamp |

The initial default is `24h`. New text/file drops use the saved default only when an explicit choice is omitted. Existing items and already-open composers retain their selected policy. Upload/text limits and storage quota are server configuration exposed read-only in Settings; theme selection remains outside the dark-theme MVP. Migration `004-preferences.sql` adds these content preferences without authentication/session data.

#### file_objects — Physical Storage Ledger

Tracks each generated blob's owner, charged bytes, `uploading` / `ready` / `deleting` state, upload lease, deletion attempts, next retry time, and safe error code. Reservations are charged before streaming in a SQLite transaction; pending physical deletions remain charged. Failed or stale uploads never appear as completed items. The ledger supports startup orphan recovery and retryable deletion, including expired-content removal. The local worker runs at startup and every 30 seconds; access checks enforce expiry independently.

Database timestamps should be recorded in UTC.

Items should be indexed by owner, creation date, expiration date, and retention status.

### 9.5 API Design

All item and file endpoints require gateway authentication. The existing `/api/` prefix is retained.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/auth/me` | Access probe after gateway approval; return local owner and Gatekeeper dashboard URL, never gateway credentials |
| GET | `/api/items` | Owner/expiry-scoped literal text/filename search; type, Void/Kept/both filters, newest/oldest order, and pagination |
| POST | `/api/items/text` | Create text or link |
| POST | `/api/items/file` | Upload file |
| GET | `/api/items/:id` | Item details |
| PATCH | `/api/items/:id` | Update retention/expiration |
| DELETE | `/api/items/:id` | Delete item |
| GET | `/api/items/:id/download` | Authorized download |
| GET | `/api/events` | Real-time event stream |
| GET | `/api/storage` | Storage statistics |
| GET | `/api/preferences` | Retrieve preferences |
| PATCH | `/api/preferences` | Update preferences |

The API should use consistent JSON responses and meaningful HTTP status codes.

There are no CavVoid login, logout, registration, or session-revocation endpoints. Those actions belong to Gatekeeper's dashboard. Browser code must navigate there rather than call its mutating APIs across origins. Requests from CavVoid's fetch client must advertise JSON; SSE requests use `text/event-stream`, so signed-out requests receive `401` rather than a page redirect. Handle gateway `401`, `403`, and unavailable-service responses without treating them as successful application data.

File uploads should use multipart form data.

The list endpoint should support pagination and filtering, with a default page size of 30 items.

### 9.6 Synchronization Events

Initial server-sent event types:

- `item.created`
- `item.updated`
- `item.deleted`
- `storage.updated`
- `preferences.updated`

Events should contain minimal metadata and never include sensitive file contents.

After reconnecting, the client should refresh the relevant item list rather than assuming every event was received.

The server must close each SSE connection within 30 seconds even if events continue to arrive. Reconnection requires a fresh gateway check. On stream failure, use the access probe to distinguish a lost connection from an ended session; avoid endless unauthorized reconnect attempts and clear private UI state when access has ended.

---

## 10. Security and Privacy

### 10.1 Authentication Security

- Enforce HTTPS in production; permit loopback HTTP only for native development.
- Use Gatekeeper's secure, HttpOnly, SameSite session cookies, hashed server-side tokens, login throttling, session rotation, expiry, and revocation. These responsibilities stay in OAuthenticator.
- Keep the shared parent domain restricted to trusted hosts. Unrelated domains require a different authentication handoff and are outside this integration.
- Follow Gatekeeper's Caddy template: set original-request metadata and the verification secret at the proxy; strip the secret and redact the gateway cookie on every CavVoid upstream request.
- Make direct public access to CavVoid upstream ports impossible. Do not publish backend ports or create an unprotected API/download route.
- Require the exact CavVoid Origin and an application-specific request header for every mutation; include multipart uploads. Reject broad or credentialed cross-origin access.
- Fail closed when verification is denied or unavailable. Keep proxy credentials in ignored server/proxy environment configuration, outside the frontend and logs.
- Handle revoked sessions on subsequent requests. Close existing SSE streams within 30 seconds and require verification on reconnection. Do not claim instantaneous termination of established downloads or streams.

### 10.2 File Security

- Authenticate every download.
- Validate file sizes and accepted upload policies.
- Sanitize file metadata and download filenames.
- Prevent directory traversal.
- Reject malformed upload requests.
- Disable execution of uploaded files.
- Prevent uploaded HTML, SVG, and other potentially active content from running under the application's origin.
- Use restrictive content-disposition and content-type headers.
- Consider malware scanning if the application becomes publicly accessible or multi-user.

### 10.3 Privacy Requirements

- No public item listing.
- No third-party analytics required.
- Do not log text content or file contents.
- Do not expose upload directories.
- Do not cache private API responses in shared caches.
- Delete expired content from active storage.
- Clearly document backup retention and deletion limitations.

### 10.4 PWA Security

- Cache only safe static application resources by default.
- Do not persist passwords, session tokens, or private files in browser local storage.
- Use appropriate Content Security Policy headers.
- Prevent sensitive content exposure through browser previews or unauthenticated routes.

---

## 11. Performance and Reliability

### 11.1 Performance Targets

| Metric | Target |
|---|---|
| Text submission | Under 1 second server response under normal load |
| Text retrieval | Under 1 second server response |
| Real-time delivery | Under 2 seconds for connected devices under normal conditions |
| File size | Up to 100 MB by default |
| Concurrent active devices | At least 5 |
| Item list pagination | 30 items per request |
| Expiration enforcement | Immediate at API access |
| Physical cleanup | Within 1 hour under normal operation |

These are engineering targets to validate during testing, not guaranteed network performance.

File transfer duration depends on actual network bandwidth.

### 11.2 Reliability Requirements

- Preserve uploaded data across container restarts.
- Use persistent storage mounts.
- Avoid partial or corrupted completed uploads.
- Clean up failed upload fragments.
- Handle network interruptions.
- Avoid duplicate submissions where possible.
- Automatically recover real-time connections.
- Handle full-storage conditions gracefully.

Uploads should first be written to temporary storage and moved into their final location only after validation and successful completion.

---

## 12. Error Handling

The application should handle:

- Gatekeeper sign-in failure, cancelled sign-in, or unavailable authentication service.
- Session expiration.
- No internet connection.
- Upload too large.
- Insufficient server storage.
- Unsupported file preview.
- Interrupted uploads.
- Expired items.
- Deleted items.
- Failed downloads.
- Clipboard permission denial.
- Synchronization connection failures.

Error messages should explain the problem and offer a clear next action where possible.

For example:

**Upload failed — File exceeds the 100 MB limit.**

**This item has expired and is no longer available.**

**Clipboard access was denied. Paste your text manually.**

---

## 13. MVP Scope and Priorities

### P0 — Required for Initial Release

- Single-user authentication through the existing OAuthenticator / Gatekeeper.
- Multiple authenticated device sessions.
- Text and link submission.
- File uploads.
- Text copying.
- File downloading.
- Image and supported audio previews.
- Temporary item feed.
- Pinning and unpinning.
- Configurable expiration.
- Manual deletion.
- Automatic cleanup.
- Real-time synchronization.
- Responsive desktop interface.
- Installable mobile PWA.
- Secure private file storage.

### P1 — Recommended Enhancements

- Search and filtering.
- Storage statistics.
- Settings link to Gatekeeper's existing device/session management interface; no duplicate CavVoid dashboard.
- Saved default expiration preference.
- Offline status page.
- Multiple file upload progress.
- Text paste-from-clipboard shortcut where supported.
- Light theme.
- QR-based device pairing.

### P2 — Future Features

- Android Share Target integration.
- One-time retrieval and deletion.
- Direct device-to-device transfers.
- Temporary share links.
- Browser extension.
- End-to-end encryption.
- Optional browser push notifications.
- Native mobile applications.
- Larger file streaming and resumable uploads.
- Multi-user accounts.

For one-time retrieval, the app should use explicit user confirmation rather than assume a browser download completed successfully.

---

## 14. Implementation Phases

The detailed steps, dependencies, demonstrations, and completion checks are in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). The plan covers the full CavVoid MVP with OAuthenticator replacing local authentication.

| Milestone | Deliverable | Completion condition |
|---|---|---|
| 1 | Runnable foundation and OAuthenticator integration | Local CavVoid shell is protected by the real local Gatekeeper; sign-in, return navigation, access denial, and gateway failure are checked |
| 2 | Text and link transfers | Two independent browser sessions can save, retrieve, copy, and delete text/links; refresh-based retrieval is sufficient here |
| 3 | Private file transfers | Upload, preview, download, deletion, progress, size limits, and quota enforcement work through authenticated access |
| 4 | Retention and cleanup | Expiration options, Keep/unpin, immediate access denial, and retryable physical cleanup work |
| 5 | Real-time synchronization | Connected clients receive changes, recover after interruption, and close streams within 30 seconds with gateway checks on reconnection |
| 6 | Mobile PWA | Responsive screens, manifest, static-only service worker, offline state, and resume work locally; physical phone installation remains an explicit release check |
| 7 | Search, settings, and release checks | Search/filtering, required preferences/statistics, security checks, and local end-to-end flows pass |
| 8 | VPS deployment preparation | Scoped deployment files and exact handoff instructions are prepared; nothing is deployed |
| 9 — only when deployment is requested | VPS rollout and live verification | Actual HTTPS deployment, gateway boundary, persistence, and real phone/PC flows are verified |

Work on one milestone at a time. After completing its checks, update the plan's status, report the working result and any verification limits, and remind Fabrice: **"Milestone N complete. Tell me 'Implement milestone N+1' when you are ready."** Stop until he requests the next milestone. After milestone 8, explicitly remind him that the next milestone deploys to his VPS and requires his deployment request. After milestone 9, report completion instead of asking for a nonexistent next milestone.

Local development and testing use native Node.js, without Docker. Deployment preparation is distinct from deployment, and production acceptance remains pending until live checks are performed. Milestones 1–7 are complete locally; actual checks and verification limits are recorded in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) and [README.md](README.md). Search, storage statistics, and saved default expiration work through authenticated APIs. Local SSE connections close after 25 seconds and reconnect through Gatekeeper; events carry identifiers or empty invalidations and clients fetch authoritative state. The PWA caches only an explicit static shell allowlist, opens a branded offline state, and requires fresh authenticated API access before showing private drops. Independent browser-profile GUI, production proxy behavior, and physical Android/iOS installation, standalone launch, keyboard, and sleep/resume remain release checks.

Milestone 8's [deployment package](deploy/README.md) is prepared locally and tested with 88 native checks plus one real-Gatekeeper integration check. It remains **awaiting exact host confirmation**, including the VPS checkout, Caddy mount/container, gateway checkout/upstream and service/network availability. The package includes explicit production admission, isolated/persistent Docker topology, Nginx/Caddy drafts and backup/restore tooling. Its actual Docker/Compose/proxy/HTTPS/persistence/restore checks must run on the intended VPS; no deployment has been performed.

---

## 15. Acceptance Criteria

The MVP is complete when all of the following conditions are satisfied:

The boxes track full release acceptance, including the intended HTTPS/VPS and physical-device environment. Local implementation checks below do not mark an unperformed live/device check as passed.

- [ ] A user can sign in through OAuthenticator / Gatekeeper and return to CavVoid from a PC browser and a mobile PWA.
- [x] CavVoid stores no passwords or duplicate authentication sessions.
- [ ] Gatekeeper logout, expiry, and revocation block the next request; existing SSE streams close within 30 seconds and reconnection requires fresh approval.
- [ ] Gatekeeper failure, forged forwarding headers, and attempted direct upstream access cannot expose private content.
- [x] Settings opens Gatekeeper's dashboard for sign-out and device/session management.
- [ ] Cross-origin mutations, including multipart uploads, are rejected.
- [ ] A user can submit text on a phone and retrieve it on a PC.
- [ ] A user can submit text on a PC and retrieve it on a phone.
- [ ] A user can upload an image and download it on another device.
- [ ] A user can upload an MP3 and play or download it on another device.
- [ ] A user can upload and download general-purpose files.
- [ ] Connected devices receive item updates without manual page refresh.
- [ ] Users can choose expiration times.
- [ ] Expired content cannot be retrieved through the API.
- [ ] The cleanup worker removes expired files from active storage.
- [ ] Users can pin items to prevent expiration.
- [ ] Users can manually delete items.
- [ ] Deleted items can no longer be downloaded.
- [ ] Unauthorized users cannot access private content.
- [ ] Upload limits and quotas are enforced.
- [ ] The interface works on narrow mobile screens.
- [ ] The PWA can be installed on supported Android and iOS devices.
- [ ] Interrupted connectivity does not corrupt stored items.
- [ ] Persistent content survives Docker container restarts.

### Local release evidence — 2026-11-14

| Area | Local result | Remaining release verification |
|---|---|---|
| Authentication/boundary | Actual local Gatekeeper; independent HTTP sessions; logout/revocation/expiry/outage, forged headers, CSRF and private routes pass | Production Caddy/HTTPS, direct-port isolation, independent browser-profile GUI |
| Transfers/storage | Text/image/audio/document, exact bytes, ranges, quota races, interrupted writes, deletion and native restart persistence pass | Physical phone ↔ PC flows, container restart/persistence and live backup/restore |
| Retention | Policies, Keep/unkeep, exact expiry, durable file cleanup and retry pass | Intended VPS filesystem/worker behavior |
| Search/settings | Owner-scoped text/filename search, type/section/sort/pagination, storage counts/limits, saved defaults and migration 4 pass | Live smoke test after deployment |
| Synchronization/performance | Five independent real-Gatekeeper HTTP clients; max event 63.9 ms, text submit 61.2 ms/retrieve 9.0 ms, stream max 25,072.9 ms | VPS proxy/SSE and physical-device latency/resume |
| Mobile/PWA/accessibility | Static-only cached shell, offline denial/recovery/update checks; desktop/phone/landscape/reflow, keyboard/focus, readable sizes and checked text contrast | Android/iOS install/standalone/OS keyboard/sleep, native zoom and screen-reader checks |

`npm test` passes 84 checks including nested cases; the real-Gatekeeper integration adds one passing check. The frontend build passes and npm audit reports zero known dependency vulnerabilities. GUI tabs share a profile; the separate native Chrome attempt stopped because its current URL could not be reliably identified. That unperformed check is not counted as a pass. No deployment has been performed.

---

## 16. Testing Strategy

### 16.1 Unit Tests

Test:

- Expiration calculations.
- Item validation.
- Retention changes.
- Storage quota calculations.
- Gateway response handling and the fixed-owner boundary.
- File metadata handling.

### 16.2 Integration Tests

Test:

- Gatekeeper sign-in/return flow, logout, expiry, and revocation through the native protected entry point.
- Unauthorized API/download/preview access, gateway outage, forged forwarding headers, and mutation Origin/header checks.
- Production Caddy isolation and direct-port bypass prevention during the deployment milestone.
- Text CRUD operations.
- File upload/download.
- Expiration enforcement.
- Physical file cleanup.
- Storage quota rejection.
- Concurrent device events and the maximum 30-second SSE lifetime after session revocation.

### 16.3 End-to-End Tests

Test representative flows across desktop and mobile browsers.

Primary scenarios:

1. Phone → PC text transfer.
2. PC → phone image transfer.
3. MP3 upload and playback.
4. Pin and unpin.
5. Expiration and cleanup.
6. Session expiration.
7. Offline/reconnect behavior.
8. PWA installation and launch.

### 16.4 Mobile-Specific Testing

Validate:

- Android Chrome PWA.
- iPhone Safari Home Screen PWA.
- File picker behavior.
- Clipboard permissions.
- Device sleep/resume.
- Upload interruption.
- Standalone display mode.
- Mobile keyboard interactions.

---

## 17. Success Metrics

The initial release should prioritize usability and reliability rather than growth metrics.

Suggested measurements:

| Metric | Desired Outcome |
|---|---|
| Text transfer | Few interactions, no unnecessary navigation |
| Cross-device synchronization | Consistent and reliable |
| File retrieval | Straightforward on all supported devices |
| Retention | Automatic expiration works correctly |
| Mobile installation | Functional standalone PWA |
| Manual recovery | Minimal need to refresh or retry |
| Storage | No uncontrolled accumulation of expired files |

These metrics can be evaluated through testing and lightweight self-hosted operational monitoring.

---

## 18. Future Product Direction

CavVoid may eventually evolve beyond temporary storage into a comprehensive private transfer utility.

Potential directions include:

**Instant Device Transfer:** Direct transfers when devices are online simultaneously.

**One-Time Drops:** Content disappears after an acknowledged retrieval.

**Share to CavVoid:** Send content to the Android PWA directly through the operating system Share menu.

**Device Pairing:** Securely authorize additional devices through short-lived QR codes.

**Browser Extension:** Save text and links directly without opening CavVoid manually.

**Encrypted Vault:** Optional client-side encryption for retained content.

These additions should remain secondary to the application's core simplicity.

---

## 19. Key Product Decisions

The following decisions are adopted for the initial implementation:

| Decision | Selection |
|---|---|
| Product name | CavVoid |
| Primary use | Personal cross-device transfer |
| Mobile experience | PWA |
| Desktop experience | Browser-based |
| User accounts | Single private user |
| Authentication | Existing OAuthenticator / Gatekeeper; Caddy `forward_auth` |
| Credential/session storage | Gatekeeper only; no duplicate CavVoid login database |
| Data transfer | Server-mediated |
| Backend | Node.js + Express |
| Frontend | React + Vite |
| Database | SQLite |
| Files | Local VPS storage |
| Real-time communication | SSE |
| Default expiration | 24 hours |
| Maximum default upload | 100 MB |
| Default storage quota | 2 GB |
| Deployment | Docker Compose |
| Reverse proxy | Caddy |
| Visual direction | Dark / cave / void |

Values such as file limits, quota, and expiration defaults must be configurable without restructuring the application.

---

## 20. Product Principle

**CavVoid should be faster than sending yourself a message.**

Every feature should support that objective.

The ideal experience is:

**Drop something → Open another device → Retrieve it.**

No unnecessary navigation, no complicated synchronization configuration, and no manual storage maintenance.

CavVoid should feel like a simple, private pocket between all your devices.
