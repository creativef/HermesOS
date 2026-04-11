# Docker Dev Setup

## Goal

Run Hermes and the dashboard stack in Docker during development, testing, and early iteration with a clean, repeatable local environment.

## Recommended V1 services

- hermes
- dashboard-api
- dashboard-web
- postgres

Optional later:
- redis
- worker

## Development principles

- one command to start the full stack
- persistent local data
- source code mounted for fast iteration
- hot reload where practical
- environment variables managed cleanly
- logs separated by service

## Suggested repo shape

```text
root/
  apps/
    dashboard-web/
    dashboard-api/
  infra/
    docker/
  docs/
  scripts/
  docker-compose.yml
  .env.example
  README.md
```

## Networking model

All services should live on the same Docker network.

- dashboard-web -> dashboard-api
- dashboard-api -> hermes
- dashboard-api -> postgres

The browser should not need direct access to Hermes or Postgres.

## Persistence model

### Hermes
Use a dedicated persistent volume for Hermes-native state.

### Postgres
Use a dedicated persistent volume for app database state.

## Environment variables to define early

- DASHBOARD_WEB_PORT
- DASHBOARD_API_PORT
- DATABASE_URL
- HERMES_BASE_URL
- NODE_ENV or APP_ENV
- feature flags as needed

## Git workflow suggestion

- `main` for stable releases
- `dev` for integration
- feature branches for isolated work

Examples:
- `feature/hermes-adapter`
- `feature/session-view`
- `feature/project-switcher`

## Practical next step after docs

Create:
1. a draft `docker-compose.yml`
2. `.env.example`
3. minimal `dashboard-api` and `dashboard-web` scaffolds
4. Hermes adapter interface in the API service
