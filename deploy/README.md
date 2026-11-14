# CavVoid VPS preparation

**Status:** Deployment package prepared locally; exact host handoff awaits the VPS folder, live Caddy mount/container, gateway checkout/upstream, and service/network conflict evidence. Nothing has been deployed.

**Domain:** `https://cavvoid.haguma.com` → **Caddy upstream:** `frontend_cavvoid:80`. The backend is `backend_cavvoid:3001` on the app-private network, with no host port. The Compose project is `cavvoid`; its persistent volume is `cavvoid_cavvoid_data`.

**Next:** Supply the missing host details or an SSH target for read-only inspection. Once confirmed, the short release path is laptop commit/push → SSH → pull/build in the chosen VPS folder → scoped gateway/Caddy update → start only CavVoid. Those mutation commands belong to requested milestone 9. Do not run the rollout sections merely to review this package.

## Confirmed facts and missing host details

| Item | Evidence/status |
|---|---|
| App origin | `https://cavvoid.haguma.com`, supplied by Fabrice; DNS registration reported, live routing not checked |
| Source repository | `https://github.com/FabHaguma/cavvoid.git`, from this checkout's Git remote |
| App services | Package uses `frontend_cavvoid:80`, `backend_cavvoid:3001`; local configuration search found no competing definition; live conflict check pending |
| Ingress network | Existing convention `caddy_network`; confirm membership/aliases on the VPS |
| App checkout | **Missing.** Suggested `~/apps/cavvoid` is a choice to confirm, not a verified server path |
| Caddy | Local `Programming/Server/caddy/docker-compose.yml` names `caddy_proxy` and mounts `./Caddyfile` at `/etc/caddy/Caddyfile`; current live container and host-side path remain unconfirmed |
| Gateway | Local OAuthenticator production reference uses `https://login.haguma.com`, `backend_gatekeeper:4000`, `COOKIE_DOMAIN=haguma.com`; confirm live values and checkout/env/Compose paths |
| Shared config layout | Local shared Caddyfile contains other sites and no current gateway/CavVoid block. Determine which of the actual one/two shared files owns this hostname; add only the CavVoid block there |
| Runtime | Docker/Compose, image builds, Nginx/Caddy validation, ingress isolation, HTTPS and persistence are **pending on the VPS**; local Docker was not probed or used |

On the intended VPS checkout, the read-only helper collects container names, ports, networks, selected Caddy mounts/version and disk space without dumping environments or Caddyfile secrets:

```sh
CAVVOID_VPS_INSPECT=1 CAVVOID_CADDY_CONTAINER=THE_VERIFIED_CONTAINER sh deploy/inspect-vps.sh
```

`THE_VERIFIED_CONTAINER` is an explicit missing input. Do not paste it unchanged. Use the results to confirm that `frontend_cavvoid` is not already another app's alias on `caddy_network`, and that existing `cavvoid` services/volume, if any, belong to this application. An existing deployment's mounts take precedence over assuming a new empty volume.

## Package and trust boundary

```text
Browser HTTPS → existing Caddy → Gatekeeper /auth/verify
                         ↓ only after approval
                   frontend_cavvoid:80 (Nginx)
                         ↓ app-private network
                   backend_cavvoid:3001 → /data
```

`Dockerfile` builds the current Vite UI into Nginx and a separate native Node 22 backend. `compose.production.yaml` has uniquely named images with a required release tag, restart policies, health checks, read-only roots, and one persistent `/data` volume. Only Nginx joins `caddy_network`; the backend joins only the project-scoped internal network. There are no published host ports. Keep one backend replica/database writer.

Local development continues verifying the cookie directly with the local gateway. Production instead requires `NODE_ENV=production`, `AUTH_MODE=trusted-ingress`, exact HTTPS app/gateway origins, absolute persistent paths, and a **separate** 64-character lowercase hex `CAVVOID_INGRESS_SECRET`. Caddy overwrites `X-CavVoid-Ingress` with this proof only after Gatekeeper approves. Both Nginx and Node reject missing/incorrect proof, including requests from other containers that reach the shared ingress network. Node still enforces exact Host, fixed owner, expiry, quota and CSRF. Network isolation and correct Caddy ordering remain required; possessing the app proof is not a replacement for the gateway.

