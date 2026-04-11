// E2E test: create a session via the API (simulating the frontend) and assert DB update
const fetch = require('node-fetch')

const API_BASE = process.env.API_BASE || 'http://localhost:4000'
const PROJECT_ID = process.env.PROJECT_ID || 'project-demo'

async function main(){
  console.log('Creating session for', PROJECT_ID)
  const headers = { 'Content-Type': 'application/json' }
  if(process.env.ADMIN_API_KEY) headers['x-api-key'] = process.env.ADMIN_API_KEY
  const r = await fetch(`${API_BASE}/api/v1/projects/${encodeURIComponent(PROJECT_ID)}/sessions`, { method: 'POST', headers, body: JSON.stringify({ title: 'E2E Test Session', prompt: 'Hello E2E' }) })
  const body = await r.json()
  console.log('Create response ok:', body.ok)
  if(!body.ok){
    console.error('Create session failed, response:', body)
    process.exit(2)
  }
  let localId = body.local_id || ''
  if(!localId){
    // fallback: query sessions list and pick newest
    console.warn('local_id missing from create response, fetching sessions list as fallback')
    const listR = await fetch(`${API_BASE}/api/v1/projects/${encodeURIComponent(PROJECT_ID)}/sessions`)
    const listBody = await listR.json().catch(()=>null)
    if(listBody && Array.isArray(listBody.sessions) && listBody.sessions.length>0){
      console.log('Using latest session from list as fallback')
      localId = listBody.sessions[0].id
    }else{
      console.error('No session id available; aborting')
      process.exit(2)
    }
  }
  // send a follow-up message (simulating frontend user action) so an assistant reply is generated and persisted
  await fetch(`${API_BASE}/api/v1/projects/${encodeURIComponent(PROJECT_ID)}/sessions/${encodeURIComponent(localId)}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: 'E2E followup' }) })
  // wait and poll session messages
  const maxAttempts = 40 // ~40s total
  for(let i=0;i<maxAttempts;i++){
    await new Promise(r=>setTimeout(r, 1000))
    const mr = await fetch(`${API_BASE}/api/v1/projects/${encodeURIComponent(PROJECT_ID)}/sessions/${encodeURIComponent(localId)}/messages`, { headers })
    if(mr.status===200){
      const mbody = await mr.json()
      if(mbody.messages && mbody.messages.some(m=>m.type==='assistant_message')){
        console.log('Assistant message persisted; test passed')
        process.exit(0)
      }
    }
  }

  // Fallback: check Postgres directly for assistant message for this session
  try{
    const { execSync } = require('child_process')
    const cmd = `docker compose exec -T postgres psql -U postgres -d hermes_dashboard -t -c "SELECT id FROM \"GuidanceEvent\" WHERE \"sessionId\"='${localId}' AND \"eventType\"='assistant_message' LIMIT 1;"`
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe','pipe','ignore'] }).trim()
    if(out){
      console.log('Assistant message found in DB; test passed via DB fallback')
      process.exit(0)
    }
  }catch(e){ /* ignore */ }

  console.error('Timeout waiting for assistant message (API poll + DB fallback failed)')
  process.exit(3)
}

main().catch(e=>{ console.error(e); process.exit(1) })
