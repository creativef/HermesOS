# Evidence-Based Audit Report

Date: 2026-04-10  
Scope: `apps/dashboard-web` (Next.js UI) + `apps/dashboard-api` (Express API) + local stack in `docker-compose.yml`.

This report is intentionally skeptical:
- I only mark behavior as **Confirmed from code** when the implementation path is traceable in this repo.
- Anything depending on external services (Hermes) or runtime configuration is tagged as **Requires runtime verification** or **Blocked by missing configuration**.

---

## Executive summary (highest-risk first)

### 1) Background-job model is in-process and not restart-safe
**Conclusion:** Confirmed from code  
**Why it matters:** message processing can stall or be lost across API restarts; queued/running jobs are not resumed automatically.  
**Evidence:** `apps/dashboard-api/index.js` (`processMessageJob`, jobs created in `POST /api/v1/projects/:projectId/sessions/:sessionId/messages` and executed via `setImmediate`, no startup sweep for `queued`/`running` jobs).

### 2) “Session chat” is not a real multi-turn conversation (no history is sent)
**Conclusion:** Confirmed from code  
**Why it matters:** the UI suggests a session timeline, but Hermes calls do not include previous messages; each “send” is a fresh completion with only a system+user message.  
**Evidence:** `apps/dashboard-api/index.js` (`processMessageJob` calls `hermes.createSession` with `{ prompt: job.input, system: … }` only); `apps/dashboard-api/hermes_adapter.js` (`createSession` builds `messages` as `[system?] + [user]`, `stream:false`).

### 3) API auth is a single global API key; SSE passes key via query string
**Conclusion:** Confirmed from code  
**Why it matters:** broad access, easy leakage (localStorage + URL logs), no per-company/project authorization, no user identity model.  
**Evidence:** `apps/dashboard-api/index.js` (`requireApiKey`, applied to all `/api/v1/*` except health); `apps/dashboard-web/src/lib/auth.ts` (stores `ADMIN_API_KEY` in `localStorage`); `apps/dashboard-web/src/app/api/v1/[...path]/route.ts` (supports `?apiKey=` because EventSource cannot send headers); `apps/dashboard-web/src/app/projects/[projectId]/sessions/[sessionId]/page.tsx` (EventSource URL includes `apiKey=...`).

### 4) Resource/performance risk: per-client SSE handler uses a polling loop
**Conclusion:** Confirmed from code  
**Why it matters:** each SSE connection runs a `while(!closed)` loop with DB polling every ~2 seconds; under load this can degrade API responsiveness.  
**Evidence:** `apps/dashboard-api/index.js` (`GET /message_jobs/:jobId/stream` loops and `findUnique` repeatedly).

### 5) Data integrity & correctness risks in create flows
**Conclusion:** Confirmed from code  
**Why it matters:** some creates do not validate inputs; at least one create does not await persistence before responding.  
**Evidence:** `apps/dashboard-api/index.js` (`POST /api/v1/companies` calls `prisma.company.create(...).catch(...)` without `await`; `POST /api/v1/projects` accepts arbitrary `id` and uses defaults without validation).

---

## Architecture overview

### Components (present in code)
- **Dashboard Web UI**: Next.js App Router + React + Tailwind + shadcn-style UI components.  
  Evidence: `apps/dashboard-web/package.json`, `apps/dashboard-web/src/app/layout.tsx`, `apps/dashboard-web/src/components/ui/*`.
- **Dashboard API**: Express REST API with Prisma ORM targeting Postgres.  
  Evidence: `apps/dashboard-api/package.json`, `apps/dashboard-api/index.js`, `apps/dashboard-api/prisma/schema.prisma`.
- **Hermes integration**: HTTP adapter talking to a Hermes “OpenAI-compatible” endpoint (`/v1/chat/completions`).  
  Evidence: `apps/dashboard-api/hermes_adapter.js`.
- **Local runtime stack** (docker-compose): `hermes` + `postgres` + `dashboard-api` + `dashboard-web`.  
  Evidence: `docker-compose.yml`.

### Data model (present in code)
Prisma models: `Company`, `Project`, `Session`, `GuidanceEvent`, `ContextArtifact`, `MessageJob`, `WorkspaceSessionMap`.  
Evidence: `apps/dashboard-api/prisma/schema.prisma`.

