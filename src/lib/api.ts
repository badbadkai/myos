import type { Schema, Daily, FinanceSummary, Streaks, CalEvent, GameState, AppSettings } from './types';
import { queue } from './queue';

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
// Thrown when the bridge is unreachable — lets callers distinguish a real
// failure from "we're offline right now".
export class OfflineError extends Error {}
// Thrown when a mutating write was parked in the offline queue instead of
// hitting the bridge. Callers show it as an info toast, not an error.
export class QueuedError extends Error {}

// A slow or dead bridge should fail fast to the offline screen rather than
// hang the whole app on a pending fetch.
const TIMEOUT_MS = 8000;

// Low-level fetch. Throws OfflineError on a genuine connection failure (so the
// queue can catch it), AuthError on 401, and a plain Error carrying the
// server's message on any other bad status.
async function send(path: string, opts?: RequestInit): Promise<Response> {
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
    if ((e as Error).name === 'AbortError') throw new OfflineError('Connection timed out.');
    throw new OfflineError('Can\'t connect right now.');
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
  return res;
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  return (await send(path, opts)).json();
}

// A vault write that should survive a connection blip. If the bridge is
// unreachable, the request is parked in the offline queue and a QueuedError is
// thrown so the caller can reassure the user rather than report a failure.
async function write<T>(path: string, opts: RequestInit, label: string): Promise<T> {
  try {
    return await req<T>(path, opts);
  } catch (e) {
    if (e instanceof OfflineError) {
      queue.add(path, opts.method || 'POST', opts.body as string | undefined, label);
      throw new QueuedError(`Offline — saved and will sync when reconnected.`);
    }
    throw e;
  }
}

// Replay parked writes in order. Stops early if we're still offline (leaves the
// rest queued); drops a write that the server rejects with a 4xx (a retry won't
// help). Returns how many synced. Callers trigger this after a health check
// passes and on the browser 'online' event.
export async function flushQueue(): Promise<number> {
  let synced = 0;
  for (const w of queue.list()) {
    try {
      await send(w.path, { method: w.method, body: w.body });
      queue.remove(w.id);
      synced++;
    } catch (e) {
      if (e instanceof OfflineError) break; // still down — try again later
      queue.remove(w.id); // 4xx/401: won't succeed on retry, don't wedge the queue
    }
  }
  return synced;
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
    write<Daily>('/daily/fields', { method: 'POST', body: JSON.stringify({ date, fields }) }, 'Daily fields'),
  setHabit: (date: string, habitKey: string, checked: boolean) =>
    write<Daily>('/daily/habit', { method: 'POST', body: JSON.stringify({ date, habitKey, checked }) }, `Habit ${habitKey}`),
  bumpCounter: (date: string, field: string, delta: number) =>
    write<Daily>('/daily/counter', { method: 'POST', body: JSON.stringify({ date, field, delta }) }, `${field} ${delta > 0 ? '+' : ''}${delta}`),
  addLog: (date: string, text: string) =>
    write<Daily>('/daily/log', { method: 'POST', body: JSON.stringify({ date, text }) }, 'Log entry'),

  finance: () => req<FinanceSummary>('/finance/summary'),
  addTransaction: (tx: { date?: string; amount: number; category: string; note?: string }) =>
    write<FinanceSummary>('/finance/transaction', { method: 'POST', body: JSON.stringify(tx) }, `Transaction ${tx.category}`),
  addSnapshot: (s: { date?: string; total: number; parts?: string }) =>
    write<FinanceSummary>('/finance/snapshot', { method: 'POST', body: JSON.stringify(s) }, 'Balance snapshot'),

  streaks: () => req<Streaks>('/habits/streaks'),

  events: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const qs = q.toString();
    return req<CalEvent[]>(`/calendar/events${qs ? `?${qs}` : ''}`);
  },
  upsertEvent: (ev: Partial<CalEvent>) =>
    write<CalEvent>('/calendar/events', { method: 'POST', body: JSON.stringify(ev) }, `Event ${ev.title || ''}`.trim()),
  deleteEvent: (id: string) =>
    write<{ ok: boolean }>(`/calendar/events/${id}`, { method: 'DELETE' }, 'Delete event'),

  inbox: (text: string) =>
    write<{ ok: boolean; path: string }>('/inbox', { method: 'POST', body: JSON.stringify({ text }) }, 'Inbox capture'),

  systemState: () => req<GameState>('/system/state'),
  quest: (q: { date?: string; pushups?: boolean; situps?: boolean; running?: boolean; submit?: boolean }) =>
    write<GameState>('/system/quest', { method: 'POST', body: JSON.stringify(q) }, 'Workout quest'),

  getSettings: () => req<AppSettings>('/settings'),
  setTimezone: (timezone: string) =>
    write<AppSettings>('/settings', { method: 'PUT', body: JSON.stringify({ timezone }) }, 'Timezone'),
};

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
