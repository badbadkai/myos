import { useEffect, useState } from 'react';
import { api } from './lib/api';
import type { Schema } from './lib/types';
import { ToastProvider } from './lib/ui';
import Today from './views/Today';
import Money from './views/Money';
import Calendar from './views/Calendar';
import Habits from './views/Habits';
import Settings from './views/Settings';

type Tab = 'today' | 'money' | 'calendar' | 'habits' | 'settings';

const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: 'today', label: 'Today', glyph: '◆' },
  { id: 'money', label: 'Money', glyph: '§' },
  { id: 'calendar', label: 'Calendar', glyph: '▦' },
  { id: 'habits', label: 'Habits', glyph: '✦' },
  { id: 'settings', label: 'Settings', glyph: '⚙' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('today');
  const [schema, setSchema] = useState<Schema | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [vault, setVault] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const hp = await api.health();
        setVault(hp.vault);
        setSchema(await api.schema());
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, []);

  return (
    <ToastProvider>
      <div className="min-h-full flex flex-col max-w-2xl mx-auto">
        <header className="px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3 flex items-baseline justify-between">
          <h1 className="font-head text-2xl font-bold text-oxblood tracking-tight">myOS</h1>
          <span className="text-xs text-dim truncate max-w-[55%]" title={vault}>
            {vault ? vault.replace(/\\/g, '/') : ''}
          </span>
        </header>

        <main className="flex-1 px-4 pb-28">
          {err && (
            <div className="panel border-pink text-pink">
              <p className="font-head uppercase text-xs tracking-wide mb-1">Bridge offline</p>
              <p className="text-sm">{err}</p>
              <p className="text-xs text-dim mt-2">Start it with <code>npm run dev:bridge</code> and check the SILVER drive is mounted.</p>
            </div>
          )}
          {!err && !schema && <p className="text-dim text-sm">Connecting to the vault…</p>}
          {schema && (
            <>
              {tab === 'today' && <Today schema={schema} />}
              {tab === 'money' && <Money schema={schema} />}
              {tab === 'calendar' && <Calendar schema={schema} />}
              {tab === 'habits' && <Habits />}
              {tab === 'settings' && <Settings schema={schema} vault={vault} />}
            </>
          )}
        </main>

        <nav className="fixed bottom-0 left-0 right-0 bg-cream/95 backdrop-blur border-t border-edge pb-[env(safe-area-inset-bottom)]">
          <div className="max-w-2xl mx-auto grid grid-cols-5">
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
