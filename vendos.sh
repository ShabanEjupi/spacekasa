#!/usr/bin/env bash
# Deploy: run ON the Ampere host. The repo is the source; /home/opc/apps/spacekasa is the copy.
# .env lives only in the copy (never rsync --delete over it).
set -euo pipefail
SRC=/mnt/data/workspace/spacekasa
DST=/home/opc/apps/spacekasa
node_check() { sudo docker run --rm -v "$SRC":/s:ro node:22-slim node --check /s/server.mjs && sudo docker run --rm -v "$SRC":/s:ro node:22-slim node --check /s/public/app.js; }
node_check
sudo docker run --rm -v "$SRC":/s:ro -w /s node:22-slim sh -c "for t in test/*.test.mjs; do node \$t >/dev/null || { echo FAIL \$t; exit 1; }; done"
mkdir -p "$DST"; sudo mkdir -p /mnt/data/spacekasa /mnt/data/spacekasa-supplier
sudo chown 1000:1000 /mnt/data/spacekasa /mnt/data/spacekasa-supplier
rsync -a --exclude .git --exclude .env --exclude data "$SRC"/ "$DST"/
cd "$DST" && sudo docker compose up -d --build
for i in $(seq 20); do curl -fs http://127.0.0.1:8310/health && curl -fs http://127.0.0.1:8311/health && exit 0; sleep 1; done
echo "health failed"; sudo docker logs --tail 20 spacekasa; exit 1
