# Critjecture

Step 5 extends the `pnpm` monorepo with RBAC-aware local search, an isolated `uv` Python sandbox, generated PNG/PDF outputs, and secure file serving for in-chat charts and downloadable documents.

Step 6 adds a local SQLite audit log, client-side tool execution auditing, and an owner-gated `/admin/logs` dashboard.

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
- `company_data/admin/rent_delinquency.csv`

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
- `matplotlib` installed for chart generation
- `reportlab` installed for PDF generation

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

## Step 5 Visuals and Documents

Step 5 adds two new sandbox-backed tools:

- `generate_visual_graph` for PNG charts
- `generate_document` for PDF notices

Each tool:

- accepts `role`
- accepts optional `inputFiles`
- runs in a fresh sandbox workspace under `/tmp/workspace/<run-id>`
- must save the final artifact inside `outputs/`

Generated assets are served back through:

- `GET /api/generated-files/<workspace-id>/<outputs-relative-path>`

The route only serves:

- `.png`
- `.pdf`

from inside the sandbox `outputs/` directory.

### Step 5 Demo Data

The document demo uses:

- `company_data/admin/rent_delinquency.csv`

The chart demo continues to use:

- `company_data/admin/contractors_new.csv`

### Suggested Step 5 Checks

- As `Owner`, ask `Create a bar chart of the top 3 contractor payouts.`
- Confirm the UI shows `search_company_knowledge` before `generate_visual_graph` when a company file is needed.
- Confirm the tool card renders a PNG preview and an image link after execution.
- As `Owner`, ask `Generate a late rent notice PDF for Unit 4B.`
- Confirm the UI shows `search_company_knowledge` before `generate_document`.
- Confirm the tool card renders a `Download Document` action for the generated PDF.
- As `Intern`, ask for the same chart and notice and confirm the assistant reports that the data is unavailable in the current access scope.

### Future Improvement Note

- A useful follow-up would be letting `run_data_analysis` persist a structured output file that `generate_visual_graph` or `generate_document` can consume directly, instead of recomputing from the original staged company data each time.

## Environment

`apps/web/.env.local` supports:

```bash
OPENAI_API_KEY=your-key-here
OPENAI_MODEL=gpt-4o-mini
```

If `OPENAI_API_KEY` is missing, the API route returns a clear configuration error.

## Step 6 Audit Logging

Step 6 adds:

- a local SQLite database at `apps/web/data/audit.sqlite`
- audit write routes under `apps/web/app/api/audit`
- an owner-only audit dashboard at `http://localhost:3000/admin/logs`

The Step 6 audit flow logs:

- each real user prompt
- the active role
- the exact tool arguments for every executed tool call
- tool completion or error summaries

Notes:

- file-picker continuation prompts are treated as synthetic follow-ups and stay attached to the original human prompt
- `/admin/logs` is gated by the current MVP role selector, not real auth
- `better-sqlite3` is a native dependency; if install scripts are skipped, run:

```bash
pnpm approve-builds --all
```

### Suggested Step 6 Checks

- As `Intern`, ask `What is our profit?` and confirm `/admin/logs?role=owner` shows the prompt plus a `search_company_knowledge` entry.
- As `Owner`, ask `Create a bar chart of the top 3 contractor payouts.` and confirm the dashboard shows both the search and graph tool calls with raw parameters.
- Ask `contractor payouts`, choose one of the two files, and confirm the later analysis/graph tool call stays attached to the original prompt row instead of creating a second prompt entry.
- Open `/admin/logs?role=intern` and confirm the page shows the owner-only access state without fetching the logs.
