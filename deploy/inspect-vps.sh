#!/bin/sh
# Read-only inventory. Run on the intended VPS, never on the laptop.
set -eu
if [ "${CAVVOID_VPS_INSPECT:-}" != 1 ]; then
    echo 'On the intended VPS: CAVVOID_VPS_INSPECT=1 sh deploy/inspect-vps.sh' >&2
    exit 1
fi
printf '\nCheckout: '
pwd
printf '\nContainers (no environment/credentials):\n'
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}\t{{.Networks}}'
printf '\nExisting shared ingress network:\n'
docker network inspect caddy_network --format '{{range .Containers}}{{println .Name .IPv4Address}}{{end}}'
printf '\nReserved app service names and gateway:\n'
for service in frontend_cavvoid backend_cavvoid backend_gatekeeper; do
    docker ps -a --filter "label=com.docker.compose.service=$service" \
        --format '{{.Names}} {{.Label "com.docker.compose.project"}} {{.Image}}'
done
if [ -n "${CAVVOID_CADDY_CONTAINER:-}" ]; then
    printf '\nSelected Caddy mounts (no file contents):\n'
    docker inspect "$CAVVOID_CADDY_CONTAINER" --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
    docker exec "$CAVVOID_CADDY_CONTAINER" caddy version
fi
printf '\nCheckout filesystem space:\n'
df -h .
