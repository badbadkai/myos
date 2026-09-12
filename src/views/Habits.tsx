import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Streaks } from '../lib/types';
import { useToast } from '../lib/ui';

const LABELS: Record<string, string> = {
  trained: 'Trained', journaled: 'Journaled', meditated: 'Meditated', skincare: 'Skincare',
};

export default function Habits() {
  const toast = useToast();
  const [s, setS] = useState<Streaks | null>(null);
  useEffect(() => {
    api.streaks().then(setS).catch((e) => toast((e as Error).message, 'err'));
  }, [toast]);

  if (!s) return <p className="text-dim text-sm">Loading habits…</p>;
  const keys = Object.keys(s.streaks);
  const maxSmoked = Math.max(1, ...s.smokedRecent.map((r) => r.smoked));

  return (
    <div className="flex flex-col gap-4">
      <div className="panel">
        <p className="label mb-3">Streaks</p>
        <div className="grid grid-cols-2 gap-3">
          {keys.map((k) => (
            <div key={k} className="flex flex-col items-center bg-cream border border-edge rounded-lg py-3">
              <span className="font-head text-3xl font-bold text-oxblood">{s.streaks[k]}</span>
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
                  <span key={i} className={`w-5 h-5 rounded-full ${on ? 'bg-green' : 'bg-edge'}`} />
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
