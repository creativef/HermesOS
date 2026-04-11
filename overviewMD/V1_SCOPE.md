# V1 Scope

## V1 goals

Build a Hermes-native workspace that supports:
- company and project structure
- session visibility
- project-scoped chat/session continuation
- soft guidance events
- basic reporting
- basic analytics
- Docker-first local development

## Must-have features

### 1. Company and project structure
- create company
- create project
- switch company and project
- store project brief and company brief

### 2. Session visibility
- list active sessions
- list recent sessions
- open session detail
- show parent and child relationships where possible

### 3. Chat and interaction surface
- start a project-scoped session
- continue an existing session
- send messages through the dashboard

### 4. Soft guidance
- send a nudge to a session
- request summary
- request blockers
- request next steps
- request reorientation to project goals

### 5. Reporting
- session summary
- project summary
- lightweight executive brief

### 6. Basic analytics
- active session count
- delegated session count
- recent activity
- rough token/cost usage if available
- active vs completed workstreams

### 7. Context management
- attach project brief
- attach constraints
- attach preferences
- attach reusable guidance/context notes

## Out of scope for V1

- complex enterprise RBAC
- advanced approval chains
- deep budget/policy engines
- elaborate workflow builder
- marketplace-style skill ecosystem
- highly granular real-time collaboration
- broad automation rule engine

## V1 success test

A user can:
1. select company and project
2. start or resume a Hermes session
3. view what Hermes is doing
4. send a subtle guidance event
5. generate a useful report
6. review basic analytics in one workspace
