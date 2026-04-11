# Prioritized remediation tasks

Severity key: Critical / High / Medium / Low  
Each task includes evidence and validation steps.

---

## 1) Make MessageJobs restart-safe (durable worker + resume)
- Severity: **Critical**
- Category: **Reliability**
- Description: `MessageJob` processing runs in the API process via `setImmediate`. If the API restarts, queued/running jobs will not resume. Add a worker loop (separate process or in-app scheduler) that periodically claims `queued` jobs, marks them `running`, processes them, and finalizes status. On startup, requeue stale `running` jobs (based on `updatedAt` + timeout).  
- Evidence: `apps/dashboard-api/index.js` (`POST /messages` creates `MessageJob` and calls `setImmediate(processMessageJob)`; no resume sweep).
- Affected files/modules: `apps/dashboard-api/index.js`, `apps/dashboard-api/prisma/schema.prisma` (may need fields like `lockedAt`, `attempts`)
- Recommended fix:
  - Add atomic “claim job” logic (transaction) and a simple interval worker (or split into `worker.js` container).
  - Track attempts, nextRunAt/backoff, and lock ownership.
  - Ensure Hermes timeouts map to `timeout` status deterministically.
- Dependencies/blockers: none (local-only stack); production concurrency requirements may change design.
- Validation steps:
  1. Start a job, restart API mid-run, confirm job finishes and UI updates.
  2. Create multiple jobs concurrently, confirm they all complete without duplicate processing.

---

## 2) Implement true multi-turn conversation or rename UX to match behavior
- Severity: **Critical**
- Category: **Bug / UX**
- Description: Each “message” is processed as a fresh `/v1/chat/completions` request containing only `[system?] + [user]`, meaning session chat history isn’t used. Either:
  - implement conversation replay (load prior `GuidanceEvent` messages and include them), or
  - explicitly label the UI as “single-shot prompts” and don’t imply continuity.  
- Evidence: `apps/dashboard-api/hermes_adapter.js` (`createSession` builds messages without history), `apps/dashboard-api/index.js` (`processMessageJob` passes only prompt/system).
- Affected files/modules: `apps/dashboard-api/index.js`, `apps/dashboard-api/hermes_adapter.js`, `apps/dashboard-web/src/app/projects/[projectId]/sessions/[sessionId]/page.tsx`
- Recommended fix:
  - Load recent user/assistant events for `sessionId` and send them as `messages[]`.
  - Add truncation/windowing to avoid huge prompts.
- Dependencies/blockers: Hermes must accept standard OpenAI `messages[]` (requires runtime verification).
- Validation steps:
  1. Send message A then B referencing A; confirm model uses prior context.

---

## 3) Remove API key from query strings (SSE auth redesign)
- Severity: **High**
- Category: **Security**
- Description: SSE streams use `?apiKey=` because EventSource cannot send headers. This leaks credentials via logs/history and creates inconsistent auth behavior.  
- Evidence: `apps/dashboard-web/src/app/api/v1/[...path]/route.ts` (query param handling), `apps/dashboard-web/src/app/projects/[projectId]/sessions/[sessionId]/page.tsx` (EventSource URL includes `apiKey`).
- Affected files/modules: `apps/dashboard-web/src/app/api/v1/[...path]/route.ts`, `apps/dashboard-web/src/app/projects/[projectId]/sessions/[sessionId]/page.tsx`, `apps/dashboard-api/index.js`
- Recommended fix options:
  - Switch SSE to `fetch()` streaming (ReadableStream) where you can send headers; or
  - Use cookie-based auth for same-origin proxy; or
  - Issue a short-lived stream token (server-signed) and validate it server-side.
- Dependencies/blockers: depends on desired auth model; local-only can keep a dev-only fallback behind an explicit flag.
- Validation steps:
  1. Confirm `/stream` works without query-string secrets.
  2. Confirm unauthorized requests are rejected.

---

