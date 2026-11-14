# CavVoid VPS preparation

**Status:** Android Share Target support is implemented and tested locally (97 checks, production build, real Chrome handoff/composer checks with mocked sign-in). Deploy this update, then install/reinstall from Chrome on Android and check **Share → CavVoid**. The existing shared `gatekeeper_app` integration needs no change. Physical Android and updated live acceptance remain pending; previous VPS image health, Caddy validation and unsigned HTTPS redirect already passed.

**Domain:** `https://cavvoid.haguma.com` → **Caddy upstream:** `frontend_cavvoid:80`. The backend is `backend_cavvoid:3001` on the app-private network, with no host port. The Compose project is `cavvoid`; its persistent volume is `cavvoid_cavvoid_data`.

**Next:** On the VPS, pull and rebuild CavVoid. The `sed` command below removes the obsolete secret and updates the image tag in the existing settings file, preserving the other settings. The data volume is reused.

```sh
cd /home/fabrice/Projects/cavvoid &&
git pull --ff-only &&
sed -i -e '/^CAVVOID_INGRESS_SECRET=/d' \
  -e "s/^CAVVOID_RELEASE=.*/CAVVOID_RELEASE=$(git rev-parse HEAD)/" \
  deploy/production.env &&
docker compose \
  --env-file deploy/production.env -f compose.production.yaml \
  up -d --build --wait backend_cavvoid frontend_cavvoid
```

Keep this site block in the existing shared Caddyfile:

```caddyfile
cavvoid.haguma.com {
    import gatekeeper_app frontend_cavvoid:80
}
```

Then open `https://cavvoid.haguma.com`, sign in, create a text drop and refresh. With that block already active, the app update needs no Caddy restart. The same update commands work for future releases; deleting the obsolete setting again is harmless. On a new checkout using the default limits/login origin, omit `--env-file deploy/production.env` and prefix Compose with `CAVVOID_RELEASE="$(git rev-parse HEAD)"`; the app needs no production secrets.

For Android sharing, open the updated site in Chrome, sign in and install CavVoid using **Install app**. If already installed, open the app and accept **Update & reload** when shown. If Android's Share menu still lacks CavVoid, remove/reinstall the old PWA from Chrome to register the new share-target manifest. Then share a link from Chrome or a photo/file from another app → **CavVoid**, review it, and send. Installation/manifest behavior follows [Chrome's Web Share Target documentation](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target). Server data stays in the existing VPS volume.

## Confirmed host details and remaining checks

| Item | Evidence/status |
|---|---|
| App origin | `https://cavvoid.haguma.com`; HTTPS resolves and redirects unsigned browser navigation to the verified `https://login.haguma.com` |
| Source repository | `https://github.com/FabHaguma/cavvoid.git`, from this checkout's Git remote |
| App services | `frontend_cavvoid:80`, `backend_cavvoid:3001`; the supplied VPS inventory showed no existing CavVoid services before the initial creation |
| Ingress network | `caddy_network` exists; Caddy and Gatekeeper are members in the supplied live inventory |
| App checkout | `/home/fabrice/Projects/cavvoid`, confirmed by VPS output |
| Caddy | `caddy_proxy`; `/home/fabrice/Projects/caddy/Caddyfile` → `/etc/caddy/Caddyfile`, confirmed by mount inspection |
| Gateway | `/home/fabrice/Projects/OAuthenticator`; `gatekeeper-backend_gatekeeper-1`, service `backend_gatekeeper:4000`. Its runtime login origin was used to generate CavVoid's private settings; app-list validation/recreation passed |
| Shared config layout | Change only the CavVoid block in the confirmed shared Caddyfile; keep all other site blocks/imports intact |
| Runtime | Images from `0dc131d` became healthy; Caddy validated/restarted and HTTPS redirected to Gatekeeper. Updated shared-snippet integration, signed-in use, persistence and device checks remain pending; local Docker was not used |

