require('dotenv').config()

const express = require('express');
const cors = require('cors');
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const http = require('http')
const { WebSocketServer } = require('ws')

const app = express();
app.disable('x-powered-by')

app.use(helmet({
  // Keep defaults; enable crossOriginResourcePolicy=false since this is an API.
  crossOriginResourcePolicy: false
}))

const jsonLimit = process.env.API_JSON_LIMIT || '1mb'
app.use(express.json({ limit: jsonLimit }));

const corsOrigin = process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : '')
if (corsOrigin) {
  app.use(cors({ origin: corsOrigin, credentials: true }))
}

const PORT = process.env.PORT || 4000;
const hermes = require('./hermes_adapter')
const { startRunWorker } = require('./worker/run_worker')
const { normalizeScheduleInput, computeNextRunAt } = require('./schedule_utils')
const { buildSystemContextForProject: buildSystemContextForProjectFromDb } = require('./system_context')

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const fs = require('fs')
const path = require('path')

function nowId(prefix){
  return `${prefix}-${Date.now()}`
}

function uid(prefix){
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function parseCookieHeader(header){
  const out = {}
  const raw = typeof header === 'string' ? header : ''
  if(!raw) return out
  const parts = raw.split(';')
  for(const p of parts){
    const idx = p.indexOf('=')
    if(idx < 0) continue
    const k = p.slice(0, idx).trim()
    const v = p.slice(idx + 1).trim()
    if(!k) continue
    out[k] = v
  }
  return out
}

function wsAuthorize(req){
  const adminKey = process.env.ADMIN_API_KEY
  if(!adminKey) return false
  const providedHeader = req && req.headers ? (req.headers['x-api-key'] || req.headers['X-Api-Key']) : null
  if(typeof providedHeader === 'string' && providedHeader === adminKey) return true

  const cookie = req && req.headers ? req.headers.cookie : ''
  const parsed = parseCookieHeader(cookie)
  const raw = parsed.hermesos_api_key
  if(typeof raw !== 'string' || !raw) return false
  let decoded = raw
  try{ decoded = decodeURIComponent(raw) }catch{}
  return decoded === adminKey
}

function safeJsonParseWs(msg){
  try{
    const s = typeof msg === 'string' ? msg : msg.toString('utf8')
    return JSON.parse(s)
  }catch{
    return null
  }
}

function startWebSocketHub({ server, prisma }){
  const wss = new WebSocketServer({ server, path: '/api/v1/ws' })
  console.log('[ws] hub listening on /api/v1/ws')

  wss.on('connection', async (ws, req) => {
    if(!wsAuthorize(req)){
      try{ ws.close(1008, 'unauthorized') }catch{}
      return
    }

    const subs = {
      runs: new Map(),       // runId -> cursor ISO string
      wikiBuilds: new Map(), // buildId -> cursor ISO string
    }

    const send = (obj) => {
      if(ws.readyState !== ws.OPEN) return
      try{ ws.send(JSON.stringify(obj)) }catch{}
    }

    send({ type: 'hello', ok: true })

    ws.on('message', async (raw) => {
      const msg = safeJsonParseWs(raw)
      if(!msg || typeof msg !== 'object') return
      if(msg.type === 'ping') return send({ type: 'pong' })

      if(msg.type === 'subscribe' && msg.scope === 'run'){
        const runId = typeof msg.runId === 'string' ? msg.runId : ''
        if(!runId) return
        const latest = await prisma.runEvent
          .findFirst({ where: { runId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
          .catch(()=>null)
        subs.runs.set(runId, latest?.createdAt ? new Date(latest.createdAt).toISOString() : '1970-01-01T00:00:00.000Z')
        send({ type: 'subscribed', scope: 'run', runId })
        return
      }

      if(msg.type === 'subscribe' && msg.scope === 'wikiBuild'){
        const buildId = typeof msg.buildId === 'string' ? msg.buildId : ''
        if(!buildId) return
        const latest = await prisma.wikiEvent
          .findFirst({ where: { buildId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
          .catch(()=>null)
        subs.wikiBuilds.set(buildId, latest?.createdAt ? new Date(latest.createdAt).toISOString() : '1970-01-01T00:00:00.000Z')
        send({ type: 'subscribed', scope: 'wikiBuild', buildId })
        return
      }
    })

    const interval = setInterval(async () => {
      if(ws.readyState !== ws.OPEN){
        clearInterval(interval)
        return
      }

      // Runs: stream new RunEvents
      for(const [runId, cursorIso] of subs.runs.entries()){
        const cursor = cursorIso ? new Date(cursorIso) : new Date(0)
        const events = await prisma.runEvent
          .findMany({
            where: { runId, createdAt: { gt: cursor } },
            orderBy: { createdAt: 'asc' },
            take: 200,
          })
          .catch(()=>[])
        if(events.length){
          const last = events[events.length - 1]
          subs.runs.set(runId, new Date(last.createdAt).toISOString())
          send({ type: 'run_events', runId, events })
        }
      }

      // Wiki builds: stream new WikiEvents
      for(const [buildId, cursorIso] of subs.wikiBuilds.entries()){
        const cursor = cursorIso ? new Date(cursorIso) : new Date(0)
        const events = await prisma.wikiEvent
          .findMany({
            where: { buildId, createdAt: { gt: cursor } },
            orderBy: { createdAt: 'asc' },
            take: 200,
          })
          .catch(()=>[])
        if(events.length){
          const last = events[events.length - 1]
          subs.wikiBuilds.set(buildId, new Date(last.createdAt).toISOString())
          send({ type: 'wiki_build_events', buildId, events })
        }
      }
    }, 1000)

    ws.on('close', () => {
      clearInterval(interval)
    })
  })
}

function wikiRoot(){
  const env = typeof process.env.WIKI_PATH === 'string' ? process.env.WIKI_PATH.trim() : ''
  return env || '/wiki'
}

function skillsRoots(){
  const env = typeof process.env.HERMES_SKILLS_PATH === 'string' ? process.env.HERMES_SKILLS_PATH.trim() : ''
  if(env) return env.split(',').map(s=>s.trim()).filter(Boolean)
  // Common locations across Hermes/Codex setups.
  return [
    '/opt/data/skills',
    '/opt/data/.codex/skills',
    '/opt/data/agents/skills',
    '/opt/hermes/skills',
    '/skills',
  ]
}

function safePathUnderRoot(root, rel){
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if(!clean || clean.includes('..')) return null
  const full = path.resolve(root, clean)
  if(!full.startsWith(path.resolve(root))) return null
  return { root, clean, full }
}

async function walkFilesWithLimit(dir, acc, limit){
  if(acc.length >= limit) return
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(()=>[])
  for(const e of entries){
    if(acc.length >= limit) return
    const full = path.join(dir, e.name)
    if(e.isDirectory()){
      await walkFilesWithLimit(full, acc, limit)
    }else if(e.isFile()){
      acc.push(full)
    }
  }
}

function parseSkillDoc(text){
  const s = typeof text === 'string' ? text : ''
  const lines = s.split('\n')
  let name = ''
  let description = ''
  for(const line of lines.slice(0, 40)){
    const h1 = /^#\s+(.+)$/.exec(line.trim())
    if(h1 && !name) name = h1[1].trim()
    const desc = /^(?:- )?(?:Description|Summary)\s*:\s*(.+)$/i.exec(line.trim())
    if(desc && !description) description = desc[1].trim()
  }
  if(!description){
    const idx = lines.findIndex(l => l.trim() && !l.trim().startsWith('#'))
    if(idx >= 0){
      description = lines.slice(idx, idx + 3).join(' ').trim()
      description = description.replace(/\s+/g, ' ')
    }
  }
  return { name, description }
}

async function listSkills(){
  const roots = skillsRoots()
  const results = []
  const seen = new Set()
  const limit = Number.parseInt(process.env.SKILLS_SCAN_LIMIT || '400', 10) || 400

  for(const r of roots){
    const root = String(r || '').trim()
    if(!root) continue
    if(!fs.existsSync(root)) continue
    const files = []
    await walkFilesWithLimit(root, files, limit)
    for(const full of files){
      if(!full.endsWith('SKILL.md')) continue
      const rel = path.relative(root, full).replace(/\\/g, '/')
      const id = `${root}:${rel}`
      if(seen.has(id)) continue
      seen.add(id)

      const stat = await fs.promises.stat(full).catch(()=>null)
      const content = await fs.promises.readFile(full, 'utf8').catch(()=>null)
      const meta = parseSkillDoc(content || '')
      results.push({
        id,
        root,
        rel,
        name: meta.name || path.basename(path.dirname(full)) || 'Skill',
        description: meta.description || '',
        bytes: stat ? stat.size : null,
        updatedAt: stat ? stat.mtime.toISOString() : null,
      })
    }
  }

  results.sort((a,b) => String(a.name).localeCompare(String(b.name)))
  return results
}

function safeWikiPath(rel){
  const root = wikiRoot()
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if(!clean || clean.includes('..')) return null
  const full = path.resolve(root, clean)
  if(!full.startsWith(path.resolve(root))) return null
  return { root, clean, full }
}

function parseFrontmatter(md){
  const text = typeof md === 'string' ? md : ''
  if(!text.startsWith('---')) return { meta: {}, body: text }
  const idx = text.indexOf('\n---', 3)
  if(idx < 0) return { meta: {}, body: text }
  const yamlBlock = text.slice(3, idx).trim()
  const body = text.slice(idx + '\n---'.length).replace(/^\s*\n/, '')
  const meta = {}
  for(const line of yamlBlock.split('\n')){
    const m = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line.trim())
    if(!m) continue
    const k = m[1]
    const v = m[2]
    if(k === 'tags'){
      // naive tags: [a, b] or a,b
      const arr = v.replace(/^\[|\]$/g,'').split(',').map(s=>s.trim()).filter(Boolean)
      meta.tags = arr
    }else{
      meta[k] = v.replace(/^"|"$/g,'').trim()
    }
  }
  return { meta, body }
}

function buildFrontmatter({ title, type, tags, created, updated }){
  const lines = ['---']
  if(title) lines.push(`title: ${String(title).trim()}`)
  if(created) lines.push(`created: ${String(created).trim()}`)
  if(updated) lines.push(`updated: ${String(updated).trim()}`)
  if(type) lines.push(`type: ${String(type).trim()}`)
  if(tags && Array.isArray(tags)){
    const t = tags.map(x=>String(x).trim()).filter(Boolean)
    lines.push(`tags: [${t.join(', ')}]`)
  }
  lines.push('---')
  lines.push('')
  return lines.join('\n')
}

function isoDate(date = new Date()){
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth()+1).padStart(2,'0')
  const d = String(date.getUTCDate()).padStart(2,'0')
  return `${y}-${m}-${d}`
}

function parseScheduleInput(body){
  if(!body || typeof body !== 'object') return null
  const s = body.schedule && typeof body.schedule === 'object' ? body.schedule : null
  if(!s) return null
  return normalizeScheduleInput(s)
}

function monthKeyUtc(date){
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function monthStartUtcFromKey(key){
  const [y, m] = String(key).split('-')
  const year = Number.parseInt(y, 10)
  const month = Number.parseInt(m, 10)
  return new Date(Date.UTC(year, (month - 1), 1, 0, 0, 0, 0))
}

function monthStartUtc(date = new Date()){
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0))
}

function addMonthsUtc(date, delta){
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1, 0, 0, 0, 0))
}

function hourKeyUtc(date){
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const h = String(date.getUTCHours()).padStart(2, '0')
  return `${y}-${m}-${d}T${h}:00Z`
}

function hourStartUtc(date = new Date()){
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    0, 0, 0
  ))
}

function dayKeyUtc(date){
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function dayStartUtc(date = new Date()){
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0))
}

function addDaysUtc(date, delta){
  return new Date(date.getTime() + (delta * 24 * 60 * 60 * 1000))
}

function weekStartUtc(date = new Date()){
  const d0 = dayStartUtc(date)
  // ISO week starts Monday. JS getUTCDay: 0=Sun ... 6=Sat
  const dow = d0.getUTCDay()
  const daysSinceMonday = (dow + 6) % 7
  return addDaysUtc(d0, -daysSinceMonday)
}

function weekKeyUtc(date){
  const ws = weekStartUtc(date)
  return dayKeyUtc(ws)
}

function isHermesTimeoutError(err){
  const s = String(err || '')
  return s.includes('AbortError') || s.toLowerCase().includes('aborted') || s.toLowerCase().includes('timeout')
}