### Runtime readiness (operational)
- **Local dev appears intended to run via Docker Compose**.  
  Evidence: `docker-compose.yml`, `apps/dashboard-api/README.md`.
- **Production posture is incomplete** (single API key, no user auth, schema lifecycle is mixed between `migrate deploy` and `db push`).  
  Evidence: `apps/dashboard-api/scripts/start.sh`, `apps/dashboard-api/index.js` (production guard for `ADMIN_API_KEY`).

---

## Frameworks and major dependencies

### `apps/dashboard-web` (UI)
**Confirmed from code**
- Next.js, React: `apps/dashboard-web/package.json`
- Tailwind CSS: `apps/dashboard-web/package.json`, `apps/dashboard-web/src/app/globals.css`
- Radix UI primitives: `apps/dashboard-web/package.json`, `apps/dashboard-web/src/components/ui/dialog.tsx`
- Charting: Chart.js + react-chartjs-2: `apps/dashboard-web/package.json`, `apps/dashboard-web/src/components/usage-charts.tsx`

### `apps/dashboard-api` (API)
**Confirmed from code**
- Express, CORS, Helmet, rate limiting: `apps/dashboard-api/package.json`, `apps/dashboard-api/index.js`
- Prisma + Postgres (`pg`): `apps/dashboard-api/package.json`, `apps/dashboard-api/prisma/schema.prisma`

---

## Entry points

### UI entry
**Confirmed from code**
- Next App Router root layout: `apps/dashboard-web/src/app/layout.tsx`
- Overview page: `apps/dashboard-web/src/app/page.tsx`

### API entry
**Confirmed from code**
- Express server: `apps/dashboard-api/index.js`
- Hermes adapter: `apps/dashboard-api/hermes_adapter.js`

### Docker entry
**Confirmed from code**
- Compose stack definition: `docker-compose.yml`
- API startup script: `apps/dashboard-api/scripts/start.sh`

---

## Route / page / screen inventory

### UI routes (Next.js)
**Confirmed from code** (`apps/dashboard-web/src/app/*`)
- `/` Overview: `apps/dashboard-web/src/app/page.tsx`
- `/health`: `apps/dashboard-web/src/app/health/page.tsx`
- `/projects`: `apps/dashboard-web/src/app/projects/page.tsx`
- `/projects/[projectId]`: `apps/dashboard-web/src/app/projects/[projectId]/page.tsx`
- `/projects/[projectId]/sessions/[sessionId]`: `apps/dashboard-web/src/app/projects/[projectId]/sessions/[sessionId]/page.tsx`
- `/issues` placeholder: `apps/dashboard-web/src/app/issues/page.tsx`
- `/api/v1/*` proxy route (server-side): `apps/dashboard-web/src/app/api/v1/[...path]/route.ts`

### API routes (Express)
**Confirmed from code** (`apps/dashboard-api/index.js`)
- Health: `GET /api/v1/health`, `GET /api/v1/hermes/health`
- Overview: `GET /api/v1/overview`
- Companies: `GET /api/v1/companies`, `POST /api/v1/companies`, `GET/PATCH/DELETE /api/v1/companies/:companyId`, `GET/PUT /api/v1/companies/:companyId/brief`
- Projects: `GET /api/v1/projects`, `POST /api/v1/projects`, `GET/PATCH/DELETE /api/v1/projects/:projectId`, `GET/PUT /api/v1/projects/:projectId/brief`
- Context artifacts: `GET /api/v1/context_artifacts`, `POST /api/v1/context_artifacts/upsert`
- Sessions: `GET /api/v1/projects/:projectId/sessions`, `POST /api/v1/projects/:projectId/sessions`, `GET/PATCH /api/v1/projects/:projectId/sessions/:sessionId`
- Guidance events: `GET /api/v1/projects/:projectId/guidance_events`, `GET /api/v1/projects/:projectId/sessions/:sessionId/events`
- Messages + jobs:  
  - `GET /api/v1/projects/:projectId/sessions/:sessionId/messages`  
  - `POST /api/v1/projects/:projectId/sessions/:sessionId/messages` (creates `MessageJob`)  
  - `GET /api/v1/projects/:projectId/sessions/:sessionId/message_jobs/:jobId`  
  - `POST /api/v1/projects/:projectId/sessions/:sessionId/message_jobs/:jobId/retry`  
  - `GET /api/v1/projects/:projectId/sessions/:sessionId/message_jobs/:jobId/stream` (SSE)
