#!/usr/bin/env sh
set -eu

if [ "${CONFIRM_RESET:-}" != "1" ]; then
  echo "Refusing to reset without CONFIRM_RESET=1" >&2
  echo "This will stop containers and DELETE volumes (including Postgres data)." >&2
  echo "" >&2
  echo "Run:" >&2
  echo "  CONFIRM_RESET=1 ./scripts/local_reset.sh" >&2
  exit 2
fi

ADMIN_API_KEY="${ADMIN_API_KEY:-devkey}"
API_BASE="${API_BASE:-http://localhost:4000}"
PROJECT_ID="${PROJECT_ID:-project-demo}"

echo "[reset] docker compose down -v"
docker compose down -v

echo "[reset] docker compose up --build -d"
docker compose up --build -d

echo "[reset] waiting for services..."
sleep 12

echo "[reset] smoke tests"
ADMIN_API_KEY="$ADMIN_API_KEY" node tests/smoke/run.js

echo "[reset] e2e session test"
API_BASE="$API_BASE" ADMIN_API_KEY="$ADMIN_API_KEY" PROJECT_ID="$PROJECT_ID" node tests/e2e/run_create_session.js

echo "[reset] done"
