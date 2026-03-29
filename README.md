# Critjecture

Critjecture is a local-first AI workspace for property-management operations. It combines a chat interface, role-aware access to company files, sandboxed Python tooling, generated charts and documents, and an owner-facing audit trail of what the assistant did.

The project is built as a `pnpm` monorepo with a Next.js web app in `apps/web` and a separate `uv`-managed Python environment in `packages/python-sandbox`.

## What It Does

- Answers questions against tenant-owned company knowledge with role-based access control.
- Searches organization data and asks for clarification when multiple files are plausible.
- Runs structured data analysis in an isolated Python sandbox using Polars.
- Generates PNG charts and PDF documents from approved company data.
- Records chat turns, tool calls, accessed files, and assistant responses in an audit dashboard.

## Core Experience

### Chat

The main app lives at `http://localhost:3000/chat`.

The chat UI uses `@mariozechner/pi-web-ui` with Critjecture-owned styling. The assistant can call four primary tools:

- `search_company_knowledge`
- `run_data_analysis`
- `generate_visual_graph`
- `generate_document`

When a question depends on company data, the assistant searches the current organization's approved files for the authenticated role, stages selected files into the sandbox, and then uses analysis or generation tools as needed.

### Roles

The current MVP has two real application roles per organization membership:

- `Intern`: limited to `company_data/public`
- `Owner`: can access all of that organization's `company_data`

Role is derived from the authenticated server session and organization membership, not from client-side UI state.

### Authentication and Tenancy

Protected routes require sign-in. Critjecture currently ships with:

- one seeded organization
- one seeded `Owner`
- one seeded `Intern`

Sessions are cookie-based. Backend routes derive permissions and tenant scope from the authenticated session, and generated files are only retrievable by the authenticated user who created them inside the same organization.

### Audit Logs

The owner audit dashboard lives at `http://localhost:3000/admin/logs`.

It shows a newest-first list of chat turn cards scoped to the current organization. Expanding a card reveals a chronological timeline of:

- assistant responses
- tool calls

Each card can be filtered to show all events, only assistant responses, or only tool calls. Tool events include raw parameters, accessed files, completion summaries, and any errors. Chat turn cards also show the initiating authenticated user and the chat session id that produced the interaction.

## Architecture

### Web App

- Framework: Next.js App Router
- Frontend: React plus `@mariozechner/pi-web-ui`
- Backend: Next.js route handlers
- Primary persistence: SQLite via `better-sqlite3` and Drizzle helpers
- Tenant model: organizations plus organization memberships

### Storage Model

Critjecture is now SQLite-first for:

- local development
- customer-managed hardware / on-prem
- Railway deployments with attached persistent storage

The runtime storage model is:

- SQLite database: `DATABASE_URL` or `<CRITJECTURE_STORAGE_ROOT>/critjecture.sqlite`
- persistent tenant data: `<CRITJECTURE_STORAGE_ROOT>/organizations/<organization-slug>/company_data`
- ephemeral sandbox workspaces: `/tmp/workspace/<run-id>`

The repo-root `sample_company_data/` directory is bundled sample data. On first boot, Critjecture copies that sample data into the active organization's storage directory if needed.

### Python Sandbox

The Python execution environment is isolated under `packages/python-sandbox`.

Key properties:

- interpreter is fixed to the project sandbox `.venv`
- execution runs in a fresh workspace under `/tmp/workspace/<run-id>`
- inherited environment variables are stripped before Python runs
- approved company files are staged into `inputs/`
- generated artifacts must be written to `outputs/`

Installed Python tooling includes:

- `polars`
- `matplotlib`
- `reportlab`

## Repository Layout

```text
apps/web                  Next.js app, API routes, audit UI, chat UI
sample_company_data       Bundled sample company data copied into org storage on first boot
deployment.md             Deployment and backup guidance for local, hardware, and Railway
packages/python-sandbox   Isolated Python runtime managed by uv
steps_completed.md        Implementation history by milestone
storage/                  Default local runtime storage root (gitignored)
```

## Requirements

- Node.js 20.9 or newer
- `pnpm` 10.x
- `uv` 0.11 or newer
- `OPENAI_API_KEY` for live chat

## Quick Start

```bash
pnpm install
uv sync --project packages/python-sandbox
cp apps/web/.env.local.example apps/web/.env.local
pnpm db:migrate
pnpm dev
```

Open:

- `http://localhost:3000/login`
- `http://localhost:3000/chat`
- `http://localhost:3000/admin/logs`

## Environment

`apps/web/.env.local` supports:

```bash
AUTH_SECRET=replace-with-a-long-random-string
OPENAI_API_KEY=your-key-here
OPENAI_MODEL=gpt-4o-mini
DATABASE_URL=./storage/critjecture.sqlite
CRITJECTURE_STORAGE_ROOT=./storage
CRITJECTURE_ORGANIZATION_NAME=Critjecture Demo
CRITJECTURE_ORGANIZATION_SLUG=critjecture-demo
CRITJECTURE_OWNER_EMAIL=owner@example.com
CRITJECTURE_OWNER_PASSWORD=change-me-owner
CRITJECTURE_OWNER_NAME=Owner Demo
CRITJECTURE_INTERN_EMAIL=intern@example.com
CRITJECTURE_INTERN_PASSWORD=change-me-intern
CRITJECTURE_INTERN_NAME=Intern Demo
```

If `OPENAI_API_KEY` is missing, the chat API returns a clear configuration error.
If the seeded user env vars are missing, login will not succeed because no pilot accounts will be available.

## Deployment

The supported primary deployment path is SQLite-backed in all current environments:

- local machine
- customer-managed hardware
- Railway with an attached volume

Start with:

- `pnpm db:migrate`
- `pnpm build`
- `pnpm start`

Read [deployment.md](/home/hard2vary/projects/critjecture/deployment.md) for the exact storage, backup, restore, and Railway guidance.

## Demo Data

The repo includes bundled sample company data under `sample_company_data`, including:

- public schedules
- admin profit data
- contractor ledgers
- rent delinquency records

Useful example prompts:

- `What is our profit?`
- `What is the average payout in our 2026 contractor ledger?`
- `contractor payouts`
- `Create a bar chart of the top 3 contractor payouts.`
- `Generate a late rent notice PDF for Unit 4B.`

## Development Notes

### `pi-web-ui` CSS

The upstream package stylesheet is generated into:

- `apps/web/app/pi-web-ui.generated.css`

Do not hand-edit that file. Refresh it after upgrading `@mariozechner/pi-web-ui` with:

```bash
pnpm --filter web sync:pi-web-ui-css
```

Keep Critjecture-specific styling in:

- `apps/web/app/pi-web-ui.css`
- `apps/web/app/globals.css`

### Native SQLite Dependency

`better-sqlite3` is a native dependency. If install scripts are blocked, run:

```bash
pnpm approve-builds --all
```

### Generated Files

Sandbox-generated artifacts are served through:

- `GET /api/generated-files/<workspace-id>/<outputs-relative-path>`

Only sandbox output files with approved extensions are served back to the UI, and only to the authenticated user who created the sandbox run inside the same organization.
