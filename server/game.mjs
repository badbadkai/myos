// myOS gamification engine — the "Solo Leveling" layer.
//
// Design: stats are DERIVED live from data the Hub already holds (daily-note
// steps + log lines + habit checkboxes, habits.csv, the trading raw log, and
// the total note count). Nothing here is a separate running tally that can
// drift — recompute any time and it is correct, exactly like the finance
// derived-balance model. The only myOS-native input is the daily workout quest
// (quests.csv); xp.csv is an optional append-only log for manual one-off
// awards. On every compute we write state.json, which the Obsidian dashboard
// renders (the dashboard never recomputes — it mirrors the snapshot).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  locateVault, vaultPath, readVaultFile, writeVaultFile, vaultExists, parseVaultCsv,
} from './vault.mjs';

// ---- timezone-aware clock -------------------------------------------------
export function ymdInTz(tz, d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
export function hmInTz(tz, d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('hour')}:${g('minute')}`;
}

// ---- settings (timezone) --------------------------------------------------
export function readSettings(schema) {
  const raw = readVaultFile(schema.system.settings);
  let s = {};
  try { s = raw ? JSON.parse(raw) : {}; } catch { s = {}; }
  return { timezone: s.timezone || schema.system.defaultTimezone };
}
export function writeSettings(schema, patch) {
  const cur = readSettings(schema);
  const next = { ...cur, ...patch };
  if (patch.timezone && !schema.system.timezones.includes(patch.timezone)) {
    const e = new Error('unsupported timezone'); e.status = 400; throw e;
  }
  writeVaultFile(schema.system.settings, JSON.stringify(next, null, 2) + '\n');
  return next;
}

// ---- tiny frontmatter reader (regex, no YAML round-trip) ------------------
function fmBlock(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : '';
}
function fmVal(block, key) {
  const m = block.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}
function truthy(v) { const s = String(v).toLowerCase(); return s === '1' || s === 'true' || s === 'x' || s === 'yes'; }

// ---- note count (for INT), lightly cached ---------------------------------
let _noteCache = { n: 0, at: 0 };
function countNotes() {
  if (Date.now() - _noteCache.at < 30000) return _noteCache.n;
  const root = locateVault();
  let n = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.md')) n++;
    }
  };
  walk(root);
  _noteCache = { n, at: Date.now() };
  return n;
}

// ---- per-day aggregation from daily notes + habits.csv --------------------
function listDir(rel) {
  try { return readdirSync(vaultPath(rel)).filter((f) => f.endsWith('.md')); }
  catch { return []; }
}

// Returns { byDate: { 'YYYY-MM-DD': {steps, logLines, smoked, trained, journaled, meditated, skincare} }, totalLog }
function collectDays(schema) {
  const cbs = schema.dailyNote.checkboxes; // {label, habitKey}
  const byDate = {};
  const ensure = (d) => (byDate[d] ||= { steps: 0, logLines: 0, smoked: null, trained: false, journaled: false, meditated: false, skincare: false });

  // habits.csv is the historical spine.
  const hraw = readVaultFile(schema.habits.csv);
  if (hraw_exists(hraw)) {
    for (const r of parseVaultCsv(hraw).rows) {
      if (!r.date) continue;
      const day = ensure(r.date);
      day.trained = truthy(r.trained); day.journaled = truthy(r.journaled);
      day.meditated = truthy(r.meditated); day.skincare = truthy(r.skincare);
      const sm = Number(r.smoked); day.smoked = Number.isFinite(sm) ? sm : day.smoked;
    }
  }

  // Daily notes are authoritative for the day they exist (covers today + any
  // day not yet rolled into habits.csv), and are the only source for steps/log.
  let totalLog = 0;
  const dir = schema.system.dailyNotesDir;
  for (const f of listDir(dir)) {
    const iso = f.replace(/\.md$/, '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    const raw = readVaultFile(`${dir}/${f}`);
    if (!raw) continue;
    const day = ensure(iso);
    const block = fmBlock(raw);
    const steps = Number(fmVal(block, 'steps')); if (Number.isFinite(steps)) day.steps = steps;
    const sm = Number(fmVal(block, 'smoked')); if (Number.isFinite(sm) && fmVal(block, 'smoked') !== '') day.smoked = sm;
    for (const cb of cbs) {
      const re = new RegExp(`- \\[( |x|X)\\]\\s+${cb.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      const mm = raw.match(re);
      if (mm) day[cb.habitKey] = mm[1].toLowerCase() === 'x';
    }
    const logs = raw.match(/^-\s+\*\*\d{1,2}:\d{2}\*\*/gm);
    if (logs) { day.logLines = logs.length; totalLog += logs.length; }
  }
  return { byDate, totalLog };
}

