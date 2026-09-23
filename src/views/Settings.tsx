import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useToast } from '../lib/ui';

const ZONES = [
  { id: 'Asia/Singapore', label: 'Singapore' },
  { id: 'Europe/London', label: 'London' },
];

export default function Settings({ onLogout }: { onLogout: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [exp, setExp] = useState<number | null>(null);
  const [today, setToday] = useState('');
  const [tz, setTz] = useState<string>('');

  const check = useCallback(async () => {
    setStatus('checking');
    try {
      const h = await api.health();
      setToday(h.today);
      setStatus('online');
      try { const me = await api.me(); setExp(me.exp); } catch { /* session handled globally */ }
      try { const s = await api.getSettings(); setTz(s.timezone); } catch { /* optional */ }
    } catch { setStatus('offline'); }
  }, []);
  useEffect(() => { check(); }, [check]);

  const pickTz = async (id: string) => {
    if (id === tz) return;
    const prev = tz;
    setTz(id); // optimistic
    try { await api.setTimezone(id); toast(`Timezone → ${ZONES.find((z) => z.id === id)?.label}`); }
    catch (e) { setTz(prev); toast((e as Error).message, 'err'); }
  };

  const reconnect = async () => { await check(); toast(status === 'online' ? 'Reconnected' : 'Connection checked'); };
  const signOut = () => { if (window.confirm('Sign out of myOS?')) onLogout(); };

  const dot = status === 'online' ? 'bg-green' : status === 'offline' ? 'bg-pink' : 'bg-amber';
  const statusText = status === 'online' ? 'Connected' : status === 'offline' ? 'Offline' : 'Checking…';
  const expLabel = exp ? new Date(exp).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  return (
    <div className="flex flex-col gap-4">
      <div className="panel">
        <div className="flex justify-between items-center mb-2">
          <p className="label">Connection</p>
          <button className="chip" onClick={reconnect} disabled={status === 'checking'}>Reconnect</button>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
          <span className="text-ink">{statusText}</span>
          {status === 'online' && today && <span className="text-dim text-xs">· today {today}</span>}
        </div>
      </div>

      <div className="panel">
        <p className="label mb-2">Timezone</p>
        <div className="grid grid-cols-2 gap-2">
          {ZONES.map((z) => (
            <button
              key={z.id}
              onClick={() => pickTz(z.id)}
              className={`py-2.5 rounded-lg border text-sm transition-colors ${
                tz === z.id ? 'border-oxblood bg-oxblood/5 text-oxblood font-head' : 'border-edge text-ink'
              }`}
            >
              {z.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-dim mt-2">Sets your day boundary and the 23:55 quest auto-submit.</p>
      </div>

      <div className="panel">
        <p className="label mb-2">Session</p>
        <p className="text-sm text-ink">Signed in until <span className="text-dim">{expLabel}</span></p>
      </div>

      <div className="panel">
        <p className="label mb-2">About</p>
        <p className="text-sm text-dim">
          myOS is your personal dashboard — capture your day, money, habits and schedule
          in one place. Everything you log here syncs straight into your Hub.
        </p>
      </div>

      <button className="btn-ghost text-pink border-pink" onClick={signOut}>Sign out</button>
    </div>
  );
}
