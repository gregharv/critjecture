# Critjecture

Critjecture is a local-first AI workspace for property-management operations. It combines a chat interface, role-aware access to company files, sandboxed Python tooling, generated charts and documents, and an owner-facing audit trail of what the assistant did.

The project is built as a `pnpm` monorepo with a Next.js web app in `apps/web` and a separate `uv`-managed Python environment in `packages/python-sandbox`.

## What It Does

- Answers questions against tenant-owned company knowledge with role-based access control.
- Searches organization data and asks for clarification when multiple files are plausible.
- Runs structured data analysis in an isolated Python sandbox using Polars.
- Generates PNG charts and PDF documents from approved company data.
- Persists short-lived chart-ready analysis results in SQLite so `analysisResultId` survives normal app restarts within its TTL.
- Lets authenticated users upload approved tenant files into organization-owned knowledge storage.
- Records chat turns, tool calls, accessed files, and assistant responses in an audit dashboard.
- Provides scripted backup creation, clean restore tooling, and repeatable recovery drills for the persisted runtime state.

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

Deployment modes:

- `single_org`: local development and on-prem, with env-seeded default org and pilot users
- `hosted`: Railway-style centrally managed multi-org deployment, where tenant provisioning is handled by the operator script

### Audit Logs

The owner audit dashboard lives at `http://localhost:3000/admin/logs`.

It shows a newest-first list of chat turn cards scoped to the current organization. Expanding a card reveals a chronological timeline of:

- assistant responses
- tool calls

Each card can be filtered to show all events, only assistant responses, or only tool calls. Tool events include raw parameters, accessed files, completion summaries, and any errors. Chat turn cards also show the initiating authenticated user and the chat session id that produced the interaction.

### Operations

The owner operations dashboard lives at `http://localhost:3000/admin/operations`.

It adds:

- route health and dependency checks
- recent failures and rate-limit activity
- open operational alerts
- per-user and per-organization usage and cost summaries

There is also a public `GET /api/health` endpoint for liveness/readiness checks.

Observed API routes attach `x-critjecture-request-id` so production failures can be correlated across request logs, sandbox runs, knowledge imports, and governance jobs. Critical operational alerts can also be delivered to an external webhook via `CRITJECTURE_ALERT_WEBHOOK_URL`.

### Settings

The owner settings dashboard lives at `http://localhost:3000/admin/settings`.

It adds:

- member creation, role changes, suspension/reactivation, and password resets
- organization display-name updates
- retention settings for logs, usage, alerts, chat history, and import metadata
- full-organization export jobs
- export-gated purge jobs for chat history, import metadata, and managed knowledge files
- customer-review links for the security review pack plus deployment, compliance, and hosted provisioning docs

### Knowledge Library

The knowledge library lives at `http://localhost:3000/knowledge`.

Authenticated users can upload `.csv`, `.txt`, `.md`, and text-extractable `.pdf` files into the current organization's knowledge tree.

- `Intern`: uploads only to `company_data/public/uploads/...`
- `Owner`: uploads to either `company_data/public/uploads/...` or `company_data/admin/uploads/...`

Uploaded files are indexed on upload, tracked in SQLite metadata, visible in the knowledge library UI, and searchable through the existing `search_company_knowledge` flow. Uploaded files that pass authorization can also be staged into the Python sandbox through the existing `inputFiles` mechanism.

## Platform

### Application

- Web experience: Next.js App Router with React plus `@mariozechner/pi-web-ui`
- Persistent app data: SQLite via `better-sqlite3` and Drizzle helpers
- Organization model: organizations plus organization memberships

### Storage

Critjecture uses a SQLite-first runtime for:

- local development
- customer-managed hardware / on-prem
- Railway deployments with attached persistent storage

The runtime storage model is:

