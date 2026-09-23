import type { Schema, Daily, FinanceSummary, Streaks, CalEvent, GameState, AppSettings } from './types';

// In dev and the localhost bridge build this is '' so calls hit the same
// origin (Vite proxies /api, or the bridge serves the app). In the Pages build
// it's the absolute bridge URL, since the static site can't proxy.
const API_BASE = __BRIDGE_BASE__;
const TOKEN_KEY = 'myos.token';

export const auth = {
  get: () => localStorage.getItem(TOKEN_KEY) || '',
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

// Thrown on a 401 so the app can drop to the login screen.
export class AuthError extends Error {}

// A slow or dead bridge should fail fast to the offline screen rather than
// hang the whole app on a pending fetch.
const TIMEOUT_MS = 8000;

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = auth.get();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...opts,
      signal: ctrl.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Connection timed out.');
    throw new Error('Can\'t connect right now.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) {
    auth.clear();
    throw new AuthError('Session expired — please sign in again.');
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch { /* noop */ }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  // The live online probe: never served from the SW cache, so "offline" means
  // the bridge is genuinely unreachable rather than just slow.
  health: () => req<{ ok: boolean; vault: string; today: string }>('/health', { cache: 'no-store' }),
  login: async (email: string, password: string) => {
    const r = await req<{ token: string; email: string }>('/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    });
    auth.set(r.token);
    return r;
  },
  me: () => req<{ email: string; exp: number }>('/me'),
  logout: () => auth.clear(),
  schema: () => req<Schema>('/schema'),

  today: (date?: string) => req<Daily>(`/today${date ? `?date=${date}` : ''}`),
  setFields: (date: string, fields: Record<string, unknown>) =>
    req<Daily>('/daily/fields', { method: 'POST', body: JSON.stringify({ date, fields }) }),
  setHabit: (date: string, habitKey: string, checked: boolean) =>
    req<Daily>('/daily/habit', { method: 'POST', body: JSON.stringify({ date, habitKey, checked }) }),
  bumpCounter: (date: string, field: string, delta: number) =>
    req<Daily>('/daily/counter', { method: 'POST', body: JSON.stringify({ date, field, delta }) }),
  addLog: (date: string, text: string) =>
    req<Daily>('/daily/log', { method: 'POST', body: JSON.stringify({ date, text }) }),

  finance: () => req<FinanceSummary>('/finance/summary'),
  addTransaction: (tx: { date?: string; amount: number; category: string; note?: string }) =>
    req<FinanceSummary>('/finance/transaction', { method: 'POST', body: JSON.stringify(tx) }),
  addSnapshot: (s: { date?: string; total: number; parts?: string }) =>
    req<FinanceSummary>('/finance/snapshot', { method: 'POST', body: JSON.stringify(s) }),

  streaks: () => req<Streaks>('/habits/streaks'),

  events: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const qs = q.toString();
    return req<CalEvent[]>(`/calendar/events${qs ? `?${qs}` : ''}`);
  },
  upsertEvent: (ev: Partial<CalEvent>) =>
    req<CalEvent>('/calendar/events', { method: 'POST', body: JSON.stringify(ev) }),
  deleteEvent: (id: string) =>
    req<{ ok: boolean }>(`/calendar/events/${id}`, { method: 'DELETE' }),

  inbox: (text: string) =>
    req<{ ok: boolean; path: string }>('/inbox', { method: 'POST', body: JSON.stringify({ text }) }),

  systemState: () => req<GameState>('/system/state'),
  quest: (q: { date?: string; pushups?: boolean; situps?: boolean; running?: boolean; submit?: boolean }) =>
    req<GameState>('/system/quest', { method: 'POST', body: JSON.stringify(q) }),

  getSettings: () => req<AppSettings>('/settings'),
  setTimezone: (timezone: string) =>
    req<AppSettings>('/settings', { method: 'PUT', body: JSON.stringify({ timezone }) }),
};

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
