function makeId(prefix){
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
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

function extractResponseText(result){
  if(!result || typeof result !== 'object') return null

  // Responses API: output: [{ type:'message', content:[{type:'output_text', text:'...'}]}]
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

  // Fallback: some servers still return chat.completions shape under /v1/responses
  const message = result?.choices?.[0]?.message
  if(message && typeof message.content === 'string') return message.content.trim()

  return null
}

function buildPlanPrompt(goal){
  return [
    'You are Hermes, the orchestrator for a durable multi-step run.',
    'Create an execution plan for the following goal. Return ONLY valid JSON (no markdown).',
    '',
    'Goal:',
    goal,
    '',
    'Output JSON schema:',
    '{',
    '  "title": "short title",',
    '  "steps": [',
    '    { "kind": "llm", "summary": "short", "prompt": "what to do", "requires_approval": false },',
    '    { "kind": "artifact_write", "summary": "short", "artifact_type": "string", "body": "string", "requires_approval": false },',
    '    { "kind": "llm", "summary": "short", "prompt": "what to do", "requires_approval": true, "approval_prompt": "what to ask the human" }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- Keep steps small and sequential.',
    '- If a step could be risky/destructive/expensive, mark requires_approval=true.',
    '- Each "prompt" must be self-contained and actionable.',
    '- Use kind="artifact_write" to save final outputs (summaries, decisions) into durable artifacts.'
  ].join('\n')
}

function normalizePlannedSteps(plan){
  const rawSteps = plan && Array.isArray(plan.steps) ? plan.steps : []
  const out = []
  for(const s of rawSteps){
    if(!s || typeof s !== 'object') continue
    const kind = typeof s.kind === 'string' && s.kind.trim() ? s.kind.trim() : 'llm'
    const summary = typeof s.summary === 'string' ? s.summary.trim() : ''
    const prompt = typeof s.prompt === 'string' ? s.prompt : ''
    const requiresApproval = Boolean(s.requires_approval || s.requiresApproval)
    const approvalPrompt = typeof s.approval_prompt === 'string' ? s.approval_prompt : (typeof s.approvalPrompt === 'string' ? s.approvalPrompt : '')
    const artifactType =
      typeof s.artifact_type === 'string' ? s.artifact_type.trim() :
      (typeof s.artifactType === 'string' ? s.artifactType.trim() : '')
    const body =
      typeof s.body === 'string' ? s.body :
      (typeof s.text === 'string' ? s.text : '')

    if(kind === 'approval'){
      out.push({ kind: 'approval', summary, prompt: approvalPrompt || prompt || summary || 'Approve this step', requiresApproval: false })
      continue
    }
    if(kind === 'artifact_write'){
      out.push({ kind: 'artifact_write', summary, artifactType, body, requiresApproval, approvalPrompt })
      continue
    }
    out.push({ kind, summary, prompt, requiresApproval, approvalPrompt })
  }
  return out
}

async function appendRunEvent(prisma, runId, stepId, level, message, payload){
  try{
    await prisma.runEvent.create({
      data: {
        id: makeId('revt'),
        runId,
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

async function upsertContextArtifactForStep(prisma, run, step, body, artifactTypeOverride){
  const text = String(body || '').trim()
  if(!text) return null

  const type = artifactTypeOverride && String(artifactTypeOverride).trim()
    ? String(artifactTypeOverride).trim()
    : `run_step_output:${run.id}:${step.index}`

  try{
    const artifact = await prisma.contextArtifact.upsert({
      where: { type_scopeType_scopeId: { type, scopeType: 'project', scopeId: run.projectId } },
      update: { body: text, metadata: { runId: run.id, stepId: step.id, stepIndex: step.index, kind: step.kind }, updatedAt: new Date() },
      create: {
        id: makeId('ctx'),
        type,
        scopeType: 'project',
        scopeId: run.projectId,
        body: text,
        metadata: { runId: run.id, stepId: step.id, stepIndex: step.index, kind: step.kind }
      }
    })
    return artifact
  }catch(_e){
    return null
  }
}

async function createGuidanceEventsForStep(prisma, run, step, assistantText){
  const text = typeof assistantText === 'string' ? assistantText.trim() : ''
  if(!text) return

  const basePayload = { text, runId: run.id, stepId: step.id, stepIndex: step.index, kind: step.kind }

  // Always create a project-scoped run event for future views.
  await prisma.guidanceEvent.create({
    data: {
      id: makeId('evt'),
      projectId: run.projectId,
      sessionId: null,
      eventType: 'run_step_output',
      payload: basePayload
    }
  }).catch(()=>{})

  // If the run is attached to a session, also emit an assistant message so it shows in the chat timeline.
  if(run.sessionId){
    await prisma.guidanceEvent.create({
      data: {
        id: makeId('evt'),
        projectId: run.projectId,
        sessionId: run.sessionId,
        eventType: 'assistant_message',
        payload: basePayload
      }
    }).catch(()=>{})
  }
}

async function claimNextRun(prisma, workerId, lockMs, maxConcurrentRuns){
  const now = new Date()
  const cap = Number.isFinite(Number(maxConcurrentRuns)) ? Number(maxConcurrentRuns) : 1

  // Capacity check is DB-backed so multiple worker processes don't overload Hermes.
  if(cap > 0){
    const active = await prisma.projectRun.count({
      where: { status: { in: ['claimed','running'] }, OR: [{ lockExpiresAt: null }, { lockExpiresAt: { gt: now } }] }
    }).catch(()=>0)
    if(active >= cap) return null
  }

  const lockExpiresAt = new Date(Date.now() + lockMs)
  const where = {
    status: { in: ['queued', 'blocked'] },
    OR: [{ lockExpiresAt: null }, { lockExpiresAt: { lt: now } }]
  }

  const candidate = await prisma.projectRun.findFirst({ where, orderBy: { createdAt: 'asc' } }).catch(()=>null)
  if(!candidate) return null

  const updated = await prisma.projectRun.updateMany({
    where: Object.assign({ id: candidate.id }, where),
    data: { status: 'claimed', lockedBy: workerId, lockExpiresAt, updatedAt: new Date(), attempts: { increment: 1 } }
  }).catch(()=>({ count: 0 }))
  if(!updated || updated.count !== 1) return null
  return candidate.id
}

async function claimNextStep(prisma, runId, workerId, lockMs, maxConcurrentSteps){
  const now = new Date()
  const cap = Number.isFinite(Number(maxConcurrentSteps)) ? Number(maxConcurrentSteps) : 1
  if(cap > 0){
    const active = await prisma.runStep.count({
      where: { status: { in: ['claimed','running'] }, OR: [{ lockExpiresAt: null }, { lockExpiresAt: { gt: now } }] }
    }).catch(()=>0)
    if(active >= cap) return null
  }

  const lockExpiresAt = new Date(Date.now() + lockMs)
  const where = {
    runId,
    status: 'queued',
    OR: [{ lockExpiresAt: null }, { lockExpiresAt: { lt: now } }]
  }
  const candidate = await prisma.runStep.findFirst({ where, orderBy: { index: 'asc' } }).catch(()=>null)
  if(!candidate) return null

  const updated = await prisma.runStep.updateMany({
    where: Object.assign({ id: candidate.id }, where),
    data: { status: 'claimed', lockedBy: workerId, lockExpiresAt, updatedAt: new Date() }
  }).catch(()=>({ count: 0 }))
  if(!updated || updated.count !== 1) return null
  return candidate.id
}

async function startClaimedStep(prisma, stepId, workerId, lockMs){
  const lockExpiresAt = new Date(Date.now() + lockMs)
  const updated = await prisma.runStep.updateMany({
    where: { id: stepId, status: 'claimed', lockedBy: workerId },
    data: { status: 'running', startedAt: new Date(), updatedAt: new Date(), lockExpiresAt, attempts: { increment: 1 } }
  }).catch(()=>({ count: 0 }))
  return updated && updated.count === 1
}

async function releaseRunLock(prisma, runId, workerId){
  await prisma.projectRun.updateMany({
    where: { id: runId, lockedBy: workerId },
    data: { lockedBy: null, lockExpiresAt: null, updatedAt: new Date() }
  }).catch(()=>{})
}

async function selectNextStep(prisma, runId){
  const steps = await prisma.runStep.findMany({
    where: { runId },
    orderBy: { index: 'asc' },
    take: 200
  }).catch(()=>[])

  // Find first step that isn't finished (sequential dependency model).
  for(const s of steps){
    if(s.status === 'succeeded' || s.status === 'canceled') continue
    return s
  }
  return null
}

async function markRunTerminalIfDone(prisma, runId){
  const steps = await prisma.runStep.findMany({ where: { runId }, select: { status: true } }).catch(()=>[])
  if(!steps.length) return
  if(steps.some(s => s.status === 'failed')) {
    await prisma.projectRun.update({ where: { id: runId }, data: { status: 'failed', updatedAt: new Date(), lockExpiresAt: null, lockedBy: null } }).catch(()=>{})
    return
  }
  if(steps.some(s => s.status === 'blocked')) {
    await prisma.projectRun.update({ where: { id: runId }, data: { status: 'blocked', updatedAt: new Date(), lockExpiresAt: null, lockedBy: null } }).catch(()=>{})
    return
  }
  if(steps.every(s => s.status === 'succeeded' || s.status === 'canceled')) {
    await prisma.projectRun.update({ where: { id: runId }, data: { status: 'succeeded', updatedAt: new Date(), lockExpiresAt: null, lockedBy: null } }).catch(()=>{})
  }
}

function parseUsageFromHermesResult(result){
  const u = result && typeof result === 'object' ? result.usage : null
  if(!u || typeof u !== 'object') return null
  const promptTokens = Number.isFinite(Number(u.prompt_tokens)) ? Number(u.prompt_tokens) : null
  const completionTokens = Number.isFinite(Number(u.completion_tokens)) ? Number(u.completion_tokens) : null
  const inputTokens = Number.isFinite(Number(u.input_tokens)) ? Number(u.input_tokens) : null
  const outputTokens = Number.isFinite(Number(u.output_tokens)) ? Number(u.output_tokens) : null
  const totalTokensRaw = Number.isFinite(Number(u.total_tokens)) ? Number(u.total_tokens) : null
  const totalTokens =
    totalTokensRaw != null ? totalTokensRaw :
    (promptTokens != null && completionTokens != null ? (promptTokens + completionTokens) :
      (inputTokens != null && outputTokens != null ? (inputTokens + outputTokens) : null))

  const finalPrompt = promptTokens != null ? promptTokens : inputTokens
  const finalCompletion = completionTokens != null ? completionTokens : outputTokens
  return { promptTokens: finalPrompt, completionTokens: finalCompletion, totalTokens }
}

function getCostPer1kTokensUsd(){
  const raw = process.env.COST_PER_1K_TOKENS_USD || '0'
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

async function executeLlmStep({ prisma, hermes, buildSystemContextForProject, run, step, timeoutMs, maxAttempts }){
  const system = await buildSystemContextForProject(run.projectId)

  const inputObj = step.input && typeof step.input === 'object' ? step.input : {}
  const inputType = typeof inputObj.type === 'string' ? inputObj.type : null

  let prompt = ''
  if(inputType === 'plan'){
    prompt = buildPlanPrompt(String(inputObj.goal || run.goal || '').trim())
  }else{
    prompt = typeof inputObj.prompt === 'string' ? inputObj.prompt : ''
    if(!prompt && typeof inputObj.text === 'string') prompt = inputObj.text
    if(!prompt && typeof inputObj.goal === 'string') prompt = inputObj.goal
    prompt = String(prompt || '').trim()
  }

  if(!prompt){
    await prisma.runStep.update({
      where: { id: step.id },
      data: { status: 'failed', error: 'missing_step_prompt', endedAt: new Date(), updatedAt: new Date(), lockedBy: null, lockExpiresAt: null }
    }).catch(()=>{})
    await appendRunEvent(prisma, run.id, step.id, 'error', 'Step failed: missing prompt', {})
    return
  }

  const startedAt = Date.now()
  const prev = run.hermesLastResponseId || null
  await appendRunEvent(prisma, run.id, step.id, 'info', 'Calling Hermes /v1/responses', { previous_response_id: prev })

  const r = await hermes.createResponse(
    run.projectId,
    {
      input: prompt,
      system,
      previous_response_id: prev,
      metadata: { runId: run.id, stepId: step.id, stepIndex: step.index }
    },
    { timeoutMs }
  )

  if(!(r && r.ok && r.result)){
    const err = r && (r.error || r.result) ? (r.error || r.result) : 'hermes_failed'
    const attempts = Number.isFinite(Number(step.attempts)) ? Number(step.attempts) : 0
    const cap = Number.isFinite(Number(maxAttempts)) ? Number(maxAttempts) : 1
    const canRetry = attempts < cap
    await prisma.runStep.update({
      where: { id: step.id },
      data: {
        status: canRetry ? 'queued' : 'failed',
        error: String(err),
        output: r && typeof r === 'object' ? r : null,
        durationMs: Date.now() - startedAt,
        endedAt: new Date(),
        updatedAt: new Date(),
        lockedBy: null,
        lockExpiresAt: null,
        startedAt: canRetry ? null : step.startedAt
      }
    }).catch(()=>{})
    await appendRunEvent(prisma, run.id, step.id, canRetry ? 'warn' : 'error', canRetry ? 'Hermes call failed; requeued' : 'Hermes call failed', { error: String(err).slice(0, 400), attempts, maxAttempts: cap })
    return
  }

  const hermesResponseId = r.result.id ? String(r.result.id) : null
  const assistantText = extractResponseText(r.result)
  const usage = parseUsageFromHermesResult(r.result)
  const costPer1k = getCostPer1kTokensUsd()
  const estimatedUsd = usage && usage.totalTokens != null ? (usage.totalTokens / 1000) * costPer1k : null
  const model = r.result && r.result.model ? String(r.result.model) : null

  const artifactTypeOverride =
    (step.input && typeof step.input === 'object' && typeof step.input.artifactType === 'string' && step.input.artifactType.trim())
      ? step.input.artifactType.trim()
      : ((step.input && typeof step.input === 'object' && typeof step.input.artifact_type === 'string' && step.input.artifact_type.trim())
        ? step.input.artifact_type.trim()
        : null)

  await prisma.$transaction(async (tx) => {
    await tx.runStep.update({
      where: { id: step.id },
      data: {
        status: 'succeeded',
        output: { hermes: r.result, assistantText },
        hermesResponseId,
        provider: 'hermes',
        model,
        promptTokens: usage ? usage.promptTokens : null,
        completionTokens: usage ? usage.completionTokens : null,
        totalTokens: usage ? usage.totalTokens : null,
        estimatedUsd,
        durationMs: Date.now() - startedAt,
        endedAt: new Date(),
        updatedAt: new Date(),
        lockedBy: null,
        lockExpiresAt: null
      }
    })
    if(hermesResponseId){
      await tx.projectRun.update({ where: { id: run.id }, data: { hermesLastResponseId: hermesResponseId, updatedAt: new Date() } })
    }
  }).catch(()=>{})

  await appendRunEvent(prisma, run.id, step.id, 'info', 'Hermes call succeeded', { hermesResponseId })

  if(assistantText){
    await upsertContextArtifactForStep(prisma, run, step, assistantText, artifactTypeOverride)
    await createGuidanceEventsForStep(prisma, run, step, assistantText)
  }

  // If this was the planning step, expand plan into durable steps.
  if(step.index === 0 && inputType === 'plan'){
    const plan = safeJsonParse(assistantText || '')
    const normalized = normalizePlannedSteps(plan || {})
    if(!normalized.length){
      await appendRunEvent(prisma, run.id, step.id, 'warn', 'Planning produced no steps; adding a fallback step', {})
      await prisma.runStep.create({
        data: {
          id: makeId('step'),
          runId: run.id,
          index: 1,
          kind: 'llm',
          status: 'queued',
          input: { prompt: 'Continue executing the run. Decide next concrete action and perform it.', planText: assistantText || '' }
        }
      }).catch(()=>{})
      return
    }

    const toCreate = []
    let idx = 1
    for(const s of normalized){
      if(s.requiresApproval){
        toCreate.push({
          id: makeId('step'),
          runId: run.id,
          index: idx++,
          kind: 'approval',
          status: 'queued',
          summary: s.summary || null,
          input: { prompt: s.approvalPrompt || `Approve: ${s.summary || s.prompt || 'step'}`, summary: s.summary || null }
        })
      }
      if(s.kind === 'artifact_write'){
        toCreate.push({
          id: makeId('step'),
          runId: run.id,
          index: idx++,
          kind: 'artifact_write',
          status: 'queued',
          summary: s.summary || null,
          input: { artifactType: s.artifactType || '', body: s.body || '', summary: s.summary || null }
        })
      }else{
        toCreate.push({
          id: makeId('step'),
          runId: run.id,
          index: idx++,
          kind: s.kind || 'llm',
          status: 'queued',
          summary: s.summary || null,
          input: { prompt: s.prompt || '', summary: s.summary || null }
        })
      }
    }

    // Only create if there aren't already post-plan steps (idempotency).
    const existing = await prisma.runStep.count({ where: { runId: run.id, index: { gt: 0 } } }).catch(()=>0)
    if(existing > 0){
      await appendRunEvent(prisma, run.id, step.id, 'info', 'Plan steps already exist; skipping expansion', { existing })
      return
    }

    await prisma.runStep.createMany({ data: toCreate }).catch((e) => {
      appendRunEvent(prisma, run.id, step.id, 'error', 'Failed creating planned steps', { error: String(e).slice(0, 300) })
    })
    await appendRunEvent(prisma, run.id, step.id, 'info', 'Created planned steps', { count: toCreate.length })
  }
}

async function executeArtifactWriteStep({ prisma, run, step }){
  const inputObj = step.input && typeof step.input === 'object' ? step.input : {}
  const artifactType = typeof inputObj.artifactType === 'string' ? inputObj.artifactType.trim()
    : (typeof inputObj.artifact_type === 'string' ? inputObj.artifact_type.trim() : '')
  const body = typeof inputObj.body === 'string' ? inputObj.body
    : (typeof inputObj.text === 'string' ? inputObj.text : '')

  const text = String(body || '').trim()
  if(!text){
    await prisma.runStep.update({ where: { id: step.id }, data: { status: 'failed', error: 'missing_artifact_body', endedAt: new Date(), updatedAt: new Date(), lockedBy: null, lockExpiresAt: null } }).catch(()=>{})
    await appendRunEvent(prisma, run.id, step.id, 'error', 'artifact_write failed: missing body', {})
    return
  }

  const artifact = await upsertContextArtifactForStep(prisma, run, step, text, artifactType || null)
  await createGuidanceEventsForStep(prisma, run, step, text)

  await prisma.runStep.update({
    where: { id: step.id },
    data: { status: 'succeeded', output: { artifact }, endedAt: new Date(), updatedAt: new Date(), lockedBy: null, lockExpiresAt: null }
  }).catch(()=>{})

  await appendRunEvent(prisma, run.id, step.id, 'info', 'artifact_write succeeded', { type: artifact?.type || artifactType || null })
}

async function executeApprovalStep({ prisma, run, step }){
  const prompt = (step.input && typeof step.input === 'object' && typeof step.input.prompt === 'string')
    ? step.input.prompt
    : 'Approval required'

  const existing = await prisma.approvalRequest.findFirst({ where: { stepId: step.id, runId: run.id, status: 'pending' } }).catch(()=>null)
  if(!existing){
    await prisma.approvalRequest.create({
      data: {
        id: makeId('apr'),
        runId: run.id,
        stepId: step.id,
        status: 'pending',
        prompt: String(prompt || '').trim() || 'Approval required',
        context: { runId: run.id, stepId: step.id, stepIndex: step.index }
      }
    }).catch(()=>{})
    await appendRunEvent(prisma, run.id, step.id, 'info', 'Approval requested', {})
  }

  await prisma.$transaction(async (tx) => {
    await tx.runStep.update({ where: { id: step.id }, data: { status: 'blocked', updatedAt: new Date(), lockedBy: null, lockExpiresAt: null } })
    await tx.projectRun.update({ where: { id: run.id }, data: { status: 'blocked', updatedAt: new Date(), lockedBy: null, lockExpiresAt: null } })
  }).catch(()=>{})
}

async function workOnce({ prisma, hermes, buildSystemContextForProject, workerId }){
  const lockMs = Number.parseInt(process.env.RUN_WORKER_LOCK_MS || '600000', 10) || 600000
  const timeoutMs = Number.parseInt(process.env.RUN_STEP_TIMEOUT_MS || process.env.HERMES_JOB_TIMEOUT_MS || '600000', 10) || 600000
  const maxConcurrentRuns = Number.parseInt(process.env.RUN_WORKER_MAX_CONCURRENT_RUNS || '2', 10) || 2
  const maxConcurrentSteps = Number.parseInt(process.env.RUN_WORKER_MAX_CONCURRENT_STEPS || '4', 10) || 4
  const maxStepAttempts = Number.parseInt(process.env.RUN_STEP_MAX_ATTEMPTS || '2', 10) || 2

  const now = new Date()

  // Reap expired run locks (best-effort).
  try{
    const expiredRuns = await prisma.projectRun.findMany({
      where: { status: { in: ['claimed','running'] }, lockExpiresAt: { lt: now } },
      select: { id: true }
    }).catch(()=>[])
    for(const r of expiredRuns){
      await prisma.projectRun.updateMany({
        where: { id: r.id, lockExpiresAt: { lt: now } },
        data: { status: 'queued', lockedBy: null, lockExpiresAt: null, updatedAt: new Date() }
      }).catch(()=>{})
      await appendRunEvent(prisma, r.id, null, 'warn', 'Reaped expired run lock', {})
    }
  }catch(_e){}

  // Reap expired step locks (best-effort).
  try{
    const expiredSteps = await prisma.runStep.findMany({
      where: { status: { in: ['claimed','running'] }, lockExpiresAt: { lt: now } },
      select: { id: true, runId: true, index: true, kind: true, attempts: true }
    }).catch(()=>[])
    for(const s of expiredSteps){
      const attempts = Number.isFinite(Number(s.attempts)) ? Number(s.attempts) : 0
      const canRetry = attempts < maxStepAttempts
      await prisma.runStep.updateMany({
        where: { id: s.id, lockExpiresAt: { lt: now } },
        data: canRetry
          ? { status: 'queued', error: 'step_lock_expired', lockedBy: null, lockExpiresAt: null, startedAt: null, updatedAt: new Date() }
          : { status: 'failed', error: 'step_lock_expired', lockedBy: null, lockExpiresAt: null, endedAt: new Date(), updatedAt: new Date() }
      }).catch(()=>{})
      await appendRunEvent(prisma, s.runId, s.id, canRetry ? 'warn' : 'error', 'Reaped expired step lock', { stepIndex: s.index, kind: s.kind, attempts })
    }
  }catch(_e){}

  // Reap timed-out running steps (best-effort).
  try{
    const cutoff = new Date(Date.now() - timeoutMs)
    const stuck = await prisma.runStep.findMany({
      where: { status: 'running', startedAt: { lt: cutoff } },
      select: { id: true, runId: true, index: true, kind: true, attempts: true }
    }).catch(()=>[])
    for(const s of stuck){
      const attempts = Number.isFinite(Number(s.attempts)) ? Number(s.attempts) : 0
      const canRetry = attempts < maxStepAttempts
      await prisma.runStep.updateMany({
        where: { id: s.id, status: 'running' },
        data: canRetry
          ? { status: 'queued', error: 'step_timeout', endedAt: new Date(), startedAt: null, lockedBy: null, lockExpiresAt: null, updatedAt: new Date() }
          : { status: 'failed', error: 'step_timeout', endedAt: new Date(), lockedBy: null, lockExpiresAt: null, updatedAt: new Date() }
      }).catch(()=>{})
      await appendRunEvent(prisma, s.runId, s.id, canRetry ? 'warn' : 'error', 'Step timed out', { stepIndex: s.index, kind: s.kind, attempts })
    }
  }catch(_e){}

  const runId = await claimNextRun(prisma, workerId, lockMs, maxConcurrentRuns)
  if(!runId) return false

  const run = await prisma.projectRun.findUnique({ where: { id: runId } }).catch(()=>null)
  if(!run) return false

  // Transition claimed -> running
  await prisma.projectRun.updateMany({
    where: { id: run.id, status: 'claimed', lockedBy: workerId },
    data: { status: 'running', updatedAt: new Date() }
  }).catch(()=>{})

  const step = await selectNextStep(prisma, run.id)
  if(!step){
    await markRunTerminalIfDone(prisma, run.id)
    await releaseRunLock(prisma, run.id, workerId)
    return true
  }

  // Approval handling (blocked step can become succeeded/failed based on decision).
  if(step.status === 'blocked' && step.kind === 'approval'){
    const pending = await prisma.approvalRequest.findFirst({ where: { stepId: step.id, runId: run.id, status: 'pending' } }).catch(()=>null)
    if(pending){
      await prisma.projectRun.update({ where: { id: run.id }, data: { status: 'blocked', updatedAt: new Date(), lockedBy: null, lockExpiresAt: null } }).catch(()=>{})
      await releaseRunLock(prisma, run.id, workerId)
      return true
    }

    const decided = await prisma.approvalRequest.findFirst({
      where: { stepId: step.id, runId: run.id, status: { in: ['approved', 'rejected'] } },
      orderBy: { updatedAt: 'desc' }
    }).catch(()=>null)

    if(decided && decided.status === 'approved'){
      await prisma.runStep.update({ where: { id: step.id }, data: { status: 'succeeded', endedAt: new Date(), updatedAt: new Date(), lockedBy: null, lockExpiresAt: null } }).catch(()=>{})
      await prisma.projectRun.update({ where: { id: run.id }, data: { status: 'running', updatedAt: new Date() } }).catch(()=>{})
      await appendRunEvent(prisma, run.id, step.id, 'info', 'Approval granted; continuing', {})
      await markRunTerminalIfDone(prisma, run.id)
      await releaseRunLock(prisma, run.id, workerId)
      return true
    }

    if(decided && decided.status === 'rejected'){
      await prisma.runStep.update({ where: { id: step.id }, data: { status: 'failed', error: 'approval_rejected', endedAt: new Date(), updatedAt: new Date(), lockedBy: null, lockExpiresAt: null } }).catch(()=>{})
      await prisma.projectRun.update({ where: { id: run.id }, data: { status: 'failed', updatedAt: new Date(), lockedBy: null, lockExpiresAt: null } }).catch(()=>{})
      await appendRunEvent(prisma, run.id, step.id, 'error', 'Approval rejected; failing run', {})
      await releaseRunLock(prisma, run.id, workerId)
      return true
    }

    await releaseRunLock(prisma, run.id, workerId)
    return true
  }

  // Sequential model: only execute queued steps.
  // If another worker already claimed/started the next step, back off.
  if(step.status === 'claimed' || step.status === 'running'){
    await releaseRunLock(prisma, run.id, workerId)
    return true
  }
  if(step.status !== 'queued'){
    await markRunTerminalIfDone(prisma, run.id)
    await releaseRunLock(prisma, run.id, workerId)
    return true
  }

  const stepId = await claimNextStep(prisma, run.id, workerId, lockMs, maxConcurrentSteps)
  if(!stepId){
    await releaseRunLock(prisma, run.id, workerId)
    return true
  }
  await appendRunEvent(prisma, run.id, stepId, 'info', 'Step claimed', { workerId })

  const started = await startClaimedStep(prisma, stepId, workerId, lockMs)
  if(!started){
    await releaseRunLock(prisma, run.id, workerId)
    return true
  }
  await appendRunEvent(prisma, run.id, stepId, 'info', 'Step started', { workerId })

  const liveStep = await prisma.runStep.findUnique({ where: { id: stepId } }).catch(()=>null)
  if(!liveStep){
    await releaseRunLock(prisma, run.id, workerId)
    return true
  }

  if(liveStep.kind === 'approval'){
    await executeApprovalStep({ prisma, run, step: liveStep })
    await releaseRunLock(prisma, run.id, workerId)
    return true
  }

  if(liveStep.kind === 'llm'){
    await executeLlmStep({ prisma, hermes, buildSystemContextForProject, run, step: liveStep, timeoutMs, maxAttempts: maxStepAttempts })
    await markRunTerminalIfDone(prisma, run.id)
    await releaseRunLock(prisma, run.id, workerId)
    return true
  }

  if(liveStep.kind === 'artifact_write'){
    await executeArtifactWriteStep({ prisma, run, step: liveStep })
    await markRunTerminalIfDone(prisma, run.id)
    await releaseRunLock(prisma, run.id, workerId)
    return true
  }

  await prisma.runStep.update({
    where: { id: liveStep.id },
    data: { status: 'failed', error: `unsupported_step_kind:${liveStep.kind}`, endedAt: new Date(), updatedAt: new Date(), lockedBy: null, lockExpiresAt: null }
  }).catch(()=>{})
  await appendRunEvent(prisma, run.id, liveStep.id, 'error', 'Unsupported step kind', { kind: liveStep.kind })
  await markRunTerminalIfDone(prisma, run.id)
  await releaseRunLock(prisma, run.id, workerId)
  return true
}

function startRunWorker({ prisma, hermes, buildSystemContextForProject }){
  const enabled = String(process.env.RUN_WORKER_ENABLED || '1') !== '0'
  if(!enabled){
    console.log('[run-worker] disabled (RUN_WORKER_ENABLED=0)')
    return { stop: () => {} }
  }

  const workerId = process.env.RUN_WORKER_ID || `run-worker-${process.pid}`
  const tickMs = Number.parseInt(process.env.RUN_WORKER_TICK_MS || '2000', 10) || 2000
  console.log(`[run-worker] starting id=${workerId} tick_ms=${tickMs}`)

  let running = false
  const timer = setInterval(async () => {
    if(running) return
    running = true
    try{
      await tickSchedules({ prisma, workerId })
      const didWork = await workOnce({ prisma, hermes, buildSystemContextForProject, workerId })
      // If there is more work, the next tick will pick it up (keeps loop simple).
      if(!didWork) {
        // idle
      }
    }catch(e){
      console.error('[run-worker] tick error', e)
    } finally {
      running = false
    }
  }, tickMs)
  timer.unref && timer.unref()

  return { stop: () => clearInterval(timer) }
}

function safeTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return null
  const v = tz.trim()
  if (!v) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v }).format(new Date())
    return v
  } catch {
    return null
  }
}

function getZonedParts(date, timeZone) {
  const tz = safeTimeZone(timeZone) || 'UTC'
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
  const parts = fmt.formatToParts(date)
  const out = {}
  for (const p of parts) {
    if (p.type === 'year') out.year = Number.parseInt(p.value, 10)
    if (p.type === 'month') out.month = Number.parseInt(p.value, 10)
    if (p.type === 'day') out.day = Number.parseInt(p.value, 10)
    if (p.type === 'hour') out.hour = Number.parseInt(p.value, 10)
    if (p.type === 'minute') out.minute = Number.parseInt(p.value, 10)
    if (p.type === 'second') out.second = Number.parseInt(p.value, 10)
  }
  return out
}

function zonedTimeToUtc({ year, month, day, hour, minute, second }, timeZone) {
  const tz = safeTimeZone(timeZone) || 'UTC'
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, second || 0, 0)
  let guess = desiredUtc
  for (let i = 0; i < 4; i++) {
    const actualParts = getZonedParts(new Date(guess), tz)
    const actualUtc = Date.UTC(
      actualParts.year,
      (actualParts.month || 1) - 1,
      actualParts.day || 1,
      actualParts.hour || 0,
      actualParts.minute || 0,
      actualParts.second || 0,
      0
    )
    const diff = desiredUtc - actualUtc
    if (diff === 0) break
    guess += diff
  }
  return new Date(guess)
}

function parseTimeOfDayToMinutes(value) {
  const s = typeof value === 'string' ? value.trim() : ''
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return null
  const hh = Number.parseInt(m[1], 10)
  const mm = Number.parseInt(m[2], 10)
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > 23) return null
  if (mm < 0 || mm > 59) return null
  return hh * 60 + mm
}

function uniqueSortedMinutes(list) {
  const out = []
  const seen = new Set()
  for (const v of list) {
    const n = Number(v)
    if (!Number.isFinite(n)) continue
    const mm = ((Math.round(n) % 1440) + 1440) % 1440
    const k = String(mm)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(mm)
  }
  out.sort((a, b) => a - b)
  return out
}

function minutesListFromConfig(config) {
  const cfg = config && typeof config === 'object' ? config : {}
  const mode = typeof cfg.mode === 'string' ? cfg.mode : 'interval'

  if (mode === 'daily_times') {
    const times = Array.isArray(cfg.times) ? cfg.times : []
    const mins = []
    for (const t of times) {
      const v = parseTimeOfDayToMinutes(String(t || ''))
      if (v != null) mins.push(v)
    }
    return uniqueSortedMinutes(mins)
  }

  if (mode === 'times_per_day') {
    const countRaw = cfg.count != null ? Number.parseInt(String(cfg.count), 10) : null
    const count = Number.isFinite(countRaw) ? Math.max(1, Math.min(24, countRaw)) : null
    const start = parseTimeOfDayToMinutes(String(cfg.startTime || ''))
    const end = parseTimeOfDayToMinutes(String(cfg.endTime || ''))
    if (!count || start == null) return []

    const windowMinutes = end != null ? ((end - start + 1440) % 1440) : 0
    const span = windowMinutes > 0 ? windowMinutes : 1440
    const step = span / count
    const mins = []
    for (let i = 0; i < count; i++) mins.push(start + i * step)
    return uniqueSortedMinutes(mins)
  }

  return []
}

function daysOfWeekFromConfig(config) {
  const cfg = config && typeof config === 'object' ? config : {}
  const raw = Array.isArray(cfg.daysOfWeek) ? cfg.daysOfWeek : []
  const out = []
  const seen = new Set()
  for (const v of raw) {
    const n = Number.parseInt(String(v), 10)
    if (!Number.isFinite(n) || n < 1 || n > 7) continue
    const k = String(n)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(n)
  }
  out.sort((a, b) => a - b)
  return out
}

function minutesListFromTimesArray(times) {
  const mins = []
  for (const t of times) {
    const v = parseTimeOfDayToMinutes(String(t || ''))
    if (v != null) mins.push(v)
  }
  return uniqueSortedMinutes(mins)
}

function computeNextRunAt({ now = new Date(), intervalSeconds, config, timezone }) {
  const cfg = config && typeof config === 'object' ? config : {}
  const mode = typeof cfg.mode === 'string' ? cfg.mode : 'interval'
  const tz = safeTimeZone(timezone) || 'UTC'

  if (mode === 'interval' || intervalSeconds) {
    const sec = Number.parseInt(String(intervalSeconds || 0), 10)
    if (!Number.isFinite(sec) || sec <= 0) return null
    return new Date(now.getTime() + sec * 1000)
  }

  const z = getZonedParts(now, tz)
  const isoDow = ((new Date(Date.UTC(z.year, z.month - 1, z.day)).getUTCDay() + 6) % 7) + 1

  if (mode === 'weekly_times') {
    const days = daysOfWeekFromConfig(cfg)
    const times = minutesListFromTimesArray(Array.isArray(cfg.times) ? cfg.times : [])
    if (!days.length || !times.length) return null

    for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
      const dayIso = ((isoDow - 1 + dayOffset) % 7) + 1
      if (!days.includes(dayIso)) continue

      const approx = new Date(now.getTime() + dayOffset * 36 * 60 * 60 * 1000)
      const zp = getZonedParts(approx, tz)
      const ymd = { year: zp.year, month: zp.month, day: zp.day }
      for (const mins of times) {
        const hour = Math.floor(mins / 60)
        const minute = mins % 60
        const candidate = zonedTimeToUtc({ ...ymd, hour, minute, second: 0 }, tz)
        if (candidate.getTime() > now.getTime() + 1000) return candidate
      }
    }
    return null
  }

  const minutesList = minutesListFromConfig(cfg)
  if (!minutesList.length) return null

  const ymd = { year: z.year, month: z.month, day: z.day }
  for (const mins of minutesList) {
    const hour = Math.floor(mins / 60)
    const minute = mins % 60
    const candidate = zonedTimeToUtc({ ...ymd, hour, minute, second: 0 }, tz)
    if (candidate.getTime() > now.getTime() + 1000) return candidate
  }

  const nextApprox = new Date(now.getTime() + 36 * 60 * 60 * 1000)
  const z2 = getZonedParts(nextApprox, tz)
  const ymd2 = { year: z2.year, month: z2.month, day: z2.day }
  const first = minutesList[0]
  const hour = Math.floor(first / 60)
  const minute = first % 60
  return zonedTimeToUtc({ ...ymd2, hour, minute, second: 0 }, tz)
}

