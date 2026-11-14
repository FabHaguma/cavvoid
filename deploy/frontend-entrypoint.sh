#!/bin/sh
set -eu

valid_secret() {
    case "$1" in *[!a-f0-9]*) return 1 ;; esac
    [ "${#1}" -eq 64 ]
}
valid_limit() {
    case "$1" in ''|0*|*[!0-9]*) return 1 ;; esac
    [ "${#1}" -le 10 ] && [ "$1" -le "$2" ]
}
if ! valid_secret "${CAVVOID_INGRESS_SECRET:-}"; then
    echo 'CavVoid requires a separate 64-character lowercase hex ingress secret.' >&2
    exit 1
fi
if ! valid_limit "${MAX_FILE_BYTES:-}" 1073741824; then
    echo 'Set MAX_FILE_BYTES from 1 to 1073741824.' >&2
    exit 1
fi
if ! valid_limit "${MAX_TEXT_BYTES:-}" 10485760; then
    echo 'Set MAX_TEXT_BYTES from 1 to 10485760.' >&2
    exit 1
fi

# Allow 1 MiB for the bounded multipart envelope, above the backend file limit.
export CAVVOID_BODY_LIMIT_BYTES=$((MAX_FILE_BYTES + 1048576))
# Also admit the backend's JSON transport limit for escaped text characters.
json_limit=$((MAX_TEXT_BYTES * 6 + 4096))
if [ "$json_limit" -gt "$CAVVOID_BODY_LIMIT_BYTES" ]; then
    export CAVVOID_BODY_LIMIT_BYTES=$json_limit
fi
envsubst '${CAVVOID_INGRESS_SECRET} ${CAVVOID_BODY_LIMIT_BYTES}' \
    < /etc/nginx/templates/cavvoid.conf.template \
    > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
