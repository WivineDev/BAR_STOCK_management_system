import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import businessRoutes from './routes/business.js';

export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: false, methods: ['GET', 'POST', 'PATCH', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'] }));
app.use(express.json({ limit: '100kb' }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }), authRoutes);
app.use('/api', businessRoutes);
app.use((_req, res) => res.status(404).json({ error: 'The requested resource was not found' }));
app.use((error, _req, res, _next) => {
  if (error?.code === 'ER_DUP_ENTRY' || error?.code === 'P2002' || error?.meta?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That value already exists' });
  if (error?.code === 'ER_NO_REFERENCED_ROW_2' || error?.code === 'P2003' || error?.meta?.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ error: 'A related record could not be found' });
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error('Request failed', { message: error.message, code: error.code });
  res.status(status).json({ error: status >= 500 ? 'An unexpected server error occurred' : error.message });
});
