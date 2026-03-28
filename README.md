# Critjecture

Step 3 extends the `pnpm` monorepo with an RBAC-aware local search tool plus an isolated `uv` Python sandbox for deterministic data analysis.

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

Suggested Step 3 smoke check:

- Start a fresh chat session.
- Send any first message in `/chat`.
- The temporary Step 3 smoke-test prompt will force a `run_data_analysis` tool call that executes `import polars as pl; print(2 + 2)`.
- Success is the assistant returning `4`.

## Environment

`apps/web/.env.local` supports:

```bash
OPENAI_API_KEY=your-key-here
OPENAI_MODEL=gpt-4o-mini
```

If `OPENAI_API_KEY` is missing, the API route returns a clear configuration error.
