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
  if (!exists(rel)) return { date: iso, exists: false, frontmatter: {}, habits: {} };
  const raw = read(rel);
  const fm = matter(raw);
  const habits = {};
  for (const cb of schema.dailyNote.checkboxes) {
    const re = new RegExp(`- \\[( |x|X)\\]\\s+${escapeRe(cb.label)}\\b`);
    const mm = raw.match(re);
    habits[cb.habitKey] = mm ? mm[1].toLowerCase() === 'x' : false;
  }
  return { date: iso, exists: true, frontmatter: fm.data, habits };
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
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
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
  raw = raw.replace(/^---\n[\s\S]*?\n---/, `---\n${block}\n---`);
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

// ---- finance --------------------------------------------------------------
function financeRel(schema, key) {
  return `${schema.finance.raw}/${schema.finance.files[key]}`;
}

function loadTransactions(schema) {
  const rel = financeRel(schema, 'transactions');
  if (!exists(rel)) return [];
  return parseCsv(read(rel)).rows.map((r) => ({
    date: r.date, amount: Number(r.amount), category: r.category, note: r.note,
  })).filter((r) => r.date && !Number.isNaN(r.amount));
}
function loadBalances(schema) {
  const rel = financeRel(schema, 'balances');
  if (!exists(rel)) return [];
  return parseCsv(read(rel)).rows.map((r) => ({
    date: r.date, account: r.account, balance: Number(r.balance),
  })).filter((r) => r.date && !Number.isNaN(r.balance));
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

// Derived live balance = latest snapshot total + sum of transactions dated AFTER that snapshot.
export function derivedBalance(schema) {
  const bals = loadBalances(schema).sort((a, b) => (a.date < b.date ? -1 : 1));
  const txs = loadTransactions(schema);
  if (!bals.length) {
    return txs.reduce((s, t) => s + t.amount, 0);
  }
  const snapDates = [...new Set(bals.map((b) => b.date))].sort();
  const latest = snapDates[snapDates.length - 1];
  const accounts = [...new Set(bals.map((b) => b.account))];
  let snapTotal = 0;
  for (const a of accounts) {
    const rows = bals.filter((b) => b.account === a && b.date <= latest);
    if (rows.length) snapTotal += rows[rows.length - 1].balance;
  }
  const after = txs.filter((t) => t.date > latest).reduce((s, t) => s + t.amount, 0);
  return Math.round((snapTotal + after) * 100) / 100;
}

function writeBankedToLondonFund(schema, banked) {
  const rel = schema.finance.londonFund;
  if (!exists(rel)) return;
  let raw = read(rel);
  const v = banked.toFixed(2);
  if (/banked::\s*[\d.]+/.test(raw)) {
    raw = raw.replace(/banked::\s*[\d.]+/, `banked:: ${v}`);
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
      const m = raw.match(new RegExp(`${key}::\\s*([\\d.]+)`));
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
    recent: txs.slice(-8).reverse(),
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

export function addTransaction(schema, { date, amount, category, note }) {
  const row = { date: date || todayIso(), amount: Number(amount).toFixed(2), category, note: note || '' };
  appendCsvRow(financeRel(schema, 'transactions'), row);
  const banked = derivedBalance(schema);
  writeBankedToLondonFund(schema, banked);
  return financeSummary(schema);
}

export function addSnapshot(schema, { date, total, parts }) {
  // total is the new balance for account `main`. parts is an optional note (e.g. bank+cash breakdown).
  const rel = financeRel(schema, 'balances');
  const d = date || todayIso();
  appendCsvRow(rel, { date: d, account: schema.finance.account, balance: Number(total).toFixed(2) });
  const banked = derivedBalance(schema);
  writeBankedToLondonFund(schema, banked);
  return { ...financeSummary(schema), snapshotNote: parts || '' };
}

// ---- habits.csv streaks ---------------------------------------------------
export function habitStreaks(schema) {
  const rel = schema.habits.csv;
  if (!exists(rel)) return { rows: [], streaks: {}, last7: {} };
  const rows = parseCsv(read(rel)).rows.filter((r) => r.date);
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  const keys = ['trained', 'journaled', 'meditated', 'skincare'];
  const truthy = (v) => v === '1' || v === 'true' || v === 'x' || v === 'yes' || v === 'TRUE';
  const streaks = {};
  for (const k of keys) {
    let s = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (truthy(rows[i][k])) s++; else break;
    }
    streaks[k] = s;
  }
  const last7 = {};
  const recent = rows.slice(-7);
  for (const k of keys) last7[k] = recent.map((r) => truthy(r[k]));
  const smokedRecent = recent.map((r) => ({ date: r.date, smoked: Number(r.smoked) || 0 }));
  return { streaks, last7, smokedRecent, days: recent.map((r) => r.date) };
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