Gatekeeper's existing `PROXY_AUTH_SECRET` stays solely in Gatekeeper/Caddy verification configuration. Never put it, the administrator password, or gateway cookies into CavVoid's runtime/build. Caddy redacts the gateway cookie and removes its verification-secret header; Nginx drops cookies and that header before proxying. The app proof is removed before API handlers. The Docker build context excludes `.env`/runtime credentials, data, backups and local QA artifacts.

Nginx routes `/api/` and `/api/events` before static routes, preserves the full path/query, streams uploads/downloads without proxy caching or disk buffering, and leaves API failures as errors. SSE buffering is off, Caddy flushes immediately, and Node retains its fixed 25-second lifetime. Upload/body limits derive from the same file/text limits plus bounded multipart/JSON overhead; proxy upload inactivity is 20 minutes and backend request timeout 30 minutes. The browser's file request timeout remains 20 minutes. In-progress transfers may finish after session revocation; the next request/stream reconnect is gated again.

Only `/`, `/kept` and `/settings` get the SPA index. Unknown files/routes return 404. Manifest MIME, worker scope and the shell marker are set explicitly. Security/no-store headers cover static/error responses; APIs retain their backend headers. Nginx access logs are disabled and error logging is critical-only; the proposed CavVoid Caddy block discards its access log so search queries do not become access-log records. Inspect actual global/proxy logging on the VPS and avoid debug logs or `nginx -T`, which can reveal proof values.

## Requested rollout — laptop first

These commands are prepared instructions, **not executed deployment**. Fabrice commits/pushes the intended release from the laptop. No commit or push was made by this milestone. Use the existing Git remote and the intended branch. The VPS must receive the exact pushed commit, not just local untracked files.

On the verified SSH target, use the confirmed CavVoid checkout. For a new folder, clone `https://github.com/FabHaguma/cavvoid.git` into that chosen folder once. For an existing deployment, run the stopped-app backup below and preserve its current runtime file, commit and image IDs **before pulling or changing its release tag**. Then preserve ignored private runtime/data files, use `git pull --ff-only`, and confirm `git rev-parse HEAD` is the intended pushed commit. Do not overwrite an unrelated checkout or discard uncommitted server changes.

From that **confirmed VPS CavVoid folder**, after the gateway origin is verified:

```sh
node scripts/prepare-production.js --gateway-origin https://THE_VERIFIED_LOGIN_HOST --release "$(git rev-parse HEAD)"
docker compose --env-file deploy/production.env -f compose.production.yaml config --quiet
docker compose --env-file deploy/production.env -f compose.production.yaml build --pull
```

The login host above is deliberately unresolved. The helper creates mode-600 `deploy/production.env`, generates only CavVoid's own proof, preserves it and existing limits on later releases, and updates the image tag. It prints no secret and starts no service. Do not run it on a live checkout before preserving the previous runtime file/release tag. For later updates, do not generate a new proof unless coordinating the matching private Caddy change. Review the selected official Node 22/Nginx stable base-image digests on the VPS and record the resulting image IDs alongside the commit for rollback.

## Register just CavVoid in the existing gateway

In the **confirmed Gatekeeper checkout/env**, append this one entry to the existing complete `PROTECTED_APPS` JSON array, keeping all current entries and exactly one assignment:

```json
{"id":"cavvoid","name":"CavVoid","url":"https://cavvoid.haguma.com"}
```

Keep the existing password, database, proxy secret and session settings. Confirm its browser origin is the verified login host and its existing cookie domain covers `cavvoid.haguma.com` (the local reference is `haguma.com`). Do not overwrite a working cookie scope from an example. Validate and recreate only the gateway backend using its **actual** Compose/env paths. If the confirmed layout matches the local OAuthenticator reference, from that gateway checkout:

```sh
docker compose --env-file backend/.env -f compose.production.yaml config --quiet
docker compose --env-file backend/.env -f compose.production.yaml up -d backend_gatekeeper
```

