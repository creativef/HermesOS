# Dashboard API

Quick start for local development (requires Postgres and Hermes running via `docker compose` in the repo root).

Environment
- `DATABASE_URL` - Postgres connection string (e.g. `postgres://postgres:postgres@localhost:5433/hermes_dashboard`)
- `HERMES_BASE_URL` - optional, default `http://hermes:8642`
- `ADMIN_API_KEY` - if set, required for admin + write endpoints (sent as `x-api-key`)
- `PRISMA_DB_PUSH_ON_START` - set to `1` to run `prisma db push` during startup (useful in dev/CI)
- `HERMES_TIMEOUT_MS` - timeout for Dashboard API -> Hermes HTTP calls

Install & run locally

```bash
cd apps/dashboard-api
npm install
# generate prisma client
npx prisma generate
# push schema (requires DATABASE_URL)
DATABASE_URL="postgres://postgres:postgres@localhost:5433/hermes_dashboard" npx prisma db push
# start
npm start
```

Docker
Use the repository `docker-compose.yml` to run the full stack (Hermes, Postgres, API, Web).

Notes
- The API uses Prisma at runtime; Prisma migrations live under `prisma/migrations/`.
- Startup behavior:
  - `NODE_ENV=production`: runs `npx prisma migrate deploy` (expects a migrations history).
  - non-production: runs `npx prisma db push` by default to bootstrap a dev DB.
- `db/migrate.js` is a legacy SQL-based schema script and may not match the Prisma model mapping.
