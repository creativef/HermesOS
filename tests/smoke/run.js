// Simple smoke test that checks key endpoints are reachable.
const endpoints = [
  { name: 'API health', url: 'http://localhost:4000/api/v1/health' },
  { name: 'Admin DB', url: 'http://localhost:4000/api/v1/admin/db' },
  { name: 'Projects', url: 'http://localhost:4000/api/v1/projects' },
  { name: 'Hermes health', url: 'http://localhost:4000/api/v1/hermes/health' }
]

const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'devkey'

async function req(url){
  try{
    const headers = ADMIN_API_KEY ? { 'x-api-key': ADMIN_API_KEY } : {}
    const res = await fetch(url, { headers })
    const text = await res.text()
    return { status: res.status, body: text }
  }catch(e){
    return { err: String(e) }
  }
}

(async function createCompanyAndCheckBrief(){
  const slug = `smoke-${Date.now()}`
  const createRes = await fetch('http://localhost:4000/api/v1/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ADMIN_API_KEY ? { 'x-api-key': ADMIN_API_KEY } : {}) },
    body: JSON.stringify({ name: `Smoke ${slug}`, slug })
  })
  const createText = await createRes.text()
  if(!createRes.ok) throw new Error(`Create company failed: ${createRes.status} ${createText}`)
  const company = JSON.parse(createText)
  const companyId = company.id

  const briefRes = await fetch(`http://localhost:4000/api/v1/companies/${encodeURIComponent(companyId)}/brief`, {
    headers: ADMIN_API_KEY ? { 'x-api-key': ADMIN_API_KEY } : {}
  })
  const briefText = await briefRes.text()
  if(!briefRes.ok) throw new Error(`Company brief GET failed: ${briefRes.status} ${briefText}`)
})()
  .then(()=>console.log('Checking Company brief -> OK'))
  .catch((e)=>{ console.log('Checking Company brief -> FAIL', String(e)); process.exitCode = 1 })
;

(async ()=>{
  let failed = false
  for(const e of endpoints){
    process.stdout.write(`Checking ${e.name} -> ${e.url} ... `)
    const r = await req(e.url)
    if(r.err){
      console.log('FAIL', r.err)
      failed = true
    }else if(r.status >= 400){
      console.log('FAIL', r.status)
      console.log(r.body)
      failed = true
    }else{
      console.log('OK')
    }
  }
  process.exit(failed ? 1 : 0)
})()
