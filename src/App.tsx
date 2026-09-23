import { useEffect, useState, useCallback } from 'react';
import { api, auth, AuthError } from './lib/api';
import type { Schema } from './lib/types';
import { ToastProvider } from './lib/ui';
import Login from './views/Login';
import Today from './views/Today';
import Status from './views/Status';
import Money from './views/Money';
import Calendar from './views/Calendar';
import Habits from './views/Habits';
import Settings from './views/Settings';

type Tab = 'today' | 'status' | 'money' | 'calendar' | 'habits' | 'settings';

const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: 'today', label: 'Today', glyph: '◆' },
  { id: 'status', label: 'Status', glyph: '❖' },
  { id: 'money', label: 'Money', glyph: '§' },
  { id: 'calendar', label: 'Calendar', glyph: '▦' },
  { id: 'habits', label: 'Habits', glyph: '✦' },
  { id: 'settings', label: 'Settings', glyph: '⚙' },
];

type Phase = 'checking' | 'offline' | 'login' | 'ready';

export default function App() {
  const [tab, setTab] = useState<Tab>('today');
  const [schema, setSchema] = useState<Schema | null>(null);
  const [err, setErr] = useState<string>('');
  const [phase, setPhase] = useState<Phase>('checking');

  const boot = useCallback(async () => {
    setPhase('checking'); setErr('');
    try {
      await api.health();
    } catch (e) {
      setErr((e as Error).message);
      setPhase('offline');
      return;
    }
    if (!auth.get()) { setPhase('login'); return; }
    try {
      await api.me();
      setSchema(await api.schema());
      setPhase('ready');
    } catch (e) {
      if (e instanceof AuthError) setPhase('login');
      else { setErr((e as Error).message); setPhase('offline'); }
    }
  }, []);

  useEffect(() => { boot(); }, [boot]);

  const logout = () => { api.logout(); setSchema(null); setPhase('login'); };

  if (phase === 'checking') {
    return <div className="min-h-full flex items-center justify-center text-dim text-sm">Connecting…</div>;
  }

  if (phase === 'offline') {
    return (
      <div className="min-h-full flex items-center justify-center px-6">
        <div className="panel border-pink max-w-sm w-full">
          <p className="font-head uppercase text-xs tracking-wide mb-1 text-pink">Can't connect</p>
          <p className="text-sm text-ink">{err}</p>
          <p className="text-xs text-dim mt-2">
            myOS can't reach your home server right now. Make sure it's on and connected,
            then try again. Anything already loaded still shows; saving needs a connection.
          </p>
          <button className="btn-primary w-full mt-4" disabled={phase !== 'offline'} onClick={boot}>Retry</button>
        </div>
      </div>
    );
  }

  if (phase === 'login') {
    return (
      <ToastProvider>
        <Login onDone={boot} />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <div className="min-h-full flex flex-col max-w-2xl mx-auto">
        <header className="px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3 flex items-baseline justify-between">
          <h1 className="font-head text-2xl font-bold text-oxblood tracking-tight">myOS</h1>
          <span className="text-xs text-dim">
            {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
        </header>

        <main className="flex-1 px-4 pb-28">
          {schema && (
            <>
              {tab === 'today' && <Today schema={schema} />}
              {tab === 'status' && <Status />}
              {tab === 'money' && <Money schema={schema} />}
              {tab === 'calendar' && <Calendar schema={schema} />}
              {tab === 'habits' && <Habits schema={schema} />}
              {tab === 'settings' && <Settings onLogout={logout} />}
            </>
          )}
        </main>

        <nav className="fixed bottom-0 left-0 right-0 bg-cream/95 backdrop-blur border-t border-edge pb-[env(safe-area-inset-bottom)]">
          <div className="max-w-2xl mx-auto grid grid-cols-6">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`py-3 flex flex-col items-center gap-0.5 transition-colors ${
                  tab === t.id ? 'text-oxblood' : 'text-dim'
                }`}
              >
                <span className="text-lg leading-none">{t.glyph}</span>
                <span className="font-head uppercase text-[10px] tracking-wide">{t.label}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>
    </ToastProvider>
  );
}
