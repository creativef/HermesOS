# Hermes Dashboard — Phased Development Plan

This document captures the working todo list broken into clear, ordered phases for V1.

## Phase 0 — Foundation
- [x] Finalize product language and V1 scope
- [x] Repo layout and Docker-first dev setup
- [x] Add `docker-compose.yml`, `.env.example`, persistent volumes
- [x] Minimal service scaffolds (`dashboard-api`, `dashboard-web`)

## Phase 1 — Core Domain
- [x] Define core DB schema (companies/projects/sessions/events)
- [x] Add “context artifacts” model (separate from workspace maps)
- [x] Add DB migrations and ORM wiring (Prisma + Postgres)
- [x] Implement core backend CRUD for `companies` and `projects`

## Phase 2 — Hermes Integration
- [x] Implement Hermes adapter (health + chat completions)
- [ ] Workspace session mapping (sync + `last_synced_at`)
- [x] Demo end-to-end: create project -> create session -> view session

## Phase 3 — Guidance & Timeline
- [x] Persistence and model for `guidance_events`
- [x] API to create/send guidance (minimal: persist + Hermes call)
- [ ] UI timeline integration and visibility settings

## Phase 4 — Reports & Analytics
- [x] Reports generation endpoints (sessions/events per project)
- [ ] Reports storage (`reports`)
- [ ] Analytics snapshot pipeline (`analytics_snapshots`)
- [x] Basic dashboards: counts + recent activity (overview)

## Phase 5 — Frontend (Shadcn-based)
- [x] Scaffold frontend with Tailwind, Radix, and `shadcn/ui` primitives
- [x] Implement pages: Workspace Home, Projects, Project Overview, Session Detail
- [ ] Implement pages: Reports, Analytics, Context
- [x] Connect components to API, add basic client state (localStorage + hooks)

## Phase 6 — Testing, Docs, and Dev Workflow
- [x] End-to-end local dev flow (docker compose + hot reload)
- [x] Add basic E2E/smoke tests (node scripts)
- [x] Documentation set + run instructions (overviewMD/* + per-app READMEs)

## Phase 7 — Release Prep & CI
- Add CI for lint/test/build
- Prepare deployment manifests (optional)

## Notes & Priorities
- Hermes remains source-of-truth for sessions/messages — always reference by `hermes_session_id`.
- Keep persistence separate: Hermes data vs platform DB.
- Prioritize Hermes adapter and DB schema early to avoid rework.

## Effort Estimate & Milestones

Summary estimates for remaining work (time = engineering days):
- Finish API contract & polishing OpenAPI: 1 day
- ORM + migrations hardened (Prisma migrations, data migration if needed): 2 days
- Backend features (projects, sessions, guidance flows, analytics): 3 days
- Frontend polish (shadcn/Next UI pages for Workspace/Project/Session): 5 days
- End-to-end tests + local dev workflow improvements: 2 days
- Documentation, README, env, run instructions: 1 day
- CI pipeline (GitHub Actions) + basic deployment steps: 1 day

Total (timeboxed): ~15 engineering days (3 weeks at 5d/week for 1 FTE), or compressible to 2 weeks with parallel work (frontend + backend concurrently).

Proposed milestone plan (two-week sprint cadence):
- Sprint 1 (Days 1–5): Finalize OpenAPI, harden Prisma migrations, wire up backend endpoints and reports.
- Sprint 2 (Days 6–10): Implement frontend pages (Workspace Home, Project Overview, Session Detail). Add basic E2E smoke tests.
- Sprint 3 (Days 11–15): Polishing, analytics/reporting, docs, CI, and deployment scaffolding.

If you'd like, I can now scaffold a basic GitHub Actions CI workflow and add pipeline checks. I'll do that next.

---

## Contemplating Future Implementation: Ideas from Other Projects

This section captures *potential* features/workflows observed in other open-source projects. These are **not committed scope** and should be treated as exploratory inputs for future phases.

Reference projects:
- `hermelinChat`: https://github.com/quarker1337/hermelinChat
- `conductor-oss`: https://github.com/charannyk06/conductor-oss

### What we might borrow from `hermelinChat`
- **Terminal-first Hermes UX**: a “real terminal” experience (PTY-backed) rather than only HTTP-proxy chat, to preserve native CLI behaviors and ergonomics.
- **Session history via local state**: fast session browsing/switching by reading Hermes’ local state (where applicable), reducing reliance on runtime APIs for history.
- **Runner gateway for artifacts/previews**: proxy locally hosted previews/artifacts through a single origin with tokenized access to avoid random ports/CORS and reduce attack surface.
- **Single-port deployment shape**: consolidate UI + proxy routes + API behind one surface for simpler local/prod operations.
- **Operational security knobs**: explicit configuration for cookie/session secrets, secure cookies, trust-proxy, optional IP allowlists, etc.
- **Caveat**: some artifact flows may depend on non-upstream Hermes tooling contracts; adopt only if we commit to a compatible “tooling contract”.

### What we might borrow from `conductor-oss`
- **Markdown-native task intake**: treat a Markdown board (e.g. `CONDUCTOR.md`-style) as a human-first kanban source of truth for tasks.
- **Worktree isolation**: run parallel sessions in isolated git worktrees so concurrent agent runs do not trample the same branch/repo state.
- **Ops primitives**: retry/restore/kill/cleanup workflows, plus health tracking and “session feed” visibility for long-running work.
- **Diff/preview surfaces**: built-in per-session diff view + preview URLs integrated into the dashboard.
- **Layered architecture**: clear separation between “core models”, “git ops”, “executors/adapters”, “watcher”, and “server” to keep orchestration maintainable.

### Recommended adoption order (highest leverage, lowest disruption)
1. **Runner gateway + previews** (from `hermelinChat` patterns) to stabilize previews/artifacts and reduce operational friction.
2. **Task lifecycle + dispatch queue** (from `conductor-oss`) to formalize “what work is next” and support review/retry.
3. **Worktree isolation** (from `conductor-oss`) for safe parallelization and reviewable outputs.
4. **Terminal-first mode** (from `hermelinChat`) if HTTP chat is insufficient; this is a larger architectural commitment.