On the intended VPS checkout, the read-only helper collects container names, ports, networks, selected Caddy mounts/version and disk space without dumping environments or Caddyfile secrets:

```sh
CAVVOID_VPS_INSPECT=1 CAVVOID_CADDY_CONTAINER=caddy_proxy sh deploy/inspect-vps.sh
```

Use the results when investigating service/network ownership. `frontend_cavvoid` and the existing `cavvoid` volume belong to this deployment; preserve them on updates.

## Package and trust boundary

```text
Browser HTTPS → existing Caddy → Gatekeeper /auth/verify
                         ↓ only after approval
                   frontend_cavvoid:80 (Nginx)
                         ↓ app-private network
                   backend_cavvoid:3001 → /data
```

`Dockerfile` builds the current Vite UI into Nginx and a separate native Node 22 backend. `compose.production.yaml` has uniquely named images with a required release tag, restart policies, health checks, read-only roots, and one persistent `/data` volume. Only Nginx joins `caddy_network`; the backend joins only the project-scoped internal network. There are no published host ports. Keep one backend replica/database writer.

Production authentication belongs to the existing Caddy `gatekeeper_app` snippet. It checks Gatekeeper before forwarding every public request. Nginx serves/proxies the approved request and Node trusts the app-private proxy path; neither requires an extra header or app secret. `NODE_ENV=production`, explicit `AUTH_MODE=trusted-ingress`, exact HTTPS origins and absolute persistent paths remain required. Node enforces exact Host, fixed owner, expiry, quota and CSRF. The shared `caddy_network` is trusted server infrastructure, just as for Fabrice's other private apps: containers attached to it can reach Nginx directly. Do not publish either app port or attach untrusted containers to that network. Local development continues direct verification with the real local Gatekeeper.

Gatekeeper's existing `PROXY_AUTH_SECRET` stays solely in Gatekeeper/Caddy verification configuration. The shared snippet redacts the gateway cookie and removes its proxy-key header. Nginx also drops cookies and that header, and Node ignores caller-supplied identity/forwarding assertions. CavVoid's production settings contain only release/origin/limits; its build and runtime need no authentication credentials. The Docker build context excludes runtime settings, data, backups and local QA artifacts.

Nginx routes `/api/` and `/api/events` before static routes, preserves the full path/query, streams uploads/downloads without proxy caching or disk buffering, and leaves API failures as errors. Nginx SSE buffering is off and Node retains its fixed 25-second lifetime; verify delivery through the actual shared Caddy snippet on the VPS. Upload/body limits derive from the same file/text limits plus bounded multipart/JSON overhead; proxy upload inactivity is 20 minutes and backend request timeout 30 minutes. The browser's file request timeout remains 20 minutes. In-progress transfers may finish after session revocation; the next request/stream reconnect is gated again.

Only `/`, `/kept` and `/settings` get the SPA index. Unknown files/routes return 404. Manifest MIME, worker scope and the shell marker are set explicitly. Security/no-store headers cover static/error responses; APIs retain their backend headers. Nginx access logs are disabled and error logging is critical-only. Caddy retains the existing shared logging policy; consider search-query privacy there when enabling access/debug logs.

## Requested rollout — laptop first

Fabrice's workflow is laptop commit/push → SSH → pull/build in `/home/fabrice/Projects/cavvoid`. The initial release and readiness correction were pushed and built on the VPS. Use the short path above for this update, and record the deployed commit for rollback.

On the verified SSH target, use the confirmed CavVoid checkout. For a new folder, clone `https://github.com/FabHaguma/cavvoid.git` into that chosen folder once. For an existing deployment, run the stopped-app backup below and preserve its current runtime file, commit and image IDs **before pulling or changing its release tag**. Then preserve ignored private runtime/data files, use `git pull --ff-only`, and confirm `git rev-parse HEAD` is the intended pushed commit. Do not overwrite an unrelated checkout or discard uncommitted server changes.

