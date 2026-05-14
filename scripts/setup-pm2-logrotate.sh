#!/bin/bash
#
# One-time PM2 log rotation setup.
#
# PM2's per-app log_size / log_file options in ecosystem.config don't
# rotate — that's done by a separate PM2 module (pm2-logrotate). Run
# this script once on every box that runs `bun run pm2:start`.
#
# Idempotent: re-running just re-applies the same settings.
#
# Usage:
#   ./scripts/setup-pm2-logrotate.sh

set -e

if ! command -v pm2 &>/dev/null; then
    echo "pm2 not found — install with: npm i -g pm2" >&2
    exit 1
fi

echo "[pm2-logrotate] Installing module (no-op if already installed)..."
pm2 install pm2-logrotate

# Settings: 10MB rotation, keep 7 files (~70MB ceiling per stream),
# rotate on size threshold OR daily, gzip old files, system timezone.
# These match the daemon's expected ~MB/day footprint with headroom.
echo "[pm2-logrotate] Applying configuration..."
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'   # daily at midnight
pm2 set pm2-logrotate:workerInterval 30            # check every 30s

echo "[pm2-logrotate] Done. Current settings:"
pm2 conf pm2-logrotate
