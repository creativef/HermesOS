#!/usr/bin/env sh
set -e

echo "[dashboard-api] prisma generate"
npx prisma generate

if [ "${NODE_ENV:-development}" = "production" ]; then
  echo "[dashboard-api] prisma migrate deploy (production)"
  i=0
  while :; do
    if npx prisma migrate deploy; then
      break
    fi
    i=$((i+1))
    if [ "$i" -ge 15 ]; then
      echo "[dashboard-api] prisma migrate deploy failed after retries" >&2
      exit 1
    fi
    echo "[dashboard-api] prisma migrate deploy failed; retrying in 2s (attempt $i/15)..."
    sleep 2
  done
elif [ "${PRISMA_DB_PUSH_ON_START:-}" = "1" ] || [ "${NODE_ENV:-development}" != "production" ]; then
  echo "[dashboard-api] prisma db push (bootstrap schema)"
  # Postgres may not be ready immediately on container start.
  i=0
  while :; do
    if npx prisma db push; then
      break
    fi
    i=$((i+1))
    if [ "$i" -ge 15 ]; then
      echo "[dashboard-api] prisma db push failed after retries" >&2
      exit 1
    fi
    echo "[dashboard-api] prisma db push failed; retrying in 2s (attempt $i/15)..."
    sleep 2
  done
else
  echo "[dashboard-api] skipping prisma db push"
fi

echo "[dashboard-api] starting server"
node index.js
