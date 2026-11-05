import jwt from 'jsonwebtoken';
import { pool } from '../config/database.js';
import { asyncRoute, fail } from '../utils/errors.js';

export const authenticate = asyncRoute(async (req, _res, next) => {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  if (!token) fail(401, 'Sign in to continue');
  let claims;
  try { claims = jwt.verify(token, process.env.JWT_SECRET); } catch { fail(401, 'Your session has expired. Please sign in again.'); }
  const [users] = await pool.execute(
    `SELECT u.id, u.business_id AS businessId, u.name, u.email, u.role, u.active, b.name AS businessName
     FROM users u JOIN businesses b ON b.id = u.business_id WHERE u.id = ? AND u.business_id = ? LIMIT 1`,
    [claims.sub, claims.biz],
  );
  if (!users.length || !users[0].active) fail(401, 'This account is no longer active');
  req.user = users[0];
  next();
});

export function authorize(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.user.role)) return next(Object.assign(new Error('You do not have permission to do that'), { status: 403 }));
    next();
  };
}