- Reports: `GET /api/v1/reports/sessions-per-project`, `GET /api/v1/reports/guidance-events-per-project`
- Admin: `GET /api/v1/admin/db`
- Delegate (scaffold): `POST /api/v1/projects/:projectId/sessions/:sessionId/delegate`

---

## Primary application flows (end-to-end trace)

### Flow: set API key → load Overview
**Confirmed from code**
1. User sets key in UI; stored in localStorage.  
   Evidence: `apps/dashboard-web/src/app/page.tsx` (Set key), `apps/dashboard-web/src/lib/auth.ts`
2. UI calls `GET /api/v1/overview` via same-origin proxy route.  
   Evidence: `apps/dashboard-web/src/lib/http.ts` (`x-api-key` header), `apps/dashboard-web/src/app/api/v1/[...path]/route.ts`
3. API enforces `x-api-key` for `/api/v1/*` except health routes.  
   Evidence: `apps/dashboard-api/index.js` (`requireApiKey`, `app.use('/api/v1', ...)`)

### Flow: create company + optional brief (UI modal)
**Confirmed from code**
1. UI `POST /api/v1/companies` with `{name, slug}`.  
   Evidence: `apps/dashboard-web/src/components/app-shell.tsx` (`createCompanyFlow`)
2. Optional brief `PUT /api/v1/companies/:companyId/brief`.  
   Evidence: `apps/dashboard-web/src/components/app-shell.tsx` (`createCompanyFlow`), API handler in `apps/dashboard-api/index.js`
**Reliability note:** Company create route doesn’t await DB write before responding.  
Evidence: `apps/dashboard-api/index.js` (`POST /api/v1/companies`).

### Flow: create project + optional brief (+ optional company assignment)
**Confirmed from code**
1. UI `POST /api/v1/projects` with `{name, companyId}`.  
   Evidence: `apps/dashboard-web/src/components/app-shell.tsx` (`createProjectFlow`), API handler in `apps/dashboard-api/index.js`
2. Optional brief `PUT /api/v1/projects/:projectId/brief`.  
   Evidence: same files as above.

### Flow: create session
**Confirmed from code**
1. UI `POST /api/v1/projects/:projectId/sessions` with `{title, prompt}`.  
   Evidence: `apps/dashboard-web/src/app/projects/[projectId]/page.tsx`
2. API creates a local `Session` row and then calls Hermes `createSession` (OpenAI-compatible completion).  
   Evidence: `apps/dashboard-api/index.js` (`POST /sessions`), `apps/dashboard-api/hermes_adapter.js` (`createSession`)
**Requires runtime verification:** Whether Hermes returns a stable “session id” for `hermesSessionId` field.  
Evidence: API sets `Session.hermesSessionId = hermesRes.result.id || hermesRes.result.hermes_session_id`. (`apps/dashboard-api/index.js`)

### Flow: send message → async Hermes job → UI updates
**Confirmed from code**
1. UI posts user message to API: `POST /messages`.  
   Evidence: `apps/dashboard-web/src/app/projects/[projectId]/sessions/[sessionId]/page.tsx` (`send`)
2. API persists `GuidanceEvent(user_message)` and creates `MessageJob(queued)` then runs `processMessageJob` via `setImmediate`.  
   Evidence: `apps/dashboard-api/index.js` (messages POST + `processMessageJob`)
3. UI watches job via SSE; adds `?apiKey=` to stream URL to bypass EventSource header limitation.  
   Evidence: `apps/dashboard-web/src/app/projects/[projectId]/sessions/[sessionId]/page.tsx` (`watchJob`), `apps/dashboard-web/src/app/api/v1/[...path]/route.ts`
4. Job completion persists `GuidanceEvent(assistant_message)` and stores token/cost fields.  
   Evidence: `apps/dashboard-api/index.js` (`processMessageJob`, `parseUsage`, `estimatedUsd`)

---

## Feature status matrix (high-level)

Legend: Fully functional / Partially operational / Present but incomplete / Not implemented  
Each line includes a confidence tag.

