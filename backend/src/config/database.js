import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

if (!process.env.DATABASE_URL) {
  const username = encodeURIComponent(process.env.DB_USER || 'root');
  const password = encodeURIComponent(process.env.DB_PASSWORD || '');
  const host = process.env.DB_HOST || '127.0.0.1';
  const port = Number(process.env.DB_PORT || 3306);
  const database = encodeURIComponent(process.env.DB_NAME || 'bssbms');
  process.env.DATABASE_URL = `mysql://${username}:${password}@${host}:${port}/${database}`;
}

export const prisma = new PrismaClient();

function isReadQuery(sql) {
  return /^(SELECT|SHOW|DESCRIBE|EXPLAIN|WITH)\b/i.test(sql.trimStart());
}

function createSqlClient(client) {
  return {
    async execute(sql, values = []) {
      if (isReadQuery(sql)) return [await client.$queryRawUnsafe(sql, ...values)];
      const affectedRows = await client.$executeRawUnsafe(sql, ...values);
      return [{ affectedRows }];
    },
  };
}

export const pool = createSqlClient(prisma);

export async function withTransaction(work) {
  return prisma.$transaction((transaction) => work(createSqlClient(transaction)), {
    maxWait: 10_000,
    timeout: 30_000,
  });
}