function hraw_exists(v) { return typeof v === 'string' && v.trim().length > 0; }

// ---- trading discipline ---------------------------------------------------
// Group the raw log by day: trade count, distinct assets, clean (all planned),
// and rule-breaks (planned explicitly false).
function collectTrading(schema) {
  const dir = schema.system.tradingLog;
  const byDate = {};
  for (const f of listDir(dir)) {
    const raw = readVaultFile(`${dir}/${f}`);
    if (!raw) continue;
    const block = fmBlock(raw);
    const date = fmVal(block, 'date'); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const asset = fmVal(block, 'asset');
    const planned = fmVal(block, 'planned').toLowerCase();
    const d = (byDate[date] ||= { trades: 0, assets: new Set(), plannedTrue: 0, plannedFalse: 0 });
    d.trades++; if (asset) d.assets.add(asset);
    if (planned === 'true') d.plannedTrue++;
    else if (planned === 'false') d.plannedFalse++;
  }
  return byDate;
}

// ---- quests ---------------------------------------------------------------
function readQuests(schema) {
  const raw = readVaultFile(schema.system.quests);
  const rows = hraw_exists(raw) ? parseVaultCsv(raw).rows : [];
  const byDate = {};
  for (const r of rows) if (r.date) byDate[r.date] = {
    date: r.date,
    pushups: truthy(r.pushups) ? 1 : 0,
    situps: truthy(r.situps) ? 1 : 0,
    running: truthy(r.running) ? 1 : 0,
    submitted: truthy(r.submitted) ? 1 : 0,
    ts: r.ts || '',
  };
  return byDate;
}
function writeQuests(schema, byDate) {
  const cols = schema.system.questColumns;
  const dates = Object.keys(byDate).sort();
  const body = dates.map((d) => {
    const q = byDate[d];
    return [q.date, q.pushups, q.situps, q.running, q.submitted, q.ts].join(',');
  });
  writeVaultFile(schema.system.quests, cols.join(',') + '\n' + (body.length ? body.join('\n') + '\n' : ''));
}

// Save the checkbox state for a day without finalizing (submitted stays 0).
export function saveQuest(schema, { date, pushups, situps, running }) {
  const { timezone } = readSettings(schema);
  const day = date || ymdInTz(timezone);
  const byDate = readQuests(schema);
  const prev = byDate[day] || {};
  byDate[day] = {
    date: day,
    pushups: pushups != null ? (pushups ? 1 : 0) : (prev.pushups || 0),
    situps: situps != null ? (situps ? 1 : 0) : (prev.situps || 0),
    running: running != null ? (running ? 1 : 0) : (prev.running || 0),
    submitted: prev.submitted || 0,
    ts: new Date().toISOString(),
  };
  writeQuests(schema, byDate);
  return computeGameState(schema);
}

