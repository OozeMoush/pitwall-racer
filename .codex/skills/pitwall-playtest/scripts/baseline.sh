#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

status=0

echo "== focused gameplay playtests =="
npm run test:playtest || status=1

echo
echo "== full suite =="
npm test || status=1

echo
echo "== production build =="
npm run build || status=1

exit "$status"