The verified login origin is `https://login.haguma.com`, which is the Compose default. `deploy/production.env` is optional for release/limit overrides. If using the optional native settings helper on a host with Node 22, it also removes any obsolete app secret automatically:

```sh
node scripts/prepare-production.js --gateway-origin https://login.haguma.com --release "$(git rev-parse HEAD)"
docker compose --env-file deploy/production.env -f compose.production.yaml config --quiet
docker compose --env-file deploy/production.env -f compose.production.yaml build --pull
```

The optional helper writes mode-600 settings, preserves existing limits and updates the image tag. It generates no authentication secret and starts no service. Ordinary updates can set `CAVVOID_RELEASE` in the Compose command instead; no Node installation or settings helper is required on the VPS. Record the resulting image IDs alongside the commit for rollback.

## Register just CavVoid in the existing gateway

This registration already passed on the current VPS. For a new installation, append this entry to `PROTECTED_APPS` in `/home/fabrice/Projects/OAuthenticator/backend/.env`, keeping the existing entries:

```json
{"id":"cavvoid","name":"CavVoid","url":"https://cavvoid.haguma.com"}
```

Keep the existing password, database, proxy secret and session settings. Confirm its browser origin is the verified login host and its existing cookie domain covers `cavvoid.haguma.com` (the local reference is `haguma.com`). Do not overwrite a working cookie scope from an example. Validate and recreate only the gateway backend using its **actual** Compose/env paths. If the confirmed layout matches the local OAuthenticator reference, from that gateway checkout:

```sh
docker compose --env-file backend/.env -f compose.production.yaml config --quiet
docker compose --env-file backend/.env -f compose.production.yaml up -d backend_gatekeeper
```

These paths/service names are confirmed. No gateway image rebuild is required for an app-list-only change. The current registration needs no further Gatekeeper changes for this CavVoid update.

## Add only the CavVoid Caddy block

Use [Caddyfile.cavvoid.example](Caddyfile.cavvoid.example): it contains only the hostname and `import gatekeeper_app frontend_cavvoid:80`. The existing shared snippet owns `forward_auth`, its proxy key and credential redaction. There is no CavVoid-specific secret, header, snippet parameter or additional login block.

The actual shared file is `/home/fabrice/Projects/caddy/Caddyfile`, mounted into `caddy_proxy` at `/etc/caddy/Caddyfile`. Keep other site blocks and the shared `gatekeeper_app` definition intact. If the simple CavVoid import is already active, this application update does not require a Caddy change.

Before the edit, preserve the actual host-side shared config and its imports. Confirm the container sees the changed file (single-file bind mounts can retain an editor-replaced inode). With actual values substituted, validation and the familiar restart method are:

```sh
docker exec caddy_proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile &&
# Only after validation succeeds, and only for the identified Caddy container:
docker restart caddy_proxy
```

These identifiers are confirmed. A graceful `caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile` in that same container is an optional alternative when its admin API is enabled. Apply shared Caddy configuration only when it changes, after validation succeeds.

## Start and verify only CavVoid

After backups (when existing data is present), Compose validation/build, gateway registration and the reviewed Caddy change, from the actual CavVoid checkout:

```sh
docker compose --env-file deploy/production.env -f compose.production.yaml up -d backend_cavvoid frontend_cavvoid
docker compose --env-file deploy/production.env -f compose.production.yaml ps
```

Backend health checks the internal database-ready `/health` with the configured Host; Nginx health checks its internal `/nginx-health` without a secret. Public `/health` is not exposed. After both services are healthy, open `https://cavvoid.haguma.com` and verify real sign-in/return, nested routes, manifest/icons, private APIs and main transfers. On failure, inspect only these services first:

```sh
docker compose --env-file deploy/production.env -f compose.production.yaml logs --tail=80 backend_cavvoid frontend_cavvoid
```

For a proxy failure, inspect scoped Caddy logs, network/DNS membership, the upstream and the shared Gatekeeper snippet. Avoid printing the shared Caddyfile or expanded gateway configuration, which contains its proxy key.

