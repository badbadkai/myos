// Vault access layer for the myOS bridge.
// Locates the Hub vault across drive letters, then reads/writes the specific
// files myOS touches: daily-note frontmatter + habit checkboxes, the finance
// CSVs (with the locked derived-balance formula), habits.csv, and the calendar.
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import matter from 'gray-matter';

const VAULT_REL = join('Kai', 'Hub Revamped');
const MARKER = 'ME.md';

// ---- vault location -------------------------------------------------------
let VAULT = null;

export function locateVault() {
  if (VAULT && existsSync(join(VAULT, MARKER))) return VAULT;
  const envPath = process.env.MYOS_VAULT;
  if (envPath && existsSync(join(envPath, MARKER))) { VAULT = envPath; return VAULT; }
  const letters = 'DEFGHIJKLMNOPQRSTUVWXYZC'.split('');
  for (const l of letters) {
    const p = join(`${l}:\\`, VAULT_REL);
    if (existsSync(join(p, MARKER))) { VAULT = p; return VAULT; }
  }
  throw new Error('Vault not found. Is the SILVER drive mounted? Set MYOS_VAULT to override.');
}

export function vaultPath(rel) {
  return join(locateVault(), rel.replace(/\//g, '\\'));
}

function read(rel) {
  return readFileSync(vaultPath(rel), 'utf8');
}
function write(rel, content) {
  const full = vaultPath(rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}
function exists(rel) {
  return existsSync(vaultPath(rel));
}

// ---- schema ---------------------------------------------------------------
export function getSchema() {
  return JSON.parse(read('x/myos.schema.json'));
}

// ---- CSV helpers (append-only + in-place edit) ----------------------------
function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
  if (!lines.length) return { header: [], rows: [] };
  const header = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const cells = splitCsvLine(l);
    const o = {};
    header.forEach((h, i) => { o[h] = cells[i] ?? ''; });
    return o;
  });
  return { header, rows };
}
function splitCsvLine(line) {
  const out = [];
  let cur = '', inq = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inq) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inq = false;
      else cur += c;
    } else if (c === '"') inq = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvLine(header, obj) {
  return header.map((h) => csvCell(obj[h])).join(',');
}
function ensureTrailingNewline(s) {
  return s.endsWith('\n') ? s : s + '\n';
}

function appendCsvRow(rel, obj) {
  const text = exists(rel) ? read(rel) : '';
  if (!text.trim()) throw new Error(`CSV ${rel} has no header`);
  const { header } = parseCsv(text);
  write(rel, ensureTrailingNewline(text) + csvLine(header, obj) + '\n');
}

// ---- dates ----------------------------------------------------------------
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Local wall-clock timestamp, second precision. This is the ledger ordering key:
// a new row stamped now sorts after every migrated/prior row, so a fresh
// transaction always drifts the live balance forward in real time.
function nowTs() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function fmtTemplateDate(iso, pattern) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const MON = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return pattern
    .replace('dddd', DOW[date.getDay()])
    .replace('MMMM', MON[date.getMonth()])
    .replace('YYYY', String(y))
    .replace('MM', String(m).padStart(2, '0'))
    .replace('DD', String(d).padStart(2, '0'))
    .replace('D', String(d));
}

// ---- daily note -----------------------------------------------------------
function dailyRel(iso, schema) {
  return schema.dailyNote.path.replace('{date}', iso);
}

function createDailyFromTemplate(iso, schema) {
  const tpl = read(schema.dailyNote.templatePath);
  const filled = tpl
    .replace(/\{\{date:([^}]+)\}\}/g, (_, p) => fmtTemplateDate(iso, p));
  write(dailyRel(iso, schema), filled);
}

