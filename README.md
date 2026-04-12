# HermesOS

HermesOS is a local-first **orchestrator dashboard** for the NousResearch **Hermes Agent**. It gives you a durable “runs + steps” execution model (survives restarts), a clean UI for projects/sessions, and a foundation for human-in-the-loop approvals, scheduling, and usage/cost tracking.

This repo ships as a Docker Compose stack:

- `hermes` (Hermes Agent gateway)
- `postgres` (durable state)
- `dashboard-api` (Express + Prisma + worker loop)
- `dashboard-web` (Next.js UI)

## What you can do today

- **Sessions**: create sessions per project, send messages, and watch Hermes jobs via SSE.
- **Runs**: create durable multi-step runs (`ProjectRun` → `RunStep` → `RunEvent`), with Hermes continuity via `/v1/responses` + `previous_response_id`.
- **Scheduling (v1)**: attach a durable schedule to a session or run:
  - `interval`: run every X minutes/hours/days
  - `times/day`: run N times per day starting at a chosen time (UI shows a daily time preview)
- **Usage & cost estimates**: the dashboard can estimate cost from token totals using env-configured rates.

## How it works (architecture)

**State lives in Postgres** via Prisma (`apps/dashboard-api/prisma/schema.prisma`).

**Execution is durable**:

- A `ProjectRun` is created with an initial “plan” step (`RunStep index=0`).
- The run worker claims work from DB, executes one step at a time, and appends `RunEvent` logs.
- Hermes calls use the Responses API (`/v1/responses`) and store continuity in:
  - `RunStep.hermesResponseId`
  - `ProjectRun.hermesLastResponseId` (fed back as `previous_response_id` on the next step)

**Scheduling is DB-backed**:

- `Schedule` rows store `nextRunAt`, a config blob (`config`), and lock fields.
- The worker periodically claims due schedules and creates a run from the schedule’s `runTemplate`.

## Quickstart (Docker)

1) Create your local env file:

```bash
cp .env.example .env
```

2) Start the stack:

```bash
docker compose up -d --build
```

3) Open the UI:

- Dashboard Web: `http://localhost:3000`
- Dashboard API: `http://localhost:4000`

4) Set the API key in the UI:

- On the Overview page, click **Use devkey** (default for local dev), or paste your own `ADMIN_API_KEY`.

## Configuration

All config is optional for local dev (defaults exist in `docker-compose.yml`), but you can override via `.env`.

### Key env vars

- **Ports**
  - `DASHBOARD_API_PORT` (default `4000`)
  - `DASHBOARD_WEB_PORT` (default `3000`)
  - `DATABASE_PORT` (default `5433` for host access)
- **Auth**
  - `ADMIN_API_KEY` (default `devkey` in compose)  
    Required for all `/api/v1/*` routes except health. The web UI stores this key in `localStorage`.
- **Hermes**
  - `HERMES_BASE_URL` (default `http://hermes:8642`)
  - `HERMES_TIMEOUT_MS` (HTTP timeout for adapter calls)
  - `HERMES_JOB_TIMEOUT_MS` (timeout for background job-style work)
  - `HERMES_PLATFORM` (useful on Apple Silicon if the Hermes image is amd64-only)
- **Cost estimation**
  - Simple: `COST_PER_1K_TOKENS_USD`
  - Split pricing (preferred): `COST_INPUT_PER_1M_TOKENS_USD` and `COST_OUTPUT_PER_1M_TOKENS_USD`

## Using HermesOS

### Projects

- Go to `/projects`, create/select a project.
- On the project page you can see sessions and runs.

### Sessions

- Create a session and start chatting.
- Optional: enable **Automation** and create a schedule tied to that session.

### Runs (durable orchestration)

- Go to the project’s **Runs** page and create a run with a goal.
- Optional: attach it to a session and/or create a schedule for it.
- Open a run to see its timeline (steps + events).

## What this repo still needs (recommended next improvements)

**Scheduling**
- Days-of-week + specific time selection (cron-like UX).
- “N times per day” should support a window (e.g. between 09:00–17:00) instead of spreading across 24h.
- Catch-up policies (missed runs) and concurrency controls per schedule.

**Worker hardening**
- Strict lifecycle transitions (enqueue → claim → start → complete/fail) for runs/steps.
- Capacity limits (`max_concurrent_runs`, `max_concurrent_steps`) and better retries/reaping.
- Option to run the worker as a separate service for isolation.

**Realtime UX**
- WebSocket hub or SSE improvements so timelines update instantly everywhere.

**Usage as first-class data**
- Persist usage entries (tokens + estimated USD) for run steps, not only message jobs, and render usage from DB.

**Security**
- Replace querystring API key patterns (used by SSE) with a real auth strategy (cookies/session/JWT or signed tokens).

## Repo layout

- `apps/dashboard-api/` – Express API, Prisma schema, Hermes adapter, durable run worker
- `apps/dashboard-web/` – Next.js dashboard UI
- `tests/` – smoke/e2e scripts
- `docker-compose.yml` – local stack

## Contributing

PRs are welcome. If you’re adding a feature, prefer:

- DB-backed state (Prisma) over in-process queues
- Append-only events (`RunEvent`) for observability
- Small, composable endpoints over one-off routes

## Safety / secrets

- `.env` is ignored by git (`.gitignore` includes `.env` and `.env.*`).
- Only `.env.example` files are checked in.