function sanitizeAssistantText(text){
  if(typeof text !== 'string') return text
  // Hermes tool traces can leak as a leading {"ref":"@e.."} prefix; strip it for user-facing text.
  return text.replace(/^\s*\{\s*"ref"\s*:\s*"@[^"]+"\s*\}\s*/m, '').trim()
}

function extractAssistantText(result){
  const message = result && result.choices && result.choices[0] && result.choices[0].message ? result.choices[0].message : null
  if(message && typeof message.content === 'string') return sanitizeAssistantText(message.content)

  // Some OpenAI-compatible servers may return content parts.
  if(message && Array.isArray(message.content)){
    const parts = message.content
      .map((p) => {
        if(typeof p === 'string') return p
        if(p && typeof p.text === 'string') return p.text
        if(p && typeof p.content === 'string') return p.content
        return ''
      })
      .join('')
    const out = parts.trim()
    return out ? sanitizeAssistantText(out) : null
  }

  return null
}

function getMinAssistantChars(){
  const raw = process.env.HERMES_MIN_ASSISTANT_CHARS || '20'
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : 20
}

function getCostPer1kTokensUsd(){
  const raw = process.env.COST_PER_1K_TOKENS_USD || '0'
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function getInputCostPer1MTokensUsd(){
  const raw = process.env.COST_INPUT_PER_1M_TOKENS_USD || '0'
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function getOutputCostPer1MTokensUsd(){
  const raw = process.env.COST_OUTPUT_PER_1M_TOKENS_USD || '0'
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function estimateUsdFromTokenSplit({ promptTokens, completionTokens, totalTokens }){
  const inputRatePer1M = getInputCostPer1MTokensUsd()
  const outputRatePer1M = getOutputCostPer1MTokensUsd()
  if(inputRatePer1M > 0 || outputRatePer1M > 0){
    const inTok = Number(promptTokens || 0)
    const outTok = Number(completionTokens || 0)
    return (inTok / 1_000_000) * inputRatePer1M + (outTok / 1_000_000) * outputRatePer1M
  }
  const costPer1k = getCostPer1kTokensUsd()
  const tok = Number(totalTokens || 0)
  return tok ? (tok / 1000) * costPer1k : 0
}

function parseUsage(result){
  const u = result && typeof result === 'object' ? result.usage : null
  if(!u || typeof u !== 'object') return null
  const promptTokens = Number.isFinite(Number(u.prompt_tokens)) ? Number(u.prompt_tokens) : null
  const completionTokens = Number.isFinite(Number(u.completion_tokens)) ? Number(u.completion_tokens) : null
  // Responses API naming
  const inputTokens = Number.isFinite(Number(u.input_tokens)) ? Number(u.input_tokens) : null
  const outputTokens = Number.isFinite(Number(u.output_tokens)) ? Number(u.output_tokens) : null
  const totalTokens = Number.isFinite(Number(u.total_tokens)) ? Number(u.total_tokens) : (promptTokens != null && completionTokens != null ? promptTokens + completionTokens : null)
  const finalTotal = totalTokens != null ? totalTokens : (inputTokens != null && outputTokens != null ? inputTokens + outputTokens : null)
  return { promptTokens, completionTokens, inputTokens, outputTokens, totalTokens: finalTotal }
}

async function processMessageJob(jobId){
  // Runs asynchronously after we have already responded to the client.
  const job = await prisma.messageJob.findUnique({ where: { id: jobId } }).catch(()=>null)
  if(!job) return
  if(job.status !== 'queued') return

  const startedAt = Date.now()
  console.log(`[jobs] start job=${jobId} project=${job.projectId} session=${job.sessionId} input_len=${(job.input||'').length}`)

  await prisma.messageJob.update({ where: { id: jobId }, data: { status: 'running', updatedAt: new Date() } }).catch(()=>{})

  try{
    const systemFromBriefs = await buildSystemContextForProject(job.projectId)
    const jobTimeoutMs = Number.parseInt(process.env.HERMES_JOB_TIMEOUT_MS || '600000', 10) || 600000
    const hermesRes = await hermes.createSession(
      job.projectId,
      Object.assign({ prompt: job.input }, systemFromBriefs ? { system: systemFromBriefs } : {}),
      { timeoutMs: jobTimeoutMs }
    )
    if(!(hermesRes && hermesRes.ok && hermesRes.result)){
      const err = hermesRes && hermesRes.error ? hermesRes.error : 'hermes_failed'
      const status = isHermesTimeoutError(err) ? 'timeout' : 'failed'
      await prisma.messageJob.update({ where: { id: jobId }, data: { status, error: String(err), durationMs: Date.now()-startedAt, updatedAt: new Date() } }).catch(()=>{})
      console.log(`[jobs] end job=${jobId} status=${status} ms=${Date.now()-startedAt} err=${String(err).slice(0,160)}`)
      return
    }

    const assistantText = extractAssistantText(hermesRes.result)
    const usage = parseUsage(hermesRes.result)
    const costPer1k = getCostPer1kTokensUsd()
    const estimatedUsd = usage && usage.totalTokens != null ? (usage.totalTokens / 1000) * costPer1k : null
    const model = (hermesRes.result && hermesRes.result.model) ? String(hermesRes.result.model) : (job.model || null)

    const minChars = getMinAssistantChars()
    if(!assistantText || assistantText.trim().length < minChars){
      const preview = assistantText ? assistantText.trim().slice(0, 200) : '(empty)'
      const rawPreview = JSON.stringify(hermesRes.result).slice(0, 400)
      const error = `assistant_output_too_short min=${minChars} got=${assistantText ? assistantText.trim().length : 0} preview=${preview} raw=${rawPreview}`
      await prisma.messageJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          error,
          provider: 'hermes',
          model,
          promptTokens: usage ? usage.promptTokens : null,
          completionTokens: usage ? usage.completionTokens : null,
          totalTokens: usage ? usage.totalTokens : null,
          estimatedUsd,
          durationMs: Date.now()-startedAt,
          updatedAt: new Date()
        }
      }).catch(()=>{})
      console.log(`[jobs] end job=${jobId} status=failed ms=${Date.now()-startedAt} err=assistant_output_too_short`)
      return
    }

    // Persist assistant message as guidance event (timeline/messages view).
    await prisma.guidanceEvent
      .create({
        data: {
          id: `evt-${Date.now()}-a`,
          projectId: job.projectId,
          sessionId: job.sessionId,
          eventType: 'assistant_message',
          payload: { text: assistantText },
        },
      })
      .catch((e) => console.error('persist assistant message (job)', e))

    // Update session hermes_session_id if available.
    const hermesId = hermesRes.result.id || hermesRes.result.hermes_session_id || null
    if(hermesId){
      await prisma.session.update({ where: { id: job.sessionId }, data: { hermesSessionId: hermesId, status: 'completed', updatedAt: new Date() } }).catch(()=>{})
    }

    await prisma.messageJob.update({
      where: { id: jobId },
      data: {
        status: 'succeeded',
        provider: 'hermes',
        model,
        promptTokens: usage ? usage.promptTokens : null,
        completionTokens: usage ? usage.completionTokens : null,
        totalTokens: usage ? usage.totalTokens : null,
        estimatedUsd,
        durationMs: Date.now()-startedAt,
        updatedAt: new Date()
      }
    }).catch(()=>{})
    console.log(`[jobs] end job=${jobId} status=succeeded ms=${Date.now()-startedAt} out_len=${(assistantText||'').length}`)
  }catch(e){
    await prisma.messageJob.update({ where: { id: jobId }, data: { status: 'failed', error: String(e), durationMs: Date.now()-startedAt, updatedAt: new Date() } }).catch(()=>{})
    console.log(`[jobs] end job=${jobId} status=failed ms=${Date.now()-startedAt} err=${String(e).slice(0,160)}`)
  }
}

async function buildSystemContextForProject(projectId){
  return buildSystemContextForProjectFromDb(prisma, projectId)
}

// In production, do not allow running without an admin key configured.
if ((process.env.NODE_ENV || '').toLowerCase() === 'production' && !process.env.ADMIN_API_KEY) {
  console.error('[security] ADMIN_API_KEY must be set in production')
  process.exit(1)
}

// Test DB connection (will throw if DATABASE_URL not set / unreachable)
prisma
  .$connect()
  .then(() => {
    console.log('Connected to Postgres via Prisma')
    // Start durable run worker loop after DB is reachable.
    // Set RUN_WORKER_ENABLED=0 to disable.
    startRunWorker({ prisma, hermes, buildSystemContextForProject })
  })
  .catch((e) => console.error('Prisma connect error', e))

app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', env: process.env.NODE_ENV || 'development' });
});

app.get('/api/v1/hermes/health', async (req, res) => {
  const r = await hermes.health()
  res.json(r)
})

// Simple API key middleware.
function requireApiKey(req, res, next){
  const adminKey = process.env.ADMIN_API_KEY
  if(!adminKey) return res.status(500).json({ ok: false, error: 'server_misconfigured' })
  const provided = req.get('x-api-key')
  if(provided && provided === adminKey) return next()
  res.status(401).json({ ok: false, error: 'unauthorized' })
}

// Protect all /api/v1/* except health endpoints
app.use('/api/v1', (req, res, next) => {
  if (req.path === '/health' || req.path === '/hermes/health') return next()
  return requireApiKey(req, res, next)
})

// Rate-limit authenticated API calls.
const windowMs = Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10) || 60000
const max = Number.parseInt(process.env.RATE_LIMIT_MAX || '120', 10) || 120
app.use('/api/v1', rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.get('x-api-key') || req.ip,
  skip: (req) => req.path === '/health' || req.path === '/hermes/health'
}))

function minutesAgoDate(minutes){
  const m = Number(minutes || 0)
  const ms = Number.isFinite(m) && m > 0 ? m * 60_000 : 0
  return new Date(Date.now() - ms)
}

async function getHermesHealthSafe(){
  try{
    return await hermes.health()
  }catch(e){
    return { ok: false, error: String(e) }
  }
}