// Explicit submit: lock the day's checkboxes in and award.
export function submitQuest(schema, { date, pushups, situps, running }) {
  const { timezone } = readSettings(schema);
  const day = date || ymdInTz(timezone);
  const byDate = readQuests(schema);
  const prev = byDate[day] || {};
  byDate[day] = {
    date: day,
    pushups: pushups != null ? (pushups ? 1 : 0) : (prev.pushups || 0),
    situps: situps != null ? (situps ? 1 : 0) : (prev.situps || 0),
    running: running != null ? (running ? 1 : 0) : (prev.running || 0),
    submitted: 1,
    ts: new Date().toISOString(),
  };
  writeQuests(schema, byDate);
  return computeGameState(schema);
}

// Auto-finalize: any pending day that is in the past, or is today past the
// 23:55 cutoff (in the selected timezone), gets locked in with whatever was
// checked. Called lazily on each state read and by the bridge's minute timer,
// so it fires whether or not the laptop was awake at 23:55.
export function autoFinalizeQuests(schema) {
  const { timezone } = readSettings(schema);
  const today = ymdInTz(timezone);
  const nowHm = hmInTz(timezone);
  const cutoff = schema.system.questAutoSubmit || '23:55';
  const byDate = readQuests(schema);
  let changed = false;
  for (const d of Object.keys(byDate)) {
    const q = byDate[d];
    if (q.submitted) continue;
    const pastDay = d < today;
    const dueToday = d === today && nowHm >= cutoff;
    if (pastDay || dueToday) { q.submitted = 1; q.ts = new Date().toISOString(); changed = true; }
  }
  if (changed) writeQuests(schema, byDate);
  return changed;
}

// ---- manual xp events -----------------------------------------------------
function readXp(schema) {
  const raw = readVaultFile(schema.system.xp);
  return hraw_exists(raw) ? parseVaultCsv(raw).rows.filter((r) => r.stat) : [];
}

// ---- level curves ---------------------------------------------------------
// Per-stat: points to *reach* level L (from 1) = statStep * L(L-1)/2. With
// statStep=8 that is 4*L*(L-1): L2=8, L3=24, L4=48 cumulative. Flatter curve.
function statLevel(points, step) {
  const cum = (L) => step * L * (L - 1) / 2;
  if (points <= 0) return { level: 1, into: Math.max(0, points), need: step };
  let L = 1;
  while (cum(L + 1) <= points) L++;
  return { level: L, into: points - cum(L), need: step * L };
}
// Character: EXP to reach level L = charBase * Σ_{k=1}^{L-1} k^charExp.
function charLevel(exp, base, expo) {
  let L = 1, cum = 0, step = base * Math.pow(1, expo);
  while (cum + step <= exp) { cum += step; L++; step = base * Math.pow(L, expo); }
  return { level: L, into: Math.round(exp - cum), need: Math.round(step), total: Math.round(exp) };
}

