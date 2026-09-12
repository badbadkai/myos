import type { Schema } from '../lib/types';

export default function Settings({ schema, vault }: { schema: Schema; vault: string }) {
  return (
    <div className="flex flex-col gap-4">
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
    </div>
  );
}