export function getDaily(iso, schema) {
  const rel = dailyRel(iso, schema);
  if (!exists(rel)) return { date: iso, exists: false, frontmatter: {}, habits: {}, log: [] };
  const raw = read(rel);
  const fm = matter(raw);
  const habits = {};
  for (const cb of schema.dailyNote.checkboxes) {
    const re = new RegExp(`- \\[( |x|X)\\]\\s+${escapeRe(cb.label)}\\b`);
    const mm = raw.match(re);
    habits[cb.habitKey] = mm ? mm[1].toLowerCase() === 'x' : false;
  }
  return { date: iso, exists: true, frontmatter: fm.data, habits, log: parseLog(raw, schema) };
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Surgical frontmatter edit — replace each field's value in place without a
// YAML round-trip. gray-matter/js-yaml reformats dates to ISO, empties to
// literal "null", and folds long strings, all of which break the vault's
// Meta Bind inline inputs. This preserves the exact on-disk style.
function fmScalar(v) {
  if (v === '' || v === null || v === undefined) return '';
  return ` ${String(v)}`;
}

export function setDailyFields(iso, fields, schema) {
  const rel = dailyRel(iso, schema);
  if (!exists(rel)) createDailyFromTemplate(iso, schema);
  let raw = read(rel);
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) {
    // no frontmatter block — prepend one
    const lines = Object.entries(fields).map(([k, v]) => `${k}:${fmScalar(v)}`);
    raw = `---\n${lines.join('\n')}\n---\n\n${raw}`;
    write(rel, raw);
    return getDaily(iso, schema);
  }
  let block = fmMatch[1];
  for (const [k, v] of Object.entries(fields)) {
    const line = `${k}:${fmScalar(v)}`;
    const keyRe = new RegExp(`^${escapeRe(k)}:.*$`, 'm');
    if (keyRe.test(block)) block = block.replace(keyRe, line);
    else block = `${block}\n${line}`;
  }
  raw = raw.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${block}\n---`);
  write(rel, raw);
  return getDaily(iso, schema);
}

export function setHabit(iso, habitKey, checked, schema) {
  const rel = dailyRel(iso, schema);
  if (!exists(rel)) createDailyFromTemplate(iso, schema);
  const cb = schema.dailyNote.checkboxes.find((c) => c.habitKey === habitKey);
  if (!cb) throw new Error(`Unknown habit ${habitKey}`);
  let raw = read(rel);
  const re = new RegExp(`(- \\[)( |x|X)(\\]\\s+${escapeRe(cb.label)}\\b)`);
  if (re.test(raw)) {
    raw = raw.replace(re, `$1${checked ? 'x' : ' '}$3`);
  } else {
    // checkbox line missing; append under the habits section
    const sec = schema.dailyNote.habitsSection;
    const idx = raw.indexOf(sec);
    const line = `- [${checked ? 'x' : ' '}] ${cb.label}\n`;
    if (idx >= 0) {
      const insertAt = raw.indexOf('\n', idx) + 1;
      raw = raw.slice(0, insertAt) + line + raw.slice(insertAt);
    } else {
      raw += `\n${sec}\n${line}`;
    }
  }
  write(rel, raw);
  return getDaily(iso, schema);
}

export function bumpCounter(iso, field, delta, schema) {
  const cur = getDaily(iso, schema);
  const now = Number(cur.frontmatter?.[field] ?? 0) || 0;
  const next = Math.max(0, now + delta);
  return setDailyFields(iso, { [field]: next }, schema);
}

// ---- Log section (timestamped brain dump) --------------------------------
function logHeading(schema) {
  return schema.dailyNote.logSection || '## Log';
}
function hhmm() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Locate the Log section body as a [start, end) line range (exclusive of the
// heading line itself; end is the next "## " heading or EOF).
function logSectionRange(lines, heading) {
  const hIdx = lines.findIndex((l) => l.trim() === heading);
  if (hIdx === -1) return null;
  let end = lines.length;
  for (let i = hIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  return { hIdx, end };
}

function parseLog(raw, schema) {
  const lines = raw.split('\n');
  const range = logSectionRange(lines, logHeading(schema));
  if (!range) return [];
  const out = [];
  for (const l of lines.slice(range.hIdx + 1, range.end)) {
    const t = l.trim();
    if (!t || t === '-') continue;
    const m = t.match(/^-\s+(?:\*\*(\d{1,2}:\d{2})\*\*\s+)?(.*)$/);
    if (m && m[2]) out.push({ time: m[1] || '', text: m[2] });
  }
  return out;
}

// Append one timestamped bullet under the Log section. Multi-line input is
// collapsed to a single clean bullet. Replaces the empty "-" placeholder on
// the first entry; otherwise adds a new bullet after the last one.
export function appendLog(iso, text, schema) {
  const rel = dailyRel(iso, schema);
  if (!exists(rel)) createDailyFromTemplate(iso, schema);
  let raw = read(rel);
  const heading = logHeading(schema);
  const entry = `- **${hhmm()}** ${String(text).replace(/\s*\n\s*/g, ' ').trim()}`;

  const lines = raw.split('\n');
  const range = logSectionRange(lines, heading);
  if (!range) {
    raw = ensureTrailingNewline(raw) + `\n${heading}\n\n${entry}\n`;
    write(rel, raw);
    return getDaily(iso, schema);
  }
  const body = lines.slice(range.hIdx + 1, range.end);
  const content = body.filter((l) => l.trim().length > 0);
  const onlyPlaceholder = content.length === 0 || (content.length === 1 && content[0].trim() === '-');
  let newBody;
  if (onlyPlaceholder) {
    newBody = ['', entry, ''];
  } else {
    let lastContentIdx = -1;
    body.forEach((l, i) => { if (l.trim().length) lastContentIdx = i; });
    newBody = [...body.slice(0, lastContentIdx + 1), entry, ...body.slice(lastContentIdx + 1)];
  }
  const rebuilt = [...lines.slice(0, range.hIdx + 1), ...newBody, ...lines.slice(range.end)];
  write(rel, ensureTrailingNewline(rebuilt.join('\n')));
  return getDaily(iso, schema);
}

// ---- finance --------------------------------------------------------------
function financeRel(schema, key) {
  return `${schema.finance.raw}/${schema.finance.files[key]}`;
}

// One master ledger: every money row (snapshot | txn | forecast) lives in
// ledger.csv, ordered by `ts`. The loaders below split it by type so the rest
// of the finance code reads the same shapes it always did.
function loadLedger(schema) {
  const rel = financeRel(schema, 'ledger');
  if (!exists(rel)) return [];
  return parseCsv(read(rel)).rows.map((r) => ({
    ts: r.ts, date: r.date, type: r.type, account: r.account,
    amount: Number(r.amount), category: r.category, note: r.note,
  }));
}
function loadTransactions(schema) {
  return loadLedger(schema)
    .filter((r) => r.type === 'txn' && r.date && !Number.isNaN(r.amount))
    .map((r) => ({ ts: r.ts, date: r.date, amount: r.amount, category: r.category, note: r.note }));
}
function loadBalances(schema) {
  return loadLedger(schema)
    .filter((r) => r.type === 'snapshot' && r.date && !Number.isNaN(r.amount))
    .map((r) => ({ ts: r.ts, date: r.date, account: r.account, balance: r.amount }));
}
function loadBudgets(schema) {
  const rel = financeRel(schema, 'budgets');
  if (!exists(rel)) return {};
  const out = {};
  for (const r of parseCsv(read(rel)).rows) {
    const m = Number(r.monthly);
    if (r.category && !Number.isNaN(m)) out[r.category] = m;
  }
  return out;
}
function loadDebts(schema) {
  const rel = financeRel(schema, 'debts');
  if (!exists(rel)) return [];
  return parseCsv(read(rel)).rows.map((r) => ({
    creditor: r.creditor, principal: Number(r.principal), target: Number(r.target_monthly ?? 0), note: r.note,
  })).filter((r) => r.creditor && !Number.isNaN(r.principal));
}

// Derived live balance = latest snapshot total + sum of transactions with `ts`
// strictly after that snapshot. Ordering is by ts, not date, so a transaction
// logged the same day as (but after) a snapshot still drifts the balance —
// this is what makes the balance update in real time. Forecasts never count.
export function derivedBalance(schema) {
  const bals = loadBalances(schema);
  const txs = loadTransactions(schema);
  if (!bals.length) {
    return Math.round(txs.reduce((s, t) => s + t.amount, 0) * 100) / 100;
  }
  const latest = bals.reduce((a, b) => (a.ts > b.ts ? a : b));
  const after = txs.filter((t) => t.ts > latest.ts).reduce((s, t) => s + t.amount, 0);
  return Math.round((latest.balance + after) * 100) / 100;
}

function writeBankedToLondonFund(schema, banked) {
  const rel = schema.finance.londonFund;
  if (!exists(rel)) return;
  let raw = read(rel);
  const v = banked.toFixed(2);
  // Anchor to line start so a key like `subfloor::` can't be mis-matched, and
  // allow a negative value so a negative balance actually writes. Surgical
  // single-line replace; floor::/full::/deadline:: are never touched.
  const re = /^banked::.*$/m;
  if (re.test(raw)) {
    raw = raw.replace(re, `banked:: ${v}`);
    write(rel, raw);
  }
}

export function financeSummary(schema) {
  const txs = loadTransactions(schema);
  const budgets = loadBudgets(schema);
  const debts = loadDebts(schema);
  const banked = derivedBalance(schema);
  const monthKey = todayIso().slice(0, 7);
  const monthTx = txs.filter((t) => t.date.startsWith(monthKey));
  const monthIn = monthTx.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const monthOut = -monthTx.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
  const byCategory = {};
  for (const t of monthTx) if (t.amount < 0) byCategory[t.category] = (byCategory[t.category] ?? 0) - t.amount;

  const debtTx = txs.filter((t) => t.category === 'debt');
  const debtView = debts.map((d) => {
    const named = debtTx.filter((t) => (t.note || '').toLowerCase().includes(d.creditor.toLowerCase()));
    const mine = named.length ? named : (debts.length === 1 ? debtTx : []);
    const paid = -mine.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    const monthPaid = -mine.filter((t) => t.amount < 0 && t.date.startsWith(monthKey)).reduce((s, t) => s + t.amount, 0);
    return { ...d, paid, remaining: Math.max(0, d.principal - paid), monthPaid };
  });

  let london = null;
  const lf = schema.finance.londonFund;
  if (exists(lf)) {
    const raw = read(lf);
    const inline = (key) => {
      const m = raw.match(new RegExp(`^${escapeRe(key)}::\\s*(-?[\\d.]+)`, 'm'));
      return m ? Number(m[1]) : NaN;
    };
    const floor = inline('floor');
    const full = inline('full');
    london = {
      banked, floor: Number.isNaN(floor) ? null : floor, full: Number.isNaN(full) ? null : full,
      gapFloor: Number.isNaN(floor) ? null : Math.round((floor - banked) * 100) / 100,
    };
  }

  return {
    banked, monthKey, monthIn: round2(monthIn), monthOut: round2(monthOut),
    net: round2(monthIn - monthOut), byCategory, budgets, debts: debtView, london,
    recent: [...txs].sort((a, b) => ((a.ts || a.date) < (b.ts || b.date) ? -1 : 1)).slice(-8).reverse(),
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

export function addTransaction(schema, { date, amount, category, note }) {
  const row = {
    ts: nowTs(), date: date || todayIso(), type: 'txn', account: schema.finance.account,
    amount: Number(amount).toFixed(2), category, note: note || '',
  };
  appendCsvRow(financeRel(schema, 'ledger'), row);
  const banked = derivedBalance(schema);
  writeBankedToLondonFund(schema, banked);
  return financeSummary(schema);
}

export function addSnapshot(schema, { date, total, parts }) {
  // total is the new balance for account `main`. parts is an optional breakdown note (e.g. bank+cash).
  const row = {
    ts: nowTs(), date: date || todayIso(), type: 'snapshot', account: schema.finance.account,
    amount: Number(total).toFixed(2), category: '', note: parts || '',
  };
  appendCsvRow(financeRel(schema, 'ledger'), row);
  const banked = derivedBalance(schema);
  writeBankedToLondonFund(schema, banked);
  return { ...financeSummary(schema), snapshotNote: parts || '' };
}

// ---- habits.csv streaks ---------------------------------------------------
function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function habitStreaks(schema) {
  const keys = schema.dailyNote.checkboxes.map((c) => c.habitKey);
  const rel = schema.habits.csv;
  const empty = { streaks: {}, last7: {}, smokedRecent: [], days: [] };
  if (!exists(rel)) return empty;
  const rows = parseCsv(read(rel)).rows.filter((r) => r.date);
  const byDate = {};
  for (const r of rows) byDate[r.date] = r;
  const truthy = (v) => v === '1' || v === 'true' || v === 'x' || v === 'yes' || v === 'TRUE';

  // Streak = consecutive calendar days (anchored to today) the habit was done.
  // If today's row hasn't been rolled in yet (habits close at end of day),
  // anchor at yesterday so an unclosed today doesn't zero the streak.
  const today = isoDaysAgo(0);
  const hasToday = !!byDate[today];
  const streaks = {};
  for (const k of keys) {
    let s = 0;
    for (let i = hasToday ? 0 : 1; ; i++) {
      const row = byDate[isoDaysAgo(i)];
      if (row && truthy(row[k])) s++; else break;
    }
    streaks[k] = s;
  }

  // Last-7 dots over the 7 calendar days ending today (oldest first), so a
  // missing day reads as a miss rather than shifting the window.
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(isoDaysAgo(i));
  const last7 = {};
  for (const k of keys) last7[k] = days.map((d) => !!(byDate[d] && truthy(byDate[d][k])));
  const smokedRecent = days.map((d) => ({ date: d, smoked: Number(byDate[d]?.smoked) || 0 }));
  return { streaks, last7, smokedRecent, days };
}

// ---- calendar events ------------------------------------------------------
export function listEvents(schema, from, to) {
  const rel = schema.calendar.csv;
  if (!exists(rel)) return [];
  const rows = parseCsv(read(rel)).rows.filter((r) => r.id);
  return rows.filter((e) => {
    if (from && e.end < from) return false;
    if (to && e.start > to) return false;
    return true;
  }).map((e) => ({ ...e, allday: e.allday === '1' || e.allday === 'true' }));
}

function writeAllEvents(schema, events) {
  const { columns } = schema.calendar;
  const header = columns.join(',');
  const body = events.map((e) => csvLine(columns, {
    ...e, allday: e.allday ? '1' : '',
  })).join('\n');
  write(schema.calendar.csv, header + '\n' + (body ? body + '\n' : ''));
}

export function upsertEvent(schema, ev) {
  const rel = schema.calendar.csv;
  const rows = exists(rel) ? parseCsv(read(rel)).rows.filter((r) => r.id) : [];
  const id = ev.id || `e${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const clean = {
    id,
    start: ev.start || '',
    end: ev.end || '',
    title: ev.title || '',
    category: ev.category || 'personal',
    location: ev.location || '',
    notes: ev.notes || '',
    allday: ev.allday ? '1' : '',
  };
  const idx = rows.findIndex((r) => r.id === id);
  if (idx >= 0) rows[idx] = clean; else rows.push(clean);
  writeAllEvents(schema, rows);
  return { ...clean, allday: !!ev.allday };
}

export function deleteEvent(schema, id) {
  const rel = schema.calendar.csv;
  if (!exists(rel)) return { ok: true };
  const rows = parseCsv(read(rel)).rows.filter((r) => r.id && r.id !== id);
  writeAllEvents(schema, rows);
  return { ok: true };
}

// ---- inbox capture --------------------------------------------------------
export function captureInbox(schema, text) {
  const stamp = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const name = `Capture ${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.md`;
  const rel = `${schema.inbox.path}/${name}`;
  const iso = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}`;
  write(rel, `---\ncreated: ${iso}\nsource: myOS\n---\n\n${text}\n`);
  return { ok: true, path: rel };
}
