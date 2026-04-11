# System Architecture

## System in one sentence

A Hermes-centered, Dockerized workspace platform where Hermes remains the intelligence runtime, while the dashboard provides organization, visibility, reporting, analytics, and soft guidance across companies and projects.

## Core containers

### 1. Hermes container
Owns:
- session runtime
- delegated sessions
- memory/context behavior
- skills, hooks, cron, and Hermes-native processing

Should remain as close to Hermes-native behavior as possible.

### 2. Dashboard API container
Owns:
- company and project model
- workspace switching
- guidance events
- reports
- analytics aggregation
- Hermes integration layer
- session mapping to projects

This is the primary custom backend service.

### 3. Dashboard Web container
Owns:
- frontend UI
- session explorer
- project dashboard
- guidance panel
- reports view
- analytics view
- company and project switching

Should primarily talk to the Dashboard API.

### 4. App database container
Owns platform-level data:
- companies
- projects
- guidance events
- reports metadata
- analytics snapshots
- mappings between Hermes sessions and app workspaces

## Clean topology

User -> Dashboard Web -> Dashboard API -> Hermes
Dashboard API -> App DB

## Data ownership

### Hermes owns
- session IDs
- message continuity
- delegated session lineage
- Hermes-native runtime metadata
- token/cost/runtime data if exposed

### Dashboard owns
- company records
- project records
- workspace settings
- project briefs
- guidance events
- report records
- analytics snapshots
- user-facing structure and mappings

## Service boundary principle

Hermes owns intelligence.
The dashboard owns structure.

## Hermes adapter

The Dashboard API should contain a Hermes adapter layer responsible for:
- calling Hermes
- normalizing Hermes responses
- translating session-native concepts into dashboard-friendly responses
- insulating the app from Hermes implementation changes

## V1 container set

- hermes
- dashboard-api
- dashboard-web
- postgres

Optional later:
- redis
- worker
- reverse proxy

## Persistence strategy

### Hermes persistence
Use a dedicated persistent volume for Hermes-native state.

### Dashboard persistence
Use a dedicated persistent volume for app database state.

### Rule
Do not mix Hermes persistence and app persistence into one schema too early.
