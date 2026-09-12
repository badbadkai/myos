import { useState } from 'react';
import { api } from '../lib/api';

export default function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api.login(email.trim(), password);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center px-6 py-16">
      <form onSubmit={submit} className="panel w-full max-w-sm flex flex-col gap-4">
        <div className="flex flex-col items-center gap-3 mb-2">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="myOS" className="w-16 h-16" />
          <h1 className="font-head text-2xl font-bold text-oxblood tracking-tight">myOS</h1>
          <p className="text-xs text-dim">my operating system</p>
        </div>
        <label className="flex flex-col gap-1">
          <span className="label">Email</span>
          <input type="email" autoComplete="username" className="field" value={email}
            onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Password</span>
          <input type="password" autoComplete="current-password" className="field" value={password}
            onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {err && <p className="text-sm text-pink">{err}</p>}
        <button className="btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="text-[11px] text-dim text-center">Stays signed in on this device for 30 days.</p>
      </form>
    </div>
  );
}