- SQLite database: `DATABASE_URL` or `<CRITJECTURE_STORAGE_ROOT>/critjecture.sqlite`
- persistent tenant data: `<CRITJECTURE_STORAGE_ROOT>/organizations/<organization-slug>/company_data`
- persistent generated assets: `<CRITJECTURE_STORAGE_ROOT>/organizations/<organization-slug>/generated_assets`
- persistent knowledge import staging: `<CRITJECTURE_STORAGE_ROOT>/organizations/<organization-slug>/knowledge_staging`
- governance/export artifacts: `<CRITJECTURE_STORAGE_ROOT>/organizations/<organization-slug>/governance`
- ephemeral sandbox workspaces: `/tmp/workspace/<run-id>`

The repo-root `sample_company_data/` directory is bundled sample data. On first boot, Critjecture copies that sample data into the active organization's storage directory if needed.

### Sandbox

The Python execution environment is isolated under `packages/python-sandbox`.

Key properties:

- interpreter is fixed to the project sandbox `.venv`
- `single_org` runs through a local supervisor that launches Linux `bubblewrap`
- `hosted` must use a dedicated remote sandbox supervisor service
- execution uses a fresh workspace under `/tmp/workspace/<run-id>` with immediate cleanup after finalization
- inherited environment variables are stripped before Python runs
- approved company files are staged into `inputs/`
- generated artifacts must be written to `outputs/`
- accepted PNG/PDF outputs are copied into tenant storage with a short TTL before being served back to the UI

Installed Python tooling includes:

- `polars`
- `matplotlib`
- `reportlab`

## Repository Layout

```text
apps/web                  Next.js app, API routes, audit UI, chat UI
apps/web/docs             Canonical customer-review, deployment, and runbook documentation
sample_company_data       Bundled sample company data copied into org storage on first boot
deployment.md             Compatibility wrapper pointing at the canonical deployment guide
packages/python-sandbox   Isolated Python runtime managed by uv
steps_completed.md        Implementation history by milestone
storage/                  Default local runtime storage root (gitignored)
```

## Requirements

- Node.js 20.9 or newer
- `pnpm` 10.x
- `uv` 0.11 or newer
- `single_org`: Linux host with `bubblewrap` and `prlimit`
- `hosted`: `CRITJECTURE_SANDBOX_SUPERVISOR_URL` pointing at the dedicated sandbox supervisor
- `pdftotext` available on the host for uploaded PDF ingestion
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
- `http://localhost:3000/knowledge`
- `http://localhost:3000/admin/operations`
- `http://localhost:3000/admin/logs`
- `http://localhost:3000/admin/settings`

## Environment

`apps/web/.env.local` supports:

```bash
AUTH_SECRET=replace-with-a-long-random-string
OPENAI_API_KEY=your-key-here
OPENAI_MODEL=gpt-5.4-mini
DATABASE_URL=./storage/critjecture.sqlite
CRITJECTURE_STORAGE_ROOT=./storage
CRITJECTURE_DEPLOYMENT_MODE=single_org
CRITJECTURE_ORGANIZATION_NAME=Critjecture Demo
CRITJECTURE_ORGANIZATION_SLUG=critjecture-demo
CRITJECTURE_OWNER_EMAIL=owner@example.com
CRITJECTURE_OWNER_PASSWORD=change-me-owner
CRITJECTURE_OWNER_NAME=Owner Demo
CRITJECTURE_INTERN_EMAIL=intern@example.com
CRITJECTURE_INTERN_PASSWORD=change-me-intern
CRITJECTURE_INTERN_NAME=Intern Demo
CRITJECTURE_REQUEST_LOG_RETENTION_DAYS=14
CRITJECTURE_USAGE_RETENTION_DAYS=30
CRITJECTURE_DAILY_MODEL_COST_CAP_USD_USER=3
CRITJECTURE_DAILY_MODEL_COST_CAP_USD_ORGANIZATION=20
CRITJECTURE_DAILY_SANDBOX_RUN_CAP_USER=25
CRITJECTURE_DAILY_SANDBOX_RUN_CAP_ORGANIZATION=100
CRITJECTURE_SANDBOX_SUPERVISOR_HEARTBEAT_MS=1000
CRITJECTURE_SANDBOX_SUPERVISOR_LEASE_MS=25000
CRITJECTURE_SANDBOX_WAIT_FOR_RESULT_TIMEOUT_MS=30000
CRITJECTURE_SANDBOX_SUPERVISOR_URL=
CRITJECTURE_SANDBOX_SUPERVISOR_TOKEN=
CRITJECTURE_SANDBOX_SUPERVISOR_TIMEOUT_MS=15000
CRITJECTURE_CHAT_MAX_TOKENS_HARD_CAP=4000
CRITJECTURE_ALERT_WEBHOOK_URL=
```