// ---- the compute ----------------------------------------------------------
export function computeGameState(schema) {
  autoFinalizeQuests(schema);
  const P = schema.system.points;
  const E = schema.system.exp;
  const { byDate: days, totalLog } = collectDays(schema);
  const trading = collectTrading(schema);
  const quests = readQuests(schema);
  const noteCount = countNotes();
  const xp = readXp(schema);

  const dayList = Object.values(days);

  // ---- STR ----
  const strSteps = dayList.reduce((s, d) => s + Math.floor((d.steps || 0) / P.stepsPer), 0);
  const strTrained = dayList.filter((d) => d.trained).length * P.trainedStr;
  const submittedQuests = Object.values(quests).filter((q) => q.submitted);
  const questBoxes = submittedQuests.reduce((s, q) => s + q.pushups + q.situps + q.running, 0);
  const strQuest = questBoxes * P.questBox;

  // ---- INT ----
  const intNotes = Math.floor(noteCount / P.intPerNotes);
  const intLog = totalLog * P.intPerLog;

  // ---- DSC (harsh) ----
  const dscHabits = dayList.reduce((s, d) => s + (d.trained ? 1 : 0) + (d.journaled ? 1 : 0) + (d.skincare ? 1 : 0), 0) * P.dscHabit;
  const dscNoSmoke = dayList.filter((d) => d.smoked === 0).length * P.dscNoSmoke;
  const tradingDays = Object.entries(trading).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const cleanDays = tradingDays.filter(([, t]) => t.trades > 0 && t.plannedFalse === 0 && t.plannedTrue === t.trades);
  const dscClean = cleanDays.length * P.dscCleanDay;
  // current consecutive clean-day streak among trading days
  let streak = 0;
  for (let i = tradingDays.length - 1; i >= 0; i--) {
    const [, t] = tradingDays[i];
    if (t.trades > 0 && t.plannedFalse === 0 && t.plannedTrue === t.trades) streak++; else break;
  }
  const dscStreak = streak >= 3 ? Math.min(streak - 2, P.dscStreakCap) : 0;
  const ruleBreaks = tradingDays.reduce((s, [, t]) => s + t.plannedFalse, 0);
  const dscPenalty = ruleBreaks * P.dscRuleBreak; // negative

  // ---- FOC ----
  const focMed = dayList.filter((d) => d.meditated).length * P.focMeditate;
  const focNoOver = tradingDays.filter(([, t]) => t.trades > 0 && t.trades <= P.overtradeCap).length * P.focNoOvertrade;
  const focSingle = tradingDays.filter(([, t]) => t.assets.size === 1).length * P.focSingleAsset;

  // ---- manual xp events fold into their stat ----
  const evPts = { STR: 0, INT: 0, DSC: 0, FOC: 0 };
  for (const r of xp) { const p = Number(r.points); if (Number.isFinite(p) && evPts[r.stat] != null) evPts[r.stat] += p; }

  const raw = {
    STR: strSteps + strTrained + strQuest + evPts.STR,
    INT: intNotes + intLog + evPts.INT,
    DSC: dscHabits + dscNoSmoke + dscClean + dscStreak + dscPenalty + evPts.DSC,
    FOC: focMed + focNoOver + focSingle + evPts.FOC,
  };

  const stats = {};
  for (const k of schema.system.stats) {
    const pts = raw[k];
    stats[k] = { points: pts, ...statLevel(pts, schema.system.statStep) };
  }

  // ---- character EXP ----
  const statPointsTotal = Math.max(0, raw.STR + raw.INT + raw.DSC + raw.FOC);
  const habitSweepDays = dayList.filter((d) => d.trained && d.journaled && d.meditated && d.skincare).length;
  const meditateDays = dayList.filter((d) => d.meditated).length;
  const questExp = submittedQuests.reduce((s, q) => {
    const boxes = q.pushups + q.situps + q.running;
    return s + (boxes === 3 ? E.questFull : boxes >= 1 ? E.questPartial : 0);
  }, 0);
  const exp =
    statPointsTotal * E.perStatPoint +
    questExp +
    cleanDays.length * E.cleanDay +
    totalLog * E.logLine +
    habitSweepDays * E.habitSweep +
    meditateDays * E.meditate;
  const character = charLevel(exp, schema.system.charBase, schema.system.charExp);

  const { timezone } = readSettings(schema);
  const today = ymdInTz(timezone);
  const todayQuest = quests[today] || { date: today, pushups: 0, situps: 0, running: 0, submitted: 0 };

  const state = {
    generatedAt: new Date().toISOString(),
    timezone,
    today,
    character,
    stats,
    breakdown: {
      STR: { steps: strSteps, trained: strTrained, quest: strQuest },
      INT: { notes: intNotes, noteCount, log: intLog, logLines: totalLog },
      DSC: { habits: dscHabits, noSmoke: dscNoSmoke, cleanDays: dscClean, streak: dscStreak, penalty: dscPenalty, ruleBreaks },
      FOC: { meditate: focMed, noOvertrade: focNoOver, singleAsset: focSingle },
    },
    quest: todayQuest,
  };
  writeVaultFile(schema.system.state, JSON.stringify(state, null, 2) + '\n');
  return state;
}