- API key auth (global): **Partially operational** (Confirmed from code) — works for gating, lacks user/role model.  
  Evidence: `apps/dashboard-api/index.js`, `apps/dashboard-web/src/lib/auth.ts`
- Company CRUD: **Partially operational** (Confirmed from code) — create is non-awaited; no validation/uniqueness handling surfaced.  
  Evidence: `apps/dashboard-api/index.js`, `apps/dashboard-web/src/components/app-shell.tsx`
- Company brief: **Partially operational** (Confirmed from code) — can upsert, cannot clear to empty.  
  Evidence: `apps/dashboard-api/index.js` (brief PUT), `apps/dashboard-web/src/components/app-shell.tsx`
- Project CRUD: **Partially operational** (Confirmed from code) — force delete supported; validation minimal.  
  Evidence: `apps/dashboard-api/index.js`, `apps/dashboard-web/src/app/projects/page.tsx`
- Project brief: **Partially operational** (Confirmed from code) — can upsert, cannot clear to empty.  
  Evidence: `apps/dashboard-api/index.js`, `apps/dashboard-web/src/app/projects/[projectId]/page.tsx`
- Session list/create/rename (dashboard-local): **Partially operational** (Confirmed from code) — local DB records exist; Hermes “session” semantics unclear.  
  Evidence: `apps/dashboard-api/index.js`, `apps/dashboard-web/src/app/projects/[projectId]/sessions/[sessionId]/page.tsx`
- Messaging + async jobs + SSE: **Partially operational** (Confirmed from code) — restart safety + SSE auth edge cases.  
  Evidence: `apps/dashboard-api/index.js`, `apps/dashboard-web/src/app/projects/[projectId]/sessions/[sessionId]/page.tsx`
- Usage analytics (monthly + charts): **Partially operational** (Confirmed from code) — based on `MessageJob` sums; cost is estimated and needs config.  
  Evidence: `apps/dashboard-api/index.js` (`/overview` usage rollups), `apps/dashboard-web/src/components/usage-charts.tsx`
- Issues page: **Present but incomplete** (Confirmed from code).  
  Evidence: `apps/dashboard-web/src/app/issues/page.tsx`

---

## UX/UI issues

### SSE job streaming can fail without a clean fallback
**Conclusion:** Confirmed from code  
**Problem:** `watchJob` sets `streamWorked=true` after creating `EventSource`, but does not fall back to polling if the stream returns 401/403 (it only falls back if creation throws).  
**Evidence:** `apps/dashboard-web/src/app/projects/[projectId]/sessions/[sessionId]/page.tsx` (`watchJob`).

### Key leakage risk for SSE
**Conclusion:** Confirmed from code  
**Problem:** `apiKey` is passed via query string for SSE; URLs are commonly logged and can leak secrets.  
**Evidence:** `apps/dashboard-web/src/app/api/v1/[...path]/route.ts`, `apps/dashboard-web/src/app/projects/[projectId]/sessions/[sessionId]/page.tsx`.

### Inability to clear a brief to empty
**Conclusion:** Confirmed from code  
**Problem:** brief endpoints return 400 if body is empty; UI cannot remove briefs (only overwrite with non-empty).  
**Evidence:** `apps/dashboard-api/index.js` (`PUT /companies/:id/brief`, `PUT /projects/:id/brief`).

### Navigation labeling inconsistency
**Conclusion:** Confirmed from code  
**Problem:** Sidebar link labeled “Companies & projects” routes to `/projects` which is primarily a project list/creator page; companies are managed via modals in `AppShell`.  
**Evidence:** `apps/dashboard-web/src/components/app-shell.tsx`, `apps/dashboard-web/src/app/projects/page.tsx`.

---

## Reliability / maintainability issues

### Jobs are not durable across restarts
**Conclusion:** Confirmed from code  
**Evidence:** `apps/dashboard-api/index.js` (`setImmediate(processMessageJob)`, no “resume queued jobs” logic).

### Session “Hermes session id” may be storing completion ids
**Conclusion:** Likely but unverified  
**Why uncertain:** Hermes response shape is external; code uses `result.id` or `result.hermes_session_id` without validating semantics.  
**Evidence:** `apps/dashboard-api/index.js` (sets `hermesSessionId`), `apps/dashboard-api/hermes_adapter.js` (`/v1/chat/completions`).