Operator incident runbooks live under `apps/web/docs/runbooks/` and cover sandbox, storage, migration, backup/restore, hosted, and on-prem response paths.

If `OPENAI_API_KEY` is missing, the chat API returns a clear configuration error.
If `CRITJECTURE_DEPLOYMENT_MODE=single_org`, missing seeded user env vars mean login will not succeed because no pilot accounts will be available.
If `CRITJECTURE_DEPLOYMENT_MODE=hosted`, tenant orgs and users should be created with `pnpm --filter web provision:hosted-org`.

## Deployment

The supported current deployment envelope is SQLite-backed in both current modes:

- `single_org` for local development, customer-managed hardware, and controlled on-prem pilots
- `hosted` for Railway-style centrally operated deployments with a dedicated sandbox supervisor service

The intended first production path is a controlled `single_org` pilot. `hosted` remains supported, but it carries a higher operational and security-review bar because tenant isolation is enforced in shared operator-managed infrastructure.

Start with:

- `pnpm db:migrate`
- `pnpm build`
- `pnpm start`

Recovery tooling is available from the repo root:

- `pnpm backup:create -- --output-dir ./backups`
- `pnpm backup:restore -- --backup ./backups/<timestamped-backup-dir> --database-path ./restore/storage/critjecture.sqlite --storage-root ./restore/storage`
- `pnpm backup:verify -- --deployment-mode both`

Read [security_review.md](/home/hard2vary/projects/critjecture/apps/web/docs/security_review.md) for the current security, privacy, and deployment boundary summary.
Read [deployment.md](/home/hard2vary/projects/critjecture/apps/web/docs/deployment.md) for exact storage, backup, restore, and hosted/on-prem guidance.
Read [compliance_controls.md](/home/hard2vary/projects/critjecture/apps/web/docs/compliance_controls.md) for the shipped governance and retention controls.
Read [hosted_provisioning.md](/home/hard2vary/projects/critjecture/apps/web/docs/hosted_provisioning.md) for the hosted multi-org provisioning flow.

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

Useful upload checks:

- Upload a public `.csv` file, then ask the chat to summarize it.
- Upload an admin `.pdf` as Owner, then search for a phrase from the PDF.
- Confirm that Intern cannot see or use admin-scope uploads.

Useful Step 19 checks:

- Open `/admin/settings` as Owner and create a second member.
- Queue a full export, then download the resulting archive.
- Confirm purge buttons stay disabled until a recent export exists and a cutoff date is selected.

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

### Tests

Run the targeted Step 19 checks with:

```bash
pnpm test
```

### Native SQLite Dependency

`better-sqlite3` is a native dependency. If install scripts are blocked, run:

```bash
pnpm approve-builds --all
```

### Generated Files

Sandbox-generated artifacts are served through:

- `GET /api/generated-files/<run-id>/<outputs-relative-path>`

Only approved sandbox output files are served back to the UI, only to the authenticated user who created the sandbox run inside the same organization, and only until the artifact TTL expires.

Read [sandbox.md](/home/hard2vary/projects/critjecture/sandbox.md) for the current sandbox defaults, rationale, and tuning boundaries.