Those relative paths/service names are reference commands until the actual host is confirmed. No gateway image rebuild is required for an app-list-only change. This step changes a shared authentication service; preserve all other registered apps and test them afterward. Do not stop the shared gateway to perform a routine CavVoid smoke test.

## Add only the CavVoid Caddy block

Review [Caddyfile.cavvoid.example](Caddyfile.cavvoid.example). It contains only the affected hostname. Confirm the gateway upstream, then merge this block into the correct actual shared Caddyfile without replacing other sites or adding another login block. If this hostname already exists, edit that one block rather than creating a duplicate.

In the **private deployed block**, replace the verification placeholder with the existing Gatekeeper proxy secret, and the app-proof placeholder with the separate value in CavVoid's private runtime file. Reuse an existing Caddy secret/snippet mechanism if the actual layout provides one; never commit either secret. Keep the mounted config and backups private (mode 600 where appropriate). Do not print either file into the chat or run full `docker inspect`/Compose expansion that displays environments.

Before the edit, preserve the actual host-side shared config and its imports. Confirm the container sees the changed file (single-file bind mounts can retain an editor-replaced inode). With actual values substituted, validation and the familiar restart method are:

```sh
docker exec THE_VERIFIED_CADDY_CONTAINER caddy validate --config /THE/VERIFIED/CONTAINER/CONFIG --adapter caddyfile
# Only after validation succeeds, and only for the identified Caddy container:
docker restart THE_VERIFIED_CADDY_CONTAINER
```

These are intentionally marked missing identifiers, not ready-to-run exact commands. A graceful `caddy reload --config ... --adapter caddyfile` in that same container is an optional alternative when its admin API is enabled; it avoids restarting shared ingress. If only the app images change later and routing/proof are unchanged, leave Caddy alone. Runtime validation must happen before any reload/restart; no local parse is a substitute.

## Start and verify only CavVoid

After backups (when existing data is present), Compose validation/build, gateway registration and the reviewed Caddy change, from the actual CavVoid checkout:

```sh
docker compose --env-file deploy/production.env -f compose.production.yaml up -d backend_cavvoid frontend_cavvoid
docker compose --env-file deploy/production.env -f compose.production.yaml ps
```

Backend health checks the internal database-ready `/health` with the configured Host; Nginx health checks require its app proof. Public `/health` is not exposed. After both services are healthy, open `https://cavvoid.haguma.com` and verify real sign-in/return, nested routes, manifest/icons, private APIs and main transfers. On failure, inspect only these services first:

```sh
docker compose --env-file deploy/production.env -f compose.production.yaml logs --tail=80 backend_cavvoid frontend_cavvoid
```

Do not paste secrets or sensitive requests from logs. For a proxy failure, inspect scoped Caddy logs in the verified container, its network/DNS membership, the precise upstream and the two distinct proof values privately. Do not reset shared networks or restart unrelated services.

Required live checks still pending:

- Signed-out pages redirect safely; JSON/API/SSE/download requests are denied; unknown/expired/revoked cookies cannot gain new access. Check auth outage through an isolated test or an agreed maintenance window, not by casually stopping the shared gateway.
- Spoofed identity/forwarding/proof headers cannot bypass Caddy; direct Nginx without the app proof returns 403; backend has no host binding or shared ingress attachment. Verify from the actual external network and Docker topology.
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

Native checks cover the production config/admission boundary without Docker. Image builds, Compose runtime validation, Nginx `-t`, actual shared Caddy validation/reload, TLS/DNS, persistent volume ownership, backend recreation/DNS resolution, private network bypass tests, backup/restore and physical devices must run on the intended VPS in milestone 9. The host identifiers above are still required to finish milestone 8's exact handoff.

Reference behavior follows [Caddy forward authentication](https://caddyserver.com/docs/caddyfile/directives/forward_auth), [Caddy proxy header controls](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers), [Nginx path/buffering controls](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), [Compose service health/environment settings](https://docs.docker.com/reference/compose-file/services/), and [SQLite WAL persistence](https://www.sqlite.org/wal.html). These sources describe the software contracts, not this VPS's current configuration.
