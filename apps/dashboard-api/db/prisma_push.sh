#!/usr/bin/env sh
# Helper to generate Prisma client and push schema to the database.
# Requires DATABASE_URL env var to be set (e.g. postgres://user:pass@host:5432/db)

set -e

echo "Generating Prisma client..."
npx prisma generate

echo "Pushing schema to database (prisma db push)..."
npx prisma db push

echo "Done."
