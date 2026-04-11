# Object Model

## Hermes-native concepts

### Session
Core unit of active or historical work.

Suggested fields:
- hermes_session_id
- title
- status
- parent_session_id
- lineage
- created_at
- updated_at
- message_count
- token_usage
- cost_usage
- model
- source_platform
- summary
- current_focus
- last_activity

### Delegated Session
Child workstream spawned from a parent session.

Suggested fields:
- hermes_session_id
- parent_hermes_session_id
- objective
- status
- outputs
- created_at
- completed_at
- summary

### Message
Interaction inside a Hermes session.

Suggested fields:
- message_id
- hermes_session_id
- role
- content
- created_at
- metadata
- type

### Skill
Reusable behavior or capability pack.

Suggested fields:
- skill_id
- name
- description
- category
- attached_scope
- version
- active

### Context Artifact
Persistent material influencing future work.

Suggested fields:
- context_id
- type
- scope_type
- scope_id
- body
- created_at
- updated_at

## Dashboard-native concepts

### Company
Top-level business container.

Suggested fields:
- company_id
- name
- description
- owner
- settings_json
- default_guidance_profile
- created_at

### Project
A defined initiative inside a company.

Suggested fields:
- project_id
- company_id
- name
- description
- status
- priority
- objectives
- constraints
- start_date
- deadline
- project_brief
- reporting_cadence
- created_at
- updated_at

### Workspace Mapping
Bridge between the dashboard model and Hermes sessions.

Suggested fields:
- workspace_mapping_id
- company_id
- project_id
- hermes_session_id
- parent_hermes_session_id
- session_kind
- status_cache
- created_from
- last_synced_at

### Guidance Event
Soft steering interaction sent into Hermes.

Suggested fields:
- guidance_id
- company_id
- project_id
- hermes_session_id
- target_type
- guidance_type
- tone
- content
- created_by
- visible_to_users
- outcome_reference
- created_at

### Report
Structured output generated from one or more sessions or projects.

Suggested fields:
- report_id
- company_id
- project_id
- report_type
- generated_at
- source_sessions_json
- title
- body
- attachment_path

### Metric Snapshot
Computed analytics about Hermes behavior or project performance.

Suggested fields:
- metric_id
- scope_type
- scope_id
- metric_name
- metric_value
- time_window
- generated_at

## Relationship summary

- Company has many Projects
- Project has many Workspace Mappings
- Project has many Guidance Events
- Project has many Reports
- Hermes Session may have many Messages
- Hermes Session may have many Delegated Sessions
- Report aggregates one or more sessions
- Metric Snapshot belongs to company, project, or session scope
