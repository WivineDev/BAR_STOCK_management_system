import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { pool, withTransaction } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncRoute, fail } from '../utils/errors.js';

const router = Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function tokenFor(user) { return jwt.sign({ sub: user.id, biz: user.businessId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }); }
function publicUser(user) { return { id: user.id, name: user.name, email: user.email, role: user.role, businessName: user.businessName }; }

router.post('/bootstrap', asyncRoute(async (req, res) => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) fail(500, 'Configure a JWT_SECRET of at least 32 characters before creating the owner account');
  const { businessName, name, email, password } = req.body || {};
  if (!businessName?.trim() || !name?.trim() || !emailPattern.test(email || '') || typeof password !== 'string' || password.length < 10) fail(400, 'Business name, name, valid email, and a password of at least 10 characters are required');
  const lockConnection = await pool.getConnection();
  let result;
  try {
    const [lockRows] = await lockConnection.query("SELECT GET_LOCK('bssbms-first-owner-bootstrap', 10) AS acquired");
    if (Number(lockRows[0].acquired) !== 1) fail(503, 'Owner setup is already in progress. Please retry.');
    result = await withTransaction(async (connection) => {
      const [existing] = await connection.execute('SELECT COUNT(*) AS count FROM users');
      if (Number(existing[0].count) > 0) fail(409, 'The first owner account already exists. Ask an owner to create additional users.');
      const businessId = randomUUID(); const userId = randomUUID(); const branchId = randomUUID();
      await connection.execute('INSERT INTO businesses (id, name, currency) VALUES (?, ?, \'RWF\')', [businessId, businessName.trim()]);
      await connection.execute('INSERT INTO branches (id, business_id, name) VALUES (?, ?, ?)', [branchId, businessId, 'Main branch']);
      await connection.execute('INSERT INTO users (id, business_id, branch_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?, \'owner\')', [userId, businessId, branchId, name.trim(), email.toLowerCase().trim(), await bcrypt.hash(password, 12)]);
      return { id: userId, businessId, name: name.trim(), email: email.toLowerCase().trim(), role: 'owner', businessName: businessName.trim() };
    });
  } finally {
    try { await lockConnection.query("SELECT RELEASE_LOCK('bssbms-first-owner-bootstrap')"); } finally { lockConnection.release(); }
  }
  res.status(201).json({ token: tokenFor(result), user: publicUser(result) });
}));

router.post('/login', asyncRoute(async (req, res) => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) fail(500, 'Server authentication is not configured');
  const { email, password } = req.body || {};
  if (!emailPattern.test(email || '') || typeof password !== 'string' || !password) fail(400, 'Email and password are required');
  const [rows] = await pool.execute(
    `SELECT u.id, u.business_id AS businessId, u.name, u.email, u.role, u.password_hash, b.name AS businessName
     FROM users u JOIN businesses b ON b.id = u.business_id WHERE u.email = ? AND u.active = 1 LIMIT 1`, [email.toLowerCase().trim()],
  );
  if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
    if (rows.length) await pool.execute('INSERT INTO login_activity (id, business_id, user_id, successful, ip_address) VALUES (UUID(), ?, ?, 0, ?)', [rows[0].businessId, rows[0].id, req.ip]);
    fail(401, 'Email or password is incorrect');
  }
  const user = rows[0];
  await pool.execute('INSERT INTO login_activity (id, business_id, user_id, successful, ip_address) VALUES (UUID(), ?, ?, 1, ?)', [user.businessId, user.id, req.ip]);
  res.json({ token: tokenFor(user), user: publicUser(user) });
}));

router.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

export default router;
