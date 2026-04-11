# Hermes Workspace

A Hermes-centered workspace platform that makes Hermes easier to use, easier to understand, and easier to guide across companies and projects.

## What this repo is for

This project is not built to control Hermes from the outside. It is built to create the best possible environment for Hermes to think, work, persist context, and collaborate with humans.

Hermes remains the centerpiece:
- session runtime
- delegation engine
- memory/context center
- reasoning core

The dashboard becomes the surrounding layer:
- company and project organization
- session visibility
- reporting and analytics
- soft guidance and nudges
- human-friendly workspace

## Core philosophy

- Enhance Hermes, do not constrain it
- Guide Hermes, do not over-govern it
- Surface continuity, do not fragment work
- Translate business structure into Hermes-friendly context
- Keep Hermes first-class in the architecture

## Proposed documentation set

- `PRODUCT_MANIFESTO.md` — product vision and philosophy
- `SYSTEM_ARCHITECTURE.md` — service boundaries and Docker-first topology
- `OBJECT_MODEL.md` — core entities and ownership model
- `V1_SCOPE.md` — practical feature boundary for the first version
- `DOCKER_DEV_SETUP.md` — containerized development structure and principles
- `ROADMAP.md` — phased build direction

## Suggested service layout

- Hermes container
- Dashboard API container
- Dashboard Web container
- App database container

Optional later:
- Redis
- background worker
- reverse proxy

## Suggested next build steps

1. Finalize the core data model
2. Define the API surface between Dashboard API and frontend
3. Draft the UI page map
4. Set up Docker Compose for local development
5. Start with project switching, session visibility, and guidance events
