require('dotenv').config()

const { PrismaClient } = require('@prisma/client')
const hermes = require('./hermes_adapter')
const { startWikiWorker } = require('./worker/wiki_worker')

const prisma = new PrismaClient()

async function main(){
  await prisma.$connect()
  console.log('[wiki-worker] connected to Postgres')
  startWikiWorker({ prisma, hermes })
}

main().catch((e) => {
  console.error('[wiki-worker] fatal', e)
  process.exit(1)
})

