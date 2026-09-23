import { useEffect, useState, useCallback } from 'react';
import { api, QueuedError } from '../lib/api';
import { useToast } from '../lib/ui';
import type { GameState } from '../lib/types';

// Solo-Leveling "Status window": a dark glass game card — character level +
// the four stat tracks (each its own level + glowing bar) + today's workout
// quest. All numbers are derived server-side from the Hub; this view only
// renders + submits the quest. Styled to match the Hub's Character.md card so
// the app and the vault show the same status window.

const NEON = '#4dc3ff';
const TXT = '#cfe9ff';
const DIM = 'rgba(126,186,240,0.6)';
const FAINT = 'rgba(77,195,255,0.13)';

const STATS: { key: string; name: string; sub: string; color: string }[] = [
  { key: 'STR', name: 'Strength', sub: 'steps · training · workouts', color: '#ff4d6d' },
  { key: 'INT', name: 'Intellect', sub: 'notes · logs', color: '#4dc3ff' },
  { key: 'DSC', name: 'Discipline', sub: 'habits · trading rules', color: '#3ddc97' },
  { key: 'FOC', name: 'Focus', sub: 'meditation · restraint', color: '#b18cff' },
];

const QUEST = [
  { key: 'pushups', label: 'Push-ups' },
  { key: 'situps', label: 'Sit-ups' },
  { key: 'running', label: 'Running' },
] as const;