### Mixed DB schema lifecycle (db push vs migrations)
**Conclusion:** Confirmed from code  
**Evidence:** `apps/dashboard-api/scripts/start.sh` (production uses `migrate deploy`, dev uses `db push`), `docker-compose.yml` (`PRISMA_DB_PUSH_ON_START=1`), `apps/dashboard-api/prisma/migrations/*`.

### Legacy SQL scripts exist (disabled by default)
**Conclusion:** Confirmed from code  
**Evidence:** `apps/dashboard-api/db/migrate.js`, `apps/dashboard-api/db/inspect.js` (require `ALLOW_LEGACY_SQL_*` to run).

---

## Performance findings

### `/api/v1/overview` loads all MessageJobs for ~6 months without pagination
**Conclusion:** Confirmed from code  
**Risk:** grows unbounded with usage; can cause slow overview load.  
**Evidence:** `apps/dashboard-api/index.js` (`messageJob.findMany({ where: { createdAt: { gte: rangeStart } } ... })`).

### SSE per-client DB polling loop
**Conclusion:** Confirmed from code  
**Evidence:** `apps/dashboard-api/index.js` (`GET /message_jobs/:jobId/stream` loop).

---

## Security findings

### Single global API key (no user identity, no RBAC, no authorization)
**Conclusion:** Confirmed from code  
**Evidence:** `apps/dashboard-api/index.js` (`requireApiKey` compares to `ADMIN_API_KEY`).

### API key stored in localStorage
**Conclusion:** Confirmed from code  
**Evidence:** `apps/dashboard-web/src/lib/auth.ts`.

### API key in query string for SSE
**Conclusion:** Confirmed from code  
**Evidence:** `apps/dashboard-web/src/app/api/v1/[...path]/route.ts`, `apps/dashboard-web/src/app/projects/[projectId]/sessions/[sessionId]/page.tsx`.

### Demo defaults encourage weak-key usage
**Conclusion:** Confirmed from code  
**Evidence:** `docker-compose.yml` (`ADMIN_API_KEY=${ADMIN_API_KEY:-devkey}`), `apps/dashboard-web/src/app/page.tsx` (“Use devkey” button), `tests/smoke/run.js` default `devkey`.

---

## Integration and dependency risks

### Hermes API compatibility is assumed
**Conclusion:** Requires runtime verification  
**Why:** adapter assumes OpenAI-style response with `choices[0].message.content` and `usage.*`.  
**Evidence:** `apps/dashboard-api/hermes_adapter.js`, `apps/dashboard-api/index.js` (`extractAssistantText`, `parseUsage`).

---

## Environment / configuration dependencies

### Dashboard API (`apps/dashboard-api`)
**Confirmed from code** (`apps/dashboard-api/index.js`, `apps/dashboard-api/scripts/start.sh`, `apps/dashboard-api/hermes_adapter.js`)
- `ADMIN_API_KEY` (required for all `/api/v1/*` except health; required in production startup guard)
- `DATABASE_URL` (Prisma datasource; connect attempted at startup)
- `PORT` (default `4000`)
- `CORS_ORIGIN` (dev default `http://localhost:3000`)
- `API_JSON_LIMIT` (default `1mb`)
- `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX`
- `HERMES_BASE_URL` (default `http://hermes:8642`)
- `HERMES_TIMEOUT_MS` / `HERMES_HTTP_TIMEOUT_MS` (adapter timeout)
- `HERMES_JOB_TIMEOUT_MS` (job timeout for Hermes calls)
- `HERMES_MIN_ASSISTANT_CHARS` (reject short/empty assistant outputs)
- `COST_PER_1K_TOKENS_USD` (cost estimation)
- `NODE_ENV` (affects prisma migrate vs db push, and `ADMIN_API_KEY` production requirement)

### Dashboard Web (`apps/dashboard-web`)
**Confirmed from code** (`apps/dashboard-web/src/app/api/v1/[...path]/route.ts`)
- `DASHBOARD_API_URL` (upstream base for proxy; default `http://dashboard-api:4000`)

