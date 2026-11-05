import dotenv from 'dotenv';
import { app } from './app.js';
import { pool } from './config/database.js';

dotenv.config();
const port = Number(process.env.PORT || 5000);

const server = app.listen(port, async () => {
  try {
    await pool.query('SELECT 1');
    console.log(`BSSBMS API listening on port ${port}; MySQL connection ready`);
  } catch (error) {
    console.error('API started but MySQL is not available. Start XAMPP MySQL and run database migrations.', { code: error.code });
  }
});

async function stop() { server.close(async () => { await pool.end(); process.exit(0); }); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
