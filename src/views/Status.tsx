import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useToast } from '../lib/ui';
import type { GameState } from '../lib/types';

// Solo-Leveling "Status window": character level + the four stat tracks, each
// with its own level and progress bar, plus today's workout quest. All numbers
// are derived server-side from the Hub; this view only renders + submits the
// quest.

const STATS: { key: string; name: string; sub: string; color: string }[] = [
  { key: 'STR', name: 'Strength', sub: 'steps · training · workouts', color: '#b23b3b' },
  { key: 'INT', name: 'Intellect', sub: 'notes · logs', color: '#3b6fb2' },
  { key: 'DSC', name: 'Discipline', sub: 'habits · trading rules', color: '#3b8f5f' },
  { key: 'FOC', name: 'Focus', sub: 'meditation · restraint', color: '#7a5bb0' },
];

const QUEST = [
  { key: 'pushups', label: 'Push-ups' },
  { key: 'situps', label: 'Sit-ups' },
  { key: 'running', label: 'Running' },
] as const;

function Bar({ into, need, color }: { into: number; need: number; color: string }) {
  const pct = need > 0 ? Math.max(0, Math.min(100, (into / need) * 100)) : 100;
  return (
    <div className="h-2 rounded-full bg-edge overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

export default function Status() {
  const toast = useToast();
  const [state, setState] = useState<GameState | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<Record<string, boolean>>({ pushups: false, situps: false, running: false });

  const load = useCallback(async () => {
    setErr('');
    try {
      const s = await api.systemState();
      setState(s);
      setCheck({ pushups: !!s.quest.pushups, situps: !!s.quest.situps, running: !!s.quest.running });
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const submitted = !!state?.quest.submitted;

  const toggle = async (key: string) => {
    if (submitted || busy) return;
    const next = { ...check, [key]: !check[key] };
    setCheck(next); // optimistic
    try { await api.quest(next); } catch { /* saved on submit anyway */ }
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const s = await api.quest({ ...check, submit: true });
      setState(s);
      const boxes = Number(check.pushups) + Number(check.situps) + Number(check.running);
      toast(boxes ? `Quest logged · +${boxes * 2} STR` : 'Quest closed');
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  };

  if (err) {
    return (
      <div className="panel border-pink">
        <p className="label text-pink mb-1">Status unavailable</p>
        <p className="text-sm text-ink">{err}</p>
        <button className="btn-primary w-full mt-3" onClick={load}>Retry</button>
      </div>
    );
  }
  if (!state) return <div className="text-dim text-sm py-10 text-center">Loading status…</div>;

  const c = state.character;
  const checkedBoxes = Number(check.pushups) + Number(check.situps) + Number(check.running);

  return (
    <div className="flex flex-col gap-4">
      {/* Character card */}
      <div className="panel">
        <p className="label mb-1">Hunter Level</p>
        <div className="flex items-end gap-3 mb-3">
          <span className="font-head text-5xl font-bold text-oxblood leading-none">{c.level}</span>
          <span className="text-xs text-dim mb-1">{c.total.toLocaleString()} EXP total</span>
        </div>
        <Bar into={c.into} need={c.need} color="#7a1f2b" />
        <p className="text-[11px] text-dim mt-1">{c.into} / {c.need} EXP to level {c.level + 1}</p>
      </div>

      {/* Stat tracks */}
      <div className="panel">
        <p className="label mb-3">Stats</p>
        <div className="flex flex-col gap-4">
          {STATS.map((s) => {
            const st = state.stats[s.key];
            if (!st) return null;
            return (
              <div key={s.key}>
                <div className="flex items-baseline justify-between mb-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-head font-bold text-sm" style={{ color: s.color }}>{s.key}</span>
                    <span className="text-xs text-ink">{s.name}</span>
                  </div>
                  <span className="text-xs text-dim">Lv {st.level}</span>
                </div>
                <Bar into={st.into} need={st.need} color={s.color} />
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-dim">{s.sub}</span>
                  <span className="text-[10px] text-dim">{st.into} / {st.need}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Daily workout quest */}
      <div className="panel">
        <div className="flex items-baseline justify-between mb-2">
          <p className="label">Daily Quest · Workout</p>
          <span className="text-xs text-dim">{submitted ? 'Submitted' : `+${checkedBoxes * 2} STR`}</span>
        </div>
        <div className="flex flex-col gap-2">
          {QUEST.map((q) => (
            <button
              key={q.key}
              onClick={() => toggle(q.key)}
              disabled={submitted}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                check[q.key] ? 'border-oxblood bg-oxblood/5' : 'border-edge'
              } ${submitted ? 'opacity-70' : ''}`}
            >
              <span className={`w-5 h-5 rounded flex items-center justify-center text-xs ${
                check[q.key] ? 'bg-oxblood text-cream' : 'border border-edge text-transparent'
              }`}>✓</span>
              <span className="text-sm text-ink flex-1">{q.label}</span>
              <span className="text-[10px] text-dim">+2</span>
            </button>
          ))}
        </div>
        {submitted ? (
          <p className="text-[11px] text-dim mt-3">
            Locked in for today. Come back tomorrow for the next quest.
          </p>
        ) : (
          <>
            <button className="btn-primary w-full mt-3" onClick={submit} disabled={busy}>
              {busy ? 'Submitting…' : 'Submit quest'}
            </button>
            <p className="text-[11px] text-dim mt-2">
              Tick what you did and submit. If you forget, it locks in automatically at 23:55 ({state.timezone.split('/')[1] || state.timezone} time).
            </p>
          </>
        )}
      </div>
    </div>
  );
}
