# Critjecture

Step 4 extends the `pnpm` monorepo with an RBAC-aware local search tool plus an isolated `uv` Python sandbox that can discover company files, disambiguate between multiple matching ledgers, stage the chosen file, and run lazy Polars analysis safely.

The `/chat` UI uses a Critjecture grey/blue wrapper theme around `@mariozechner/pi-web-ui`.

## Requirements

- Node.js 20.9 or newer
- `pnpm` 10.x
- `uv` 0.11 or newer
- `OPENAI_API_KEY` for live chat verification

## Quick Start

```bash
pnpm install
uv sync --project packages/python-sandbox
cp apps/web/.env.local.example apps/web/.env.local
pnpm dev
```

Open `http://localhost:3000/chat`.

## `pi-web-ui` Upgrade Notes

The package stylesheet is generated locally into:

- `apps/web/app/pi-web-ui.generated.css`

Do not hand-edit that file. On `@mariozechner/pi-web-ui` upgrades, refresh it with:

```bash
pnpm --filter web sync:pi-web-ui-css
```

Keep Critjecture-specific styling in:

- `apps/web/app/pi-web-ui.css`
- `apps/web/app/globals.css`

## Step 2 Demo Data

The repo now includes:

- `company_data/public/schedule.txt`
- `company_data/admin/profit.txt`
- `company_data/admin/contractors_new.csv`
- `company_data/admin/contractors.csv`

In the chat UI:

- `Intern` can only search `company_data/public`
- `Owner` can search all of `company_data`

Suggested checks:

- As `Intern`, ask `What is our profit?`
- As `Owner`, ask `What is our profit?`

## Step 3 Sandbox

The repo now includes a standalone Python sandbox project at:

- `packages/python-sandbox`

The Next.js backend executes Python from the hardcoded project interpreter:

- `packages/python-sandbox/.venv/bin/python`

The sandbox runs with:

- working directory fixed to `/tmp/workspace`
- a stripped environment so app secrets are not passed into Python
- `polars` installed for tabular analysis

## Step 4 ReAct Flow

Step 4 now combines three behaviors:

- forgiving company search
- ambiguous file selection
- staged lazy-Polars analysis

### Search

`search_company_knowledge` now:

- starts with exact phrase search
- falls back to tokenized raw-content search and filename matching
- groups matches by file instead of returning only flat lines
- returns compact previews for candidate files
- auto-selects a file only when there is a clear winner

When multiple files are still plausible, the chat UI renders a picker so the user can choose the file before analysis continues.

### Analysis

`run_data_analysis` accepts:

- `role`
- optional `inputFiles` as `company_data`-relative paths such as `admin/contractors_new.csv`

Each approved input file is staged inside a fresh sandbox workspace under:

- `inputs/<same-relative-path>`

For CSV analysis, the assistant is required to use:

- `pl.scan_csv(...)`
- a final `.collect()`

The Step 4 guard rejects:

- `pandas`
- `pd.read_csv(...)`
- `pl.read_csv(...)`

### Demo Ledgers

The current ambiguous search demo uses:

- `company_data/admin/contractors_new.csv` for 2026
- `company_data/admin/contractors.csv` for 2025

### Suggested Step 4 Checks

- As `Owner`, ask `What is the average payout in our 2026 contractor ledger?`
- Confirm the UI shows `search_company_knowledge` first and `run_data_analysis` second.
- Confirm the search auto-selects `admin/contractors_new.csv`.
- Confirm the staged file list includes `admin/contractors_new.csv`.
- Confirm the final answer reports an average payout of `1500`.
- Ask `contractor payouts` and confirm the UI shows both contractor CSV files with a picker before analysis runs.
- Click each candidate once and confirm the analysis uses only the selected file.
- As `Intern`, ask the same question and confirm the assistant reports that the data is unavailable in the current access scope.

### UI Notes

- The file picker is app-owned UI rendered inside the chat history.
- The Python sandbox card shows staged files, code, stdout, and stderr.
- On mobile, long Python/code output should stay inside the card and scroll internally instead of overflowing the viewport.

## Environment

`apps/web/.env.local` supports:

```bash
OPENAI_API_KEY=your-key-here
OPENAI_MODEL=gpt-4o-mini
```

If `OPENAI_API_KEY` is missing, the API route returns a clear configuration error.
