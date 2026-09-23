import { useEffect, useState, useCallback, useRef } from 'react';
import { api, todayIso, QueuedError } from '../lib/api';
import type { Schema, FinanceSummary } from '../lib/types';
import { useToast, money } from '../lib/ui';

export default function Money({ schema }: { schema: Schema }) {
  const toast = useToast();
  const [sum, setSum] = useState<FinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setSum(await api.finance()); } catch (e) { toast((e as Error).message, 'err'); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  // The balance can move from elsewhere (Obsidian, the reconcile script, another
  // device), so re-pull whenever the tab regains focus rather than showing stale
  // numbers. Keeps the sum fresh without a manual reload.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', load);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', load);
    };
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <Balance sum={sum} loading={loading} />
      <Capture schema={schema} onDone={(s) => setSum(s)} />
      <Snapshot onDone={(s) => setSum(s)} />
      {sum && <BudgetPace sum={sum} />}
      {sum && sum.london && <LondonGap sum={sum} />}
      {sum && sum.debts.length > 0 && <Debts sum={sum} />}
      {sum && <Recent sum={sum} />}
    </div>
  );
}

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long' });
}

function Balance({ sum, loading }: { sum: FinanceSummary | null; loading: boolean }) {
  return (
    <div className="panel text-center">
      <p className="label">Current balance</p>
      <p className="font-head text-4xl font-bold text-oxblood mt-1" style={{ textShadow: '0 0 16px rgba(77,195,255,0.45)' }}>
        {sum ? money(sum.banked) : loading ? '…' : '—'}
      </p>
      {sum && (
        <p className="text-xs text-dim mt-2">
          {monthLabel(sum.monthKey)}: <span className="text-green">+{money(sum.monthIn)}</span> ·{' '}
          <span className="text-pink">−{money(sum.monthOut)}</span> ·{' '}
          net <span className={sum.net >= 0 ? 'text-green' : 'text-pink'}>{money(sum.net)}</span>
        </p>
      )}
    </div>
  );
}

