const { Client } = require('pg')
const url = process.env.DATABASE_URL || 'postgres://postgres:postgres@postgres:5432/hermes_dashboard'

async function inspect(){
  if (process.env.ALLOW_LEGACY_SQL_INSPECT !== '1') {
    console.error(
      [
        '[db/inspect] This legacy SQL inspection script is disabled by default.',
        'The API uses Prisma; prefer `npx prisma studio` or direct Prisma queries.',
        '',
        'If you really need to run this script, set ALLOW_LEGACY_SQL_INSPECT=1.'
      ].join('\n')
    )
    process.exit(2)
  }

  const c = new Client({ connectionString: url })
  await c.connect()
  const tables = (await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")).rows.map(r=>r.table_name)
  console.log('TABLES:', tables.join(','))
  const sess = await c.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='sessions'")
  console.log('SESSIONS_COLUMNS:', JSON.stringify(sess.rows, null, 2))
  const guides = await c.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='guidance_events'")
  console.log('GUIDANCE_COLUMNS:', JSON.stringify(guides.rows, null, 2))
  await c.end()
}

inspect().then(()=>process.exit(0)).catch(e=>{ console.error(e); process.exit(1) })
