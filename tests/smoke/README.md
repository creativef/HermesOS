# Smoke tests

Run the simple smoke checks against a running local stack (expects `dashboard-api` on port 4000):

```bash
# from repo root
node tests/smoke/run.js
```

CI will run these after starting `docker compose up --build -d`.

## Reset drill (local only)

To verify the stack can start from a completely empty Postgres volume:

```bash
cd /Users/Condense/Desktop/hermes_OS
CONFIRM_RESET=1 ./scripts/local_reset.sh
```