const card: React.CSSProperties = {
  background: 'linear-gradient(165deg,#0a1524,#050b14)',
  border: '1px solid rgba(77,195,255,0.28)',
  borderRadius: 14,
  boxShadow: '0 0 24px rgba(77,195,255,0.08), inset 0 0 40px rgba(77,195,255,0.03)',
  overflow: 'hidden',
};
const titleBar: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '9px 14px',
  borderBottom: '1px solid rgba(77,195,255,0.15)',
  background: 'rgba(77,195,255,0.05)',
};
const winTitle = (t: string) => (
  <span style={{ color: NEON, letterSpacing: '0.22em', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>◈ {t}</span>
);

function GBar({ into, need, color }: { into: number; need: number; color: string }) {
  const pct = need > 0 ? Math.max(0, Math.min(100, (into / need) * 100)) : 100;
  return (
    <div style={{ height: 8, borderRadius: 6, background: FAINT, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, borderRadius: 6, background: color, boxShadow: `0 0 8px ${color}`, transition: 'width .3s' }} />
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
    } catch (e) {
      if (e instanceof QueuedError) toast(e.message);
      else toast((e as Error).message, 'err');
    }
    finally { setBusy(false); }
  };

  if (err) {
    return (
      <div style={card} className="font-head">
        <div style={titleBar}>{winTitle('Status offline')}</div>
        <div style={{ padding: 18 }}>
          <p style={{ color: '#ff6b8a', fontSize: 13, marginBottom: 12 }}>{err}</p>
          <button
            onClick={load}
            style={{ width: '100%', padding: '10px', borderRadius: 8, border: `1px solid ${NEON}`, background: 'rgba(77,195,255,0.12)', color: NEON, letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: 13 }}
          >Retry</button>
        </div>
      </div>
    );
  }
  if (!state) {
    return <div style={{ ...card, padding: 20 }} className="font-head text-center" >
      <span style={{ color: DIM, letterSpacing: '0.15em', fontSize: 12 }}>LOADING STATUS…</span>
    </div>;
  }

  const c = state.character;
  const checkedBoxes = Number(check.pushups) + Number(check.situps) + Number(check.running);
  const q = state.quest;
  const doneBoxes = (q.pushups || 0) + (q.situps || 0) + (q.running || 0);

  return (
    <div className="flex flex-col gap-4 font-head">
      {/* Character window */}
      <div style={card}>
        <div style={titleBar}>
          {winTitle('Status Window')}
          <span style={{ color: DIM, fontSize: 10, letterSpacing: '0.1em' }}>{state.today}</span>
        </div>
        <div style={{ padding: '16px 18px 20px' }}>
          <div style={{ color: DIM, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' }}>Hunter Level</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, margin: '4px 0 12px' }}>
            <span style={{ fontSize: '3.4rem', fontWeight: 800, color: NEON, textShadow: `0 0 18px ${NEON}`, lineHeight: 1 }}>{c.level}</span>
            <span style={{ color: DIM, fontSize: 11, marginBottom: 8 }}>{c.total.toLocaleString()} EXP total</span>
          </div>
          <GBar into={c.into} need={c.need} color={NEON} />
          <div style={{ color: DIM, fontSize: 11, marginTop: 6 }}>{c.into} / {c.need} EXP to level {c.level + 1}</div>
        </div>
      </div>

      {/* Stats window */}
      <div style={card}>
        <div style={titleBar}>{winTitle('Stats')}</div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {STATS.map((s) => {
            const st = state.stats[s.key];
            if (!st) return null;
            return (
              <div key={s.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ color: s.color, fontWeight: 700, fontSize: 15, textShadow: `0 0 8px ${s.color}` }}>{s.key}</span>
                    <span style={{ color: TXT, fontSize: 12 }}>{s.name}</span>
                  </div>
                  <span style={{ color: DIM, fontSize: 11 }}>Lv {st.level} · {st.into}/{st.need}</span>
                </div>
                <GBar into={st.into} need={st.need} color={s.color} />
                <div style={{ color: DIM, fontSize: 10, marginTop: 4 }}>{s.sub}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Daily quest window */}
      <div style={card}>
        <div style={titleBar}>
          {winTitle('Daily Quest · Workout')}
          <span style={{ color: submitted ? '#3ddc97' : NEON, fontSize: 10, letterSpacing: '0.1em' }}>
            {submitted ? `LOCKED · +${doneBoxes * 2} STR` : `+${checkedBoxes * 2} STR`}
          </span>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {QUEST.map((qq) => {
            const on = check[qq.key];
            return (
              <button
                key={qq.key}
                onClick={() => toggle(qq.key)}
                disabled={submitted}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 10,
                  border: `1px solid ${on ? NEON : 'rgba(77,195,255,0.18)'}`,
                  background: on ? 'rgba(77,195,255,0.1)' : 'transparent',
                  textAlign: 'left', cursor: submitted ? 'default' : 'pointer',
                  opacity: submitted ? 0.7 : 1, transition: 'all .2s',
                }}
              >
                <span style={{
                  width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700,
                  background: on ? NEON : 'transparent', color: on ? '#05101c' : 'transparent',
                  border: on ? 'none' : '1px solid rgba(77,195,255,0.3)',
                  boxShadow: on ? `0 0 10px ${NEON}` : 'none',
                }}>✓</span>
                <span style={{ color: TXT, fontSize: 14, flex: 1 }}>{qq.label}</span>
                <span style={{ color: DIM, fontSize: 11 }}>+2 STR</span>
              </button>
            );
          })}

          {submitted ? (
            <p style={{ color: DIM, fontSize: 11, marginTop: 6 }}>
              Locked in for today. Come back tomorrow for the next quest.
            </p>
          ) : (
            <>
              <button
                onClick={submit}
                disabled={busy}
                style={{
                  marginTop: 6, width: '100%', padding: '12px', borderRadius: 10, border: 'none',
                  background: `linear-gradient(90deg, ${NEON}, #6fd4ff)`, color: '#05101c',
                  fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: 13,
                  boxShadow: `0 0 16px rgba(77,195,255,0.4)`, opacity: busy ? 0.5 : 1,
                  cursor: busy ? 'default' : 'pointer',
                }}
              >{busy ? 'Submitting…' : 'Submit quest'}</button>
              <p style={{ color: DIM, fontSize: 10.5, marginTop: 6 }}>
                Tick what you did and submit. If you forget, it auto-locks at 23:55 ({state.timezone.split('/')[1] || state.timezone} time).
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
