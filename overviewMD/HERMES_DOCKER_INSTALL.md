Hermes Agent — Docker install (macOS)

Quick interactive setup (first run)

1. Create the host data directory (stores keys, config, sessions):

   mkdir -p ~/.hermes

2. Run setup interactively to populate `~/.hermes/.env` and initial config:

   docker run -it --rm -v ~/.hermes:/opt/data nousresearch/hermes-agent setup

3. After setup finishes, run the gateway as a persistent background container:

   docker run -d \
     --name hermes \
     --restart unless-stopped \
     -v ~/.hermes:/opt/data \
     nousresearch/hermes-agent gateway run

Using Docker Compose

1. From this workspace run:

   docker compose up -d

2. View logs:

   docker compose logs -f hermes

Notes for Apple Silicon (M1/M2)

- Docker Desktop on macOS handles multi-arch images; if you hit architecture issues, enable "Use Rosetta for x86/amd64 emulation" in Docker Desktop settings or run the container with `platform: linux/amd64` in the compose file.

Troubleshooting

- Container exits immediately: run `docker logs hermes` and ensure `~/.hermes/.env` exists (or re-run the interactive `setup`).
- Permission errors on `~/.hermes`: run `chmod -R 755 ~/.hermes`.
- Browser tools (Playwright) need shared memory: add `--shm-size=1g` to `docker run` or `shm_size: 1g` in compose.

Upgrading

- Pull the newest image and recreate the container:

  docker pull nousresearch/hermes-agent:latest
  docker rm -f hermes
  docker run -d --name hermes --restart unless-stopped -v ~/.hermes:/opt/data nousresearch/hermes-agent gateway run

Useful commands

- Interactive CLI: `docker run -it --rm -v ~/.hermes:/opt/data nousresearch/hermes-agent`
- Diagnose: `docker exec -it hermes hermes doctor` or `docker logs --tail 200 hermes`

References

- Official Docker docs: https://hermes-agent.nousresearch.com/docs/user-guide/docker
- GitHub repo: https://github.com/NousResearch/hermes-agent