### Docker Compose defaults (local)
**Confirmed from code** (`docker-compose.yml`)
- `ADMIN_API_KEY` defaults to `devkey` (local convenience; unsafe for non-local use)
- `DATABASE_PORT` defaults to `5433` mapped to Postgres `5432`
- `DASHBOARD_API_PORT` defaults to `4000`, `DASHBOARD_WEB_PORT` defaults to `3000`

---

## TODO/FIXME/HACK, placeholders, demo defaults

### Marker scan
**Confirmed from code scan**
- Repo-authored source contains very few explicit `TODO`/`FIXME` markers; most results are in `node_modules`.  
  Evidence: repository scan output (see `overviewMD/CODEBASE_MAP.md` note) and presence of placeholders below.

### Explicitly scaffolded / placeholder features
**Confirmed from code**
- Issues screen is a scaffold with explanatory copy.  
  Evidence: `apps/dashboard-web/src/app/issues/page.tsx`.

### Demo / weak defaults
**Confirmed from code**
- Default admin key `devkey` appears in compose + UI + tests.  
  Evidence: `docker-compose.yml`, `apps/dashboard-web/src/app/page.tsx`, `tests/smoke/run.js`.
- Demo seed data (`company-demo`, `project-demo`, `session-demo`).  
  Evidence: `apps/dashboard-api/db/seed.js`.

---

## Unknowns and blockers

- Whether Hermes returns stable session identifiers or supports session continuation: **Requires runtime verification**.  
  Evidence: only `/v1/chat/completions` is used (`apps/dashboard-api/hermes_adapter.js`).
- Whether the UI proxy route behaves correctly under real reverse proxy / production hosting: **Requires runtime verification**.  
  Evidence: `apps/dashboard-web/src/app/api/v1/[...path]/route.ts`.
- Whether Prisma referential actions match comments (e.g., “ON DELETE SET NULL”): **Likely but unverified** without inspecting the actual DB schema/migrations produced.  
  Evidence: comment in `apps/dashboard-api/index.js`, optional relation in `apps/dashboard-api/prisma/schema.prisma`.

---

## Top priorities (recommended)

1. Make message-job processing durable (worker + resume logic; avoid in-request infinite loops).  
   Evidence: `apps/dashboard-api/index.js` (`processMessageJob`, SSE loop).
2. Decide and implement true conversation semantics (store and send conversation history, or rename UX to “single-shot prompts”).  
   Evidence: `apps/dashboard-api/hermes_adapter.js`, `apps/dashboard-api/index.js`, UI “session” pages.
3. Replace global API key with an auth model appropriate for production; remove query-string key for SSE (use cookie auth or server-issued short-lived token).  
   Evidence: `apps/dashboard-api/index.js`, `apps/dashboard-web/src/app/api/v1/[...path]/route.ts`.
4. Bound and optimize overview usage aggregation (DB-side grouping, indexes, pagination).  
  Evidence: `apps/dashboard-api/index.js` overview query.

---

## Confirmed findings (quick list)

- Global API key auth gates all `/api/v1/*` except health. (Confirmed)  
  Evidence: `apps/dashboard-api/index.js`
- UI stores API key in localStorage and attaches `x-api-key` to requests. (Confirmed)  
  Evidence: `apps/dashboard-web/src/lib/auth.ts`, `apps/dashboard-web/src/lib/http.ts`
- SSE stream auth uses query-string `apiKey` workaround. (Confirmed)  
  Evidence: `apps/dashboard-web/src/app/api/v1/[...path]/route.ts`
- Message processing is asynchronous but executed inside the API process; not restart-safe. (Confirmed)  
  Evidence: `apps/dashboard-api/index.js`
- Hermes calls are “single-shot” chat completions without session history. (Confirmed)  
  Evidence: `apps/dashboard-api/hermes_adapter.js`, `apps/dashboard-api/index.js`

## Suspected findings requiring runtime verification

- Whether Hermes responds with `usage.prompt_tokens/completion_tokens/total_tokens` consistently. (Requires runtime verification)  
  Evidence: `apps/dashboard-api/index.js` (`parseUsage`)
- Whether `hermesRes.result.id` is a “session id” vs a “completion id”. (Likely but unverified)  
  Evidence: `apps/dashboard-api/index.js` (`hermesSessionId` assignments)
