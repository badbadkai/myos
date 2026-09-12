import type { Schema, Daily, FinanceSummary, Streaks, CalEvent } from './types';

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch { /* noop */ }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  health: () => req<{ ok: boolean; vault: string; today: string }>('/health'),
  schema: () => req<Schema>('/schema'),

  today: (date?: string) => req<Daily>(`/today${date ? `?date=${date}` : ''}`),
  setFields: (date: string, fields: Record<string, unknown>) =>
    req<Daily>('/daily/fields', { method: 'POST', body: JSON.stringify({ date, fields }) }),
  setHabit: (date: string, habitKey: string, checked: boolean) =>
    req<Daily>('/daily/habit', { method: 'POST', body: JSON.stringify({ date, habitKey, checked }) }),
  bumpCounter: (date: string, field: string, delta: number) =>
    req<Daily>('/daily/counter', { method: 'POST', body: JSON.stringify({ date, field, delta }) }),

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
};

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