// Diagnostics “Doctor”: health + queue depths + stuck items
app.get('/api/v1/doctor', async (req, res) => {
  const staleMinutes = Number.isFinite(Number(req.query.staleMinutes)) ? Number(req.query.staleMinutes) : 10
  const now = new Date()
  const staleCutoff = minutesAgoDate(staleMinutes)

  try{
    const [
      hermesHealth,
      runCounts,
      runStepCounts,
      wikiBuildCounts,
      wikiStepCounts,
      scheduleCounts,
      unreadNotifications,
      stuckRunsExpired,
      stuckRunStepsExpired,
      stuckWikiBuildsExpired,
      stuckWikiStepsExpired,
      staleRunsNoLock,
      staleWikiBuildsNoLock,
    ] = await Promise.all([
      getHermesHealthSafe(),
      prisma.projectRun.groupBy({ by: ['status'], _count: { _all: true } }).catch(()=>[]),
      prisma.runStep.groupBy({ by: ['status'], _count: { _all: true } }).catch(()=>[]),
      prisma.wikiBuild.groupBy({ by: ['status'], _count: { _all: true } }).catch(()=>[]),
      prisma.wikiBuildStep.groupBy({ by: ['status'], _count: { _all: true } }).catch(()=>[]),
      prisma.schedule.groupBy({ by: ['enabled'], _count: { _all: true } }).catch(()=>[]),
      prisma.notification.count({ where: { status: 'unread' } }).catch(()=>0),
      prisma.projectRun.findMany({
        where: { status: { in: ['claimed','running'] }, lockExpiresAt: { lt: now } },
        orderBy: { updatedAt: 'asc' },
        take: 25,
        select: { id: true, projectId: true, status: true, lockedBy: true, lockExpiresAt: true, updatedAt: true, attempts: true, title: true }
      }).catch(()=>[]),
      prisma.runStep.findMany({
        where: { status: { in: ['claimed','running'] }, lockExpiresAt: { lt: now } },
        orderBy: { updatedAt: 'asc' },
        take: 50,
        select: { id: true, runId: true, index: true, kind: true, status: true, lockedBy: true, lockExpiresAt: true, updatedAt: true, attempts: true }
      }).catch(()=>[]),
      prisma.wikiBuild.findMany({
        where: { status: { in: ['claimed','running'] }, lockExpiresAt: { lt: now } },
        orderBy: { updatedAt: 'asc' },
        take: 25,
        select: { id: true, wikiProjectId: true, status: true, lockedBy: true, lockExpiresAt: true, updatedAt: true, attempts: true, title: true }
      }).catch(()=>[]),
      prisma.wikiBuildStep.findMany({
        where: { status: { in: ['claimed','running'] }, lockExpiresAt: { lt: now } },
        orderBy: { updatedAt: 'asc' },
        take: 50,
        select: { id: true, buildId: true, index: true, kind: true, status: true, lockedBy: true, lockExpiresAt: true, updatedAt: true, attempts: true }
      }).catch(()=>[]),
      prisma.projectRun.findMany({
        where: { status: 'running', lockExpiresAt: null, updatedAt: { lt: staleCutoff } },
        orderBy: { updatedAt: 'asc' },
        take: 25,
        select: { id: true, projectId: true, status: true, updatedAt: true, attempts: true, title: true }
      }).catch(()=>[]),
      prisma.wikiBuild.findMany({
        where: { status: 'running', lockExpiresAt: null, updatedAt: { lt: staleCutoff } },
        orderBy: { updatedAt: 'asc' },
        take: 25,
        select: { id: true, wikiProjectId: true, status: true, updatedAt: true, attempts: true, title: true }
      }).catch(()=>[]),
    ])

    res.json({
      ok: true,
      now: now.toISOString(),
      staleMinutes,
      hermes: hermesHealth,
      counts: {
        projectRuns: runCounts,
        runSteps: runStepCounts,
        wikiBuilds: wikiBuildCounts,
        wikiBuildSteps: wikiStepCounts,
        schedules: scheduleCounts,
        unreadNotifications,
      },
      stuck: {
        expiredLocks: {
          runs: stuckRunsExpired,
          runSteps: stuckRunStepsExpired,
          wikiBuilds: stuckWikiBuildsExpired,
          wikiBuildSteps: stuckWikiStepsExpired,
        },
        staleNoLock: {
          runs: staleRunsNoLock,
          wikiBuilds: staleWikiBuildsNoLock,
        }
      }
    })
  }catch(e){
    console.error('doctor', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// Doctor: reaper actions (requeue expired locks and optionally stale running w/out lock)
app.post('/api/v1/doctor/reap', async (req, res) => {
  const body = req.body || {}
  const mode = typeof body.mode === 'string' ? body.mode : 'expired_and_stale'
  const staleMinutes = Number.isFinite(Number(body.staleMinutes)) ? Number(body.staleMinutes) : 10
  const now = new Date()
  const staleCutoff = minutesAgoDate(staleMinutes)

  try{
    const results = {}

    // Expired locks → queued
    const runStepsExpired = await prisma.runStep.updateMany({
      where: { status: { in: ['claimed','running'] }, lockExpiresAt: { lt: now } },
      data: { status: 'queued', lockedBy: null, lockExpiresAt: null, updatedAt: new Date() }
    }).catch(()=>({ count: 0 }))
    results.runStepsExpired = runStepsExpired.count

    const runsExpired = await prisma.projectRun.updateMany({
      where: { status: { in: ['claimed','running'] }, lockExpiresAt: { lt: now } },
      data: { status: 'queued', lockedBy: null, lockExpiresAt: null, updatedAt: new Date() }
    }).catch(()=>({ count: 0 }))
    results.runsExpired = runsExpired.count

    const wikiStepsExpired = await prisma.wikiBuildStep.updateMany({
      where: { status: { in: ['claimed','running'] }, lockExpiresAt: { lt: now } },
      data: { status: 'queued', lockedBy: null, lockExpiresAt: null, updatedAt: new Date() }
    }).catch(()=>({ count: 0 }))
    results.wikiBuildStepsExpired = wikiStepsExpired.count

    const wikiBuildsExpired = await prisma.wikiBuild.updateMany({
      where: { status: { in: ['claimed','running'] }, lockExpiresAt: { lt: now } },
      data: { status: 'queued', lockedBy: null, lockExpiresAt: null, updatedAt: new Date() }
    }).catch(()=>({ count: 0 }))
    results.wikiBuildsExpired = wikiBuildsExpired.count

    if(mode === 'expired_and_stale'){
      const staleRuns = await prisma.projectRun.updateMany({
        where: { status: 'running', lockExpiresAt: null, updatedAt: { lt: staleCutoff } },
        data: { status: 'queued', updatedAt: new Date() }
      }).catch(()=>({ count: 0 }))
      results.staleRunsNoLock = staleRuns.count

      const staleWikiBuilds = await prisma.wikiBuild.updateMany({
        where: { status: 'running', lockExpiresAt: null, updatedAt: { lt: staleCutoff } },
        data: { status: 'queued', updatedAt: new Date() }
      }).catch(()=>({ count: 0 }))
      results.staleWikiBuildsNoLock = staleWikiBuilds.count
    }

    res.json({ ok: true, mode, staleMinutes, results })
  }catch(e){
    console.error('doctor reap', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// Doctor: targeted requeue
app.post('/api/v1/doctor/requeue', async (req, res) => {
  const body = req.body || {}
  const kind = typeof body.kind === 'string' ? body.kind : ''
  const id = typeof body.id === 'string' ? body.id : ''
  if(!kind || !id) return res.status(400).json({ ok: false, error: 'missing kind/id' })

  try{
    if(kind === 'run'){
      await prisma.projectRun.update({ where: { id }, data: { status: 'queued', lockedBy: null, lockExpiresAt: null, updatedAt: new Date() } })
      return res.json({ ok: true })
    }
    if(kind === 'runStep'){
      await prisma.runStep.update({ where: { id }, data: { status: 'queued', lockedBy: null, lockExpiresAt: null, updatedAt: new Date() } })
      return res.json({ ok: true })
    }
    if(kind === 'wikiBuild'){
      await prisma.wikiBuild.update({ where: { id }, data: { status: 'queued', lockedBy: null, lockExpiresAt: null, updatedAt: new Date() } })
      return res.json({ ok: true })
    }
    if(kind === 'wikiBuildStep'){
      await prisma.wikiBuildStep.update({ where: { id }, data: { status: 'queued', lockedBy: null, lockExpiresAt: null, updatedAt: new Date() } })
      return res.json({ ok: true })
    }
    return res.status(400).json({ ok: false, error: 'unknown_kind' })
  }catch(e){
    console.error('doctor requeue', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// Skills browser: list installed skills (scans `HERMES_SKILLS_PATH` or common roots)
app.get('/api/v1/skills', async (_req, res) => {
  try{
    const skills = await listSkills()
    res.json({ ok: true, roots: skillsRoots(), skills })
  }catch(e){
    console.error('skills list', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// Skills browser: read a specific SKILL.md doc (by `id` from /api/v1/skills)
app.get('/api/v1/skills/content', async (req, res) => {
  const id = req.query.id ? String(req.query.id) : ''
  if(!id || !id.includes(':')) return res.status(400).json({ ok: false, error: 'missing_id' })
  const idx = id.indexOf(':')
  const root = id.slice(0, idx)
  const rel = id.slice(idx + 1)

  try{
    const p = safePathUnderRoot(root, rel)
    if(!p) return res.status(400).json({ ok: false, error: 'invalid_path' })
    if(!p.full.endsWith('SKILL.md')) return res.status(400).json({ ok: false, error: 'not_a_skill_doc' })
    const content = await fs.promises.readFile(p.full, 'utf8')
    res.json({ ok: true, id, root, rel: p.clean, content })
  }catch(e){
    console.error('skills content', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// Overview: homepage data (counts + recent activity)
app.get('/api/v1/overview', async (req, res) => {
  const companyId = req.query.companyId ? String(req.query.companyId) : null
  const projectId = req.query.projectId ? String(req.query.projectId) : null

  const projectWhere = projectId ? { id: projectId } : (companyId ? { companyId } : {})
  const sessionWhere = projectId ? { projectId } : (companyId ? { project: { companyId } } : {})
  const eventWhere = projectId ? { projectId } : (companyId ? { project: { companyId } } : {})

  try{
    const monthStart = monthStartUtc(new Date())
    const monthsBack = 6
    const rangeStart = addMonthsUtc(monthStart, -(monthsBack - 1))
    const costPer1k = getCostPer1kTokensUsd()
    const inputCostPer1M = getInputCostPer1MTokensUsd()
    const outputCostPer1M = getOutputCostPer1MTokensUsd()
    const hourStart = hourStartUtc(new Date())
    const dayStart = dayStartUtc(new Date())
    const weekStart = weekStartUtc(new Date())
    const hoursBack = 24
    const daysBack = 30
    const weeksBack = 12

    let scopedProjectIds = null
    if(projectId){
      scopedProjectIds = [projectId]
    }else if(companyId){
      const ids = await prisma.project.findMany({ where: { companyId }, select: { id: true } }).catch(()=>[])
      scopedProjectIds = ids.map(r => r.id)
    }

    const jobs = await prisma.messageJob.findMany({
      where: Object.assign(
        { createdAt: { gte: rangeStart } },
        scopedProjectIds ? { projectId: { in: scopedProjectIds } } : {}
      ),
      select: { createdAt: true, promptTokens: true, completionTokens: true, totalTokens: true, estimatedUsd: true }
    }).catch(()=>[])

    const runStepWhere = {
      kind: 'llm',
      status: 'succeeded',
      endedAt: { gte: rangeStart }
    }
    if(scopedProjectIds) runStepWhere.run = { projectId: { in: scopedProjectIds } }

    const runSteps = await prisma.runStep
      .findMany({
        where: runStepWhere,
        select: { endedAt: true, promptTokens: true, completionTokens: true, totalTokens: true, estimatedUsd: true }
      })
      .catch(() => [])

    const byHour = new Map()
    const byDay = new Map()
    const byWeek = new Map()
    const byMonth = new Map()
    for(const j of jobs){
      const hKey = hourKeyUtc(j.createdAt)
      const hPrev = byHour.get(hKey) || { tokens: 0, usd: 0 }
      const jobTokens = Number(j.totalTokens || 0)
      hPrev.tokens += jobTokens
      const jobUsd = estimateUsdFromTokenSplit({
        promptTokens: j.promptTokens,
        completionTokens: j.completionTokens,
        totalTokens: j.totalTokens
      })
      hPrev.usd += Number(jobUsd || 0)
      byHour.set(hKey, hPrev)

      const dKey = dayKeyUtc(j.createdAt)
      const dPrev = byDay.get(dKey) || { tokens: 0, usd: 0 }
      dPrev.tokens += jobTokens
      dPrev.usd += Number(jobUsd || 0)
      byDay.set(dKey, dPrev)

      const wKey = weekKeyUtc(j.createdAt)
      const wPrev = byWeek.get(wKey) || { tokens: 0, usd: 0 }
      wPrev.tokens += jobTokens
      wPrev.usd += Number(jobUsd || 0)
      byWeek.set(wKey, wPrev)

      const key = monthKeyUtc(j.createdAt)
      const prev = byMonth.get(key) || { tokens: 0, usd: 0 }
      prev.tokens += jobTokens
      prev.usd += Number(jobUsd || 0)
      byMonth.set(key, prev)
    }

    for(const s of runSteps){
      const dt = s.endedAt || null
      if(!dt) continue
      const totalTokens = Number(s.totalTokens || 0)
      const usd = estimateUsdFromTokenSplit({
        promptTokens: s.promptTokens,
        completionTokens: s.completionTokens,
        totalTokens: s.totalTokens
      })

      const hKey = hourKeyUtc(dt)
      const hPrev = byHour.get(hKey) || { tokens: 0, usd: 0 }
      hPrev.tokens += totalTokens
      hPrev.usd += usd
      byHour.set(hKey, hPrev)

      const dKey = dayKeyUtc(dt)
      const dPrev = byDay.get(dKey) || { tokens: 0, usd: 0 }
      dPrev.tokens += totalTokens
      dPrev.usd += usd
      byDay.set(dKey, dPrev)

      const wKey = weekKeyUtc(dt)
      const wPrev = byWeek.get(wKey) || { tokens: 0, usd: 0 }
      wPrev.tokens += totalTokens
      wPrev.usd += usd
      byWeek.set(wKey, wPrev)

      const key = monthKeyUtc(dt)
      const prev = byMonth.get(key) || { tokens: 0, usd: 0 }
      prev.tokens += totalTokens
      prev.usd += usd
      byMonth.set(key, prev)
    }

    const hourly = []
    for(let i=hoursBack-1; i>=0; i--){
      const d = new Date(hourStart.getTime() - (i * 60 * 60 * 1000))
      const key = hourKeyUtc(d)
      const sums = byHour.get(key) || { tokens: 0, usd: 0 }
      hourly.push({
        hour_start_utc: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), 0, 0, 0)).toISOString(),
        tokens: sums.tokens,
        usd: sums.usd
      })
    }

    const daily = []
    for(let i=daysBack-1; i>=0; i--){
      const d = addDaysUtc(dayStart, -i)
      const key = dayKeyUtc(d)
      const sums = byDay.get(key) || { tokens: 0, usd: 0 }
      daily.push({
        day_start_utc: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)).toISOString(),
        tokens: sums.tokens,
        usd: sums.usd
      })
    }

    const weekly = []
    for(let i=weeksBack-1; i>=0; i--){
      const d = addDaysUtc(weekStart, -(i * 7))
      const key = weekKeyUtc(d)
      const sums = byWeek.get(key) || { tokens: 0, usd: 0 }
      weekly.push({
        week_start_utc: weekStartUtc(d).toISOString(),
        tokens: sums.tokens,
        usd: sums.usd
      })
    }

    const monthly = []
    for(let i=0; i<monthsBack; i++){
      const d = addMonthsUtc(monthStart, -i)
      const key = monthKeyUtc(d)
      const sums = byMonth.get(key) || { tokens: 0, usd: 0 }
      monthly.push({
        month_start_utc: monthStartUtcFromKey(key).toISOString(),
        tokens: sums.tokens,
        usd: sums.usd
      })
    }
    const currentMonthUsage = monthly[0] || { month_start_utc: monthStart.toISOString(), tokens: 0, usd: 0 }

    const [counts, companies, projects, recentSessions, recentEvents, sessionsPerProject, eventsPerProject] = await Promise.all([
      (async () => ({
        companies: companyId || projectId ? null : await prisma.company.count(),
        projects: await prisma.project.count({ where: projectWhere }).catch(()=>null),
        sessions: await prisma.session.count({ where: sessionWhere }).catch(()=>null),
        guidance_events: await prisma.guidanceEvent.count({ where: eventWhere }).catch(()=>null),
        workspace_session_maps: await prisma.workspaceSessionMap.count().catch(()=>null)
      }))(),
      prisma.company.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }).catch(()=>[]),
      prisma.project.findMany({ where: projectWhere, orderBy: { createdAt: 'desc' }, take: 50 }).catch(()=>[]),
      prisma.session.findMany({
        where: sessionWhere,
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { project: { select: { id: true, name: true } } }
      }).catch(()=>[]),
      prisma.guidanceEvent.findMany({
        where: eventWhere,
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: {
          project: { select: { id: true, name: true } },
          session: { select: { id: true, title: true, projectId: true } }
        }
      }).catch(()=>[]),
      prisma.session.groupBy({ by: ['projectId'], where: sessionWhere, _count: { id: true }, orderBy: { _count: { id: 'desc' } } }).catch(()=>[]),
      prisma.guidanceEvent.groupBy({ by: ['projectId'], where: eventWhere, _count: { id: true }, orderBy: { _count: { id: 'desc' } } }).catch(()=>[])
    ])

    res.json({
      ok: true,
      scope: { companyId, projectId },
      usage: {
        cost_per_1k_tokens_usd: costPer1k,
        cost_input_per_1m_tokens_usd: inputCostPer1M,
        cost_output_per_1m_tokens_usd: outputCostPer1M,
        range_start_utc: rangeStart.toISOString(),
        months_back: monthsBack,
        hours_back: hoursBack,
        days_back: daysBack,
        weeks_back: weeksBack,
        month_start_utc: monthStart.toISOString(),
        current_month: currentMonthUsage,
        hourly,
        daily,
        weekly,
        monthly
      },
      counts,
      companies,
      projects,
      stats: {
        sessions_per_project: sessionsPerProject,
        guidance_events_per_project: eventsPerProject
      },
      recent: {
        sessions: recentSessions,
        events: recentEvents
      }
    })
  }catch(err){
    res.status(500).json({ ok: false, error: String(err) })
  }
})

app.get('/api/v1/companies', (req, res) => {
  prisma.company.findMany().then(rows=>res.json(rows)).catch(e=>{
    console.error('list companies',e)
    res.json([])
  })
});

app.get('/api/v1/companies/:companyId', async (req, res) => {
  const id = req.params.companyId
  const c = await prisma.company.findUnique({ where: { id } }).catch(e=>null)
  if(!c) return res.status(404).json({ ok: false })
  res.json({ ok: true, company: c })
})

app.patch('/api/v1/companies/:companyId', async (req, res) => {
  const id = req.params.companyId
  const body = req.body || {}
  const name = typeof body.name === 'string' ? body.name.trim() : null
  const slug = typeof body.slug === 'string' ? body.slug.trim() : null
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : null

  const existing = await prisma.company.findUnique({ where: { id } }).catch(()=>null)
  if(!existing) return res.status(404).json({ ok: false })

  try{
    const company = await prisma.company.update({
      where: { id },
      data: {
        ...(name !== null ? { name } : {}),
        ...(slug !== null ? { slug } : {}),
        ...(metadata !== null ? { metadata } : {}),
      }
    })
    res.json({ ok: true, company })
  }catch(e){
    console.error('update company', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

app.delete('/api/v1/companies/:companyId', async (req, res) => {
  const id = req.params.companyId
  const existing = await prisma.company.findUnique({ where: { id } }).catch(()=>null)
  if(!existing) return res.status(404).json({ ok: false })
  try{
    // Remove company-scoped context artifacts (brief, etc)
    await prisma.contextArtifact.deleteMany({ where: { scopeType: 'company', scopeId: id } }).catch(()=>{})
    await prisma.company.delete({ where: { id } })
    // Projects will retain but have companyId set to null via FK ON DELETE SET NULL
    res.json({ ok: true })
  }catch(e){
    console.error('delete company', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// Projects CRUD
app.get('/api/v1/projects', async (req, res) => {
  const projects = await prisma.project.findMany().catch(e=>{ console.error('list projects',e); return [] })
  res.json({ ok: true, projects })
})

app.get('/api/v1/projects/:projectId', async (req, res) => {
  const id = req.params.projectId
  const project = await prisma.project.findUnique({ where: { id }, include: { sessions: true } }).catch(e=>null)
  if(!project) return res.status(404).json({ ok: false })
  res.json({ ok: true, project })
})

// Wiki: list pages (reads from mounted wiki folder)
app.get('/api/v1/wiki/pages', async (req, res) => {
  const root = wikiRoot()
  try{
    if(!fs.existsSync(root)) return res.json({ ok: true, root, pages: [] })
    const pages = []
    const stack = [root]
    while(stack.length){
      const dir = stack.pop()
      let entries = []
      try{ entries = fs.readdirSync(dir, { withFileTypes: true }) }catch(_e){ entries = [] }
      for(const ent of entries){
        if(ent.name.startsWith('.')) continue
        const full = path.join(dir, ent.name)
        if(ent.isDirectory()){
          stack.push(full)
          continue
        }
        if(!ent.isFile() || !ent.name.endsWith('.md')) continue
        const rel = path.relative(root, full).replace(/\\/g,'/')
        let text = ''
        try{ text = fs.readFileSync(full, 'utf8') }catch(_e){ text = '' }
        const { meta } = parseFrontmatter(text)
        const stat = fs.statSync(full)
        pages.push({
          path: rel,
          title: meta.title || ent.name.replace(/\.md$/,''),
          type: meta.type || 'unknown',
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          updated: meta.updated || isoDate(new Date(stat.mtimeMs))
        })
      }
    }
    pages.sort((a,b) => String(b.updated||'').localeCompare(String(a.updated||'')) || String(a.path).localeCompare(String(b.path)))
    res.json({ ok: true, root, pages })
  }catch(e){
    console.error('wiki pages', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// Wiki: get a page by path
app.get('/api/v1/wiki/page', async (req, res) => {
  const rel = req.query.path ? String(req.query.path) : ''
  const p = safeWikiPath(rel)
  if(!p) return res.status(400).json({ ok: false, error: 'invalid_path' })
  try{
    if(!fs.existsSync(p.full)) return res.status(404).json({ ok: false, error: 'not_found' })
    const text = fs.readFileSync(p.full, 'utf8')
    const { meta, body } = parseFrontmatter(text)
    res.json({ ok: true, path: p.clean, meta, body, content: text })
  }catch(e){
    console.error('wiki page', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// Wiki: create/update page
app.put('/api/v1/wiki/page', async (req, res) => {
  const body = req.body || {}
  const rel = typeof body.path === 'string' ? body.path : ''
  const p = safeWikiPath(rel)
  if(!p) return res.status(400).json({ ok: false, error: 'invalid_path' })
  if(!p.clean.endsWith('.md')) return res.status(400).json({ ok: false, error: 'path_must_end_with_md' })

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const type = typeof body.type === 'string' ? body.type.trim() : ''
  const tags = Array.isArray(body.tags) ? body.tags : (typeof body.tags === 'string' ? body.tags.split(',').map(s=>s.trim()) : [])
  const mdBody = typeof body.body === 'string' ? body.body : ''
  if(!title) return res.status(400).json({ ok: false, error: 'missing_title' })
  if(!type) return res.status(400).json({ ok: false, error: 'missing_type' })

  try{
    const exists = fs.existsSync(p.full)
    let created = isoDate()
    if(exists){
      const prev = fs.readFileSync(p.full, 'utf8')
      const { meta } = parseFrontmatter(prev)
      if(meta.created) created = String(meta.created).trim() || created
    }

    fs.mkdirSync(path.dirname(p.full), { recursive: true })
    const fm = buildFrontmatter({ title, type, tags, created, updated: isoDate() })
    const content = `${fm}${mdBody.trim() ? mdBody.trim() + '\n' : ''}`
    fs.writeFileSync(p.full, content, 'utf8')
    res.json({ ok: true, path: p.clean })
  }catch(e){
    console.error('wiki put', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// Wiki: delete page
app.delete('/api/v1/wiki/page', async (req, res) => {
  const rel = req.query.path ? String(req.query.path) : ''
  const p = safeWikiPath(rel)
  if(!p) return res.status(400).json({ ok: false, error: 'invalid_path' })
  try{
    if(!fs.existsSync(p.full)) return res.status(404).json({ ok: false, error: 'not_found' })
    fs.unlinkSync(p.full)
    res.json({ ok: true })
  }catch(e){
    console.error('wiki delete', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// --- Wiki projects (LLM Wiki ecosystem; separate from dashboard Projects) ---

app.get('/api/v1/wiki_projects', async (_req, res) => {
  const projects = await prisma.wikiProject
    .findMany({ orderBy: { createdAt: 'desc' } })
    .catch(() => [])
  res.json({ ok: true, projects })
})

app.post('/api/v1/wiki_projects', async (req, res) => {
  const body = req.body || {}
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const domain = typeof body.domain === 'string' ? body.domain.trim() : ''
  if(!name) return res.status(400).json({ ok: false, error: 'name_required' })

  try{
    const wikiProject = await prisma.wikiProject.create({
      data: {
        id: uid('wproj'),
        name,
        domain: domain || null,
        status: 'active',
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {}
      }
    })
    res.json({ ok: true, wikiProject })
  }catch(e){
    console.error('create wiki project', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

app.get('/api/v1/wiki_projects/:wikiProjectId', async (req, res) => {
  const { wikiProjectId } = req.params
  const wikiProject = await prisma.wikiProject.findUnique({ where: { id: wikiProjectId } }).catch(()=>null)
  if(!wikiProject) return res.status(404).json({ ok: false, error: 'not_found' })

  const [sources, builds] = await Promise.all([
    prisma.wikiSource.findMany({ where: { wikiProjectId }, orderBy: { createdAt: 'desc' } }).catch(()=>[]),
    prisma.wikiBuild.findMany({ where: { wikiProjectId }, orderBy: { createdAt: 'desc' }, take: 25 }).catch(()=>[])
  ])

  res.json({ ok: true, wikiProject, sources, builds })
})

app.patch('/api/v1/wiki_projects/:wikiProjectId', async (req, res) => {
  const { wikiProjectId } = req.params
  const body = req.body || {}
  const name = typeof body.name === 'string' ? body.name.trim() : null
  const domain = typeof body.domain === 'string' ? body.domain.trim() : null
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : null

  const existing = await prisma.wikiProject.findUnique({ where: { id: wikiProjectId } }).catch(()=>null)
  if(!existing) return res.status(404).json({ ok: false, error: 'not_found' })

  try{
    const wikiProject = await prisma.wikiProject.update({
      where: { id: wikiProjectId },
      data: {
        ...(name !== null ? { name } : {}),
        ...(domain !== null ? { domain: domain || null } : {}),
        ...(metadata !== null ? { metadata } : {}),
      }
    })
    res.json({ ok: true, wikiProject })
  }catch(e){
    console.error('update wiki project', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

app.get('/api/v1/wiki_projects/:wikiProjectId/sources', async (req, res) => {
  const { wikiProjectId } = req.params
  const sources = await prisma.wikiSource.findMany({ where: { wikiProjectId }, orderBy: { createdAt: 'desc' } }).catch(()=>[])
  res.json({ ok: true, sources })
})

app.post('/api/v1/wiki_projects/:wikiProjectId/sources', async (req, res) => {
  const { wikiProjectId } = req.params
  const body = req.body || {}
  const kind = typeof body.kind === 'string' ? body.kind.trim() : 'text'
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  const content = typeof body.content === 'string' ? body.content : ''

  const exists = await prisma.wikiProject.findUnique({ where: { id: wikiProjectId }, select: { id: true } }).catch(()=>null)
  if(!exists) return res.status(404).json({ ok: false, error: 'not_found' })

  try{
    const source = await prisma.wikiSource.create({
      data: {
        id: uid('wsrc'),
        wikiProjectId,
        kind,
        title: title || null,
        url: url || null,
        content: content || null,
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {}
      }
    })

    // Optional: auto-build when sources are added.
    const project = await prisma.wikiProject.findUnique({ where: { id: wikiProjectId }, select: { metadata: true, name: true, domain: true } }).catch(()=>null)
    const autoBuild = Boolean(project && project.metadata && typeof project.metadata === 'object' && project.metadata.autoBuildOnSource)
    let build = null
    if(autoBuild){
      const active = await prisma.wikiBuild.findFirst({
        where: { wikiProjectId, status: { in: ['queued','claimed','running'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true }
      }).catch(()=>null)
      if(!active){
        build = await createWikiBuildForProject(wikiProjectId, {
          title: `Auto build: ${project?.name || wikiProjectId}`,
          goal: `Update wiki from new sources (domain: ${project?.domain || 'General'})`
        }).catch(()=>null)
      }
    }

    res.json({ ok: true, source, autoBuildQueued: Boolean(build), build })
  }catch(e){
    console.error('create wiki source', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

function slugifyFilename(s){
  const base = String(s || '').trim().toLowerCase()
  const slug = base
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || 'source'
}

function workspaceRelForSource(source){
  const title = source.title || source.url || source.id
  const slug = slugifyFilename(title)
  const kind = String(source.kind || 'text').toLowerCase()
  if(kind === 'youtube' || kind === 'transcript') return `raw/transcripts/${slug}.md`
  if(kind === 'pdf' || kind === 'paper') return `raw/papers/${slug}.md`
  return `raw/articles/${slug}.md`
}

function sourceToMarkdown(source){
  const lines = []
  lines.push(`# ${source.title || source.url || source.id}`)
  lines.push('')
  if(source.url) lines.push(`Source URL: ${source.url}`)
  if(source.kind) lines.push(`Kind: ${source.kind}`)
  lines.push('')
  if(source.content) lines.push(String(source.content))
  else lines.push('_No content provided._')
  lines.push('')
  return lines.join('\n')
}

async function createWikiBuildForProject(wikiProjectId, opts = {}){
  const wikiProject = await prisma.wikiProject.findUnique({ where: { id: wikiProjectId } }).catch(()=>null)
  if(!wikiProject) return null
  const sources = await prisma.wikiSource.findMany({ where: { wikiProjectId }, orderBy: { createdAt: 'asc' } }).catch(()=>[])

  const title = typeof opts.title === 'string' && opts.title.trim() ? opts.title.trim() : `Build: ${wikiProject.name}`
  const goal = typeof opts.goal === 'string' && opts.goal.trim()
    ? opts.goal.trim()
    : `Build wiki pages for domain: ${wikiProject.domain || 'General'}`

  const buildId = uid('wbuild')
  const build = await prisma.wikiBuild.create({
    data: { id: buildId, wikiProjectId, status: 'queued', title, goal, metadata: {} }
  })

  const steps = []
  steps.push({
    id: uid('wstep'),
    buildId,
    index: 0,
    kind: 'init',
    summary: 'Initialize wiki workspace',
    status: 'queued',
    input: { domain: wikiProject.domain || null }
  })

  let idx = 1
  for(const src of sources){
    const rel = workspaceRelForSource(src)
    steps.push({
      id: uid('wstep'),
      buildId,
      index: idx,
      kind: 'write_file',
      summary: `Write source: ${src.title || src.url || src.id}`,
      status: 'queued',
      input: { path: rel, content: sourceToMarkdown(src), sourceId: src.id }
    })
    idx += 1
  }

  const trimmedSources = sources.slice(0, 20).map((s) => ({
    id: s.id,
    kind: s.kind,
    title: s.title,
    url: s.url,
    path: workspaceRelForSource(s),
    content_excerpt: (s.content || '').slice(0, 2500)
  }))

  steps.push({
    id: uid('wstep'),
    buildId,
    index: idx,
    kind: 'llm',
    summary: 'Generate wiki pages from sources',
    status: 'queued',
    input: {
      prompt: [
        'You are a wiki builder.',
        `Domain: ${wikiProject.domain || 'General'}`,
        '',
        'Using the sources below, generate a small set of wiki markdown pages with YAML frontmatter.',
        'Return ONLY valid JSON (no markdown).',
        '',
        'JSON schema:',
        '{ "files": [ { "path": "entities/foo.md", "content": "# ..." } ] }',
        '',
        'Rules:',
        '- Use directories: entities/, concepts/, comparisons/, queries/.',
        '- Each file MUST start with YAML frontmatter including: title, created, updated, type, tags, sources.',
        '- Keep pages compact; prefer a few high-signal pages.',
        '- Use [[wikilinks]] between pages where relevant.',
        '',
        'Sources (each has a recommended raw path you can cite in frontmatter sources):',
        JSON.stringify(trimmedSources, null, 2)
      ].join('\n'),
      system: 'You follow the wiki conventions and output strict JSON only.',
      timeoutMs: process.env.HERMES_JOB_TIMEOUT_MS || 600000
    }
  })
  const llmStepIndex = idx
  idx += 1

  steps.push({
    id: uid('wstep'),
    buildId,
    index: idx,
    kind: 'write_files',
    summary: 'Write generated wiki pages',
    status: 'queued',
    input: { fromStepIndex: llmStepIndex }
  })

  await prisma.wikiBuildStep.createMany({ data: steps })
  return build
}

app.get('/api/v1/wiki_projects/:wikiProjectId/builds', async (req, res) => {
  const { wikiProjectId } = req.params
  const builds = await prisma.wikiBuild.findMany({ where: { wikiProjectId }, orderBy: { createdAt: 'desc' }, take: 50 }).catch(()=>[])
  res.json({ ok: true, builds })
})

app.post('/api/v1/wiki_projects/:wikiProjectId/builds', async (req, res) => {
  const { wikiProjectId } = req.params
  const body = req.body || {}
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const goal = typeof body.goal === 'string' ? body.goal.trim() : ''

  const wikiProject = await prisma.wikiProject.findUnique({ where: { id: wikiProjectId } }).catch(()=>null)
  if(!wikiProject) return res.status(404).json({ ok: false, error: 'not_found' })

  try{
    const build = await createWikiBuildForProject(wikiProjectId, { title, goal })
    res.json({ ok: true, build })
  }catch(e){
    console.error('create wiki build', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

app.get('/api/v1/wiki_projects/:wikiProjectId/builds/:buildId', async (req, res) => {
  const { wikiProjectId, buildId } = req.params
  const build = await prisma.wikiBuild.findUnique({ where: { id: buildId } }).catch(()=>null)
  if(!build || build.wikiProjectId !== wikiProjectId) return res.status(404).json({ ok: false, error: 'not_found' })

  const [steps, events] = await Promise.all([
    prisma.wikiBuildStep.findMany({ where: { buildId }, orderBy: { index: 'asc' } }).catch(()=>[]),
    prisma.wikiEvent.findMany({ where: { buildId }, orderBy: { createdAt: 'asc' }, take: 500 }).catch(()=>[])
  ])

  res.json({ ok: true, build, steps, events })
})

function safeWikiWorkspaceRoot(wikiProjectId){
  const id = String(wikiProjectId || '').trim()
  if(!id || id.includes('..') || id.includes('/') || id.includes('\\')) return null
  const root = wikiRoot()
  const base = path.resolve(root, 'workspaces', id)
  if(!base.startsWith(path.resolve(root))) return null
  return base
}

async function walkFiles(dir, acc){
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(()=>[])
  for(const e of entries){
    const full = path.join(dir, e.name)
    if(e.isDirectory()){
      await walkFiles(full, acc)
    }else if(e.isFile()){
      acc.push(full)
    }
  }
}

function normKey(s){
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[#].*$/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function parseWikilinks(md){
  const text = typeof md === 'string' ? md : ''
  const out = []
  const re = /\[\[([^\]]+)\]\]/g
  let m
  while((m = re.exec(text))){
    const raw = String(m[1] || '').trim()
    if(!raw) continue
    const head = raw.split('|')[0].trim()
    const target = head.split('#')[0].trim()
    if(target) out.push(target)
  }
  return out
}

// Wiki projects: derive a graph from workspace markdown + [[wikilinks]]
app.get('/api/v1/wiki_projects/:wikiProjectId/graph', async (req, res) => {
  const { wikiProjectId } = req.params
  const includeExternal = String(req.query.includeExternal || '') === '1'

  const wikiProject = await prisma.wikiProject.findUnique({ where: { id: wikiProjectId } }).catch(()=>null)
  if(!wikiProject) return res.status(404).json({ ok: false, error: 'not_found' })

  const base = safeWikiWorkspaceRoot(wikiProjectId)
  if(!base) return res.status(400).json({ ok: false, error: 'invalid_workspace' })

  try{
    if(!fs.existsSync(base)) return res.json({ ok: true, nodes: [], edges: [] })

    const allFiles = []
    await walkFiles(base, allFiles)
    const mdFiles = allFiles.filter((f) => f.toLowerCase().endsWith('.md'))

    const nodes = []
    const keyToNodeId = new Map()
    const nodeIdToMeta = new Map()

    for(const full of mdFiles){
      const rel = path.relative(base, full).replace(/\\/g, '/')
      const content = await fs.promises.readFile(full, 'utf8').catch(()=>null)
      if(typeof content !== 'string') continue
      const { meta, body } = parseFrontmatter(content)
      const title = typeof meta.title === 'string' ? meta.title : path.basename(rel, '.md')
      const type = typeof meta.type === 'string' ? meta.type : ''
      const tags = Array.isArray(meta.tags) ? meta.tags : []

      const id = rel
      const node = { id, kind: 'page', path: rel, label: title, type, tags }
      nodes.push(node)
      nodeIdToMeta.set(id, { content, body, meta })

      const stem = path.basename(rel, '.md')
      const keys = [title, stem, rel, rel.replace(/\.md$/i,'')].map(normKey).filter(Boolean)
      for(const k of keys){
        if(!keyToNodeId.has(k)) keyToNodeId.set(k, id)
      }
    }

    const edges = []
    const seen = new Set()
    const externals = new Map() // key -> node

    for(const n of nodes){
      const meta = nodeIdToMeta.get(n.id)
      const body = meta && typeof meta.body === 'string' ? meta.body : ''
      const links = parseWikilinks(body)
      for(const l of links){
        const k = normKey(l)
        if(!k) continue
        let targetId = keyToNodeId.get(k) || null
        if(!targetId && includeExternal){
          const extId = `ext:${k}`
          if(!externals.has(extId)){
            externals.set(extId, { id: extId, kind: 'external', label: l })
          }
          targetId = extId
        }
        if(!targetId) continue
        if(targetId === n.id) continue
        const sig = `${n.id}=>${targetId}`
        if(seen.has(sig)) continue
        seen.add(sig)
        edges.push({ source: n.id, target: targetId, type: 'wikilink' })
      }
    }

    if(includeExternal){
      for(const ext of externals.values()){
        nodes.push(ext)
      }
    }

    res.json({ ok: true, wikiProjectId, nodes, edges })
  }catch(e){
    console.error('wiki graph', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// Wiki projects: SSE stream (poll-based signature)
app.get('/api/v1/wiki_projects/:wikiProjectId/stream', async (req, res) => {
  const { wikiProjectId } = req.params

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.write('retry: 2000\n\n')
  res.flushHeaders && res.flushHeaders()

  const send = (event, data) => {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  let closed = false
  req.on('close', () => { closed = true })

  let lastSig = null
  let tick = 0
  while(!closed){
    tick += 1
    res.write(`: ping ${tick}\n\n`)

    const wikiProject = await prisma.wikiProject.findUnique({ where: { id: wikiProjectId }, select: { id: true, updatedAt: true } }).catch(()=>null)
    if(!wikiProject){
      send('error', { ok: false, error: 'not_found' })
      break
    }

    const [sourceAgg, buildAgg, stepAgg, lastEvent] = await Promise.all([
      prisma.wikiSource.aggregate({ where: { wikiProjectId }, _max: { updatedAt: true } }).catch(()=>({ _max: { updatedAt: null } })),
      prisma.wikiBuild.aggregate({ where: { wikiProjectId }, _max: { updatedAt: true } }).catch(()=>({ _max: { updatedAt: null } })),
      prisma.wikiBuildStep.aggregate({ where: { build: { wikiProjectId } }, _max: { updatedAt: true } }).catch(()=>({ _max: { updatedAt: null } })),
      prisma.wikiEvent.findFirst({ where: { wikiProjectId }, orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true } }).catch(()=>null)
    ])

    const sig = [
      wikiProject.updatedAt ? wikiProject.updatedAt.toISOString() : '',
      sourceAgg?._max?.updatedAt ? sourceAgg._max.updatedAt.toISOString() : '',
      buildAgg?._max?.updatedAt ? buildAgg._max.updatedAt.toISOString() : '',
      stepAgg?._max?.updatedAt ? stepAgg._max.updatedAt.toISOString() : '',
      lastEvent?.createdAt ? new Date(lastEvent.createdAt).toISOString() : '',
      lastEvent?.id ? String(lastEvent.id) : ''
    ].join('|')

    if(sig !== lastSig){
      lastSig = sig
      send('changed', { ok: true, wikiProjectId })
    }

    await new Promise(r => setTimeout(r, 2000))
  }

  res.end()
})

// Projects: stream changes via SSE (runs/sessions/schedules/events)
app.get('/api/v1/projects/:projectId/stream', async (req, res) => {
  const { projectId } = req.params

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.write('retry: 2000\n\n')
  res.flushHeaders && res.flushHeaders()

  const send = (event, data) => {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  let closed = false
  req.on('close', () => { closed = true })

  let lastSig = null
  let tick = 0
  while(!closed){
    tick += 1
    res.write(`: ping ${tick}\n\n`)

    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, updatedAt: true } }).catch(()=>null)
    if(!project){
      send('error', { ok: false, error: 'not_found' })
      break
    }

    const [runAgg, sessionAgg, scheduleAgg, lastRunEvent] = await Promise.all([
      prisma.projectRun.aggregate({ where: { projectId }, _max: { updatedAt: true } }).catch(()=>({ _max: { updatedAt: null } })),
      prisma.session.aggregate({ where: { projectId }, _max: { updatedAt: true } }).catch(()=>({ _max: { updatedAt: null } })),
      prisma.schedule.aggregate({ where: { projectId }, _max: { updatedAt: true } }).catch(()=>({ _max: { updatedAt: null } })),
      prisma.runEvent.findFirst({ where: { run: { projectId } }, orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true } }).catch(()=>null),
    ])

    const sig = [
      project.updatedAt ? project.updatedAt.toISOString() : '',
      runAgg?._max?.updatedAt ? runAgg._max.updatedAt.toISOString() : '',
      sessionAgg?._max?.updatedAt ? sessionAgg._max.updatedAt.toISOString() : '',
      scheduleAgg?._max?.updatedAt ? scheduleAgg._max.updatedAt.toISOString() : '',
      lastRunEvent?.createdAt ? new Date(lastRunEvent.createdAt).toISOString() : '',
      lastRunEvent?.id ? String(lastRunEvent.id) : '',
    ].join('|')

    if(sig !== lastSig){
      lastSig = sig
      send('changed', { ok: true, projectId })
    }

    await new Promise(r => setTimeout(r, 2000))
  }

  res.end()
})

app.patch('/api/v1/projects/:projectId', async (req, res) => {
  const id = req.params.projectId
  const body = req.body || {}
  const name = typeof body.name === 'string' ? body.name.trim() : null
  const slug = typeof body.slug === 'string' ? body.slug.trim() : null
  const companyId = body.companyId === null ? null : (typeof body.companyId === 'string' ? body.companyId.trim() : undefined)
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : null

  const existing = await prisma.project.findUnique({ where: { id } }).catch(()=>null)
  if(!existing) return res.status(404).json({ ok: false })

  try{
    const project = await prisma.project.update({
      where: { id },
      data: {
        ...(name !== null ? { name } : {}),
        ...(slug !== null ? { slug } : {}),
        ...(companyId !== undefined ? { companyId } : {}),
        ...(metadata !== null ? { metadata } : {}),
      }
    })
    res.json({ ok: true, project })
  }catch(e){
    console.error('update project', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

app.delete('/api/v1/projects/:projectId', async (req, res) => {
  const projectId = req.params.projectId
  const force = String(req.query.force || '') === '1'

  const existing = await prisma.project.findUnique({ where: { id: projectId } }).catch(()=>null)
  if(!existing) return res.status(404).json({ ok: false })

  const sessionCount = await prisma.session.count({ where: { projectId } }).catch(()=>0)
  if(sessionCount > 0 && !force){
    return res.status(409).json({ ok: false, error: 'project_has_sessions', session_count: sessionCount, hint: 'pass ?force=1 to delete all project data' })
  }

  try{
    if(force){
      await prisma.$transaction(async (tx) => {
        await tx.workspaceSessionMap.deleteMany({ where: { projectId } })
        await tx.guidanceEvent.deleteMany({ where: { projectId } })
        await tx.messageJob.deleteMany({ where: { projectId } })
        await tx.session.deleteMany({ where: { projectId } })
        await tx.contextArtifact.deleteMany({ where: { scopeType: 'project', scopeId: projectId } })
        await tx.project.delete({ where: { id: projectId } })
      })
    }else{
      // Delete project-only artifacts; will fail if any sessions exist due to FK restrictions.
      await prisma.contextArtifact.deleteMany({ where: { scopeType: 'project', scopeId: projectId } }).catch(()=>{})
      await prisma.project.delete({ where: { id: projectId } })
    }
    res.json({ ok: true })
  }catch(e){
    console.error('delete project', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// Context artifacts (polymorphic by scopeType/scopeId)
app.get('/api/v1/context_artifacts', async (req, res) => {
  const type = req.query.type ? String(req.query.type) : null
  const scopeType = req.query.scopeType ? String(req.query.scopeType) : null
  const scopeId = req.query.scopeId ? String(req.query.scopeId) : null

  const where = {}
  if (type) where.type = type
  if (scopeType) where.scopeType = scopeType
  if (scopeId) where.scopeId = scopeId

  const artifacts = await prisma.contextArtifact
    .findMany({ where, orderBy: { updatedAt: 'desc' }, take: 200 })
    .catch((e) => {
      console.error('list context_artifacts', e)
      return []
    })
  res.json({ ok: true, artifacts })
})

app.post('/api/v1/context_artifacts/upsert', async (req, res) => {
  const body = req.body || {}
  const type = String(body.type || '').trim()
  const scopeType = String(body.scopeType || '').trim()
  const scopeId = String(body.scopeId || '').trim()
  const text = String(body.body ?? body.text ?? '').trim()
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {}

  if (!type || !scopeType || !scopeId) return res.status(400).json({ ok: false, error: 'missing type/scopeType/scopeId' })
  if (!text) return res.status(400).json({ ok: false, error: 'missing body' })

  try{
    const artifact = await prisma.contextArtifact.upsert({
      where: { type_scopeType_scopeId: { type, scopeType, scopeId } },
      update: { body: text, metadata, updatedAt: new Date() },
      create: { id: body.id || nowId('ctx'), type, scopeType, scopeId, body: text, metadata }
    })
    res.status(201).json({ ok: true, artifact })
  }catch(e){
    console.error('upsert context_artifact', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// Project/company briefs as context artifacts
app.get('/api/v1/projects/:projectId/brief', async (req, res) => {
  const projectId = req.params.projectId
  const artifact = await prisma.contextArtifact
    .findUnique({ where: { type_scopeType_scopeId: { type: 'project_brief', scopeType: 'project', scopeId: projectId } } })
    .catch(() => null)
  res.json({ ok: true, artifact })
})

app.put('/api/v1/projects/:projectId/brief', async (req, res) => {
  const projectId = req.params.projectId
  const body = req.body || {}
  const text = String(body.body ?? body.text ?? '').trim()
  if (!text) return res.status(400).json({ ok: false, error: 'missing body' })
  try{
    const artifact = await prisma.contextArtifact.upsert({
      where: { type_scopeType_scopeId: { type: 'project_brief', scopeType: 'project', scopeId: projectId } },
      update: { body: text, metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {}, updatedAt: new Date() },
      create: {
        id: nowId('ctx'),
        type: 'project_brief',
        scopeType: 'project',
        scopeId: projectId,
        body: text,
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {}
      }
    })
    res.status(201).json({ ok: true, artifact })
  }catch(e){
    console.error('upsert project brief', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

app.get('/api/v1/companies/:companyId/brief', async (req, res) => {
  const companyId = req.params.companyId
  const artifact = await prisma.contextArtifact
    .findUnique({ where: { type_scopeType_scopeId: { type: 'company_brief', scopeType: 'company', scopeId: companyId } } })
    .catch(() => null)
  res.json({ ok: true, artifact })
})

app.put('/api/v1/companies/:companyId/brief', async (req, res) => {
  const companyId = req.params.companyId
  const body = req.body || {}
  const text = String(body.body ?? body.text ?? '').trim()
  if (!text) return res.status(400).json({ ok: false, error: 'missing body' })
  try{
    const artifact = await prisma.contextArtifact.upsert({
      where: { type_scopeType_scopeId: { type: 'company_brief', scopeType: 'company', scopeId: companyId } },
      update: { body: text, metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {}, updatedAt: new Date() },
      create: {
        id: nowId('ctx'),
        type: 'company_brief',
        scopeType: 'company',
        scopeId: companyId,
        body: text,
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {}
      }
    })
    res.status(201).json({ ok: true, artifact })
  }catch(e){
    console.error('upsert company brief', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

app.post('/api/v1/projects', async (req, res) => {
  const body = req.body || {}
  const id = body.id || `project-${Date.now()}`
  try{
    const p = await prisma.project.create({ data: { id, name: body.name || id, slug: body.slug || id, companyId: body.companyId || null } })
    res.status(201).json({ ok: true, project: p })
  }catch(e){ console.error('create project',e); res.status(500).json({ ok: false, error: String(e) }) }
})

// Session detail
app.get('/api/v1/projects/:projectId/sessions/:sessionId', async (req, res) => {
  const { projectId, sessionId } = req.params
  const session = await prisma.session.findUnique({ where: { id: sessionId }, include: { guidanceEvents: true, workspaceMaps: true } }).catch(e=>null)
  if(!session || session.projectId !== projectId) return res.status(404).json({ ok: false })
  res.json({ ok: true, session })
})

// Rename/update session
app.patch('/api/v1/projects/:projectId/sessions/:sessionId', async (req, res) => {
  const { projectId, sessionId } = req.params
  const body = req.body || {}
  const title = typeof body.title === 'string' ? body.title.trim() : null

  const existing = await prisma.session.findUnique({ where: { id: sessionId } }).catch(()=>null)
  if(!existing || existing.projectId !== projectId) return res.status(404).json({ ok: false })

  try{
    const session = await prisma.session.update({
      where: { id: sessionId },
      data: {
        title: title && title.length ? title : null,
        updatedAt: new Date()
      }
    })
    res.json({ ok: true, session })
  }catch(e){
    console.error('update session', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// Delegate an action for a session (persist guidance event and optionally call Hermes)
app.post('/api/v1/projects/:projectId/sessions/:sessionId/delegate', async (req, res) => {
  const { projectId, sessionId } = req.params
  const body = req.body || {}
  const eventId = `event-${Date.now()}`
  try{
    await prisma.guidanceEvent.create({ data: { id: eventId, projectId, sessionId, eventType: body.type || 'delegate', payload: body.payload || {} } })
  }catch(e){ console.error('persist guidance event',e) }

  // Optionally forward to Hermes for execution
  let hermesResult = null
  try{
    hermesResult = await hermes.createSession(projectId, { prompt: body.prompt || body.instruction || 'Delegate task' })
  }catch(e){ hermesResult = { ok: false, error: String(e) } }

  res.status(202).json({ ok: true, event_id: eventId, hermes: hermesResult })
})

// Guidance events: list by project
app.get('/api/v1/projects/:projectId/guidance_events', async (req, res) => {
  const projectId = req.params.projectId
  const events = await prisma.guidanceEvent.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } }).catch(e=>{ console.error('list events',e); return [] })
  res.json({ ok: true, events })
})

// Guidance events: list by session
app.get('/api/v1/projects/:projectId/sessions/:sessionId/events', async (req, res) => {
  const { projectId, sessionId } = req.params
  const events = await prisma.guidanceEvent.findMany({ where: { projectId, sessionId }, orderBy: { createdAt: 'desc' } }).catch(e=>{ console.error('list events',e); return [] })
  res.json({ ok: true, events })
})

// Reports: basic analytics endpoints
app.get('/api/v1/reports/sessions-per-project', async (req, res) => {
  // Returns array of { projectId, count }
  const rows = await prisma.session.groupBy({ by: ['projectId'], _count: { id: true }, orderBy: { _count: { id: 'desc' } } }).catch(e=>{ console.error('report sessions-per-project',e); return [] })
  res.json({ ok: true, rows })
})

app.get('/api/v1/reports/guidance-events-per-project', async (req, res) => {
  const rows = await prisma.guidanceEvent.groupBy({ by: ['projectId'], _count: { id: true }, orderBy: { _count: { id: 'desc' } } }).catch(e=>{ console.error('report guidance-events-per-project',e); return [] })
  res.json({ ok: true, rows })
})

// Admin: DB health and table counts
app.get('/api/v1/admin/db', async (req, res) => {
  try{
    // quick ping via Prisma counts
    const counts = {
      companies: await prisma.company.count().catch(()=>null),
      projects: await prisma.project.count().catch(()=>null),
      sessions: await prisma.session.count().catch(()=>null),
      guidance_events: await prisma.guidanceEvent.count().catch(()=>null),
      workspace_session_maps: await prisma.workspaceSessionMap.count().catch(()=>null)
    }
    res.json({ ok: true, db: 'postgres', counts })
  }catch(err){
    res.status(500).json({ ok: false, error: String(err) })
  }
})

app.post('/api/v1/companies', (req, res) => {
  const body = req.body || {};
  const created = { id: `company-${Date.now()}`, ...body };
  // persist
  prisma.company.create({ data: { id: created.id, name: created.name, slug: created.slug } }).catch(e=>{ console.error('insert company',e) })
  res.status(201).json(created);
});


// Project-scoped sessions (proxy to Hermes via adapter)
app.get('/api/v1/projects/:projectId/sessions', async (req, res) => {
  const projectId = req.params.projectId
  // First return persisted sessions
  try{
    const sessions = await prisma.session.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } })
    res.json({ ok: true, source: 'db', sessions })
  }catch(err){
    const r = await hermes.listSessions(projectId)
    res.json(r)
  }
})

app.post('/api/v1/projects/:projectId/sessions', async (req, res) => {
  const projectId = req.params.projectId
  const body = req.body || {}
  // Persist a local session record, then attempt to create via Hermes
  const id = `session-${Date.now()}`
  const title = body.title || body.prompt || 'Untitled session'
  const scheduleInput = parseScheduleInput(body)
  try{
    // Ensure project exists (create on-demand)
    await prisma.project.upsert({ where: { id: projectId }, update: {}, create: { id: projectId, companyId: null, name: projectId, slug: projectId } })
    await prisma.session.create({ data: { id, projectId, title, status: 'pending' } })
    console.log(`[sessions] created local session id=${id} project=${projectId} title=${title}`)

    if(scheduleInput && scheduleInput.ok){
      const sch = scheduleInput.schedule
      await prisma.schedule.create({
        data: {
          id: nowId('sch'),
          projectId,
          sessionId: id,
          name: sch.name,
          enabled: sch.enabled,
          intervalSeconds: sch.intervalSeconds,
          timezone: sch.timezone,
          nextRunAt: sch.nextRunAt,
          config: sch.config,
          runTemplate: { title: `Scheduled: ${title}`, goal: title }
        }
      }).catch((e)=>console.error('create schedule (session)', e))
    }else if(scheduleInput && !scheduleInput.ok){
      console.warn('[sessions] schedule invalid', scheduleInput.error)
    }
  }catch(e){ console.error('insert session',e) }

  const systemFromBriefs = body.system ? null : await buildSystemContextForProject(projectId)
  const r = await hermes.createSession(projectId, Object.assign({}, body, systemFromBriefs ? { system: systemFromBriefs } : {}))
  if(r && r.ok && r.result){
    const hermesId = r.result.id || r.result.hermes_session_id || null
    await prisma.session.update({ where: { id }, data: { hermesSessionId: hermesId, status: 'completed', updatedAt: new Date() } }).catch(e=>console.error('update session',e))
    // Persist assistant message as a guidance event for session message history
    try{
      const assistantText = extractAssistantText(r.result) || JSON.stringify(r.result)
      await prisma.guidanceEvent.create({
        data: {
          id: `evt-${Date.now()}`,
          projectId,
          sessionId: id,
          eventType: 'assistant_message',
          payload: { text: assistantText }
        }
      })
        console.log(`[sessions] persisted assistant message for local_id=${id} project=${projectId} len=${(assistantText||'').length}`)
    }catch(e){ console.error('persist assistant message',e) }
    res.status(201).json({ ok: true, source: 'hermes', hermes: r.result, local_id: id })
  }else{
    // leave as pending
    res.status(202).json({ ok: false, source: 'local', local_id: id, error: r && r.error ? r.error : 'hermes-failed' })
  }
})

// Schedules: CRUD (session-scoped)
app.get('/api/v1/projects/:projectId/sessions/:sessionId/schedules', async (req, res) => {
  const { projectId, sessionId } = req.params
  const s = await prisma.session.findUnique({ where: { id: sessionId } }).catch(()=>null)
  if(!s || s.projectId !== projectId) return res.status(404).json({ ok: false })
  const schedules = await prisma.schedule.findMany({ where: { projectId, sessionId }, orderBy: { createdAt: 'desc' }, take: 50 }).catch(()=>[])
  res.json({ ok: true, schedules })
})

app.post('/api/v1/projects/:projectId/sessions/:sessionId/schedules', async (req, res) => {
  const { projectId, sessionId } = req.params
  const body = req.body || {}
  const s = await prisma.session.findUnique({ where: { id: sessionId } }).catch(()=>null)
  if(!s || s.projectId !== projectId) return res.status(404).json({ ok: false })

  const input = parseScheduleInput({ schedule: body })
  if(!(input && input.ok)) return res.status(400).json({ ok: false, error: input ? input.error : 'invalid_schedule' })

  try{
    const sch = input.schedule
    const schedule = await prisma.schedule.create({
      data: {
        id: body.id && typeof body.id === 'string' ? body.id : nowId('sch'),
        projectId,
        sessionId,
        name: sch.name,
        enabled: sch.enabled,
        intervalSeconds: sch.intervalSeconds,
        timezone: sch.timezone,
        nextRunAt: sch.nextRunAt,
        config: sch.config,
        runTemplate: body.runTemplate && typeof body.runTemplate === 'object' ? body.runTemplate : { title: `Scheduled run`, goal: `Run scheduled work for session ${sessionId}` }
      }
    })
    res.status(201).json({ ok: true, schedule })
  }catch(e){
    console.error('create schedule', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

app.patch('/api/v1/projects/:projectId/sessions/:sessionId/schedules/:scheduleId', async (req, res) => {
  const { projectId, sessionId, scheduleId } = req.params
  const body = req.body || {}
  const sched = await prisma.schedule.findUnique({ where: { id: scheduleId } }).catch(()=>null)
  if(!sched || sched.projectId !== projectId || sched.sessionId !== sessionId) return res.status(404).json({ ok: false })

  const enabled = body.enabled === undefined ? undefined : Boolean(body.enabled)
  let intervalSeconds = undefined
  if(body.intervalSeconds === null) intervalSeconds = null
  else if(body.intervalSeconds != null){
    const raw = Number.parseInt(String(body.intervalSeconds), 10)
    intervalSeconds = Number.isFinite(raw) && raw > 0 ? raw : undefined
  }
  const nextRunAt = body.nextRunAt ? new Date(String(body.nextRunAt)) : undefined
  const name = typeof body.name === 'string' ? body.name.trim() : undefined
  const timezone = typeof body.timezone === 'string' ? body.timezone.trim() : undefined
  const config = body.config && typeof body.config === 'object' ? body.config : undefined
  const runTemplate = body.runTemplate && typeof body.runTemplate === 'object' ? body.runTemplate : undefined

  try{
    const updatedConfig = config !== undefined ? config : (sched.config || {})
    const updatedTz = timezone !== undefined ? timezone : (sched.timezone || null)
    const updatedIntervalSeconds = intervalSeconds !== undefined ? intervalSeconds : (sched.intervalSeconds || null)
    const shouldRecomputeNext =
      nextRunAt === undefined &&
      (intervalSeconds !== undefined || config !== undefined || timezone !== undefined)

    const recomputedNext = shouldRecomputeNext
      ? computeNextRunAt({ now: new Date(), intervalSeconds: updatedIntervalSeconds, config: updatedConfig, timezone: updatedTz })
      : null

    const updated = await prisma.schedule.update({
      where: { id: scheduleId },
      data: {
        ...(enabled !== undefined ? { enabled } : {}),
        ...(intervalSeconds !== undefined ? { intervalSeconds } : {}),
        ...(name !== undefined ? { name } : {}),
        ...(timezone !== undefined ? { timezone } : {}),
        ...(config !== undefined ? { config } : {}),
        ...(runTemplate !== undefined ? { runTemplate } : {}),
        ...(nextRunAt !== undefined && !Number.isNaN(nextRunAt.getTime()) ? { nextRunAt } : {}),
        ...(recomputedNext && !Number.isNaN(recomputedNext.getTime()) ? { nextRunAt: recomputedNext } : {})
      }
    })
    res.json({ ok: true, schedule: updated })
  }catch(e){
    console.error('update schedule', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

app.delete('/api/v1/projects/:projectId/sessions/:sessionId/schedules/:scheduleId', async (req, res) => {
  const { projectId, sessionId, scheduleId } = req.params
  const sched = await prisma.schedule.findUnique({ where: { id: scheduleId } }).catch(()=>null)
  if(!sched || sched.projectId !== projectId || sched.sessionId !== sessionId) return res.status(404).json({ ok: false })
  try{
    await prisma.schedule.delete({ where: { id: scheduleId } })
    res.json({ ok: true })
  }catch(e){
    console.error('delete schedule', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// Runs: durable orchestration records (worker executes steps)
app.post('/api/v1/projects/:projectId/runs', async (req, res) => {
  const projectId = req.params.projectId
  const body = req.body || {}

  const goal = typeof body.goal === 'string' ? body.goal.trim() : ''
  if(!goal) return res.status(400).json({ ok: false, error: 'missing goal' })

  const title = typeof body.title === 'string' ? body.title.trim() : null
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {}
  const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : null
  const scheduleId = typeof body.scheduleId === 'string' && body.scheduleId.trim() ? body.scheduleId.trim() : null

  try{
    // Ensure project exists (create on-demand)
    await prisma.project.upsert({ where: { id: projectId }, update: {}, create: { id: projectId, companyId: null, name: projectId, slug: projectId } })

    if(sessionId){
      const s = await prisma.session.findUnique({ where: { id: sessionId } }).catch(()=>null)
      if(!s || s.projectId !== projectId) return res.status(404).json({ ok: false, error: 'session_not_found' })
    }

    if(scheduleId){
      const sch = await prisma.schedule.findUnique({ where: { id: scheduleId } }).catch(()=>null)
      if(!sch || sch.projectId !== projectId) return res.status(404).json({ ok: false, error: 'schedule_not_found' })
      if(sessionId && sch.sessionId && sch.sessionId !== sessionId){
        return res.status(409).json({ ok: false, error: 'schedule_session_mismatch' })
      }
    }

    const runId = body.id && typeof body.id === 'string' ? body.id : nowId('run')
    const stepId = nowId('step')

    const result = await prisma.$transaction(async (tx) => {
      const run = await tx.projectRun.create({
        data: {
          id: runId,
          projectId,
          sessionId,
          scheduleId: scheduleId || null,
          status: 'queued',
          title: title && title.length ? title : null,
          goal,
          metadata
        }
      })

      const step = await tx.runStep.create({
        data: {
          id: stepId,
          runId: runId,
          index: 0,
          kind: 'llm',
          status: 'queued',
          input: { type: 'plan', goal }
        }
      })

      return { run, step }
    })

    res.status(201).json({ ok: true, run: result.run, initial_step: result.step })
  }catch(e){
    console.error('create run', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

app.get('/api/v1/projects/:projectId/runs', async (req, res) => {
  const projectId = req.params.projectId
  const take = Math.min(200, Math.max(1, Number.parseInt(String(req.query.take || '50'), 10) || 50))

  try{
    const runs = await prisma.projectRun.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        _count: { select: { steps: true, approvals: true, events: true } }
      }
    })
    res.json({ ok: true, runs })
  }catch(e){
    console.error('list runs', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

app.get('/api/v1/projects/:projectId/runs/:runId', async (req, res) => {
  const { projectId, runId } = req.params
  try{
    const run = await prisma.projectRun.findUnique({
      where: { id: runId },
      include: {
        steps: { orderBy: { index: 'asc' } },
        approvals: { orderBy: { createdAt: 'asc' } },
        events: { orderBy: { createdAt: 'asc' }, take: 500 }
      }
    }).catch(()=>null)
    if(!run || run.projectId !== projectId) return res.status(404).json({ ok: false })
    res.json({ ok: true, run })
  }catch(e){
    console.error('get run', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

app.post('/api/v1/projects/:projectId/runs/:runId/cancel', async (req, res) => {
  const { projectId, runId } = req.params
  const run = await prisma.projectRun.findUnique({ where: { id: runId } }).catch(()=>null)
  if(!run || run.projectId !== projectId) return res.status(404).json({ ok: false })

  if(run.status === 'succeeded' || run.status === 'failed' || run.status === 'canceled'){
    return res.status(409).json({ ok: false, error: 'run_not_cancelable', status: run.status })
  }

  try{
    const updated = await prisma.projectRun.update({ where: { id: runId }, data: { status: 'canceled', updatedAt: new Date() } })
    res.json({ ok: true, run: updated })
  }catch(e){
    console.error('cancel run', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// Runs: stream updates via SSE (auto-reconnect friendly)
app.get('/api/v1/projects/:projectId/runs/:runId/stream', async (req, res) => {
  const { projectId, runId } = req.params

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.write('retry: 2000\n\n')
  res.flushHeaders && res.flushHeaders()

  const send = (event, data) => {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  let closed = false
  req.on('close', () => {
    closed = true
  })

  let lastSig = null
  let tick = 0
  while(!closed){
    tick += 1
    res.write(`: ping ${tick}\n\n`)

    const run = await prisma.projectRun.findUnique({ where: { id: runId } }).catch(()=>null)
    if(!run || run.projectId !== projectId){
      send('error', { ok: false, error: 'not_found' })
      break
    }

    const [stepAgg, approvalAgg, lastEvent] = await Promise.all([
      prisma.runStep.aggregate({ where: { runId }, _max: { updatedAt: true } }).catch(()=>({ _max: { updatedAt: null } })),
      prisma.approvalRequest.aggregate({ where: { runId }, _max: { updatedAt: true } }).catch(()=>({ _max: { updatedAt: null } })),
      prisma.runEvent.findFirst({ where: { runId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, id: true } }).catch(()=>null)
    ])

    const sig = [
      run.updatedAt ? run.updatedAt.toISOString() : '',
      run.status || '',
      run.hermesLastResponseId || '',
      stepAgg && stepAgg._max && stepAgg._max.updatedAt ? stepAgg._max.updatedAt.toISOString() : '',
      approvalAgg && approvalAgg._max && approvalAgg._max.updatedAt ? approvalAgg._max.updatedAt.toISOString() : '',
      lastEvent && lastEvent.createdAt ? new Date(lastEvent.createdAt).toISOString() : '',
      lastEvent && lastEvent.id ? String(lastEvent.id) : ''
    ].join('|')

    if(sig !== lastSig){
      lastSig = sig
      const full = await prisma.projectRun.findUnique({
        where: { id: runId },
        include: {
          steps: { orderBy: { index: 'asc' } },
          approvals: { orderBy: { createdAt: 'asc' } },
          events: { orderBy: { createdAt: 'asc' }, take: 500 }
        }
      }).catch(()=>null)
      send('status', { ok: true, run: full })
    }

    if(run.status === 'succeeded' || run.status === 'failed' || run.status === 'canceled'){
      send('done', { ok: true, run })
      break
    }

    await new Promise(r => setTimeout(r, 2000))
  }

  res.end()
})

// Runs: report progress (creates a RunEvent)
app.post('/api/v1/projects/:projectId/runs/:runId/progress', async (req, res) => {
  const { projectId, runId } = req.params
  const body = req.body || {}
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const stepId = typeof body.stepId === 'string' ? body.stepId.trim() : null
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {}

  const run = await prisma.projectRun.findUnique({ where: { id: runId } }).catch(()=>null)
  if(!run || run.projectId !== projectId) return res.status(404).json({ ok: false })

  try{
    const evt = await prisma.runEvent.create({
      data: {
        id: `revt-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        runId,
        stepId,
        level: 'info',
        message: message || 'progress',
        payload
      }
    })
    res.status(201).json({ ok: true, event: evt })
  }catch(e){
    console.error('run progress', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// Approvals: list + decide (unblocks run worker)
app.get('/api/v1/approvals', async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null
  const runId = req.query.runId ? String(req.query.runId) : null
  const projectId = req.query.projectId ? String(req.query.projectId) : null
  const take = Math.min(200, Math.max(1, Number.parseInt(String(req.query.take || '50'), 10) || 50))

  const where = {}
  if(status) where.status = status
  if(runId) where.runId = runId
  if(projectId) where.run = { projectId }

  try{
    const approvals = await prisma.approvalRequest.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take,
      include: { run: true, step: true }
    })
    res.json({ ok: true, approvals })
  }catch(e){
    console.error('list approvals', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

app.post('/api/v1/approvals/:approvalId/decision', async (req, res) => {
  const approvalId = req.params.approvalId
  const body = req.body || {}
  const decision = typeof body.decision === 'string' ? body.decision.trim().toLowerCase() : ''
  if(decision !== 'approved' && decision !== 'rejected'){
    return res.status(400).json({ ok: false, error: 'invalid_decision', hint: 'decision must be approved|rejected' })
  }

  const approval = await prisma.approvalRequest.findUnique({ where: { id: approvalId } }).catch(()=>null)
  if(!approval) return res.status(404).json({ ok: false, error: 'not_found' })
  if(approval.status !== 'pending'){
    return res.status(409).json({ ok: false, error: 'already_decided', status: approval.status })
  }

  try{
    const decidedBy = typeof body.decidedBy === 'string' ? body.decidedBy.trim() : null
    const notes = typeof body.notes === 'string' ? body.notes.trim() : null

    const updated = await prisma.$transaction(async (tx) => {
      const approval2 = await tx.approvalRequest.update({
        where: { id: approvalId },
        data: {
          status: decision,
          decision: { decision, notes },
          decidedAt: new Date(),
          decidedBy,
          updatedAt: new Date()
        }
      })

      const stepStatus = decision === 'approved' ? 'succeeded' : 'failed'
      await tx.runStep.update({
        where: { id: approval.stepId },
        data: {
          status: stepStatus,
          ...(decision === 'rejected' ? { error: 'approval_rejected' } : {}),
          endedAt: new Date(),
          updatedAt: new Date()
        }
      })

      if(decision === 'rejected'){
        await tx.projectRun.update({ where: { id: approval.runId }, data: { status: 'failed', updatedAt: new Date() } })
      }else{
        // allow worker to continue
        await tx.projectRun.update({ where: { id: approval.runId }, data: { status: 'running', updatedAt: new Date() } })
      }

      return approval2
    })

    res.json({ ok: true, approval: updated })
  }catch(e){
    console.error('decide approval', e)
    res.status(500).json({ ok: false, error: String(e) })
  }
})

// Messages: list messages for a session (assistant + user) sorted by createdAt
app.get('/api/v1/projects/:projectId/sessions/:sessionId/messages', async (req, res) => {
  const { projectId, sessionId } = req.params
  console.log(`[messages] GET project=${projectId} session=${sessionId}`)
  const events = await prisma.guidanceEvent.findMany({ where: { projectId, sessionId }, orderBy: { createdAt: 'asc' } }).catch(e=>{ console.error('list messages',e); return [] })
  res.json({ ok: true, messages: events.map(ev=>({ id: ev.id, type: ev.eventType, payload: ev.payload, createdAt: ev.createdAt })) })
})

// Message jobs: check status of an async Hermes call
app.get('/api/v1/projects/:projectId/sessions/:sessionId/message_jobs/:jobId', async (req, res) => {
  const { projectId, sessionId, jobId } = req.params
  const job = await prisma.messageJob.findUnique({ where: { id: jobId } }).catch(()=>null)
  if(!job || job.projectId !== projectId || job.sessionId !== sessionId) return res.status(404).json({ ok: false })
  res.json({ ok: true, job })
})

// Message jobs: retry (creates a new job with the same input)
app.post('/api/v1/projects/:projectId/sessions/:sessionId/message_jobs/:jobId/retry', async (req, res) => {
  const { projectId, sessionId, jobId } = req.params
  const job = await prisma.messageJob.findUnique({ where: { id: jobId } }).catch(()=>null)
  if(!job || job.projectId !== projectId || job.sessionId !== sessionId) return res.status(404).json({ ok: false })
  if(!(job.status === 'failed' || job.status === 'timeout')) return res.status(409).json({ ok: false, error: 'job_not_retryable', status: job.status })

  const newJobId = nowId('job')
  const newJob = await prisma.messageJob.create({ data: { id: newJobId, projectId, sessionId, status: 'queued', input: job.input } }).catch((e)=>null)
  if(!newJob) return res.status(500).json({ ok: false, error: 'job_create_failed' })

  setImmediate(() => {
    processMessageJob(newJobId).catch((e) => console.error('processMessageJob', e))
  })

  res.status(202).json({ ok: true, job: newJob })
})

// Message jobs: stream updates via SSE (auto-reconnect friendly)
app.get('/api/v1/projects/:projectId/sessions/:sessionId/message_jobs/:jobId/stream', async (req, res) => {
  const { projectId, sessionId, jobId } = req.params

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  // Hint EventSource reconnect delay (ms)
  res.write('retry: 2000\n\n')
  res.flushHeaders && res.flushHeaders()

  const send = (event, data) => {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  let closed = false
  req.on('close', () => {
    closed = true
  })

  // poll db status and stream updates
  let lastStatus = null
  let tick = 0
  while(!closed){
    tick += 1
    // Keepalive comment line (some proxies close idle SSE connections).
    res.write(`: ping ${tick}\n\n`)

    const job = await prisma.messageJob.findUnique({ where: { id: jobId } }).catch(()=>null)
    if(!job || job.projectId !== projectId || job.sessionId !== sessionId){
      send('error', { ok: false, error: 'not_found' })
      break
    }

    if(job.status !== lastStatus){
      lastStatus = job.status
      send('status', { ok: true, job })
    }

    if(job.status === 'succeeded' || job.status === 'failed' || job.status === 'timeout'){
      send('done', { ok: true, job })
      break
    }

    // heartbeat every ~2s
    await new Promise(r => setTimeout(r, 2000))
  }

  res.end()
})

// Send a message in a session: persist user message, call Hermes, persist assistant response
app.post('/api/v1/projects/:projectId/sessions/:sessionId/messages', async (req, res) => {
  const { projectId, sessionId } = req.params
  const body = req.body || {}
  const userText = body.content || body.prompt || ''
  console.log(`[messages] POST project=${projectId} session=${sessionId} userText_len=${(userText||'').length}`)
  if(!userText) return res.status(400).json({ ok: false, error: 'missing content' })
  const userEvtId = `evt-${Date.now()}-u`
  try{
    await prisma.guidanceEvent.create({ data: { id: userEvtId, projectId, sessionId, eventType: 'user_message', payload: { text: userText } } })
  }catch(e){
    console.error('persist user message',e)
  }

  const jobId = nowId('job')
  const requestedModel = body && body.model ? String(body.model) : null
  const job = await prisma.messageJob
    .create({ data: { id: jobId, projectId, sessionId, status: 'queued', input: String(userText), model: requestedModel } })
    .catch((e) => {
      console.error('create message job', e)
      return null
    })
  if(!job) return res.status(500).json({ ok: false, error: 'job_create_failed' })

  // Fire and forget: process Hermes call asynchronously so the client can poll.
  setImmediate(() => {
    processMessageJob(jobId).catch((e) => console.error('processMessageJob', e))
  })

  res.status(202).json({ ok: true, job, user_event_id: userEvtId })
})

const server = http.createServer(app)
server.listen(PORT, () => {
  console.log(`Dashboard API listening on port ${PORT}`);
})

// WebSocket hub for live events (runs + wiki builds).
startWebSocketHub({ server, prisma })
