require('dotenv').config()

const express = require('express');
const cors = require('cors');
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')

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

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

function nowId(prefix){
  return `${prefix}-${Date.now()}`
}

function parseScheduleInput(body){
  if(!body || typeof body !== 'object') return null
  const s = body.schedule && typeof body.schedule === 'object' ? body.schedule : null
  if(!s) return null

  const enabled = s.enabled === false ? false : true
  const intervalSecondsRaw = s.intervalSeconds != null ? Number.parseInt(String(s.intervalSeconds), 10) : null
  const intervalSeconds = Number.isFinite(intervalSecondsRaw) && intervalSecondsRaw > 0 ? intervalSecondsRaw : null
  const timezone = typeof s.timezone === 'string' && s.timezone.trim() ? s.timezone.trim() : null
  const name = typeof s.name === 'string' && s.name.trim() ? s.name.trim() : 'Session schedule'
  const config = s.config && typeof s.config === 'object' ? s.config : {}
  const startAtIso = typeof s.startAt === 'string' && s.startAt.trim() ? s.startAt.trim() : null
  const startAt = startAtIso ? new Date(startAtIso) : null
  const nextRunAt = startAt && !Number.isNaN(startAt.getTime()) ? startAt : (intervalSeconds ? new Date(Date.now() + intervalSeconds * 1000) : null)

  if(!intervalSeconds) return { ok: false, error: 'missing intervalSeconds' }
  return { ok: true, schedule: { enabled, intervalSeconds, timezone, name, config, nextRunAt } }
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
  try{
    const project = await prisma.project.findUnique({ where: { id: projectId } }).catch(()=>null)
    const companyId = project?.companyId || null

    const [projectBrief, companyBrief] = await Promise.all([
      prisma.contextArtifact
        .findUnique({ where: { type_scopeType_scopeId: { type: 'project_brief', scopeType: 'project', scopeId: projectId } } })
        .catch(() => null),
      companyId
        ? prisma.contextArtifact
            .findUnique({ where: { type_scopeType_scopeId: { type: 'company_brief', scopeType: 'company', scopeId: companyId } } })
            .catch(() => null)
        : Promise.resolve(null),
    ])

    const parts = []
    if (companyBrief?.body) parts.push(`Company brief:\n${companyBrief.body}`)
    if (projectBrief?.body) parts.push(`Project brief:\n${projectBrief.body}`)
    const system = parts.join('\n\n---\n\n').trim()
    return system || null
  }catch(e){
    console.error('buildSystemContextForProject', e)
    return null
  }
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
  const intervalSecondsRaw = body.intervalSeconds != null ? Number.parseInt(String(body.intervalSeconds), 10) : undefined
  const intervalSeconds = intervalSecondsRaw !== undefined && Number.isFinite(intervalSecondsRaw) && intervalSecondsRaw > 0 ? intervalSecondsRaw : undefined
  const nextRunAt = body.nextRunAt ? new Date(String(body.nextRunAt)) : undefined
  const name = typeof body.name === 'string' ? body.name.trim() : undefined
  const timezone = typeof body.timezone === 'string' ? body.timezone.trim() : undefined
  const config = body.config && typeof body.config === 'object' ? body.config : undefined
  const runTemplate = body.runTemplate && typeof body.runTemplate === 'object' ? body.runTemplate : undefined

  try{
    const updated = await prisma.schedule.update({
      where: { id: scheduleId },
      data: {
        ...(enabled !== undefined ? { enabled } : {}),
        ...(intervalSeconds !== undefined ? { intervalSeconds } : {}),
        ...(name !== undefined ? { name } : {}),
        ...(timezone !== undefined ? { timezone } : {}),
        ...(config !== undefined ? { config } : {}),
        ...(runTemplate !== undefined ? { runTemplate } : {}),
        ...(nextRunAt !== undefined && !Number.isNaN(nextRunAt.getTime()) ? { nextRunAt } : {})
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

app.listen(PORT, () => {
  console.log(`Dashboard API listening on port ${PORT}`);
});
