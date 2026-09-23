import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import type { Schema, GameState } from '../lib/types';
import Today from './Today';

// Home — the app's landing hub, laid out like a game HUD:
//   1. compact character card (hunter level + EXP + the four stat tracks)
//   2. weather for the active timezone's city
//   3. all the daily logging tools (the full Today view)
// The character card taps through to the full Status window.

const NEON = '#4dc3ff';
const TXT = '#cfe9ff';
const DIM = 'rgba(126,186,240,0.6)';
const FAINT = 'rgba(77,195,255,0.13)';

const STATS: { key: string; color: string }[] = [
  { key: 'STR', color: '#ff4d6d' },
  { key: 'INT', color: '#4dc3ff' },
  { key: 'DSC', color: '#3ddc97' },
  { key: 'FOC', color: '#b18cff' },
];

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

function Bar({ into, need, color }: { into: number; need: number; color: string }) {
  const pct = need > 0 ? Math.max(0, Math.min(100, (into / need) * 100)) : 100;
  return (
    <div style={{ height: 6, borderRadius: 6, background: FAINT, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, borderRadius: 6, background: color, boxShadow: `0 0 8px ${color}`, transition: 'width .3s' }} />
    </div>
  );
}

// Asia/Singapore → Singapore, Europe/London → London, etc. Coordinates drive
// the weather lookup; the city name is the trailing segment of the tz.
const CITY: Record<string, { lat: number; lon: number }> = {
  'Asia/Singapore': { lat: 1.3521, lon: 103.8198 },
  'Europe/London': { lat: 51.5074, lon: -0.1278 },
};
function cityName(tz: string) {
  return (tz.split('/').pop() || tz).replace(/_/g, ' ');
}

// WMO weather codes → a short label + a typographic glyph (kept as sharp
// symbols rather than cartoon emoji to match the HUD look).
function wmo(code: number): { label: string; glyph: string } {
  if (code === 0) return { label: 'Clear', glyph: '☀' };
  if (code <= 2) return { label: 'Partly cloudy', glyph: '⛅' };
  if (code === 3) return { label: 'Overcast', glyph: '☁' };
  if (code <= 48) return { label: 'Fog', glyph: '≈' };
  if (code <= 57) return { label: 'Drizzle', glyph: '☂' };
  if (code <= 67) return { label: 'Rain', glyph: '☂' };
  if (code <= 77) return { label: 'Snow', glyph: '❄' };
  if (code <= 82) return { label: 'Showers', glyph: '☂' };
  if (code <= 86) return { label: 'Snow showers', glyph: '❄' };
  return { label: 'Thunderstorm', glyph: '⚡' };
}

interface Weather {
  temp: number;
  feels: number;
  hi: number;
  lo: number;
  humidity: number;
  code: number;
}

function WeatherCard({ tz }: { tz: string }) {
  const [w, setW] = useState<Weather | null>(null);
  const [err, setErr] = useState(false);
  const city = cityName(tz);

  useEffect(() => {
    let live = true;
    const loc = CITY[tz] || CITY['Asia/Singapore'];
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
    setErr(false);
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        setW({
          temp: Math.round(d.current.temperature_2m),
          feels: Math.round(d.current.apparent_temperature),
          humidity: Math.round(d.current.relative_humidity_2m),
          code: d.current.weather_code,
          hi: Math.round(d.daily.temperature_2m_max[0]),
          lo: Math.round(d.daily.temperature_2m_min[0]),
        });
      })
      .catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, [tz]);

  const cond = w ? wmo(w.code) : null;

  return (
    <div style={card}>
      <div style={titleBar}>
        {winTitle(`Weather · ${city}`)}
        {w && <span style={{ color: DIM, fontSize: 10, letterSpacing: '0.1em' }}>H {w.hi}° · L {w.lo}°</span>}
      </div>
      <div style={{ padding: '14px 18px 16px' }}>
        {!w && !err && <span style={{ color: DIM, fontSize: 12, letterSpacing: '0.12em' }}>LOADING WEATHER…</span>}
        {err && <span style={{ color: DIM, fontSize: 12 }}>Weather unavailable right now.</span>}
        {w && cond && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: 40, lineHeight: 1, color: NEON, textShadow: `0 0 16px ${NEON}` }}>{cond.glyph}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontSize: '2.4rem', fontWeight: 800, color: NEON, textShadow: `0 0 14px ${NEON}`, lineHeight: 1 }}>{w.temp}°</span>
                <span style={{ color: TXT, fontSize: 13 }}>{cond.label}</span>
              </div>
              <span style={{ color: DIM, fontSize: 11 }}>Feels {w.feels}° · Humidity {w.humidity}%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CharacterCard({ state, onOpen }: { state: GameState; onOpen: () => void }) {
  const c = state.character;
  return (
    <button onClick={onOpen} style={{ ...card, textAlign: 'left', cursor: 'pointer', padding: 0, width: '100%' }} className="font-head">
      <div style={titleBar}>
        {winTitle('Status')}
        <span style={{ color: DIM, fontSize: 10, letterSpacing: '0.1em' }}>view ›</span>
      </div>
      <div style={{ padding: '14px 18px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: DIM, fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase' }}>Hunter Level</span>
            <span style={{ fontSize: '2.6rem', fontWeight: 800, color: NEON, textShadow: `0 0 16px ${NEON}`, lineHeight: 1 }}>{c.level}</span>
          </div>
          <div style={{ flex: 1, paddingBottom: 4 }}>
            <Bar into={c.into} need={c.need} color={NEON} />
            <div style={{ color: DIM, fontSize: 10, marginTop: 5 }}>{c.into} / {c.need} EXP → Lv {c.level + 1}</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
          {STATS.map((s) => {
            const st = state.stats[s.key];
            if (!st) return null;
            return (
              <div key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ color: s.color, fontWeight: 700, fontSize: 12, textShadow: `0 0 6px ${s.color}` }}>{s.key}</span>
                  <span style={{ color: DIM, fontSize: 10 }}>{st.level}</span>
                </div>
                <Bar into={st.into} need={st.need} color={s.color} />
              </div>
            );
          })}
        </div>
      </div>
    </button>
  );
}

export default function Home({ schema, onOpenStatus }: { schema: Schema; onOpenStatus: () => void }) {
  const [state, setState] = useState<GameState | null>(null);
  const [tz, setTz] = useState('Asia/Singapore');

  const load = useCallback(async () => {
    try {
      const s = await api.systemState();
      setState(s);
      setTz(s.timezone);
    } catch { /* character card just stays hidden if the bridge blips */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col gap-4">
      {state && <CharacterCard state={state} onOpen={onOpenStatus} />}
      <WeatherCard tz={tz} />
      <Today schema={schema} />
    </div>
  );
}
