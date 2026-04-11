const { Client } = require('pg')
const url = process.env.DATABASE_URL || 'postgres://postgres:postgres@postgres:5432/hermes_dashboard'

async function migrate(){
  if (process.env.ALLOW_LEGACY_SQL_MIGRATE !== '1') {
    console.error(
      [
        '[db/migrate] This legacy SQL migration script is disabled by default.',
        'The API uses Prisma and expects Prisma-managed tables (e.g. "Company", "Project").',
        'Use `npx prisma db push` / Prisma migrations instead.',
        '',
        'If you really need to run this script, set ALLOW_LEGACY_SQL_MIGRATE=1.'
      ].join('\n')
    )
    process.exit(2)
  }

  const client = new Client({ connectionString: url })
  await client.connect()

  // Apply comprehensive Phase-1 schema
  await client.query(`
    -- Companies
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    );

    -- Projects belong to companies
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    );

    -- Sessions represent a dashboard-tracked session; may map to a Hermes session id
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      hermes_session_id TEXT,
      title TEXT,
      status TEXT DEFAULT 'pending',
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    );

    -- Explicit mapping table for workspace/session artifacts (optional)
    CREATE TABLE IF NOT EXISTS workspace_session_maps (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
      path TEXT,
      artifact_type TEXT,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    );

    -- Guidance events emitted by the dashboard or Hermes (persist for analytics)
    CREATE TABLE IF NOT EXISTS guidance_events (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      payload JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    );

    -- Indexes for common lookups
    CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_hermes_id ON sessions(hermes_session_id);
    CREATE INDEX IF NOT EXISTS idx_guidance_project ON guidance_events(project_id);
  `)

  await client.end()
}

migrate().then(()=>console.log('migrations applied')).catch(e=>{ console.error('migration failed',e); process.exit(1) })
