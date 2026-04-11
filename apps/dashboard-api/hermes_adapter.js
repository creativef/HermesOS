const HERMES_BASE = (process.env.HERMES_BASE_URL || 'http://hermes:8642').replace(/\/$/, '')
const AUTH_HEADER = (() => {
  const key = process.env.HERMES_API_KEY || process.env.API_SERVER_KEY || process.env.API_KEY
  return key ? { Authorization: `Bearer ${key}` } : {}
})()

function getTimeoutMs(){
  const raw = process.env.HERMES_TIMEOUT_MS || process.env.HERMES_HTTP_TIMEOUT_MS || '60000'
  const ms = Number.parseInt(raw, 10)
  return Number.isFinite(ms) && ms > 0 ? ms : 60000
}

function getFetch(){
  if (typeof fetch === 'function') return fetch
  throw new Error('global fetch() is not available; requires Node 18+ (recommended Node 20)')
}

async function fetchWithTimeout(url, opts, timeoutMs){
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try{
    return await getFetch()(url, Object.assign({}, opts, { signal: controller.signal }))
  } finally {
    clearTimeout(t)
  }
}

async function fetchJson(url, opts = {}, timeoutMs){
  const finalOpts = Object.assign({ method: 'GET', headers: {} }, opts)
  finalOpts.headers = Object.assign({ Accept: 'application/json' }, AUTH_HEADER, finalOpts.headers || {})
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : getTimeoutMs()
  const res = await fetchWithTimeout(url, finalOpts, effectiveTimeoutMs)
  const text = await res.text()
  let data = null
  try{ data = text ? JSON.parse(text) : null }catch(e){ data = text }
  return { ok: res.ok, status: res.status, data }
}

module.exports = {
  health: async function(){
    try{
      const url = `${HERMES_BASE}/health`
      const r = await fetchJson(url, { method: 'GET' })
      if (!r.ok) return { ok: false, url, status: r.status, result: r.data }
      return { ok: true, url, status: r.status, result: r.data }
    }catch(err){
      return { ok: false, error: String(err), url: HERMES_BASE }
    }
  },

  listSessions: async function(projectId){
    // Use the OpenAI-compatible API prefix if available; Hermes does not
    // expose a standardized sessions list in all builds, so return an
    // empty array on 404 or unimplemented.
    const url = `${HERMES_BASE}/v1/sessions${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`
    try{
      const r = await fetchJson(url)
      if (!r.ok){
        // Hermes may not implement this route; treat 404/405/501 as "empty list" rather than a hard failure.
        if (r.status === 404 || r.status === 405 || r.status === 501) {
          return { ok: true, source: url, status: r.status, sessions: [], raw: r.data }
        }
        return { ok: false, source: url, status: r.status, result: r.data }
      }
      const payload = r.data
      if(payload && (Array.isArray(payload) || payload.sessions)){
        return { ok: true, source: url, status: r.status, sessions: payload.sessions || payload }
      }
      // Unexpected shape; return empty list but include raw result for debugging
      return { ok: true, source: url, status: r.status, sessions: [], raw: payload }
    }catch(err){
      // If 404 or network error, surface that to the caller so UI can decide
      return { ok: false, error: String(err), url }
    }
  },

  createSession: async function(projectId, body, opts = {}){
    // Create an initial conversation via the OpenAI-compatible chat endpoint.
    const url = `${HERMES_BASE}/v1/chat/completions`
    // Build a minimal messages array: system (optional), then user
    const messages = []
    if(body && body.system) messages.push({ role: 'system', content: body.system })
    const userMsg = body?.prompt || body?.title || body?.message || 'Start session'
    messages.push({ role: 'user', content: userMsg })

    const payload = {
      model: body?.model || 'hermes-agent',
      messages,
      stream: false
    }

    try{
      const timeoutMs = opts && opts.timeoutMs ? Number.parseInt(String(opts.timeoutMs), 10) : undefined
      const res = await fetchJson(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) }, timeoutMs)
      if (!res.ok) return { ok: false, source: url, status: res.status, result: res.data }
      return { ok: true, source: url, status: res.status, result: res.data }
    }catch(err){
      return { ok: false, error: String(err), url }
    }
  }
}
