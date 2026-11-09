import jwt from 'jsonwebtoken';
import { prisma } from '../config/database.js';
import { asyncRoute, fail } from '../utils/errors.js';

export const authenticate = asyncRoute(async (req, _res, next) => {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  if (!token) fail(401, 'Sign in to continue');
  let claims;
  try { claims = jwt.verify(token, process.env.JWT_SECRET); } catch { fail(401, 'Your session has expired. Please sign in again.'); }
  const user = await prisma.user.findFirst({
    where: { id: claims.sub, businessId: claims.biz },
    select: {
      id: true,
      businessId: true,
      name: true,
      email: true,
      role: true,
      active: true,
      business: { select: { name: true } },
    },
  });
  if (!user || !user.active) fail(401, 'This account is no longer active');
  req.user = { ...user, businessName: user.business.name };
  delete req.user.business;
  next();
});

export function authorize(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.user.role)) return next(Object.assign(new Error('You do not have permission to do that'), { status: 403 }));
    next();
  };
}
