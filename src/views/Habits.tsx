import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import type { Schema, Streaks } from '../lib/types';
import { useToast } from '../lib/ui';

export default function Habits({ schema }: { schema: Schema }) {
  const toast = useToast();
  const [s, setS] = useState<Streaks | null>(null);

  // Labels come from the schema so they stay in lock-step with the daily note.
  const LABELS: Record<string, string> = Object.fromEntries(
    schema.dailyNote.checkboxes.map((c) => [c.habitKey, c.label]),
  );

  const refresh = useCallback(() => {
    api.streaks().then(setS).catch((e) => toast((e as Error).message, 'err'));
  }, [toast]);

  useEffect(() => { refresh(); }, [refresh]);

  // Habits roll over at day close and can be toggled elsewhere, so re-pull
  // whenever the tab regains focus.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  if (!s) return <p className="text-dim text-sm">Loading habits…</p>;
  const keys = Object.keys(s.streaks);
  const maxSmoked = Math.max(1, ...s.smokedRecent.map((r) => r.smoked));

  return (
    <div className="flex flex-col gap-4">
      <div className="panel">
        <div className="flex justify-between items-center mb-3">
          <p className="label">Streaks</p>
          <button className="chip" onClick={refresh}>Refresh</button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {keys.map((k) => (
            <div key={k} className="flex flex-col items-center bg-cream/60 border border-edge rounded-lg py-3">
              <span className="font-head text-3xl font-bold text-oxblood" style={{ textShadow: '0 0 12px rgba(77,195,255,0.5)' }}>{s.streaks[k]}</span>
              <span className="label">{LABELS[k] ?? k}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <p className="label mb-3">Last 7 days</p>
        <div className="flex flex-col gap-2">
          {keys.map((k) => (
            <div key={k} className="flex items-center justify-between">
              <span className="font-head uppercase text-xs tracking-wide w-24">{LABELS[k] ?? k}</span>
              <div className="flex gap-1.5">
                {(s.last7[k] ?? []).map((on, i) => (
                  <span key={s.days[i] ?? i} className={`w-5 h-5 rounded-full ${on ? 'bg-green' : 'bg-edge'}`} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <p className="label mb-3">Smoking · last 7</p>
        <div className="flex items-end justify-between gap-1.5 h-24">
          {s.smokedRecent.map((r) => (
            <div key={r.date} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
              <span className="text-[10px] text-dim">{r.smoked || ''}</span>
              <div
                className={`w-full rounded-t ${r.smoked === 0 ? 'bg-green' : 'bg-pink'}`}
                style={{ height: `${(r.smoked / maxSmoked) * 100}%`, minHeight: r.smoked === 0 ? '2px' : '6px' }}
              />
              <span className="text-[9px] text-dim">{r.date.slice(8)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
