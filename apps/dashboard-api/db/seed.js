const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function seed(){
  console.log('Seeding demo data...')
  await prisma.company.upsert({
    where: { id: 'company-demo' },
    update: {},
    create: { id: 'company-demo', name: 'Demo Company', slug: 'demo-company' }
  })

  await prisma.project.upsert({
    where: { id: 'project-demo' },
    update: {},
    create: { id: 'project-demo', name: 'Demo Project', slug: 'demo-project', companyId: 'company-demo' }
  })

  await prisma.session.upsert({
    where: { id: 'session-demo' },
    update: {},
    create: { id: 'session-demo', projectId: 'project-demo', title: 'Demo Session', status: 'completed', hermesSessionId: null }
  })

  console.log('Seed complete')
  await prisma.$disconnect()
}

seed().catch(e=>{ console.error(e); process.exit(1) })
