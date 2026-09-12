// myOS bridge — local Express server that fronts the vault.
// Holds the only write-head to the Hub. The PWA talks to it over /api.
// In production it also serves the built dist/ so the whole app is one origin.
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import {
  locateVault, getSchema, todayIso,
  getDaily, setDailyFields, setHabit, bumpCounter, appendLog,
  financeSummary, addTransaction, addSnapshot,
  habitStreaks,
  listEvents, upsertEvent, deleteEvent,
  captureInbox,
} from './vault.mjs';
import { loadAuth, verifyPassword, issueToken, requireAuth } from './auth.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MYOS_BRIDGE_PORT) || 4177;

const app = express();
// Private Network Access: a public HTTPS page (e.g. the GitHub Pages site) making
// a request to this localhost bridge triggers a preflight carrying
// `Access-Control-Request-Private-Network`. Chromium requires us to answer with
// `Access-Control-Allow-Private-Network: true` or it blocks the call.
app.use((req, res, next) => {
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// small async wrapper so thrown errors become 500s, not unhandled rejections
const h = (fn) => (req, res) => {
  Promise.resolve()
    .then(() => fn(req, res))
    .catch((err) => {
      console.error(`[myos] ${req.method} ${req.path} —`, err.message);
      res.status(500).json({ error: err.message });
    });
};

// ---- public: health + login -----------------------------------------------
app.get('/api/health', h((req, res) => {
  const vault = locateVault();
  res.json({ ok: true, vault, today: todayIso() });
}));

app.post('/api/login', h((req, res) => {
  const { email, password } = req.body || {};
  if (!verifyPassword(email, password)) return res.status(401).json({ error: 'Wrong email or password' });
  res.json({ token: issueToken(), email: String(email).toLowerCase() });
}));

app.get('/api/me', requireAuth, h((req, res) => {
  res.json({ email: req.user.sub, exp: req.user.exp });
}));

// ---- everything below requires a valid session -----------------------------
app.use('/api', requireAuth);

app.get('/api/schema', h((req, res) => {
  res.json(getSchema());
}));

// ---- daily note -----------------------------------------------------------
app.get('/api/today', h((req, res) => {
  const schema = getSchema();
  const iso = req.query.date || todayIso();
  res.json(getDaily(iso, schema));
}));

app.post('/api/daily/fields', h((req, res) => {
  const schema = getSchema();
  const { date, fields } = req.body;
  res.json(setDailyFields(date || todayIso(), fields || {}, schema));
}));

app.post('/api/daily/habit', h((req, res) => {
  const schema = getSchema();
  const { date, habitKey, checked } = req.body;
  res.json(setHabit(date || todayIso(), habitKey, !!checked, schema));
}));

app.post('/api/daily/counter', h((req, res) => {
  const schema = getSchema();
  const { date, field, delta } = req.body;
  res.json(bumpCounter(date || todayIso(), field, Number(delta) || 0, schema));
}));

app.post('/api/daily/log', h((req, res) => {
  const schema = getSchema();
  const { date, text } = req.body;
  if (!text || !text.trim()) throw new Error('text required');
  res.json(appendLog(date || todayIso(), text.trim(), schema));
}));

// Step count push — written to the daily note's `steps` frontmatter field.
// Built for an iOS Shortcut automation authenticating with the X-API-Key header.
app.post('/api/daily/steps', h((req, res) => {
  const schema = getSchema();
  const date = req.body.date || req.query.date;
  const steps = req.body.steps ?? req.query.steps;
  const n = Number(steps);
  if (!Number.isFinite(n)) throw new Error('steps (number) required');
  res.json(setDailyFields(date || todayIso(), { steps: Math.round(n) }, schema));
}));

// ---- finance --------------------------------------------------------------
app.get('/api/finance/summary', h((req, res) => {
  res.json(financeSummary(getSchema()));
}));

app.post('/api/finance/transaction', h((req, res) => {
  const schema = getSchema();
  const { date, amount, category, note } = req.body;
  if (amount === undefined || amount === null || amount === '') throw new Error('amount required');
  if (!category) throw new Error('category required');
  res.json(addTransaction(schema, { date, amount, category, note }));
}));

app.post('/api/finance/snapshot', h((req, res) => {
  const schema = getSchema();
  const { date, total, parts } = req.body;
  if (total === undefined || total === null || total === '') throw new Error('total required');
  res.json(addSnapshot(schema, { date, total, parts }));
}));

// ---- habits ---------------------------------------------------------------
app.get('/api/habits/streaks', h((req, res) => {
  res.json(habitStreaks(getSchema()));
}));

// ---- calendar -------------------------------------------------------------
app.get('/api/calendar/events', h((req, res) => {
  const schema = getSchema();
  const { from, to } = req.query;
  res.json(listEvents(schema, from, to));
}));

app.post('/api/calendar/events', h((req, res) => {
  res.json(upsertEvent(getSchema(), req.body || {}));
}));

app.put('/api/calendar/events/:id', h((req, res) => {
  res.json(upsertEvent(getSchema(), { ...req.body, id: req.params.id }));
}));

app.delete('/api/calendar/events/:id', h((req, res) => {
  res.json(deleteEvent(getSchema(), req.params.id));
}));

// ---- inbox ----------------------------------------------------------------
app.post('/api/inbox', h((req, res) => {
  const schema = getSchema();
  const { text } = req.body;
  if (!text || !text.trim()) throw new Error('text required');
  res.json(captureInbox(schema, text.trim()));
}));

// ---- serve built PWA in production ----------------------------------------
const dist = join(__dirname, '..', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(join(dist, 'index.html'));
  });
}

app.listen(PORT, () => {
  let vaultMsg = '';
  try { vaultMsg = `vault: ${locateVault()}`; } catch (e) { vaultMsg = `VAULT NOT FOUND — ${e.message}`; }
  console.log(`[myos] bridge on http://localhost:${PORT}`);
  console.log(`[myos] ${vaultMsg}`);
  try { const a = loadAuth(); console.log(`[myos] login as ${a.email} (${a.sessionDays}-day sessions)`); }
  catch (e) { console.log(`[myos] AUTH CONFIG MISSING — ${e.message}`); }
  if (existsSync(dist)) console.log('[myos] serving built PWA from dist/');
});
