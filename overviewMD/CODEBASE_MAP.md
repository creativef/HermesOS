# Codebase Map (Pre‑Audit)

Goal: identify repository structure and likely responsibilities **without** asserting runtime behavior that can’t be traced in code. Every major statement below cites specific files/modules as evidence.

---

## 1) Architecture summary

**Present in code**
- **Multi-container local stack**: Hermes runtime + Postgres + Dashboard API + Dashboard Web. See `docker-compose.yml`.
- **Dashboard API** is an Express server that:
  - exposes `/api/v1/*` endpoints,
  - persists core records to Postgres via Prisma,
  - calls Hermes via an HTTP adapter. See `apps/dashboard-api/index.js`, `apps/dashboard-api/hermes_adapter.js`, `apps/dashboard-api/prisma/schema.prisma`.
- **Dashboard Web** is a Next.js App Router UI that:
  - serves pages under `src/app/*`,
  - proxies `/api/v1/*` to the Dashboard API using a Next route handler,
  - stores “API key” and selected workspace scope in `localStorage`. See `apps/dashboard-web/src/app`, `apps/dashboard-web/src/app/api/v1/[...path]/route.ts`, `apps/dashboard-web/src/lib/auth.ts`, `apps/dashboard-web/src/lib/workspace.ts`.

**Operational (depends on runtime/config)**
- Running with Docker depends on container networking (service names like `dashboard-api`, `postgres`, `hermes`) and env var configuration in `docker-compose.yml`. No production deployment manifests are present.

---

## 2) Frameworks and major dependencies

**Dashboard API (`apps/dashboard-api`)**
- Express + CORS + Helmet + rate limiting. See `apps/dashboard-api/index.js`, `apps/dashboard-api/package.json`.
- Prisma ORM + `pg` Postgres driver. See `apps/dashboard-api/package.json`, `apps/dashboard-api/prisma/schema.prisma`.

**Dashboard Web (`apps/dashboard-web`)**
- Next.js App Router + React. See `apps/dashboard-web/package.json`, `apps/dashboard-web/src/app/layout.tsx`.
- Tailwind CSS (via `@tailwindcss/postcss`) + Radix primitives + small “shadcn-style” UI components. See `apps/dashboard-web/package.json`, `apps/dashboard-web/postcss.config.mjs`, `apps/dashboard-web/src/components/ui/*`.

---

## 3) Entry points

**Containers / startup**
- Compose entrypoint for the stack: `docker-compose.yml`.
- Dashboard API container starts `npm start` → `sh ./scripts/start.sh` → `node index.js`. See `apps/dashboard-api/package.json`, `apps/dashboard-api/scripts/start.sh`, `apps/dashboard-api/index.js`.
- Dashboard Web container runs `npm run dev` (Next dev server). See `apps/dashboard-web/package.json`, `apps/dashboard-web/Dockerfile`, `docker-compose.yml`.

**Node scripts**
- E2E script (host-run): `tests/e2e/run_create_session.js`.
- Smoke script: `tests/smoke/run.js`.

---

## 4) Route/page/screen inventory

### Dashboard API routes (Express)
Auth note: all `/api/v1/*` routes are protected by `x-api-key` **except** `/api/v1/health` and `/api/v1/hermes/health`. See `apps/dashboard-api/index.js` (`requireApiKey`, `app.use('/api/v1', ...)`).

**Health**
- `GET /api/v1/health` (unauthed) — API status. `apps/dashboard-api/index.js`
- `GET /api/v1/hermes/health` (unauthed) — proxied Hermes health. `apps/dashboard-api/index.js`, `apps/dashboard-api/hermes_adapter.js`

**Overview**
- `GET /api/v1/overview` — counts + lists + grouped stats with optional `companyId`/`projectId` scope. `apps/dashboard-api/index.js`

**Companies**
- `GET /api/v1/companies` — list. `apps/dashboard-api/index.js`
- `GET /api/v1/companies/:companyId` — detail. `apps/dashboard-api/index.js`
- `POST /api/v1/companies` — create (minimal). `apps/dashboard-api/index.js`