Required live checks still pending:

- Signed-out pages redirect safely; JSON/API/SSE/download requests are denied; unknown/expired/revoked cookies cannot gain new access. Check auth outage through an isolated test or an agreed maintenance window, not by casually stopping the shared gateway.
- Spoofed browser identity/forwarding headers cannot bypass the public Caddy gate or choose an owner. The backend has no host binding or shared ingress attachment. Direct Nginx access from the trusted shared Docker network is permitted by this deployment model; test public access separately.
- Same-origin text/file flows, quota and retention, image/audio/document downloads/ranges, five clients, notifications under two seconds and stream closure within 30 seconds through the actual proxy.
- Physical phone ↔ PC, Android/iOS installation/standalone launch, sleep/resume and keyboard; independent browser profiles. Local viewport emulation and HTTP clients do not establish those results.
- Recreate/restart CavVoid containers, confirm database/files/defaults persist, and test a backup restore to a separate location. Preserve the original instance until the restored copy is checked.

## Data, backup and rollback

`cavvoid_cavvoid_data` contains `/data/cavvoid.sqlite` plus SQLite sidecars and `/data/files/{tmp,objects}`. Preserve the **whole volume**, not just the main SQLite file or uploaded blobs. Local demo data and Gatekeeper's database are not copied into this new production volume. Migration 4 is applied on backend startup by the single database owner. Before a later upgrade, record the old schema/image release and make a consistent stopped-backend backup; interruption aborts unfinished uploads, whose leases/cleanup recover on restart.

On the VPS, from the actual CavVoid checkout, save the old runtime file (mode 600), commit, image IDs and tag in a private backup directory outside the Git/build context. Confirm the volume belongs to CavVoid. The following pattern uses the current already-built backend image, no new utility image:

```sh
umask 077
CAVVOID_BACKUP_DIR="$HOME/backups/cavvoid/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$CAVVOID_BACKUP_DIR"
cp -p deploy/production.env "$CAVVOID_BACKUP_DIR/production.env"
git rev-parse HEAD > "$CAVVOID_BACKUP_DIR/commit.txt"
docker compose --env-file deploy/production.env -f compose.production.yaml stop backend_cavvoid
# Confirm backend is stopped and no other writer uses this volume before copying.
CAVVOID_BACKEND_IMAGE="$(docker compose --env-file deploy/production.env -f compose.production.yaml images -q backend_cavvoid)"
test -n "$CAVVOID_BACKEND_IMAGE"
docker run --rm --network none --user 0 --entrypoint tar \
  --mount type=volume,src=cavvoid_cavvoid_data,dst=/source,readonly \
  --mount "type=bind,src=$CAVVOID_BACKUP_DIR,dst=/backup" \
  "$CAVVOID_BACKEND_IMAGE" -cpf /backup/data.tar -C /source .
sha256sum "$CAVVOID_BACKUP_DIR/data.tar" > "$CAVVOID_BACKUP_DIR/data.tar.sha256"
# Resume only after a successful backup, unless an authorized upgrade is next.
docker compose --env-file deploy/production.env -f compose.production.yaml start backend_cavvoid
```

For a first install with no prior CavVoid volume, there is no existing CavVoid data to back up; still preserve the shared Caddy config and gateway configuration before their scoped changes. Keep backups private/offline and test their recovery. Backups have their own retention and can retain content past app expiration.

For restore verification, use the matching backend image and a **new app-scoped volume**, never the live volume. With the private backup directory/image above still set, on the intended VPS:

