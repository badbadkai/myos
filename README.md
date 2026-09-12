# myOS

Kai's personal operating system — a PWA that writes directly into the Hub vault
(the second brain) through a small local bridge. Key in a detail, press submit,
and it lands in the right file instantly: daily-note fields, the finance ledger,
habits, the calendar, or the inbox.

## How it works

```
  PWA (React + Vite)  ──/api──▶  bridge (Express, :4177)  ──▶  Hub vault files
```

- **Bridge** (`server/`) holds the only write-head to the vault. It locates the
  vault by probing drive letters for the `ME.md` marker (the SILVER drive letter
  moves), reads `x/myos.schema.json` to know where every field lives, and exposes
  a small REST API. It never ships a raw folder handle — only specific operations.
- **PWA** (`src/`) is the front-end: Today, Money, Calendar, Habits, Settings.
- **Schema-driven:** add a field in `x/myos.schema.json` in the vault and it shows
  up with no app rebuild.

The derived-balance rule is shared with `finance-reconcile.ps1`:
`banked = latest snapshot total + Σ(transactions dated after that snapshot)`,
written back to `London Fund.md` `banked::` on every money capture.

## Run

```bash
npm install
npm run dev        # bridge (:4177) + vite (:5173) together
```

Open http://localhost:5173. Vite proxies `/api` to the bridge.

### Production (the real setup)

```bash
npm run build      # tsc + vite → dist/
npm start          # bridge serves dist/ at http://localhost:4177
```

One origin, installable as a PWA, no CORS or mixed-content issues, no GitHub Pro
needed. Point your phone/desktop browser at the machine running the bridge.

### Vault override

The bridge auto-finds the vault. To force a path: set `MYOS_VAULT` to the vault
root (the folder containing `ME.md`). Bridge port: `MYOS_BRIDGE_PORT` (default 4177).

## Writes to

| View | Target |
|---|---|
| Today | `03 Calendar/02 Daily Notes/{date}.md` frontmatter + `## Habits` checkboxes |
| Money | `06 Areas/03 Finance/raw/*.csv` + `London Fund.md` `banked::` |
| Calendar | `03 Calendar/events.csv` |
| Habits | reads `06 Areas/05 Habits/raw/habits.csv` |
| Inbox | `01 +/Capture ….md` |

All edits are surgical (line-level frontmatter edits, CSV appends, checkbox flips)
to preserve the vault's exact on-disk style and Meta Bind inline inputs.