## 4) Fix SSE fallback: if stream returns 401/403, fall back to polling
- Severity: **High**
- Category: **Reliability / UX**
- Description: `watchJob` treats stream as “worked” once constructed; if the SSE request is unauthorized, it won’t automatically fall back to polling, leaving users stuck.  
- Evidence: `apps/dashboard-web/src/app/projects/[projectId]/sessions/[sessionId]/page.tsx` (`watchJob` sets `streamWorked=true` and doesn’t handle auth failure).
- Affected files/modules: `apps/dashboard-web/src/app/projects/[projectId]/sessions/[sessionId]/page.tsx`
- Recommended fix:
  - Add a timeout: if no `status` event arrives within N seconds, close stream and start polling.
  - Detect `error` events early and switch to polling.
- Dependencies/blockers: none.
- Validation steps:
  1. Remove API key; confirm UI still resolves job state via polling with a visible warning.

---

## 5) Await persistence and add validation for Company create
- Severity: **High**
- Category: **Bug / Reliability**
- Description: Company creation responds before `prisma.company.create` completes; unique constraint violations (slug) aren’t surfaced reliably to the client.  
- Evidence: `apps/dashboard-api/index.js` (`POST /api/v1/companies` uses `prisma.company.create(...).catch(...)` without `await`).
- Affected files/modules: `apps/dashboard-api/index.js`, `apps/dashboard-web/src/components/app-shell.tsx`
- Recommended fix:
  - `await` the create and return `409` on unique violations.
  - Validate `name` and `slug` length/format on both client and server.
- Dependencies/blockers: none.
- Validation steps:
  1. Attempt to create two companies with same slug; confirm 409 + UI message.

---

## 6) Add a way to clear briefs (delete or allow empty)
- Severity: **Medium**
- Category: **UX / Missing Feature**
- Description: brief PUT handlers reject empty bodies; user cannot remove a brief once set.  
- Evidence: `apps/dashboard-api/index.js` (`PUT /companies/:id/brief`, `PUT /projects/:id/brief` return 400 on empty).
- Affected files/modules: `apps/dashboard-api/index.js`, `apps/dashboard-web` brief editors (`app-shell.tsx`, `projects/[projectId]/page.tsx`)
- Recommended fix:
  - Allow empty to mean “delete artifact”, or add explicit `DELETE /brief`.
- Dependencies/blockers: none.
- Validation steps:
  1. Set a brief, clear it, confirm it is removed and no longer included in system context.

---

## 7) Bound and optimize `/api/v1/overview` usage aggregation
- Severity: **Medium**
- Category: **Performance**
- Description: overview loads all MessageJobs for ~6 months and aggregates in JS; will slow down as job volume grows.  
- Evidence: `apps/dashboard-api/index.js` (`messageJob.findMany` with only `createdAt >= rangeStart` and no `take`).
- Affected files/modules: `apps/dashboard-api/index.js`
- Recommended fix:
  - Use DB-side group-by (e.g., Prisma groupBy by day/week/month if possible) or pre-aggregate tables.
  - Add indexes aligned to queries; confirm `@@index([projectId, sessionId, createdAt])` is sufficient.  
  - Consider limiting to requested scopes only and supporting pagination for “recent”.
- Dependencies/blockers: depends on Prisma capabilities; may require raw SQL.
- Validation steps:
  1. Seed many jobs (e.g., 100k), measure `/overview` response time before/after.

---

## 8) Clarify and enforce “production vs local” configuration
- Severity: **Medium**
- Category: **Security / Tech Debt**
- Description: `devkey` defaults are present in compose, UI, and tests; safe for local dev but dangerous if deployed.  
- Evidence: `docker-compose.yml` (`ADMIN_API_KEY:-devkey`), `apps/dashboard-web/src/app/page.tsx` (“Use devkey”), `tests/smoke/run.js` default.
- Affected files/modules: `docker-compose.yml`, `apps/dashboard-web/src/app/page.tsx`, `tests/*`
- Recommended fix:
  - Gate “Use devkey” button behind `NODE_ENV !== 'production'`.
  - Require explicit `ADMIN_API_KEY` when not running in compose “local” profile.
- Dependencies/blockers: none.
- Validation steps:
  1. Ensure production build refuses to start without a strong key.

