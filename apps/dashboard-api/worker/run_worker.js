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
    '    { "kind": "llm", "summary": "short", "prompt": "what to do", "requires_approval": true, "approval_prompt": "what to ask the human" }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- Keep steps small and sequential.',
    '- If a step could be risky/destructive/expensive, mark requires_approval=true.',
    '- Each "prompt" must be self-contained and actionable.'
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
    if(kind === 'approval'){
      out.push({ kind: 'approval', summary, prompt: approvalPrompt || prompt || summary || 'Approve this step', requiresApproval: false })
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

async function claimNextRun(prisma, workerId, lockMs){
  const now = new Date()
  const lockExpiresAt = new Date(Date.now() + lockMs)
  const where = {
    status: { in: ['queued', 'running', 'blocked'] },
    OR: [{ lockExpiresAt: null }, { lockExpiresAt: { lt: now } }]
  }

  const candidate = await prisma.projectRun.findFirst({ where, orderBy: { createdAt: 'asc' } }).catch(()=>null)
  if(!candidate) return null

  const updated = await prisma.projectRun.updateMany({
    where: Object.assign({ id: candidate.id }, where),
    data: { lockedBy: workerId, lockExpiresAt, updatedAt: new Date() }
  }).catch(()=>({ count: 0 }))
  if(!updated || updated.count !== 1) return null
  return candidate.id
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
    await prisma.projectRun.update({ where: { id: runId }, data: { status: 'blocked', updatedAt: new Date() } }).catch(()=>{})
    return
  }
  if(steps.every(s => s.status === 'succeeded' || s.status === 'canceled')) {
    await prisma.projectRun.update({ where: { id: runId }, data: { status: 'succeeded', updatedAt: new Date(), lockExpiresAt: null, lockedBy: null } }).catch(()=>{})
  }
}

async function executeLlmStep({ prisma, hermes, buildSystemContextForProject, run, step, timeoutMs }){
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
      data: { status: 'failed', error: 'missing_step_prompt', endedAt: new Date(), updatedAt: new Date() }
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
    await prisma.runStep.update({
      where: { id: step.id },
      data: {
        status: 'failed',
        error: String(err),
        output: r && typeof r === 'object' ? r : null,
        durationMs: Date.now() - startedAt,
        endedAt: new Date(),
        updatedAt: new Date()
      }
    }).catch(()=>{})
    await appendRunEvent(prisma, run.id, step.id, 'error', 'Hermes call failed', { error: String(err).slice(0, 400) })
    return
  }

  const hermesResponseId = r.result.id ? String(r.result.id) : null
  const assistantText = extractResponseText(r.result)

  await prisma.$transaction(async (tx) => {
    await tx.runStep.update({
      where: { id: step.id },
      data: {
        status: 'succeeded',
        output: { hermes: r.result, assistantText },
        hermesResponseId,
        durationMs: Date.now() - startedAt,
        endedAt: new Date(),
        updatedAt: new Date()
      }
    })
    if(hermesResponseId){
      await tx.projectRun.update({ where: { id: run.id }, data: { hermesLastResponseId: hermesResponseId, updatedAt: new Date() } })
    }
  }).catch(()=>{})

  await appendRunEvent(prisma, run.id, step.id, 'info', 'Hermes call succeeded', { hermesResponseId })

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
          input: { prompt: s.approvalPrompt || `Approve: ${s.summary || s.prompt || 'step'}`, summary: s.summary || null }
        })
      }
      toCreate.push({
        id: makeId('step'),
        runId: run.id,
        index: idx++,
        kind: s.kind || 'llm',
        status: 'queued',
        input: { prompt: s.prompt || '', summary: s.summary || null }
      })
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
    await tx.runStep.update({ where: { id: step.id }, data: { status: 'blocked', updatedAt: new Date() } })
    await tx.projectRun.update({ where: { id: run.id }, data: { status: 'blocked', updatedAt: new Date() } })
  }).catch(()=>{})
}

async function workOnce({ prisma, hermes, buildSystemContextForProject, workerId }){
  const lockMs = Number.parseInt(process.env.RUN_WORKER_LOCK_MS || '600000', 10) || 600000
  const timeoutMs = Number.parseInt(process.env.RUN_STEP_TIMEOUT_MS || process.env.HERMES_JOB_TIMEOUT_MS || '600000', 10) || 600000

  const runId = await claimNextRun(prisma, workerId, lockMs)
  if(!runId) return false

  const run = await prisma.projectRun.findUnique({ where: { id: runId } }).catch(()=>null)
  if(!run) return false

  if(run.status === 'queued'){
    await prisma.projectRun.update({ where: { id: run.id }, data: { status: 'running', updatedAt: new Date() } }).catch(()=>{})
  }

  const step = await selectNextStep(prisma, run.id)
  if(!step){
    await markRunTerminalIfDone(prisma, run.id)
    return true
  }

  // If blocked, only proceed if approval has been resolved.
  if(step.status === 'blocked' && step.kind === 'approval'){
    const pending = await prisma.approvalRequest.findFirst({ where: { stepId: step.id, runId: run.id, status: 'pending' } }).catch(()=>null)
    if(pending) return true

    const decided = await prisma.approvalRequest.findFirst({
      where: { stepId: step.id, runId: run.id, status: { in: ['approved', 'rejected'] } },
      orderBy: { updatedAt: 'desc' }
    }).catch(()=>null)

    if(decided && decided.status === 'approved'){
      await prisma.runStep.update({ where: { id: step.id }, data: { status: 'succeeded', endedAt: new Date(), updatedAt: new Date() } }).catch(()=>{})
      await prisma.projectRun.update({ where: { id: run.id }, data: { status: 'running', updatedAt: new Date() } }).catch(()=>{})
      await appendRunEvent(prisma, run.id, step.id, 'info', 'Approval granted; continuing', {})
      await markRunTerminalIfDone(prisma, run.id)
      return true
    }

    if(decided && decided.status === 'rejected'){
      await prisma.runStep.update({ where: { id: step.id }, data: { status: 'failed', error: 'approval_rejected', endedAt: new Date(), updatedAt: new Date() } }).catch(()=>{})
      await prisma.projectRun.update({ where: { id: run.id }, data: { status: 'failed', updatedAt: new Date() } }).catch(()=>{})
      await appendRunEvent(prisma, run.id, step.id, 'error', 'Approval rejected; failing run', {})
      return true
    }

    return true
  }

  if(step.status !== 'queued' && step.status !== 'running'){
    await markRunTerminalIfDone(prisma, run.id)
    return true
  }

  if(step.status === 'queued'){
    const updated = await prisma.runStep.updateMany({
      where: { id: step.id, status: 'queued' },
      data: { status: 'running', startedAt: new Date(), updatedAt: new Date() }
    }).catch(()=>({ count: 0 }))
    if(!updated || updated.count !== 1) return true
  }

  if(step.kind === 'approval'){
    await executeApprovalStep({ prisma, run, step })
    return true
  }

  if(step.kind === 'llm'){
    await executeLlmStep({ prisma, hermes, buildSystemContextForProject, run, step, timeoutMs })
    await markRunTerminalIfDone(prisma, run.id)
    return true
  }

  await prisma.runStep.update({ where: { id: step.id }, data: { status: 'failed', error: `unsupported_step_kind:${step.kind}`, endedAt: new Date(), updatedAt: new Date() } }).catch(()=>{})
  await appendRunEvent(prisma, run.id, step.id, 'error', 'Unsupported step kind', { kind: step.kind })
  await markRunTerminalIfDone(prisma, run.id)
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

module.exports = { startRunWorker }

