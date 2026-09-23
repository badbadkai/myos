// Offline write queue. When the bridge is unreachable, vault writes are parked
// in localStorage and replayed in order once the connection returns, so a log
// tapped out on the subway isn't lost. Only mutations are queued; reads and
// auth never are.

const KEY = 'myos.queue';

export interface QueuedWrite {
  id: string;
  path: string; // e.g. '/finance/transaction'
  method: string; // POST | PUT | DELETE
  body?: string; // JSON string
  ts: number;
  label: string; // human summary for the pending list
}

function read(): QueuedWrite[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedWrite[]) : [];
  } catch {
    return [];
  }
}

function write(q: QueuedWrite[]) {
  localStorage.setItem(KEY, JSON.stringify(q));
  window.dispatchEvent(new CustomEvent('myos:queue', { detail: q.length }));
}

export const queue = {
  list: read,
  size: () => read().length,
  add: (path: string, method: string, body: string | undefined, label: string) => {
    const q = read();
    q.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, path, method, body, ts: Date.now(), label });
    write(q);
  },
  remove: (id: string) => write(read().filter((w) => w.id !== id)),
  clear: () => write([]),
};