async function claimDueSchedules(prisma, workerId, lockMs){
  const now = new Date()
  const lockExpiresAt = new Date(Date.now() + lockMs)
  const where = {
    enabled: true,
    nextRunAt: { lte: now },
    OR: [{ lockExpiresAt: null }, { lockExpiresAt: { lt: now } }]
  }

  const candidate = await prisma.schedule.findFirst({ where, orderBy: { nextRunAt: 'asc' } }).catch(()=>null)
  if(!candidate) return null

  const updated = await prisma.schedule.updateMany({
    where: Object.assign({ id: candidate.id }, where),
    data: { lockedBy: workerId, lockExpiresAt, updatedAt: new Date() }
  }).catch(()=>({ count: 0 }))
  if(!updated || updated.count !== 1) return null
  return candidate.id
}

async function createRunFromSchedule(prisma, schedule){
  const runTemplate = schedule.runTemplate && typeof schedule.runTemplate === 'object' ? schedule.runTemplate : {}
  const goal = typeof runTemplate.goal === 'string' ? runTemplate.goal.trim() : ''
  if(!goal) return null
  const title = typeof runTemplate.title === 'string' ? runTemplate.title.trim() : null

  const runId = makeId('run')
  const stepId = makeId('step')
  const result = await prisma.$transaction(async (tx) => {
    const run = await tx.projectRun.create({
      data: {
        id: runId,
        projectId: schedule.projectId,
        sessionId: schedule.sessionId || null,
        scheduleId: schedule.id,
        status: 'queued',
        title: title && title.length ? title : null,
        goal,
        metadata: { scheduleId: schedule.id }
      }
    })
    const step = await tx.runStep.create({
      data: {
        id: stepId,
        runId,
        index: 0,
        kind: 'llm',
        status: 'queued',
        summary: 'Plan',
        input: { type: 'plan', goal }
      }
    })
    return { run, step }
  }).catch(()=>null)
  return result
}

