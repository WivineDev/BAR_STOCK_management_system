// Runs tests/pos-acceptance.integration.js against a throwaway database on a
// dedicated port so the suite is repeatable and never touches dev data.
// Mirrors tests/run-table-service.mjs — see the note there about DATABASE_URL:
// database.js memoizes it on first import, so child processes need it explicitly.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { prisma } from '../src/config/database.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, '..');
const suffix = randomUUID().slice(0, 8);
const dbName = `bssbms_pos_${suffix}`;
const port = Number(process.env.POS_TEST_PORT || 5198);
const baseUrl = `http://localhost:${port}/api`;

const username = encodeURIComponent(process.env.DB_USER || 'root');
const password = encodeURIComponent(process.env.DB_PASSWORD || '');
const host = process.env.DB_HOST || '127.0.0.1';
const dbPort = Number(process.env.DB_PORT || 3306);
const testUrl = `mysql://${username}:${password}@${host}:${dbPort}/${dbName}`;

const childEnv = {
  ...process.env,
  DB_NAME: dbName,
  DATABASE_URL: testUrl,
  PORT: String(port),
  NODE_ENV: 'test',
};

function run(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: backend, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(output) : reject(new Error(`node ${args.join(' ')} exited ${code}\n${output}`))));
  });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return true;
    } catch { /* not up yet */ }
    await delay(500);
  }
  return false;
}

let server;
let failed = false;
try {
  await prisma.$executeRawUnsafe(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  console.log(`Created test database ${dbName}`);
  console.log('Applying migrations…');
  await run([path.join('database', 'migrate.js')], childEnv);

  server = spawn(process.execPath, ['src/server.js'], { cwd: backend, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  server.stdout.on('data', (chunk) => { serverLog += chunk; });
  server.stderr.on('data', (chunk) => { serverLog += chunk; });
  if (!(await waitForHealth())) throw new Error(`Test server did not become healthy\n${serverLog}`);
  console.log(`Test server listening on ${baseUrl}`);

  console.log('Running POS acceptance suite…\n');
  try {
    const output = await run([path.join('tests', 'pos-acceptance.integration.js')], { ...childEnv, BSSBMS_TEST_API: baseUrl });
    console.log(output.trim());
  } catch (error) {
    failed = true;
    console.error(error.message);
  }
} catch (error) {
  failed = true;
  console.error(error.message);
} finally {
  if (server && !server.killed) {
    server.kill();
    await delay(800);
    if (!server.killed) server.kill('SIGKILL');
  }
  try {
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${dbName}\``);
    console.log(`Dropped test database ${dbName}`);
  } catch (error) {
    console.error(`Could not drop ${dbName}: ${error.message}`);
  }
  await prisma.$disconnect();
}

if (failed) {
  console.error('POS acceptance test run FAILED');
  process.exit(1);
}
console.log('POS acceptance test run PASSED');
