import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool, prisma } from '../src/config/database.js';

dotenv.config();

const historyTable = 'bssbms_migration_history';
const migrations = [
  { version: '0001_core', filename: './bssbms.sql' },
  { version: '0002_purchases_packaging', filename: './migrations/0002_purchases_and_packaging.sql' },
  { version: '0003_transaction_returns', filename: './migrations/0003_transaction_returns.sql' },
  { version: '0004_sale_category_snapshot', filename: './migrations/0004_sale_category_snapshot.sql' },
  { version: '0005_table_service', filename: './migrations/0005_table_service.sql' },
  { version: '0006_payment_references', filename: './migrations/0006_payment_references.sql' },
];

async function executeSqlFile(filename) {
  const file = fileURLToPath(new URL(filename, import.meta.url));
  const statements = (await readFile(file, 'utf8')).split(';').map((statement) => statement.trim()).filter(Boolean);
  for (const statement of statements) {
    if (/^(?:--[^\r\n]*\s*)*SET\s+(?:NAMES|FOREIGN_KEY_CHECKS)\b/i.test(statement)) continue;
    await pool.execute(statement);
  }
}

try {
  const [tables] = await pool.execute('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()');
  const historyExists = tables.some((table) => table.name === historyTable);
  if (tables.length > 0 && !historyExists) {
    throw new Error(`Database ${process.env.DB_NAME || 'bssbms'} already contains tables but has no BSSBMS migration marker. To protect existing data, this installer only runs against an empty database. Choose a new development database or review and migrate the existing schema deliberately.`);
  }

  await pool.execute(`CREATE TABLE IF NOT EXISTS ${historyTable} (
    version VARCHAR(32) PRIMARY KEY,
    status ENUM('running','complete') NOT NULL,
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  for (const migration of migrations) {
    const [versions] = await pool.execute(`SELECT status FROM ${historyTable} WHERE version = ?`, [migration.version]);
    if (versions[0]?.status === 'complete') {
      console.log(`Already applied ${migration.version}`);
      continue;
    }
    await pool.execute(`INSERT INTO ${historyTable} (version, status) VALUES (?, 'running') ON DUPLICATE KEY UPDATE status = 'running'`, [migration.version]);
    try {
      await executeSqlFile(migration.filename);
      await pool.execute(`UPDATE ${historyTable} SET status = 'complete', completed_at = CURRENT_TIMESTAMP WHERE version = ?`, [migration.version]);
      console.log(`Applied ${path.basename(migration.filename)}`);
    } catch (error) {
      throw new Error(`Migration ${migration.version} failed: ${error.code || error.message}`, { cause: error });
    }
  }
} finally {
  await prisma.$disconnect();
}
