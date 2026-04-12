require('dotenv').config()

const { PrismaClient } = require('@prisma/client')
const hermes = require('./hermes_adapter')
const { startRunWorker } = require('./worker/run_worker')
const { buildSystemContextForProject } = require('./system_context')

const prisma = new PrismaClient()

async function main(){
  await prisma.$connect()
  console.log('[worker] connected to Postgres')
  const ctx = (projectId) => buildSystemContextForProject(prisma, projectId)
  startRunWorker({ prisma, hermes, buildSystemContextForProject: ctx })
}

main().catch((e) => {
  console.error('[worker] fatal', e)
  process.exit(1)
})