```sh
sha256sum -c "$CAVVOID_BACKUP_DIR/data.tar.sha256"
CAVVOID_RESTORE_VOLUME="cavvoid_restore_check_$(date -u +%Y%m%dT%H%M%SZ)"
if docker volume inspect "$CAVVOID_RESTORE_VOLUME" >/dev/null 2>&1; then
  echo 'Restore target already exists; select a new isolated check volume.' >&2
  exit 1
fi
docker volume create --label com.haguma.purpose=cavvoid-restore-check "$CAVVOID_RESTORE_VOLUME"
docker run --rm --network none --user 0 --entrypoint tar \
  --mount "type=volume,src=$CAVVOID_RESTORE_VOLUME,dst=/restore" \
  --mount "type=bind,src=$CAVVOID_BACKUP_DIR,dst=/backup,readonly" \
  "$CAVVOID_BACKEND_IMAGE" -xpf /backup/data.tar -C /restore
docker run --rm --network none --entrypoint node \
  --mount "type=volume,src=$CAVVOID_RESTORE_VOLUME,dst=/data" \
  "$CAVVOID_BACKEND_IMAGE" scripts/verify-data.js --database /data/cavvoid.sqlite --files /data/files
```

Only restore an archive you created and trust. `verify-data.js` opens SQLite read-only, checks schema 4, SQLite/foreign-key integrity, file quota metadata and each stored file's size/SHA-256 without printing filenames/content. It performs no migrations or cleanup. Its isolated restored volume allows SQLite to create WAL lock/sidecar files if needed; the original backup remains read-only. Pending deletion and unfinished upload counts are reported for review; normal startup handles their recovery. The isolated target remains separate for inspection and is not selected for production automatically. A successful check does not authorize overwriting newer live drops. Do not use `down -v`, volume pruning, or a backup restore as a routine image rollback.

If a rollout fails, stop further changes. Prefer recreating only CavVoid with the saved prior frontend/backend image tags and compatible config. Keep the old images; do not overwrite their tags. All current release images expect schema 4; earlier milestone images may reject it, so verify compatibility rather than blindly downgrading. An incompatible schema needs a planned recovery/forward fix; restoring an old backup could discard newer drops. If the Caddy block needs rollback, preserve the gate or remove/disable the CavVoid route: never make the private app public. Restore only the affected route/import from the saved shared config and validate before applying it, preserving concurrent unrelated edits.

## Validation record and sources

### Initial VPS startup correction

Both images built successfully from `acf3d78bc2d6864318a1a5c39326f9cc7e242d72`. The first startup failed because Node's fetch replaced the public Host with loopback. `0dc131d` corrected it with a bounded core-HTTP probe; both VPS containers then became healthy. The actual Caddyfile validated and Caddy restarted; a public HTTPS browser request returned the expected Gatekeeper login redirect. The public Host guard remains enforced.

After that correction, `npm test` passed all 89 native checks on Node 22.15.0. Signed-in access then exposed the separate app-secret requirement, while a private frontend request with the old secret succeeded. Fabrice confirmed that all private apps must use the existing one-argument shared Gatekeeper import. This release removes the extra requirement from Nginx, Node, Compose and settings generation. The updated image still needs its actual VPS and signed-in acceptance checks.

For the shared-snippet update, all 89 native checks, the real local Gatekeeper integration test and `npm run build` passed. Production API coverage accepts the trusted proxy request with no credential, keeps the fixed owner despite forged identity headers, rejects incorrect Host/cross-origin mutations, and opens its bounded stream. The real Gateway test covers independent sessions, revocation, logout, expiry and outage. These native tests do not execute the VPS Caddy/Nginx binaries.

Native checks cover the production proxy contract without Docker. Actual shared-snippet behavior, Nginx runtime, persistence, backend recreation/DNS resolution, backup/restore and physical-device checks remain part of VPS acceptance. Earlier image health and unsigned redirects do not establish successful signed-in app use.

Reference behavior follows [Caddy forward authentication](https://caddyserver.com/docs/caddyfile/directives/forward_auth), [Caddy proxy header controls](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers), [Nginx path/buffering controls](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), [Compose service health/environment settings](https://docs.docker.com/reference/compose-file/services/), and [SQLite WAL persistence](https://www.sqlite.org/wal.html). These sources describe the software contracts, not this VPS's current configuration.