**Projects**
- `GET /api/v1/projects` — list. `apps/dashboard-api/index.js`
- `GET /api/v1/projects/:projectId` — detail. `apps/dashboard-api/index.js`
- `POST /api/v1/projects` — create. `apps/dashboard-api/index.js`

**Sessions**
- `GET /api/v1/projects/:projectId/sessions` — list from DB (fallback to Hermes adapter). `apps/dashboard-api/index.js`, `apps/dashboard-api/hermes_adapter.js`
- `POST /api/v1/projects/:projectId/sessions` — persist local session then call Hermes. `apps/dashboard-api/index.js`, `apps/dashboard-api/hermes_adapter.js`
- `GET /api/v1/projects/:projectId/sessions/:sessionId` — local detail includes `guidanceEvents` + `workspaceMaps`. `apps/dashboard-api/index.js`

**Messages**
- `GET /api/v1/projects/:projectId/sessions/:sessionId/messages` — derived from `GuidanceEvent` rows. `apps/dashboard-api/index.js`
- `POST /api/v1/projects/:projectId/sessions/:sessionId/messages` — persists “user_message”, calls Hermes, persists “assistant_message”. `apps/dashboard-api/index.js`, `apps/dashboard-api/hermes_adapter.js`

**Guidance / delegation**
- `POST /api/v1/projects/:projectId/sessions/:sessionId/delegate` — persists a guidance event and (currently) calls Hermes `createSession`. `apps/dashboard-api/index.js`, `apps/dashboard-api/hermes_adapter.js`
- `GET /api/v1/projects/:projectId/guidance_events` — list. `apps/dashboard-api/index.js`
- `GET /api/v1/projects/:projectId/sessions/:sessionId/events` — list. `apps/dashboard-api/index.js`

**Reports**
- `GET /api/v1/reports/sessions-per-project` — groupBy counts. `apps/dashboard-api/index.js`
- `GET /api/v1/reports/guidance-events-per-project` — groupBy counts. `apps/dashboard-api/index.js`

**Admin**
- `GET /api/v1/admin/db` — table counts. `apps/dashboard-api/index.js`

### Dashboard Web routes (Next.js App Router)
**Pages**
- `/` overview/home: `apps/dashboard-web/src/app/page.tsx`
- `/health`: `apps/dashboard-web/src/app/health/page.tsx`
- `/issues`: `apps/dashboard-web/src/app/issues/page.tsx` (explicitly scaffolded)
- `/projects`: `apps/dashboard-web/src/app/projects/page.tsx`
- `/projects/[projectId]`: `apps/dashboard-web/src/app/projects/[projectId]/page.tsx`
- `/projects/[projectId]/sessions/[sessionId]`: `apps/dashboard-web/src/app/projects/[projectId]/sessions/[sessionId]/page.tsx`

**API proxy**
- `/api/v1/*` proxy handler: `apps/dashboard-web/src/app/api/v1/[...path]/route.ts`

---

## 5) Feature inventory

**Present in code**
- API-key gated dashboard API (`x-api-key`) with rate limiting. `apps/dashboard-api/index.js`
- Company/project creation + selection in UI. `apps/dashboard-web/src/components/app-shell.tsx`, `apps/dashboard-api/index.js`, `apps/dashboard-api/prisma/schema.prisma`
- Session creation per project (persist locally + Hermes call) and session list/detail. `apps/dashboard-api/index.js`, `apps/dashboard-web/src/app/projects/[projectId]/page.tsx`
- Message send + message history view (implemented via `GuidanceEvent`). `apps/dashboard-api/index.js`, `apps/dashboard-web/src/app/projects/[projectId]/sessions/[sessionId]/page.tsx`
- Overview dashboard (counts + recent sessions/events). `apps/dashboard-api/index.js`, `apps/dashboard-web/src/app/page.tsx`
- Reports endpoints for sessions/events per project (API only; no dedicated UI page). `apps/dashboard-api/index.js`