function Capture({ schema, onDone }: { schema: Schema; onDone: (s: FinanceSummary) => void }) {
  const toast = useToast();
  const { spend, tracked, income } = schema.finance.categories;
  const [amount, setAmount] = useState('');
  const [sign, setSign] = useState<'out' | 'in'>('out');
  const [category, setCategory] = useState(spend[0]);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const recog = useRef<any>(null);
  const [listening, setListening] = useState(false);

  const submit = async () => {
    const a = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(a)) { toast('Enter an amount', 'err'); return; }
    setBusy(true);
    try {
      const signed = sign === 'out' ? -Math.abs(a) : Math.abs(a);
      const s = await api.addTransaction({ date, amount: signed, category, note });
      onDone(s);
      setAmount(''); setNote(''); setDate(todayIso());
      toast('Transaction logged');
    } catch (e) {
      if (e instanceof QueuedError) { setAmount(''); setNote(''); setDate(todayIso()); toast(e.message); }
      else toast((e as Error).message, 'err');
    }
    setBusy(false);
  };

  const voice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast('Voice not supported here', 'err'); return; }
    if (listening) { recog.current?.stop(); return; }
    const r = new SR();
    r.lang = 'en-SG'; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e: any) => {
      const text = e.results[0][0].transcript as string;
      const m = text.match(/(\d+(?:\.\d+)?)/);
      if (m) setAmount(m[1]);
      setNote((n) => (n ? `${n} ${text}` : text));
    };
    r.onend = () => setListening(false);
    r.onerror = (e: any) => {
      setListening(false);
      if (e?.error !== 'aborted' && e?.error !== 'no-speech') toast('Voice capture failed', 'err');
    };
    recog.current = r; r.start(); setListening(true);
  };

  const quick = schema.finance.quickLog ?? [];
  const applyQuick = (q: { amount: number; category: string }) => {
    setSign('out');
    setAmount(String(q.amount));
    setCategory(q.category);
  };

  return (
    <div className="panel">
      <p className="label mb-3">Log transaction</p>
      {quick.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {quick.map((q) => (
            <button key={q.label} className="chip" onClick={() => applyQuick(q)}>
              {q.label} <span className="text-dim">{money(q.amount)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2 mb-3">
        <button className={`chip flex-1 ${sign === 'out' ? 'chip-on' : ''}`} onClick={() => setSign('out')}>Spent</button>
        <button className={`chip flex-1 ${sign === 'in' ? 'chip-on' : ''}`} onClick={() => setSign('in')}>Received</button>
      </div>
      <div className="flex gap-2 mb-3">
        <input
          type="number" inputMode="decimal" className="field text-2xl font-head" placeholder="0.00"
          value={amount} onChange={(e) => setAmount(e.target.value)}
        />
        <button className={`btn-ghost px-3 ${listening ? 'text-pink border-pink' : ''}`} onClick={voice} title="Voice capture">
          {listening ? '●' : '🎤'}
        </button>
      </div>
      <select className="field mb-3" value={category} onChange={(e) => setCategory(e.target.value)}>
        <optgroup label="Spend">{spend.map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>
        <optgroup label="Tracked">{tracked.map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>
        <optgroup label="Income">{income.map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>
      </select>
      <input className="field mb-3" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
      <input type="date" className="field mb-3" value={date} onChange={(e) => setDate(e.target.value)} />
      <button className="btn-primary w-full" disabled={busy} onClick={submit}>
        {busy ? 'Logging…' : 'Log it'}
      </button>
    </div>
  );
}

function Snapshot({ onDone }: { onDone: (s: FinanceSummary) => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState('');
  const [parts, setParts] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const t = Number(total);
    if (total.trim() === '' || !Number.isFinite(t)) { toast('Enter a balance', 'err'); return; }
    setBusy(true);
    try {
      onDone(await api.addSnapshot({ total: t, parts }));
      setTotal(''); setParts(''); setOpen(false);
      toast('Snapshot saved');
    } catch (e) {
      if (e instanceof QueuedError) { setTotal(''); setParts(''); setOpen(false); toast(e.message); }
      else toast((e as Error).message, 'err');
    }
    setBusy(false);
  };
  return (
    <div className="panel">
      <button className="label w-full text-left flex justify-between items-center" onClick={() => setOpen((o) => !o)}>
        <span>Balance snapshot</span><span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-xs text-dim">Records your real account balance today. Future transactions derive from this.</p>
          <input type="number" inputMode="decimal" className="field" placeholder="Total balance" value={total} onChange={(e) => setTotal(e.target.value)} />
          <input className="field" placeholder="Breakdown note (optional)" value={parts} onChange={(e) => setParts(e.target.value)} />
          <button className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save snapshot'}</button>
        </div>
      )}
    </div>
  );
}

function BudgetPace({ sum }: { sum: FinanceSummary }) {
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const expectedFrac = dayOfMonth / daysInMonth;
  const cats = Object.keys(sum.budgets);
  return (
    <div className="panel">
      <p className="label mb-3">Budget pace · day {dayOfMonth}/{daysInMonth}</p>
      <div className="flex flex-col gap-2.5">
        {cats.map((c) => {
          const spent = sum.byCategory[c] ?? 0;
          const cap = sum.budgets[c];
          const frac = cap ? spent / cap : 0;
          const paceOver = frac > expectedFrac + 0.1;
          const over = frac > 1;
          const barColor = over ? 'bg-pink' : paceOver ? 'bg-amber' : 'bg-green';
          return (
            <div key={c}>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-head uppercase tracking-wide">{c}{c === 'vices' && over ? ' ⚠' : ''}</span>
                <span className={over ? 'text-pink' : 'text-dim'}>{money(spent)} / {money(cap)}</span>
              </div>
              <div className="h-2 rounded-full bg-edge overflow-hidden">
                <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, frac * 100)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LondonGap({ sum }: { sum: FinanceSummary }) {
  const l = sum.london!;
  const floor = l.floor ?? 0;
  const frac = floor ? Math.min(1, l.banked / floor) : 0;
  return (
    <div className="panel">
      <p className="label mb-2">London Fund</p>
      <div className="flex justify-between text-sm mb-1">
        <span>{money(l.banked)} banked</span>
        {l.gapFloor !== null && l.gapFloor > 0 && <span className="text-amber">{money(l.gapFloor)} to floor</span>}
        {l.gapFloor !== null && l.gapFloor <= 0 && <span className="text-green">floor cleared ✓</span>}
      </div>
      <div className="h-2.5 rounded-full bg-edge overflow-hidden">
        <div className="h-full bg-oxblood" style={{ width: `${frac * 100}%` }} />
      </div>
      {l.floor !== null && <p className="text-xs text-dim mt-1">Floor {money(l.floor)}{l.full !== null ? ` · full ${money(l.full)}` : ''}</p>}
    </div>
  );
}

function Debts({ sum }: { sum: FinanceSummary }) {
  return (
    <div className="panel">
      <p className="label mb-3">Debts</p>
      <div className="flex flex-col gap-3">
        {sum.debts.map((d) => {
          const frac = d.principal ? Math.min(1, d.paid / d.principal) : 0;
          return (
            <div key={d.creditor}>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-head uppercase tracking-wide">{d.creditor}</span>
                <span className="text-pink">{money(d.remaining)} left</span>
              </div>
              <div className="h-2 rounded-full bg-edge overflow-hidden">
                <div className="h-full bg-green" style={{ width: `${frac * 100}%` }} />
              </div>
              <p className="text-xs text-dim mt-1">
                Repaid {money(d.paid)} of {money(d.principal)} ({Math.round(frac * 100)}%)
                {d.target ? ` · this month ${money(d.monthPaid)} / ${money(d.target)}` : ' · no target set'}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Recent({ sum }: { sum: FinanceSummary }) {
  return (
    <div className="panel">
      <p className="label mb-3">Recent</p>
      <div className="flex flex-col gap-1.5">
        {sum.recent.map((t, i) => (
          <div key={`${t.date}-${i}-${t.amount}`} className="flex items-center justify-between text-sm border-b border-edge/50 last:border-0 pb-1.5 last:pb-0">
            <div className="min-w-0">
              <p className="truncate">{t.note || t.category}</p>
              <p className="text-xs text-dim">{t.date} · {t.category}</p>
            </div>
            <span className={`font-head tabular-nums ${t.amount < 0 ? 'text-pink' : 'text-green'}`}>
              {t.amount < 0 ? '−' : '+'}{money(Math.abs(t.amount))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
