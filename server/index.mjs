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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 5000;

// A client-fault error the h() wrapper surfaces as a 400 (not a 500).
function bad(msg) { const e = new Error(msg); e.status = 400; return e; }

// `date` flows into the daily-note file path, so a bad value is both a 400 and
// a path-traversal guard. Defaults to today when omitted.
function reqDate(d) {
  const iso = d || todayIso();
  if (!DATE_RE.test(iso)) throw bad('date must be YYYY-MM-DD');
  return iso;
}

// Strip absolute filesystem paths out of messages before they reach the client,
// leaving only the basename so fs errors don't leak the vault layout.
function scrub(msg) {
  return String(msg || 'error')
    .replace(/[A-Za-z]:\\[^\s'"]*[\\]([^\s'"\\]+)/g, '$1')
    .replace(/\/(?:[^\s'"/]+\/)+([^\s'"/]+)/g, '$1');
}

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

// small async wrapper: client-fault errors (err.status) surface as that code;
// everything else is a 500. Absolute paths are scrubbed from the client message,
// and only genuine server faults are logged.
const h = (fn) => (req, res) => {
  Promise.resolve()
    .then(() => fn(req, res))
    .catch((err) => {
      const status = err.status || 500;
      if (status >= 500) console.error(`[myos] ${req.method} ${req.path} —`, err.message);
      res.status(status).json({ error: scrub(err.message) });
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
  res.json(getDaily(reqDate(req.query.date), schema));
}));

app.post('/api/daily/fields', h((req, res) => {
  const schema = getSchema();
  const { date, fields } = req.body;
  res.json(setDailyFields(reqDate(date), fields || {}, schema));
}));

app.post('/api/daily/habit', h((req, res) => {
  const schema = getSchema();
  const { date, habitKey, checked } = req.body;
  res.json(setHabit(reqDate(date), habitKey, !!checked, schema));
}));

app.post('/api/daily/counter', h((req, res) => {
  const schema = getSchema();
  const { date, field, delta } = req.body;
  const n = Number(delta);
  if (!Number.isFinite(n)) throw bad('delta must be a finite number');
  const keys = schema.dailyNote.frontmatter.map((f) => f.key);
  if (!keys.includes(field)) throw bad('unknown counter field');
  res.json(bumpCounter(reqDate(date), field, n, schema));
}));

app.post('/api/daily/log', h((req, res) => {
  const schema = getSchema();
  const { date, text } = req.body;
  if (!text || !text.trim()) throw bad('text required');
  if (text.length > MAX_TEXT) throw bad(`text too long (max ${MAX_TEXT} chars)`);
  res.json(appendLog(reqDate(date), text.trim(), schema));
}));

// Step count push — written to the daily note's `steps` frontmatter field.
// Built for an iOS Shortcut automation authenticating with the X-API-Key header.
app.post('/api/daily/steps', h((req, res) => {
  const schema = getSchema();
  const date = req.body.date || req.query.date;
  const steps = req.body.steps ?? req.query.steps;
  // iOS Health hands the step count to the Shortcut as a formatted quantity
  // (thousands comma + a "steps" unit label), so accept any string and keep
  // only the digits/decimal before parsing.
  const cleaned = String(steps ?? '').replace(/[^0-9.]/g, '');
  const n = Number(cleaned);
  if (cleaned === '' || !Number.isFinite(n)) throw bad('steps (number) required');
  res.json(setDailyFields(reqDate(date), { steps: Math.round(n) }, schema));
}));

// Reflection reminder — returns plain reminder text when today's reflection
// fields are still blank, and an empty body when they're all filled. Built for
// an iOS Shortcut time automation: fetch this, and only Show Notification if the
// body has any text. Key rides in the query string like the steps push.
app.get('/api/daily/reflection-due', h((req, res) => {
  const schema = getSchema();
  const iso = reqDate(req.query.date);
  const daily = getDaily(iso, schema);
  const fm = daily.frontmatter || {};
  const fields = schema.dailyNote.frontmatter.filter((f) => f.group === 'reflection' && f.type === 'text');
  const blank = (v) => v === undefined || v === null || String(v).trim() === '';
  const missing = fields.filter((f) => blank(fm[f.key]));
  res.type('text/plain');
  if (missing.length === 0) return res.send('');
  res.send(`myOS: reflections still open today — ${missing.map((f) => f.label).join(', ')}.`);
}));

// ---- finance --------------------------------------------------------------
app.get('/api/finance/summary', h((req, res) => {
  res.json(financeSummary(getSchema()));
}));

app.post('/api/finance/transaction', h((req, res) => {
  const schema = getSchema();
  const { date, amount, category, note } = req.body;
  const n = Number(amount);
  if (amount === undefined || amount === null || String(amount).trim() === '' || !Number.isFinite(n)) {
    throw bad('amount must be a finite number');
  }
  if (!category) throw bad('category required');
  res.json(addTransaction(schema, { date: reqDate(date), amount: n, category, note }));
}));

app.post('/api/finance/snapshot', h((req, res) => {
  const schema = getSchema();
  const { date, total, parts } = req.body;
  const n = Number(total);
  if (total === undefined || total === null || String(total).trim() === '' || !Number.isFinite(n)) {
    throw bad('total must be a finite number');
  }
  res.json(addSnapshot(schema, { date: reqDate(date), total: n, parts }));
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
  if (!text || !text.trim()) throw bad('text required');
  if (text.length > MAX_TEXT) throw bad(`text too long (max ${MAX_TEXT} chars)`);
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