**Scaffolded / incomplete / unclear operationally**
- “Issues” page is a placeholder. `apps/dashboard-web/src/app/issues/page.tsx`
- Workspace session mapping model exists but there are no create/update routes or sync job in API. `apps/dashboard-api/prisma/schema.prisma`, `apps/dashboard-api/index.js`
- Hermes session continuity (“continue session”, session list/detail) is not implemented beyond `createSession` and a best-effort `listSessions`. `apps/dashboard-api/hermes_adapter.js`

---

## 6) Shared components and utilities

**Dashboard Web**
- Layout shell + left nav + workspace selectors: `apps/dashboard-web/src/components/app-shell.tsx`
- UI primitives: `apps/dashboard-web/src/components/ui/button.tsx`, `apps/dashboard-web/src/components/ui/card.tsx`, `apps/dashboard-web/src/components/ui/input.tsx`, `apps/dashboard-web/src/components/ui/separator.tsx`
- HTTP helpers (adds `x-api-key` from localStorage): `apps/dashboard-web/src/lib/http.ts`
- Auth/key persistence: `apps/dashboard-web/src/lib/auth.ts`
- Workspace selection persistence: `apps/dashboard-web/src/lib/workspace.ts`

**Dashboard API**
- Hermes adapter: `apps/dashboard-api/hermes_adapter.js`

---

## 7) Service/API/integration inventory

**Internal services**
- `dashboard-web` → `dashboard-api` via Next route handler proxy. `apps/dashboard-web/src/app/api/v1/[...path]/route.ts`, `docker-compose.yml`
- `dashboard-api` → Postgres via Prisma. `apps/dashboard-api/index.js`, `apps/dashboard-api/prisma/schema.prisma`, `docker-compose.yml`
- `dashboard-api` → Hermes HTTP API (`/health`, `/v1/chat/completions`, optional `/v1/sessions`). `apps/dashboard-api/hermes_adapter.js`, `docker-compose.yml`

**External**
- Docker pulls a published Hermes image. `docker-compose.yml`

---

## 8) State management approach

**Present in code**
- Client-side state is managed with React hooks + `localStorage`.
  - API key stored in localStorage (`ADMIN_API_KEY`). `apps/dashboard-web/src/lib/auth.ts`
  - selected company/project stored in localStorage. `apps/dashboard-web/src/lib/workspace.ts`
  - per-page state uses `useState` + `useEffect`. Example: `apps/dashboard-web/src/app/page.tsx`, `apps/dashboard-web/src/app/projects/page.tsx`

**Not present**
- No Redux/Zustand/React Query in the repo.

---

## 9) Database/auth/storage/background-job usage

**Database**
- Postgres is used as the primary persistence store for the dashboard domain. `docker-compose.yml`, `apps/dashboard-api/prisma/schema.prisma`
- Schema includes: `Company`, `Project`, `Session`, `GuidanceEvent`, `WorkspaceSessionMap`. `apps/dashboard-api/prisma/schema.prisma`
- Schema lifecycle:
  - `prisma db push` runs automatically in non-production (or when `PRISMA_DB_PUSH_ON_START=1`). `apps/dashboard-api/scripts/start.sh`
  - `prisma migrate deploy` is used only for `NODE_ENV=production`. `apps/dashboard-api/scripts/start.sh`

**Auth**
- Single shared admin API key in env (`ADMIN_API_KEY`) required for almost all API routes. `apps/dashboard-api/index.js`
- No user accounts, sessions, OAuth, or RBAC present in code.

**Storage**
- Postgres volume for persistence (`postgres_data`). `docker-compose.yml`
- Hermes data stored via host bind mount `~/.hermes:/opt/data`. `docker-compose.yml`
- Dashboard web stores key + selections in browser localStorage. `apps/dashboard-web/src/lib/auth.ts`, `apps/dashboard-web/src/lib/workspace.ts`

**Background jobs**
- None present (no worker process, cron, queue, or scheduler).

---

## 10) Environment/config dependency list

