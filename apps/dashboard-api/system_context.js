async function buildSystemContextForProject(prisma, projectId){
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

module.exports = { buildSystemContextForProject }

