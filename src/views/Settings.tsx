import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import type { Schema } from '../lib/types';
import { useToast } from '../lib/ui';

export default function Settings({ schema, vault, onLogout }: { schema: Schema; vault: string; onLogout: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [exp, setExp] = useState<number | null>(null);
  const [today, setToday] = useState('');

  const check = useCallback(async () => {
    setStatus('checking');
    try {
      const h = await api.health();
      setToday(h.today);
      setStatus('online');
      try { const me = await api.me(); setExp(me.exp); } catch { /* session handled globally */ }
    } catch { setStatus('offline'); }
  }, []);
  useEffect(() => { check(); }, [check]);

  const reconnect = async () => { await check(); toast(status === 'online' ? 'Reconnected' : 'Connection checked'); };
  const signOut = () => { if (window.confirm('Sign out of myOS?')) onLogout(); };

  const dot = status === 'online' ? 'bg-green' : status === 'offline' ? 'bg-pink' : 'bg-amber';
  const statusText = status === 'online' ? 'Connected' : status === 'offline' ? 'Bridge offline' : 'Checking…';
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
        <p className="label mb-2">Session</p>
        <p className="text-sm text-ink">Logged in until <span className="text-dim">{expLabel}</span></p>
      </div>

      <div className="panel">
        <p className="label mb-2">Vault</p>
        <p className="text-sm break-all">{vault.replace(/\\/g, '/')}</p>
      </div>

      <div className="panel">
        <p className="label mb-2">Writes to</p>
        <ul className="text-sm flex flex-col gap-1 text-dim">
          <li><span className="text-ink">Daily note</span> — {schema.dailyNote.path}</li>
          <li><span className="text-ink">Finance</span> — {schema.finance.raw}/</li>
          <li><span className="text-ink">Habits</span> — {schema.habits.csv}</li>
          <li><span className="text-ink">Calendar</span> — {schema.calendar.csv}</li>
          <li><span className="text-ink">Inbox</span> — {schema.inbox.path}</li>
        </ul>
      </div>

      <div className="panel">
        <p className="label mb-2">About</p>
        <p className="text-sm text-dim">
          myOS writes directly into the Hub vault via the local bridge. Edit
          <code className="mx-1">x/myos.schema.json</code>in the vault to add fields — no rebuild needed.
        </p>
      </div>

      <button className="btn-ghost text-pink border-pink" onClick={signOut}>Sign out</button>
    </div>
  );
}
