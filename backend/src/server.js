import dotenv from 'dotenv';
import { app } from './app.js';
import { prisma } from './config/database.js';

dotenv.config();
const port = Number(process.env.PORT || 5000);

const server = app.listen(port, async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log(`BSSBMS API listening on port ${port}; Prisma Client connected to MySQL and executed a query successfully.`);
  } catch (error) {
    console.error('API started, but Prisma could not connect to MySQL. Start MySQL and verify DATABASE_URL.', { code: error.code });
  }
});

async function stop() { server.close(async () => { await prisma.$disconnect(); process.exit(0); }); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
