import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import type { Schema, CalEvent } from '../lib/types';
import { useToast } from '../lib/ui';

// ---- date helpers (all local time) ----------------------------------------
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dtLocal = (d: Date) => `${iso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseDT = (s: string) => {
  if (!s) return new Date(NaN);
  const [date, time] = s.split('T');
  const [y, m, d] = date.split('-').map(Number);
  if (!time) return new Date(y, m - 1, d);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm || 0);
};
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => { const x = new Date(d); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); x.setHours(0, 0, 0, 0); return x; };
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const CAT_COLOR: Record<string, string> = {
  work: 'bg-oxblood', trading: 'bg-green', study: 'bg-cyan', personal: 'bg-accent',
  health: 'bg-amber', social: 'bg-pink', admin: 'bg-dim',
};
const catColor = (c: string) => CAT_COLOR[c] ?? 'bg-dim';

const HOUR_H = 48; // px per hour

type View = 'day' | 'week' | 'month';

export default function Calendar({ schema }: { schema: Schema }) {
  const toast = useToast();
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(new Date());
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [editing, setEditing] = useState<Partial<CalEvent> | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [busy, setBusy] = useState(false);

  const range = useCallback(() => {
    if (view === 'month') {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
      return { from: iso(addDays(startOfWeek(first), 0)), to: iso(addDays(startOfWeek(last), 6)) };
    }
    if (view === 'week') {
      const s = startOfWeek(anchor);
      return { from: iso(s), to: iso(addDays(s, 7)) };
    }
    return { from: iso(anchor), to: iso(addDays(anchor, 1)) };
  }, [view, anchor]);

  const load = useCallback(async () => {
    const { from, to } = range();
    setLoadingEvents(true);
    try { setEvents(await api.events(from, to)); } catch (e) { toast((e as Error).message, 'err'); }
    finally { setLoadingEvents(false); }
  }, [range, toast]);
  useEffect(() => { load(); }, [load]);

  const nav = (n: number) => {
    if (view === 'month') setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + n, 1));
    else if (view === 'week') setAnchor(addDays(anchor, n * 7));
    else setAnchor(addDays(anchor, n));
  };

  const save = async (ev: Partial<CalEvent>) => {
    if (busy) return; // guard against a double-tap creating duplicate rows
    setBusy(true);
    try { await api.upsertEvent(ev); setEditing(null); await load(); toast('Event saved'); }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try { await api.deleteEvent(id); setEditing(null); await load(); toast('Event deleted'); }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  };

  const title = view === 'month'
    ? `${MON[anchor.getMonth()]} ${anchor.getFullYear()}`
    : view === 'day'
      ? `${DOW[(anchor.getDay() + 6) % 7]} ${anchor.getDate()} ${MON[anchor.getMonth()]}`
      : (() => { const s = startOfWeek(anchor); const e = addDays(s, 6); return `${s.getDate()} ${MON[s.getMonth()].slice(0, 3)} – ${e.getDate()} ${MON[e.getMonth()].slice(0, 3)}`; })();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(['day', 'week', 'month'] as View[]).map((v) => (
            <button key={v} className={`chip ${view === v ? 'chip-on' : ''}`} onClick={() => setView(v)}>{v}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button className="btn-ghost px-3" onClick={() => nav(-1)}>‹</button>
          <button className="chip" onClick={() => setAnchor(new Date())}>Today</button>
          <button className="btn-ghost px-3" onClick={() => nav(1)}>›</button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="font-head text-lg font-semibold">{title}</h2>
        <button className="btn-primary py-1.5" onClick={() => {
          const start = new Date(view === 'day' ? anchor : new Date());
          start.setMinutes(0, 0, 0);
          if (view !== 'day') start.setHours(9);
          const end = new Date(start); end.setHours(start.getHours() + 1);
          setEditing({ start: dtLocal(start), end: dtLocal(end), category: 'personal' });
        }}>+ Event</button>
      </div>

      {loadingEvents && <p className="text-xs text-dim">Loading events…</p>}

      {view === 'month' && <MonthGrid anchor={anchor} events={events} onPick={(d) => { setAnchor(d); setView('day'); }} />}
      {view === 'week' && <TimeGrid days={weekDays(anchor)} events={events} onCreate={openCreate(setEditing)} onEdit={setEditing} />}
      {view === 'day' && <TimeGrid days={[anchor]} events={events} onCreate={openCreate(setEditing)} onEdit={setEditing} />}

      {editing && (
        <EventEditor
          schema={schema}
          ev={editing}
          busy={busy}
          onChange={setEditing}
          onSave={save}
          onDelete={remove}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function weekDays(anchor: Date) {
  const s = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

function openCreate(setEditing: (e: Partial<CalEvent>) => void) {
  return (day: Date, hour: number) => {
    const start = new Date(day); start.setHours(hour, 0, 0, 0);
    const end = new Date(start); end.setHours(hour + 1);
    setEditing({ start: dtLocal(start), end: dtLocal(end), category: 'personal' });
  };
}

// ---- time grid (day / week) ------------------------------------------------
function TimeGrid({ days, events, onCreate, onEdit }: {
  days: Date[]; events: CalEvent[]; onCreate: (d: Date, h: number) => void; onEdit: (e: CalEvent) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 7 * HOUR_H; }, []);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const timed = events.filter((e) => !e.allday);
  const allday = events.filter((e) => e.allday);

  return (
    <div className="panel p-0 overflow-hidden">
      {/* day headers */}
      <div className="flex border-b border-edge">
        <div className="w-12 shrink-0" />
        {days.map((d) => {
          const today = sameDay(d, new Date());
          return (
            <div key={iso(d)} className={`flex-1 text-center py-2 ${today ? 'text-oxblood' : 'text-dim'}`}>
              <div className="text-[10px] font-head uppercase tracking-wide">{DOW[(d.getDay() + 6) % 7]}</div>
              <div className={`text-lg font-head ${today ? 'font-bold' : ''}`}>{d.getDate()}</div>
            </div>
          );
        })}
      </div>

      {/* all-day row */}
      {allday.length > 0 && (
        <div className="flex border-b border-edge bg-cream/60">
          <div className="w-12 shrink-0 text-[9px] text-dim text-right pr-1 pt-1 uppercase">all</div>
          {days.map((d) => (
            <div key={iso(d)} className="flex-1 border-l border-edge/50 p-0.5 min-h-[22px] flex flex-col gap-0.5">
              {allday.filter((e) => eventOnDay(e, d)).map((e) => (
                <button key={e.id} onClick={() => onEdit(e)}
                  className={`${catColor(e.category)} text-cream text-[10px] rounded px-1 py-0.5 truncate text-left`}>
                  {e.title || '(untitled)'}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* hour grid */}
      <div ref={scroller} className="overflow-y-auto" style={{ maxHeight: '60vh' }}>
        <div className="flex" style={{ height: 24 * HOUR_H }}>
          <div className="w-12 shrink-0 relative">
            {hours.map((h) => (
              <div key={h} className="absolute right-1 text-[9px] text-dim -translate-y-1/2" style={{ top: h * HOUR_H }}>
                {h === 0 ? '' : `${pad(h)}:00`}
              </div>
            ))}
          </div>
          {days.map((d) => {
            const dayEvents = layout(timed.filter((e) => eventOnDay(e, d)), d);
            return (
              <div key={iso(d)} className="flex-1 relative border-l border-edge/50">
                {hours.map((h) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-edge/40"
                    style={{ top: h * HOUR_H, height: HOUR_H }}
                    onClick={() => onCreate(d, h)} />
                ))}
                {dayEvents.map(({ e, top, height, lane, lanes }) => (
                  <button key={e.id} onClick={(ev) => { ev.stopPropagation(); onEdit(e); }}
                    className={`${catColor(e.category)} text-cream absolute rounded px-1 py-0.5 text-left overflow-hidden`}
                    style={{
                      top, height: Math.max(height, 16),
                      left: `${(lane / lanes) * 100}%`, width: `${(1 / lanes) * 100}%`,
                    }}>
                    <div className="text-[10px] font-semibold leading-tight truncate">{e.title || '(untitled)'}</div>
                    <div className="text-[9px] opacity-80 leading-tight truncate">
                      {parseDT(e.start).getHours()}:{pad(parseDT(e.start).getMinutes())}
                    </div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function eventOnDay(e: CalEvent, d: Date) {
  const s = parseDT(e.start);
  const en = e.end ? parseDT(e.end) : s;
  const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(d); dayEnd.setHours(23, 59, 59, 999);
  return s <= dayEnd && en >= dayStart;
}

// assign overlapping events to lanes so they sit side by side
function layout(evs: CalEvent[], day: Date) {
  const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0);
  const items = evs.map((e) => {
    const s = parseDT(e.start), en = e.end ? parseDT(e.end) : new Date(s.getTime() + 3600000);
    const startMin = Math.max(0, (s.getTime() - dayStart.getTime()) / 60000);
    const endMin = Math.min(24 * 60, (en.getTime() - dayStart.getTime()) / 60000);
    return { e, startMin, endMin: Math.max(endMin, startMin + 15) };
  }).sort((a, b) => a.startMin - b.startMin);

  const laneEnds: number[] = [];
  const placed = items.map((it) => {
    let lane = laneEnds.findIndex((end) => end <= it.startMin);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.endMin); }
    else laneEnds[lane] = it.endMin;
    return { ...it, lane };
  });
  // compute overlap group size per item (simplified: total lanes used that day)
  const lanes = Math.max(1, laneEnds.length);
  return placed.map((p) => ({
    e: p.e, lane: p.lane, lanes,
    top: (p.startMin / 60) * HOUR_H,
    height: ((p.endMin - p.startMin) / 60) * HOUR_H,
  }));
}

// ---- month grid ------------------------------------------------------------
function MonthGrid({ anchor, events, onPick }: { anchor: Date; events: CalEvent[]; onPick: (d: Date) => void }) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weeks = 6;

  return (
    <div className="panel p-2">
      <div className="grid grid-cols-7 mb-1">
        {DOW.map((d) => <div key={d} className="text-center text-[10px] font-head uppercase text-dim">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1" style={{ gridTemplateRows: `repeat(${weeks}, minmax(64px, 1fr))` }}>
        {cells.slice(0, weeks * 7).map((d) => {
          const inMonth = d.getMonth() === anchor.getMonth();
          const today = sameDay(d, new Date());
          const dayEvents = events.filter((e) => eventOnDay(e, d));
          return (
            <button key={iso(d)} onClick={() => onPick(d)}
              className={`text-left rounded-lg border p-1 overflow-hidden ${inMonth ? 'border-edge bg-cream' : 'border-transparent opacity-40'}`}>
              <div className={`text-xs font-head ${today ? 'text-cream bg-oxblood rounded-full w-5 h-5 flex items-center justify-center' : ''}`}>
                {d.getDate()}
              </div>
              <div className="flex flex-col gap-0.5 mt-0.5">
                {dayEvents.slice(0, 3).map((e) => (
                  <div key={e.id} className={`${catColor(e.category)} text-cream text-[9px] rounded px-1 truncate`}>
                    {e.title || '(untitled)'}
                  </div>
                ))}
                {dayEvents.length > 3 && <div className="text-[9px] text-dim">+{dayEvents.length - 3}</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- event editor ----------------------------------------------------------
function EventEditor({ schema, ev, busy, onChange, onSave, onDelete, onClose }: {
  schema: Schema; ev: Partial<CalEvent>; busy: boolean;
  onChange: (e: Partial<CalEvent>) => void;
  onSave: (e: Partial<CalEvent>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  // Snapshot the event as first opened so a backdrop tap can warn before
  // discarding edits. EventEditor remounts each time the modal opens.
  const originalRef = useRef(JSON.stringify(ev));
  const set = (patch: Partial<CalEvent>) => onChange({ ...ev, ...patch });
  const allday = !!ev.allday;
  const dirty = JSON.stringify(ev) !== originalRef.current;
  const tryClose = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  };
  const del = () => {
    if (!ev.id) return;
    if (!window.confirm('Delete this event?')) return;
    onDelete(ev.id);
  };
  return (
    <div className="fixed inset-0 z-40 bg-ink/40 flex items-end sm:items-center justify-center p-4" onClick={tryClose}>
      <div className="panel w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <p className="label">{ev.id ? 'Edit event' : 'New event'}</p>
          <button className="text-dim text-xl leading-none" onClick={tryClose}>×</button>
        </div>
        <div className="flex flex-col gap-3">
          <input className="field text-lg" placeholder="Title" value={ev.title ?? ''} onChange={(e) => set({ title: e.target.value })} />

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allday} onChange={(e) => set({ allday: e.target.checked })} />
            <span className="font-head uppercase tracking-wide text-xs">All day</span>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="label">Start</span>
              <input type={allday ? 'date' : 'datetime-local'} className="field text-sm"
                value={allday ? (ev.start ?? '').slice(0, 10) : (ev.start ?? '')}
                onChange={(e) => set({ start: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">End</span>
              <input type={allday ? 'date' : 'datetime-local'} className="field text-sm"
                value={allday ? (ev.end ?? '').slice(0, 10) : (ev.end ?? '')}
                onChange={(e) => set({ end: e.target.value })} />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="label">Category</span>
            <select className="field" value={ev.category ?? 'personal'} onChange={(e) => set({ category: e.target.value })}>
              {schema.calendar.categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          <input className="field" placeholder="Location" value={ev.location ?? ''} onChange={(e) => set({ location: e.target.value })} />
          <textarea className="field resize-y min-h-[60px]" placeholder="Notes" value={ev.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />

          <div className="flex gap-2">
            {ev.id && <button className="btn-ghost text-pink border-pink" disabled={busy} onClick={del}>Delete</button>}
            <button className="btn-primary flex-1" disabled={busy} onClick={() => onSave(ev)}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
