#!/bin/sh
set -e

# The container starts as root only to fix the ownership of the writable
# directories, then runs the app as the unprivileged node user. A deployment
# may bind-mount them from the host (see docs/operate/troubleshooting.md), and host directories
# created before the image switched away from root are still owned by root.
if [ "$(id -u)" = '0' ]; then
  for dir in /app/public/uploads /app/.tmp; do
    mkdir -p "$dir"
    if [ "$(stat -c %u "$dir")" != "$(id -u node)" ]; then
      chown -R node:node "$dir"
    fi
  done
  exec su-exec node "$@"
fi

exec "$@"
