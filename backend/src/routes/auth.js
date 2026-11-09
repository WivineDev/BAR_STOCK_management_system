import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { prisma } from '../config/database.js';
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
  const result = await prisma.$transaction(async (transaction) => {
    const lockRows = await transaction.$queryRaw`SELECT GET_LOCK('bssbms-first-owner-bootstrap', 10) AS acquired`;
    const acquired = Number(lockRows[0].acquired) === 1;
    if (!acquired) fail(503, 'Owner setup is already in progress. Please retry.');
    try {
      if (await transaction.user.count() > 0) fail(409, 'The first owner account already exists. Ask an owner to create additional users.');
      const businessId = randomUUID();
      const userId = randomUUID();
      const branchId = randomUUID();
      const business = await transaction.business.create({
        data: { id: businessId, name: businessName.trim(), currency: 'RWF' },
      });
      await transaction.branch.create({
        data: { id: branchId, businessId, name: 'Main branch' },
      });
      await transaction.user.create({
        data: {
          id: userId,
          businessId,
          branchId,
          name: name.trim(),
          email: email.toLowerCase().trim(),
          passwordHash: await bcrypt.hash(password, 12),
          role: 'owner',
        },
      });
      return { id: userId, businessId, name: name.trim(), email: email.toLowerCase().trim(), role: 'owner', businessName: business.name };
    } finally {
      await transaction.$queryRaw`SELECT RELEASE_LOCK('bssbms-first-owner-bootstrap')`;
    }
  }, { maxWait: 10_000, timeout: 30_000 });
  res.status(201).json({ token: tokenFor(result), user: publicUser(result) });
}));

router.post('/login', asyncRoute(async (req, res) => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) fail(500, 'Server authentication is not configured');
  const { email, password } = req.body || {};
  if (!emailPattern.test(email || '') || typeof password !== 'string' || !password) fail(400, 'Email and password are required');
  const account = await prisma.user.findFirst({
    where: { email: email.toLowerCase().trim(), active: true },
    select: {
      id: true,
      businessId: true,
      name: true,
      email: true,
      role: true,
      passwordHash: true,
      business: { select: { name: true } },
    },
  });
  if (!account || !(await bcrypt.compare(password, account.passwordHash))) {
    if (account) {
      await prisma.loginActivity.create({
        data: { id: randomUUID(), businessId: account.businessId, userId: account.id, successful: false, ipAddress: req.ip },
      });
    }
    fail(401, 'Email or password is incorrect');
  }
  const user = { ...account, businessName: account.business.name };
  delete user.passwordHash;
  delete user.business;
  await prisma.loginActivity.create({
    data: { id: randomUUID(), businessId: user.businessId, userId: user.id, successful: true, ipAddress: req.ip },
  });
  res.json({ token: tokenFor(user), user: publicUser(user) });
}));

router.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

export default router;
