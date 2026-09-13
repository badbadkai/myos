import { useEffect, useState, useCallback, useRef } from 'react';
import { api, todayIso } from '../lib/api';
import type { Schema, Daily, LogEntry } from '../lib/types';
import { useToast } from '../lib/ui';

export default function Today({ schema }: { schema: Schema }) {
  const toast = useToast();
  const [date, setDate] = useState(todayIso());
  const [daily, setDaily] = useState<Daily | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reqId = useRef(0);

  const load = useCallback(async (d: string) => {
    const id = ++reqId.current;
    setLoading(true); setError('');
    try {
      const res = await api.today(d);
      if (id !== reqId.current) return; // a newer date-nav superseded this load
      setDaily(res);
      const dr: Record<string, string> = {};
      for (const f of schema.dailyNote.frontmatter) {
        const v = res.frontmatter[f.key];
        dr[f.key] = v === null || v === undefined ? '' : String(v);
      }
      setDraft(dr);
    } catch (e) {
      if (id !== reqId.current) return;
      setError((e as Error).message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [schema]);

  useEffect(() => { load(date); }, [date, load]);

  const fm = schema.dailyNote.frontmatter;
  const reflection = fm.filter((f) => f.group === 'reflection' && !f.counter);
  const meals = fm.filter((f) => f.group === 'meals');
  const counters = fm.filter((f) => f.counter);

  const saveFields = async () => {
    setSaving(true);
    try {
      const fields: Record<string, unknown> = {};
      for (const f of [...reflection, ...meals]) {
        const raw = draft[f.key] ?? '';
        fields[f.key] = f.type === 'number' && raw !== '' ? Number(raw) : raw;
      }
      const res = await api.setFields(date, fields);
      setDaily(res);
      toast('Daily note saved');
    } catch (e) { toast((e as Error).message, 'err'); }
    setSaving(false);
  };

  const toggleHabit = async (habitKey: string, checked: boolean) => {
    const prev = daily;
    // optimistic: flip the toggle immediately, roll back if the write fails
    setDaily((d) => (d ? { ...d, habits: { ...d.habits, [habitKey]: checked } } : d));
    try {
      setDaily(await api.setHabit(date, habitKey, checked));
    } catch (e) {
      setDaily(prev);
      toast((e as Error).message, 'err');
    }
  };

  const bump = async (field: string, delta: number) => {
    const prev = daily;
    const cur = Number(daily?.frontmatter[field] ?? 0) || 0;
    const next = Math.max(0, cur + delta);
    // optimistic: move the counter now, roll back if the write fails
    setDaily((d) => (d ? { ...d, frontmatter: { ...d.frontmatter, [field]: next } } : d));
    setDraft((d) => ({ ...d, [field]: String(next) }));
    try {
      const res = await api.bumpCounter(date, field, delta);
      setDaily(res);
      setDraft((d) => ({ ...d, [field]: String(res.frontmatter[field] ?? 0) }));
    } catch (e) {
      setDaily(prev);
      setDraft((d) => ({ ...d, [field]: String(prev?.frontmatter[field] ?? 0) }));
      toast((e as Error).message, 'err');
    }
  };

  const addLog = async (text: string) => {
    try {
      const res = await api.addLog(date, text);
      setDaily(res);
      toast('Added to log');
    } catch (e) { toast((e as Error).message, 'err'); throw e; }
  };

  const shift = (days: number) => {
    const [y, m, d] = date.split('-').map(Number);
    const nd = new Date(y, m - 1, d + days);
    setDate(`${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-${String(nd.getDate()).padStart(2, '0')}`);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* date picker */}
      <div className="flex items-center gap-2">
        <button className="btn-ghost px-3" onClick={() => shift(-1)}>‹</button>
        <input type="date" className="field text-center" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn-ghost px-3" onClick={() => shift(1)}>›</button>
        {date !== todayIso() && (
          <button className="chip" onClick={() => setDate(todayIso())}>Today</button>
        )}
      </div>
      {loading && <p className="text-xs text-dim">Loading…</p>}
      {error && !loading && (
        <p className="text-xs text-pink">Couldn't load this day: {error}</p>
      )}
      {daily && !loading && !error && !daily.exists && (
        <p className="text-xs text-amber">No note yet for this day — saving will create it from the template.</p>
      )}

      {/* log — timestamped brain dump */}
      <LogPanel entries={daily?.log ?? []} onAppend={addLog} />

      {/* counters (smoked etc.) */}
      {counters.length > 0 && (
        <div className="panel">
          <p className="label mb-3">Counters</p>
          <div className="flex flex-col gap-3">
            {counters.map((c) => {
              const val = Number(daily?.frontmatter[c.key] ?? 0) || 0;
              return (
                <div key={c.key} className="flex items-center justify-between">
                  <span className="font-head uppercase text-sm">{c.label}</span>
                  <div className="flex items-center gap-3">
                    <button className="btn-ghost w-10 h-10 p-0 text-lg" onClick={() => bump(c.key, -1)}>−</button>
                    <span className="font-head text-2xl w-10 text-center tabular-nums">{val}</span>
                    <button className="btn-primary w-10 h-10 p-0 text-lg" onClick={() => bump(c.key, 1)}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* habit toggles */}
      <div className="panel">
        <p className="label mb-3">Habits</p>
        <div className="grid grid-cols-2 gap-2">
          {schema.dailyNote.checkboxes.map((cb) => {
            const on = !!daily?.habits[cb.habitKey];
            return (
              <button
                key={cb.habitKey}
                onClick={() => toggleHabit(cb.habitKey, !on)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-head uppercase tracking-wide transition-colors ${
                  on ? 'bg-green text-cream border-green' : 'border-edge text-dim hover:border-green'
                }`}
              >
                <span>{on ? '✓' : '○'}</span>
                <span className="truncate">{cb.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* reflection */}
      <div className="panel">
        <p className="label mb-3">Reflection</p>
        <div className="flex flex-col gap-3">
          {reflection.map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="label">{f.label}</span>
              {f.type === 'number' ? (
                <input
                  type="number"
                  className="field"
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              ) : (
                <textarea
                  className="field resize-y min-h-[44px]"
                  rows={f.key === 'wins' || f.key === 'gratitude' ? 2 : 1}
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              )}
            </label>
          ))}
        </div>
      </div>

      {/* meals */}
      <div className="panel">
        <p className="label mb-3">Meals</p>
        <div className="flex flex-col gap-3">
          {meals.map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="label">{f.label}</span>
              <input
                className="field"
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      </div>

      <button className="btn-primary" disabled={saving} onClick={saveFields}>
        {saving ? 'Saving…' : 'Save daily note'}
      </button>

      <InboxCapture />
    </div>
  );
}

function LogPanel({ entries, onAppend }: { entries: LogEntry[]; onAppend: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { await onAppend(text.trim()); setText(''); }
    catch { /* toast shown upstream, keep the draft */ }
    setBusy(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
  };
  return (
    <div className="panel">
      <p className="label mb-3">Log — brain dump</p>
      {entries.length > 0 && (
        <ul className="flex flex-col gap-2 mb-3">
          {entries.map((e, i) => (
            <li key={`${i}-${e.time}`} className="text-sm flex gap-2.5">
              {e.time && <span className="font-head text-[11px] text-dim tabular-nums pt-0.5 shrink-0">{e.time}</span>}
              <span className="text-ink whitespace-pre-wrap break-words">{e.text}</span>
            </li>
          ))}
        </ul>
      )}
      <textarea
        className="field resize-y min-h-[60px]"
        placeholder="What's on your mind…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
      />
      <button className="btn-primary mt-3 w-full" disabled={busy || !text.trim()} onClick={send}>
        {busy ? 'Logging…' : 'Add to log'}
      </button>
    </div>
  );
}

function InboxCapture() {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.inbox(text.trim());
      setText('');
      toast('Captured to inbox');
    } catch (e) { toast((e as Error).message, 'err'); }
    setBusy(false);
  };
  return (
    <div className="panel">
      <p className="label mb-3">Quick capture → inbox</p>
      <textarea
        className="field resize-y min-h-[60px]"
        placeholder="A thought, a task, anything for Silver to triage…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="btn-ghost mt-3 w-full" disabled={busy || !text.trim()} onClick={send}>
        {busy ? 'Sending…' : 'Capture'}
      </button>
    </div>
  );
}