**From `docker-compose.yml`**
- `HERMES_PLATFORM` (optional), `DATABASE_PORT`, `DASHBOARD_API_PORT`, `DASHBOARD_WEB_PORT`
- Dashboard API:
  - `PORT`, `DATABASE_URL`, `HERMES_BASE_URL`, `HERMES_TIMEOUT_MS`, `ADMIN_API_KEY`, `PRISMA_DB_PUSH_ON_START`, `NODE_ENV`
- Dashboard Web:
  - `PORT`, `DASHBOARD_API_URL`, `NEXT_TELEMETRY_DISABLED`, `CHOKIDAR_USEPOLLING`

**Used in API code**
- `API_JSON_LIMIT`, `CORS_ORIGIN`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`. `apps/dashboard-api/index.js`
- Hermes adapter auth header can use `HERMES_API_KEY` / `API_SERVER_KEY` / `API_KEY`. `apps/dashboard-api/hermes_adapter.js`

**Used in Web code**
- `DASHBOARD_API_URL` for proxy base URL. `apps/dashboard-web/src/app/api/v1/[...path]/route.ts`

---

## 11) TODO/FIXME/HACK and placeholder logic inventory

**Present (repo code)**
- “Issues” page explicitly described as scaffolded. `apps/dashboard-web/src/app/issues/page.tsx`

**Not found (excluding `node_modules`)**
- No `TODO`/`FIXME`/`HACK` markers found in repo-authored source as of this scan.

---

## 12) Likely risk hotspots (pre-audit hypotheses)

These are “where to look first” areas; they are **not** claims of bugs.

- **Auth model (single shared key)**: no user separation; mistakes can expose all data/actions. `apps/dashboard-api/index.js`, `apps/dashboard-web/src/lib/auth.ts`
- **Hermes adapter shape assumptions**: `createSession` uses `/v1/chat/completions` and then code tries to interpret the response as if it contains IDs; compatibility depends on the Hermes image/API. `apps/dashboard-api/hermes_adapter.js`, `apps/dashboard-api/index.js`
- **Schema lifecycle in dev (`db push`)**: can drift schema without migration history; can surprise data integrity when moving to production. `apps/dashboard-api/scripts/start.sh`, `apps/dashboard-api/prisma/migrations`
- **Data integrity**: many IDs are `Date.now()` derived and relations allow nullable `companyId` / `projectId` on some models; this can create orphaned records. `apps/dashboard-api/index.js`, `apps/dashboard-api/prisma/schema.prisma`
- **Proxying headers through Next route handler**: forwards most headers upstream; review for cookie/header leakage and caching behavior. `apps/dashboard-web/src/app/api/v1/[...path]/route.ts`

---

## 13) Recommended audit order (business risk + failure impact)

1. **Auth & perimeter**: `x-api-key` enforcement, exemptions, rate limiting, and any routes that should be unauthed. `apps/dashboard-api/index.js`
2. **Hermes adapter correctness & error handling**: request/response shapes, timeouts, retries, and how failures are persisted/exposed. `apps/dashboard-api/hermes_adapter.js`, `apps/dashboard-api/index.js`
3. **DB schema + lifecycle**: migrations vs `db push`, constraints, nullable relations, uniqueness, and seed/migrate scripts. `apps/dashboard-api/prisma/schema.prisma`, `apps/dashboard-api/prisma/migrations`, `apps/dashboard-api/scripts/start.sh`
4. **Session/message persistence semantics**: ensure what the UI shows actually corresponds to persisted events; validate ordering and duplication risks. `apps/dashboard-api/index.js`, `apps/dashboard-web/src/app/projects/[projectId]/sessions/[sessionId]/page.tsx`
5. **Proxy boundary**: confirm `dashboard-web` proxy behavior won’t create surprising auth bypasses or caching issues. `apps/dashboard-web/src/app/api/v1/[...path]/route.ts`
6. **Docker/ops ergonomics**: volumes, `.next`/cache behavior, and local data persistence. `docker-compose.yml`, `apps/dashboard-web/Dockerfile`

