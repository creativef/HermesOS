const fs = require('fs')
const path = require('path')

function makeId(prefix){
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function getWikiRoot(){
  const env = typeof process.env.WIKI_PATH === 'string' ? process.env.WIKI_PATH.trim() : ''
  return env || '/wiki'
}

function safeWorkspacePath(wikiProjectId, rel){
  const root = path.resolve(getWikiRoot(), 'workspaces', String(wikiProjectId || '').trim())
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if(!clean || clean.includes('..')) return null
  const full = path.resolve(root, clean)
  if(!full.startsWith(root)) return null
  return { root, clean, full }
}

function isoDate(date = new Date()){
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth()+1).padStart(2,'0')
  const d = String(date.getUTCDate()).padStart(2,'0')
  return `${y}-${m}-${d}`
}

function parseUsage(result){
  const u = result && typeof result === 'object' ? result.usage : null
  if(!u || typeof u !== 'object') return null
  const promptTokens = Number.isFinite(Number(u.prompt_tokens)) ? Number(u.prompt_tokens) : null
  const completionTokens = Number.isFinite(Number(u.completion_tokens)) ? Number(u.completion_tokens) : null
  const inputTokens = Number.isFinite(Number(u.input_tokens)) ? Number(u.input_tokens) : null
  const outputTokens = Number.isFinite(Number(u.output_tokens)) ? Number(u.output_tokens) : null
  const totalTokens = Number.isFinite(Number(u.total_tokens)) ? Number(u.total_tokens) : (promptTokens != null && completionTokens != null ? promptTokens + completionTokens : null)
  const finalTotal = totalTokens != null ? totalTokens : (inputTokens != null && outputTokens != null ? inputTokens + outputTokens : null)
  return { promptTokens, completionTokens, inputTokens, outputTokens, totalTokens: finalTotal }
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

function extractResponseText(result){
  if(!result || typeof result !== 'object') return null
  const output = Array.isArray(result.output) ? result.output : null
  if(output && output.length){
    const texts = []
    for(const item of output){
      const content = item && Array.isArray(item.content) ? item.content : null
      if(!content) continue
      for(const c of content){
        if(!c) continue
        if(typeof c.text === 'string') texts.push(c.text)
        else if(typeof c.content === 'string') texts.push(c.content)
      }
    }
    const joined = texts.join('').trim()
    if(joined) return joined
  }
  const message = result?.choices?.[0]?.message
  if(message && typeof message.content === 'string') return message.content.trim()
  return null
}

function safeJsonParse(text){
  if(typeof text !== 'string') return null
  const trimmed = text.trim()
  if(!trimmed) return null
  try{
    return JSON.parse(trimmed)
  }catch(_e){
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if(start >= 0 && end > start){
      const slice = trimmed.slice(start, end + 1)
      try{ return JSON.parse(slice) }catch(_e2){ return null }
    }
    return null
  }
}

async function appendWikiEvent(prisma, wikiProjectId, buildId, stepId, level, message, payload){
  try{
    await prisma.wikiEvent.create({
      data: {
        id: makeId('wevt'),
        wikiProjectId,
        buildId: buildId || null,
        stepId: stepId || null,
        level: level || 'info',
        message: String(message || ''),
        payload: payload && typeof payload === 'object' ? payload : {}
      }
    })
  }catch(_e){
    // best-effort
  }
}

async function ensureDir(p){
  await fs.promises.mkdir(p, { recursive: true })
}

function defaultSchemaMarkdown(domain){
  const today = isoDate(new Date())
  const name = String(domain || '').trim() || 'General'
  return [
    '# Wiki Schema',
    '',
    '## Domain',
    `${name} — knowledge base curated by HermesOS.`,
    '',
    '## Conventions',
    '- File names: lowercase, hyphens, no spaces',
    '- Every page starts with YAML frontmatter',
    '- Use [[wikilinks]] to link between pages',
    '- When updating a page, bump `updated`',
    '- Add every page to `index.md`',
    '- Append actions to `log.md`',
    '',
    '## Frontmatter',
    '```yaml',
    '---',
    'title: Page Title',
    `created: ${today}`,
    `updated: ${today}`,
    'type: entity | concept | comparison | query',
    'tags: [tag1, tag2]',
    'sources: [raw/articles/source.md]',
    '---',
    '```',
    '',
    '## Page Thresholds',
    '- Create a page when a concept is central to a source or appears in 2+ sources',
    '- Split pages that exceed ~200 lines',
    '- Prefer small, linkable pages over monoliths',
  ].join('\n')
}

function defaultIndexMarkdown(){
  const today = isoDate(new Date())
  return [
    '# Wiki Index',
    '',
    '> Content catalog. Every wiki page listed under its type with a one-line summary.',
    `> Last updated: ${today} | Total pages: 0`,
    '',
    '## Entities',
    '',
    '## Concepts',
    '',
    '## Comparisons',
    '',
    '## Queries',
    ''
  ].join('\n')
}

function defaultLogMarkdown(domain){
  const today = isoDate(new Date())
  const name = String(domain || '').trim() || 'General'
  return [
    '# Wiki Log',
    '',
    '> Chronological record of all wiki actions. Append-only.',
    '> Format: `## [YYYY-MM-DD] action | subject`',
    '> Actions: ingest, update, query, lint, create, archive, delete',
    '',
    `## [${today}] create | Wiki initialized`,
    `- Domain: ${name}`,
    ''
  ].join('\n')
}

async function initWikiWorkspace({ wikiProjectId, domain }){
  const root = path.resolve(getWikiRoot(), 'workspaces', String(wikiProjectId || '').trim())
  if(!root || root.includes('..')) throw new Error('invalid wikiProjectId')

  await ensureDir(root)
  await ensureDir(path.join(root, 'raw', 'articles'))
  await ensureDir(path.join(root, 'raw', 'papers'))
  await ensureDir(path.join(root, 'raw', 'transcripts'))
  await ensureDir(path.join(root, 'raw', 'assets'))
  await ensureDir(path.join(root, 'entities'))
  await ensureDir(path.join(root, 'concepts'))
  await ensureDir(path.join(root, 'comparisons'))
  await ensureDir(path.join(root, 'queries'))

  const schemaPath = path.join(root, 'SCHEMA.md')
  const indexPath = path.join(root, 'index.md')
  const logPath = path.join(root, 'log.md')

  // idempotent: only create if missing
  await fs.promises.writeFile(schemaPath, defaultSchemaMarkdown(domain), { encoding: 'utf8', flag: 'wx' }).catch(()=>{})
  await fs.promises.writeFile(indexPath, defaultIndexMarkdown(), { encoding: 'utf8', flag: 'wx' }).catch(()=>{})
  await fs.promises.writeFile(logPath, defaultLogMarkdown(domain), { encoding: 'utf8', flag: 'wx' }).catch(()=>{})

  return { root }
}

async function writeWorkspaceFile({ wikiProjectId, relPath, content }){
  const p = safeWorkspacePath(wikiProjectId, relPath)
  if(!p) throw new Error('invalid path')
  await ensureDir(path.dirname(p.full))
  await fs.promises.writeFile(p.full, String(content || ''), { encoding: 'utf8' })
  return { path: p.clean }
}

function getEnabled(){
  const raw = process.env.WIKI_WORKER_ENABLED
  if(raw == null) return true
  const v = String(raw).trim().toLowerCase()
  return !(v === '0' || v === 'false' || v === 'no' || v === 'off')
}

function getLockMs(){
  const raw = process.env.WIKI_WORKER_LOCK_MS || '120000'
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 120000
}

function getPollMs(){
  const raw = process.env.WIKI_WORKER_POLL_MS || '1500'
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 1500
}

function getMaxConcurrentBuilds(){
  const raw = process.env.WIKI_WORKER_MAX_CONCURRENT_BUILDS || '1'
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : 1
}

function getMaxConcurrentSteps(){
  const raw = process.env.WIKI_WORKER_MAX_CONCURRENT_STEPS || '2'
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : 2
}

function getStepMaxAttempts(){
  const raw = process.env.WIKI_STEP_MAX_ATTEMPTS || '2'
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 1 ? n : 2
}

async function claimNextBuild(prisma, workerId, lockMs){
  const now = new Date()
  const cap = getMaxConcurrentBuilds()
  if(cap > 0){
    const active = await prisma.wikiBuild.count({
      // Only count builds that are actively locked (in-flight). Unlocked "running"
      // builds represent "in between steps" and should not consume capacity.
      where: { status: { in: ['claimed','running'] }, lockExpiresAt: { gt: now } }
    }).catch(()=>0)
    if(active >= cap) return null
  }

  const lockExpiresAt = new Date(Date.now() + lockMs)
  // A build can be "running" between step executions (we release locks per tick);
  // allow reclaiming it when it's not currently locked so work continues.
  const where = { status: { in: ['queued','running'] }, OR: [{ lockExpiresAt: null }, { lockExpiresAt: { lt: now } }] }
  const candidate = await prisma.wikiBuild.findFirst({ where, orderBy: { createdAt: 'asc' } }).catch(()=>null)
  if(!candidate) return null

  const updated = await prisma.wikiBuild.updateMany({
    where: Object.assign({ id: candidate.id }, where),
    data: { status: 'claimed', lockedBy: workerId, lockExpiresAt, updatedAt: new Date(), attempts: { increment: 1 } }
  }).catch(()=>({ count: 0 }))
  if(!updated || updated.count !== 1) return null
  return candidate.id
}

async function claimNextStep(prisma, buildId, workerId, lockMs){
  const now = new Date()
  const cap = getMaxConcurrentSteps()
  if(cap > 0){
    const active = await prisma.wikiBuildStep.count({
      where: { status: { in: ['claimed','running'] }, lockExpiresAt: { gt: now } }
    }).catch(()=>0)
    if(active >= cap) return null
  }

  const lockExpiresAt = new Date(Date.now() + lockMs)
  const where = { buildId, status: 'queued', OR: [{ lockExpiresAt: null }, { lockExpiresAt: { lt: now } }] }
  const candidate = await prisma.wikiBuildStep.findFirst({ where, orderBy: { index: 'asc' } }).catch(()=>null)
  if(!candidate) return null

  const updated = await prisma.wikiBuildStep.updateMany({
    where: Object.assign({ id: candidate.id }, where),
    data: { status: 'claimed', lockedBy: workerId, lockExpiresAt, updatedAt: new Date() }
  }).catch(()=>({ count: 0 }))
  if(!updated || updated.count !== 1) return null
  return candidate.id
}

async function startClaimedStep(prisma, stepId, workerId, lockMs){
  const lockExpiresAt = new Date(Date.now() + lockMs)
  const updated = await prisma.wikiBuildStep.updateMany({
    where: { id: stepId, status: 'claimed', lockedBy: workerId },
    data: { status: 'running', startedAt: new Date(), updatedAt: new Date(), lockExpiresAt, attempts: { increment: 1 } }
  }).catch(()=>({ count: 0 }))
  return updated && updated.count === 1
}

async function releaseBuildLock(prisma, buildId, workerId){
  await prisma.wikiBuild.updateMany({
    where: { id: buildId, lockedBy: workerId },
    data: { lockedBy: null, lockExpiresAt: null, updatedAt: new Date() }
  }).catch(()=>{})
}

async function selectNextStep(prisma, buildId){
  const steps = await prisma.wikiBuildStep.findMany({
    where: { buildId },
    orderBy: { index: 'asc' },
    take: 500
  }).catch(()=>[])

  for(const s of steps){
    if(['succeeded','canceled'].includes(s.status)) continue
    return s
  }
  return null
}

async function reapExpiredLocks(prisma){
  const now = new Date()
  await prisma.wikiBuildStep.updateMany({
    where: { status: { in: ['claimed','running'] }, lockExpiresAt: { lt: now } },
    data: { status: 'queued', lockedBy: null, lockExpiresAt: null, updatedAt: new Date() }
  }).catch(()=>{})
  await prisma.wikiBuild.updateMany({
    where: { status: { in: ['claimed','running'] }, lockExpiresAt: { lt: now } },
    data: { status: 'queued', lockedBy: null, lockExpiresAt: null, updatedAt: new Date() }
  }).catch(()=>{})
}

async function executeStep({ prisma, hermes, build, step, workerId }){
  const start = Date.now()
  const wikiProjectId = build.wikiProjectId
  await appendWikiEvent(prisma, wikiProjectId, build.id, step.id, 'info', `step:${step.kind}:start`, { index: step.index, kind: step.kind })

  try{
    if(step.kind === 'init'){
      const project = await prisma.wikiProject.findUnique({ where: { id: wikiProjectId } }).catch(()=>null)
      const domain = project?.domain || null
      const r = await initWikiWorkspace({ wikiProjectId, domain })
      await prisma.wikiBuildStep.update({
        where: { id: step.id },
        data: { status: 'succeeded', output: { root: r.root }, endedAt: new Date(), durationMs: Date.now() - start, updatedAt: new Date() }
      })
      await appendWikiEvent(prisma, wikiProjectId, build.id, step.id, 'info', 'workspace:initialized', { root: r.root })
      return { ok: true }
    }

    if(step.kind === 'write_file'){
      const relPath = step?.input?.path
      let content = step?.input?.content

      const fromStepIndex = Number.isFinite(Number(step?.input?.fromStepIndex)) ? Number(step.input.fromStepIndex) : null
      if(fromStepIndex != null){
        const prev = await prisma.wikiBuildStep.findFirst({
          where: { buildId: build.id, index: fromStepIndex },
          select: { output: true }
        }).catch(()=>null)
        if(prev && prev.output && typeof prev.output === 'object' && typeof prev.output.text === 'string'){
          content = prev.output.text
        }
      }

      const r = await writeWorkspaceFile({ wikiProjectId, relPath, content })
      await prisma.wikiBuildStep.update({
        where: { id: step.id },
        data: { status: 'succeeded', output: { path: r.path }, endedAt: new Date(), durationMs: Date.now() - start, updatedAt: new Date() }
      })
      await appendWikiEvent(prisma, wikiProjectId, build.id, step.id, 'info', 'file:written', { path: r.path })
      return { ok: true }
    }

    if(step.kind === 'write_files'){
      const fromStepIndex = Number.isFinite(Number(step?.input?.fromStepIndex)) ? Number(step.input.fromStepIndex) : null
      if(fromStepIndex == null) throw new Error('write_files requires input.fromStepIndex')

      const prev = await prisma.wikiBuildStep.findFirst({
        where: { buildId: build.id, index: fromStepIndex },
        select: { output: true }
      }).catch(()=>null)

      const prevText = prev && prev.output && typeof prev.output === 'object' && typeof prev.output.text === 'string' ? prev.output.text : ''
      const parsed = safeJsonParse(prevText) || null

      let files = []
      if(Array.isArray(parsed)) files = parsed
      else if(parsed && typeof parsed === 'object' && Array.isArray(parsed.files)) files = parsed.files
      else throw new Error('write_files could not parse JSON files from previous step output.text')

      const written = []
      for(const f of files){
        if(!f || typeof f !== 'object') continue
        const p = typeof f.path === 'string' ? f.path.trim() : ''
        const c = typeof f.content === 'string' ? f.content : ''
        if(!p) continue
        await writeWorkspaceFile({ wikiProjectId, relPath: p, content: c })
        written.push(p)
      }

      await prisma.wikiBuildStep.update({
        where: { id: step.id },
        data: {
          status: 'succeeded',
          output: { written },
          endedAt: new Date(),
          durationMs: Date.now() - start,
          updatedAt: new Date()
        }
      })
      await appendWikiEvent(prisma, wikiProjectId, build.id, step.id, 'info', 'files:written', { count: written.length })
      return { ok: true }
    }

    if(step.kind === 'llm'){
      const input = step?.input?.prompt || step?.input?.input || step?.input?.message || ''
      const system = step?.input?.system || null
      const timeoutMs = step?.input?.timeoutMs || process.env.HERMES_JOB_TIMEOUT_MS
      const prev = build.hermesLastResponseId || null

      const resp = await hermes.createResponse(wikiProjectId, {
        input,
        system,
        previous_response_id: prev,
        metadata: { wikiProjectId, buildId: build.id, stepId: step.id, stepIndex: step.index }
      }, { timeoutMs })

      if(!resp.ok){
        throw new Error(typeof resp.result === 'string' ? resp.result : JSON.stringify(resp.result || resp.error || 'Hermes error'))
      }

      const result = resp.result
      const usage = parseUsage(result) || {}
      const promptTokens = usage.promptTokens ?? usage.inputTokens ?? null
      const completionTokens = usage.completionTokens ?? usage.outputTokens ?? null
      const totalTokens = usage.totalTokens ?? null
      const estimatedUsd = estimateUsdFromTokenSplit({ promptTokens, completionTokens, totalTokens })

      const hermesResponseId = typeof result?.id === 'string' ? result.id : null
      const text = extractResponseText(result)

      await prisma.wikiBuildStep.update({
        where: { id: step.id },
        data: {
          status: 'succeeded',
          output: { text, raw: result },
          hermesResponseId,
          provider: 'hermes',
          model: result?.model || null,
          promptTokens,
          completionTokens,
          totalTokens,
          estimatedUsd,
          endedAt: new Date(),
          durationMs: Date.now() - start,
          updatedAt: new Date()
        }
      })

      if(hermesResponseId){
        await prisma.wikiBuild.update({
          where: { id: build.id },
          data: { hermesLastResponseId: hermesResponseId, updatedAt: new Date() }
        }).catch(()=>{})
      }

      await appendWikiEvent(prisma, wikiProjectId, build.id, step.id, 'info', 'hermes:response', {
        hermesResponseId,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedUsd
      })

      return { ok: true }
    }

    if(step.kind === 'approval'){
      await prisma.wikiBuildStep.update({
        where: { id: step.id },
        data: { status: 'blocked', updatedAt: new Date() }
      })
      await prisma.wikiBuild.update({
        where: { id: build.id },
        data: { status: 'blocked', updatedAt: new Date() }
      }).catch(()=>{})
      await appendWikiEvent(prisma, wikiProjectId, build.id, step.id, 'warn', 'step:blocked', { reason: 'approval' })
      return { ok: true, blocked: true }
    }

    throw new Error(`unknown step kind: ${step.kind}`)
  }catch(err){
    const attempts = Number(step.attempts || 0)
    const maxAttempts = getStepMaxAttempts()
    const msg = String(err && err.message ? err.message : err)
    const willRetry = attempts < maxAttempts

    await prisma.wikiBuildStep.update({
      where: { id: step.id },
      data: {
        status: willRetry ? 'queued' : 'failed',
        error: msg,
        endedAt: new Date(),
        durationMs: Date.now() - start,
        lockedBy: null,
        lockExpiresAt: null,
        updatedAt: new Date()
      }
    }).catch(()=>{})

    await appendWikiEvent(prisma, wikiProjectId, build.id, step.id, 'error', 'step:error', { error: msg, willRetry })

    if(!willRetry){
      await prisma.wikiBuild.update({
        where: { id: build.id },
        data: { status: 'failed', updatedAt: new Date(), lockedBy: null, lockExpiresAt: null }
      }).catch(()=>{})
      await appendWikiEvent(prisma, wikiProjectId, build.id, step.id, 'error', 'build:failed', { error: msg })
    }
    return { ok: false, error: msg, willRetry }
  }
}

async function ensureBuildRunning(prisma, buildId, workerId){
  await prisma.wikiBuild.updateMany({
    where: { id: buildId, lockedBy: workerId, status: 'claimed' },
    data: { status: 'running', updatedAt: new Date() }
  }).catch(()=>{})
}

async function tickOnce({ prisma, hermes, workerId, lockMs }){
  await reapExpiredLocks(prisma)
  const buildId = await claimNextBuild(prisma, workerId, lockMs)
  if(!buildId) return

  await ensureBuildRunning(prisma, buildId, workerId)

  const build = await prisma.wikiBuild.findUnique({ where: { id: buildId } }).catch(()=>null)
  if(!build){
    await releaseBuildLock(prisma, buildId, workerId)
    return
  }

  const next = await selectNextStep(prisma, buildId)
  if(!next){
    await prisma.wikiBuild.updateMany({
      where: { id: buildId, lockedBy: workerId, status: { in: ['claimed','running'] } },
      data: { status: 'succeeded', lockedBy: null, lockExpiresAt: null, updatedAt: new Date() }
    }).catch(()=>{})
    await appendWikiEvent(prisma, build.wikiProjectId, build.id, null, 'info', 'build:succeeded', {})
    return
  }

  if(next.status === 'blocked'){
    await prisma.wikiBuild.updateMany({
      where: { id: buildId, lockedBy: workerId },
      data: { status: 'blocked', updatedAt: new Date(), lockedBy: null, lockExpiresAt: null }
    }).catch(()=>{})
    await appendWikiEvent(prisma, build.wikiProjectId, build.id, next.id, 'warn', 'build:blocked', { stepIndex: next.index })
    return
  }

  if(next.status === 'failed'){
    await prisma.wikiBuild.updateMany({
      where: { id: buildId, lockedBy: workerId },
      data: { status: 'failed', updatedAt: new Date(), lockedBy: null, lockExpiresAt: null }
    }).catch(()=>{})
    return
  }

  if(next.status !== 'queued'){
    // running/claimed/canceled/succeeded: release and let other ticks progress
    await releaseBuildLock(prisma, buildId, workerId)
    return
  }

  const stepId = await claimNextStep(prisma, buildId, workerId, lockMs)
  if(!stepId){
    await releaseBuildLock(prisma, buildId, workerId)
    return
  }
  const started = await startClaimedStep(prisma, stepId, workerId, lockMs)
  if(!started){
    await releaseBuildLock(prisma, buildId, workerId)
    return
  }

  const step = await prisma.wikiBuildStep.findUnique({ where: { id: stepId } }).catch(()=>null)
  if(!step){
    await releaseBuildLock(prisma, buildId, workerId)
    return
  }

  await executeStep({ prisma, hermes, build, step, workerId })
  await releaseBuildLock(prisma, buildId, workerId)
}

function startWikiWorker({ prisma, hermes }){
  if(!getEnabled()){
    console.log('[wiki-worker] disabled (WIKI_WORKER_ENABLED=0)')
    return
  }

  const workerId = `wiki-worker-${process.pid}-${Math.random().toString(16).slice(2)}`
  const lockMs = getLockMs()
  const pollMs = getPollMs()

  console.log('[wiki-worker] starting', { workerId, lockMs, pollMs })

  // Ensure locks don't remain stuck after restarts.
  reapExpiredLocks(prisma).catch(()=>{})

  setInterval(() => {
    tickOnce({ prisma, hermes, workerId, lockMs })
      .catch((e) => console.error('[wiki-worker] tick error', e))
  }, pollMs)

  // Occasional reaper pass for slow tick intervals.
  setInterval(() => {
    reapExpiredLocks(prisma).catch(()=>{})
  }, Math.max(10_000, pollMs * 5))
}

module.exports = { startWikiWorker }