async function tickSchedules({ prisma, workerId }){
  const lockMs = Number.parseInt(process.env.SCHEDULE_LOCK_MS || '600000', 10) || 600000
  const maxPerTick = Math.min(10, Math.max(1, Number.parseInt(process.env.SCHEDULE_MAX_PER_TICK || '3', 10) || 3))

  for(let i=0; i<maxPerTick; i++){
    const scheduleId = await claimDueSchedules(prisma, workerId, lockMs)
    if(!scheduleId) return

    const schedule = await prisma.schedule.findUnique({ where: { id: scheduleId } }).catch(()=>null)
    if(!schedule) continue

    const config = schedule.config && typeof schedule.config === 'object' ? schedule.config : {}
    const maxActiveRunsRaw = config.maxActiveRuns != null ? Number.parseInt(String(config.maxActiveRuns), 10) : 1
    const maxActiveRuns = Number.isFinite(maxActiveRunsRaw) ? Math.max(1, Math.min(20, maxActiveRunsRaw)) : 1

    const nextRunAt = computeNextRunAt({ now: new Date(), intervalSeconds: schedule.intervalSeconds || null, config, timezone: schedule.timezone || null })
    const nextRunAtValue = nextRunAt && !Number.isNaN(nextRunAt.getTime()) ? nextRunAt : null

    // Skip if there is already an active run for this schedule.
    const activeCount = await prisma.projectRun.count({
      where: { scheduleId: schedule.id, status: { in: ['queued','running','blocked'] } },
    }).catch(()=>0)

    if(activeCount >= maxActiveRuns){
      await prisma.schedule.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: schedule.lastRunAt || null,
          nextRunAt: nextRunAtValue,
          lockExpiresAt: null,
          lockedBy: null,
          updatedAt: new Date()
        }
      }).catch(()=>{})
      continue
    }

    const created = await createRunFromSchedule(prisma, schedule)

    // Catch-up policy: we only ever create one run per due tick (default), but allow a single
    // "run_once" catch-up if we were far behind.
    // NOTE: true multi-catch-up ("run_all") is intentionally not implemented yet.
    const catchUp = typeof config.catchUp === 'string' ? config.catchUp : 'skip'
    if (catchUp === 'run_once') {
      // no-op here: createRunFromSchedule already created the one run
    }

    await prisma.schedule.update({
      where: { id: schedule.id },
      data: {
        lastRunAt: new Date(),
        nextRunAt: nextRunAtValue,
        lockExpiresAt: null,
        lockedBy: null,
        updatedAt: new Date()
      }
    }).catch(()=>{})

    if(created && created.run){
      await appendRunEvent(prisma, created.run.id, created.step?.id || null, 'info', 'Schedule fired', { scheduleId: schedule.id })
    }
  }
}

module.exports = { startRunWorker }
