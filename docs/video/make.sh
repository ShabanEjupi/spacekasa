#!/usr/bin/env bash
# Builds docs/video output on the Ampere host: narration (Edge neural TTS) → screen recording → cut + mix + captions.
#   docs/video/make.sh [base-url] [out-dir]
set -euo pipefail
BASE=${1:-https://kasa.spacecode.tech}
OUT=${2:-/mnt/data/spacekasa-video}
HERE=$(cd "$(dirname "$0")" && pwd)
# Sandbox buyer for the "pay" segment (a PayPal sandbox Personal account, US).
BUYER_EMAIL=${BUYER_EMAIL:?set BUYER_EMAIL}; BUYER_PASS=${BUYER_PASS:?set BUYER_PASS}
VOICE=${VOICE:-en-US-AndrewMultilingualNeural}
mkdir -p "$OUT"
cp "$HERE"/script.json "$HERE"/record.mjs "$HERE"/compose.mjs "$OUT"/

echo "1/4 narration"
sudo docker run --rm -v "$OUT":/o -e VOICE="$VOICE" python:3.12-slim sh -c '
  pip install -q edge-tts >/dev/null 2>&1
  python - <<PY
import json, subprocess, os, time
for i, s in enumerate(json.load(open("/o/script.json"))):
    for attempt in range(4):  # the free endpoint drops a request now and then
        if subprocess.run(["edge-tts", "--voice", os.environ["VOICE"], "--rate=+4%", "--text", s["say"], "--write-media", f"/o/a{i}.mp3"]).returncode == 0: break
        time.sleep(5 * (attempt + 1))
    else: raise SystemExit(f"no audio for segment {i}")
PY'
n=$(ls "$OUT"/a*.mp3 | wc -l)
durs=$(for i in $(seq 0 $((n-1))); do sudo docker run --rm -v "$OUT":/o --entrypoint ffprobe spacecode/ffmpeg:1 -v error -show_entries format=duration -of csv=p=0 /o/a$i.mp3; done | paste -sd,)
echo "[$durs]" > "$OUT"/durations.json

echo "2/4 recording against $BASE"
sudo docker run --rm --network host -v "$OUT":/o mcr.microsoft.com/playwright:v1.55.0-noble sh -c \
  "cd /tmp && npm i -s playwright@1.55.0 >/dev/null 2>&1 && cp /o/record.mjs /o/script.json . && BUYER_EMAIL=$BUYER_EMAIL BUYER_PASS=$BUYER_PASS node record.mjs $BASE /o"

echo "3/4 compose"
sudo docker run --rm -v "$OUT":/o node:22-slim node /o/compose.mjs /o

echo "4/4 render"
sudo docker run --rm -v "$OUT":/o -w /o --entrypoint sh spacecode/ffmpeg:1 -c 'tr "\n" "\0" < ffmpeg.args | xargs -0 ffmpeg -hide_banner -loglevel error'
ls -la "$OUT"/spacekasa-demo.mp4
