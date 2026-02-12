import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { PORT, PAUSE_PROLONGEE_MINUTES } from './config.js';
import { verifyToken } from './auth.js';
import db from './db.js';
import { setIo } from './socketEmitter.js';
import authRoutes from './routes/auth.js';
import statusRoutes from './routes/status.js';
import adminRoutes from './routes/admin.js';
import capacityRoutes from './routes/capacity.js';
import teamsRoutes from './routes/teams.js';
import presenceRoutes from './routes/presence.js';
import approvalsRoutes from './routes/approvals.js';
import { startPresenceChecker, handleSocketDisconnect } from './presence.js';
import { initTransport } from './services/mailService.js';
import { notifyPendingCount } from './socketEmitter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const clientDist = join(__dirname, '..', 'client', 'dist');

// ── Diagnostic au démarrage : vérifier la présence du build frontend ──
const distExists = fs.existsSync(clientDist);
const indexExists = fs.existsSync(join(clientDist, 'index.html'));
console.log(`[startup] clientDist = ${clientDist}`);
console.log(`[startup] dist exists = ${distExists}, index.html exists = ${indexExists}`);
if (!distExists) {
  console.warn('[startup] WARNING: client/dist not found. Run "npm run build" first.');
}

const app = express();
const httpServer = createServer(app);

const DEFAULT_ORIGINS = [
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176',
  'https://test.breaktopia.io',
  'https://breaktopia.io',
];

// Allow overriding via env: ALLOWED_ORIGINS=https://foo.com,https://bar.com
const envOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : [];

const ALLOWED_ORIGINS = envOrigins.length > 0
  ? [...DEFAULT_ORIGINS, ...envOrigins]
  : DEFAULT_ORIGINS;

const io = new Server(httpServer, {
  cors: { origin: ALLOWED_ORIGINS },
});

setIo(io);

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json());

app.get('/favicon.ico', (req, res) => res.status(204).end());

// ── Public config routes (MUST be declared BEFORE capacityRoutes which uses authMiddleware) ──

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Dynamic config — reads pauseProlongeeMinutes from DB (app_settings)
app.get('/api/config', (req, res) => {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'pauseProlongeeMinutes'").get();
  const pauseProlongeeMinutes = row ? parseInt(row.value, 10) : PAUSE_PROLONGEE_MINUTES;
  res.json({ pauseProlongeeMinutes });
});

// PATCH /api/config — superadmin only
app.patch('/api/config', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Non authentifié' });

  const userRow = db.prepare('SELECT role FROM users WHERE id = ?').get(payload.id);
  if (!userRow || userRow.role !== 'superadmin') {
    return res.status(403).json({ error: 'Accès interdit' });
  }

  const { pauseProlongeeMinutes } = req.body;
  if (pauseProlongeeMinutes != null) {
    const val = parseInt(pauseProlongeeMinutes, 10);
    if (Number.isNaN(val) || val < 1 || val > 120) {
      return res.status(400).json({ error: 'Valeur invalide (1-120)' });
    }
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('pauseProlongeeMinutes', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')").run(String(val), String(val));

    // Broadcast to all connected clients
    io.emit('configUpdated', { pauseProlongeeMinutes: val });
  }

  // Return current config
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'pauseProlongeeMinutes'").get();
  res.json({ pauseProlongeeMinutes: row ? parseInt(row.value, 10) : PAUSE_PROLONGEE_MINUTES });
});

// ── Authenticated API routes ──

app.use('/api/auth', authRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', capacityRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/presence', presenceRoutes);
app.use('/api/admin/approvals', approvalsRoutes);

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const payload = verifyToken(token);
  if (!payload) return next(new Error('Non authentifié'));
  socket.userId = payload.id;
  next();
});

io.on('connection', (socket) => {
  // Look up the user to determine team and role
  const userRow = db.prepare('SELECT id, role, team_id, approval_status FROM users WHERE id = ?').get(socket.userId);
  if (!userRow) return;

  // Reject socket connections from non-approved users
  if (userRow.approval_status !== 'approved') {
    socket.disconnect(true);
    return;
  }

  // Join team-specific room
  if (userRow.team_id) {
    socket.join(`team:${userRow.team_id}`);
  }

  // Super-admins also join the global superadmin room to receive all updates
  if (userRow.role === 'superadmin') {
    socket.join('superadmin');
    // Send initial pending approvals count
    const row = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE approval_status = 'pending'").get();
    socket.emit('pendingApprovals', { count: row?.cnt ?? 0 });
  }

  // When a socket disconnects, check if the user should be marked offline
  // instantly (pendingLogout + no remaining sockets = tab/browser closed).
  socket.on('disconnect', () => {
    handleSocketDisconnect(socket.userId);
  });
});

// Initialize email transport
initTransport();

// Start the presence checker (grace-based auto-logout)
startPresenceChecker(io);

// ── Debug endpoint (protected) ──
if (process.env.DEBUG_DIST === 'true') {
  app.get('/__debug/dist', (req, res) => {
    const distExistsNow = fs.existsSync(clientDist);
    const indexExistsNow = fs.existsSync(join(clientDist, 'index.html'));
    const files = distExistsNow ? fs.readdirSync(clientDist).slice(0, 50) : [];
    res.json({
      clientDist,
      distExists: distExistsNow,
      indexExists: indexExistsNow,
      files
    });
  });
}

// ── Serve React/Vite frontend in production ──
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  res.sendFile(join(clientDist, 'index.html'));
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
