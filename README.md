# Critjecture

Critjecture is an auditable AI data analyst for business teams. It combines a chat interface, role-aware access to company files, sandboxed analysis tooling, generated outputs, and an admin-visible audit trail of what the system did to produce each answer.

The project is built as a `pnpm` monorepo with a Next.js web app in `apps/web` and a separate `uv`-managed Python environment in `packages/python-sandbox`.

## What It Does

- Answers business questions against organization data with role-based access control.
- Searches organization knowledge and asks for clarification when multiple files are plausible.
- Runs structured data analysis in an isolated Python sandbox using Polars.
- Generates PNG charts and PDF documents when those outputs help explain or operationalize an answer.
- Persists short-lived chart-ready analysis results in SQLite so `analysisResultId` survives normal app restarts within its TTL.
- Lets authenticated users upload approved files into organization-owned knowledge storage.
- Records chat turns, tool calls, accessed files, and assistant responses in an audit dashboard.
- Provides scripted backup creation, clean restore tooling, and repeatable recovery drills for persisted runtime state.

## Commercial Packaging Direction

Critjecture is intended to be packaged as a flat-rate team product rather than a seat-based assistant:

- one monthly workspace price
- unlimited seats
- pooled monthly credits for analysis and answer generation
- admin visibility into per-user usage
- admin controls to restrict heavy users when needed
- predictable monthly spend through a hard cap once included credits are exhausted

This is aimed at teams that want governed business-data answers for the whole company without deciding which employees get a paid seat.

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

The current product has three fixed application roles per organization membership:

- `member`: limited to `company_data/public`
- `admin`: can access all of that organization's `company_data` plus audit, operations, member management, and review docs
- `owner`: all admin capabilities plus organization settings, export downloads, and destructive governance

Role is derived from the authenticated server session and organization membership, not from client-side UI state.

### Authentication and Tenancy

Protected routes require sign-in. Critjecture currently ships with:

- one bootstrap organization
- one bootstrap `Owner`
- one bootstrap `Member`

Sessions are cookie-based. Backend routes derive permissions and tenant scope from the authenticated session. Generated files remain creator-owned by default and can also be retrieved by the organization owner inside the same organization.

Deployment modes:

- `single_org`: local development and on-prem, with env-seeded bootstrap org and bootstrap users
- `hosted`: Railway-style centrally managed dedicated customer cell, where one bound organization is provisioned by the operator script

### Audit Logs

The admin audit dashboard lives at `http://localhost:3000/admin/logs`.

It shows a newest-first list of chat turn cards scoped to the current organization. Expanding a card reveals a chronological timeline of:

- assistant responses
- tool calls

Each card can be filtered to show all events, only assistant responses, or only tool calls. Tool events include raw parameters, accessed files, completion summaries, and any errors. Chat turn cards also show the initiating authenticated user and the chat session id that produced the interaction.

### Operations

The admin operations dashboard lives at `http://localhost:3000/admin/operations`.

It adds:

- route health and dependency checks
- recent failures and rate-limit activity
- open operational alerts
- workspace credit balance, reset window, and per-user heavy-usage visibility
- internal per-user and per-organization usage and cost summaries

There is also a public `GET /api/health` endpoint for liveness/readiness checks.

Observed API routes attach `x-critjecture-request-id` so production failures can be correlated across request logs, sandbox runs, knowledge imports, and governance jobs. Critical operational alerts can also be delivered to an external webhook via `CRITJECTURE_ALERT_WEBHOOK_URL`.

### Settings

The admin settings dashboard lives at `http://localhost:3000/admin/settings`.

It adds:

- workspace plan and remaining pooled credits
- member monthly credit caps plus suspend/reactivate controls
- member creation, role changes, suspension/reactivation, and password resets
- organization display-name updates
- retention settings for logs, usage, alerts, chat history, and import metadata
- full-organization export jobs
- export-gated purge jobs for chat history, import metadata, and managed knowledge files
- customer-review links for the security review pack plus deployment, compliance, and hosted provisioning docs

### Knowledge Library

The knowledge library lives at `http://localhost:3000/knowledge`.

Authenticated users can upload `.csv`, `.txt`, `.md`, and text-extractable `.pdf` files into the current organization's knowledge tree.

- `member`: read-only public-scope visibility
- `admin` and `owner`: uploads to either `company_data/public/uploads/...` or `company_data/admin/uploads/...`

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

Current hosted support keeps that same engine inside a narrower dedicated-cell envelope:

- one organization/customer per hosted deployment cell
- one writable web-app instance per hosted cell
- SQLite in `WAL` mode plus one persistent storage root per cell
- no active-active multi-writer replicas sharing one SQLite file
- current synchronous request model only
- target hosted recovery objectives of `24`-hour RPO and `2`-hour RTO

The runtime storage model is:

- SQLite database: `DATABASE_URL` or `<CRITJECTURE_STORAGE_ROOT>/critjecture.sqlite`
- persistent tenant data: `<CRITJECTURE_STORAGE_ROOT>/organizations/<organization-slug>/company_data`
- persistent generated assets: `<CRITJECTURE_STORAGE_ROOT>/organizations/<organization-slug>/generated_assets`
- persistent knowledge import staging: `<CRITJECTURE_STORAGE_ROOT>/organizations/<organization-slug>/knowledge_staging`
- governance/export artifacts: `<CRITJECTURE_STORAGE_ROOT>/organizations/<organization-slug>/governance`
- ephemeral sandbox workspaces: `/tmp/workspace/<run-id>`

The repo-root `sample_company_data/` directory is bundled demo data. On first boot, Critjecture copies that sample data into the active organization's storage directory if needed.

### Sandbox

The Python execution environment is isolated under `packages/python-sandbox`.

Key properties:

- interpreter is fixed to the project sandbox `.venv`
- `single_org` now defaults to a dedicated container-backed sandbox supervisor service
- `local_supervisor` remains available only as an explicit dev/test override using Linux `bubblewrap`
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
compliance_controls.md    Compatibility wrapper pointing at the canonical compliance guide
hosted_provisioning.md    Compatibility wrapper pointing at the canonical hosted guide
packages/python-sandbox   Isolated Python runtime managed by uv
packages/sandbox-supervisor Dedicated container-backed sandbox supervisor service
steps_completed.md        Implementation history by milestone
storage/                  Default local runtime storage root (gitignored)
```

## Requirements

- Node.js 20.9 or newer
- `pnpm` 10.x
- `uv` 0.11 or newer
- `single_org`: Docker Engine plus the dedicated sandbox supervisor service
- `single_org` local-dev/test fallback: Linux host with `bubblewrap` and `prlimit`
- `hosted`: `CRITJECTURE_SANDBOX_SUPERVISOR_URL` pointing at the dedicated sandbox supervisor
- `hosted`: `CRITJECTURE_HOSTED_ORGANIZATION_SLUG`, `CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID`, and `CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET`
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
CRITJECTURE_SANDBOX_EXECUTION_BACKEND=container_supervisor
CRITJECTURE_SANDBOX_CONTAINER_IMAGE=critjecture/sandbox-runner:latest
CRITJECTURE_SANDBOX_SUPERVISOR_HEARTBEAT_MS=1000
CRITJECTURE_SANDBOX_SUPERVISOR_LEASE_MS=25000
CRITJECTURE_SANDBOX_WAIT_FOR_RESULT_TIMEOUT_MS=30000
CRITJECTURE_SANDBOX_SUPERVISOR_URL=http://127.0.0.1:4100
CRITJECTURE_SANDBOX_SUPERVISOR_TOKEN=replace-me
CRITJECTURE_SANDBOX_SUPERVISOR_TIMEOUT_MS=15000
CRITJECTURE_CHAT_MAX_TOKENS_HARD_CAP=4000
CRITJECTURE_ALERT_WEBHOOK_URL=
```

For local development without the dedicated supervisor service, set `CRITJECTURE_SANDBOX_EXECUTION_BACKEND=local_supervisor` and keep the existing `bubblewrap` / `prlimit` host dependencies installed.

## Workspace Credits

Critjecture now enforces a workspace-level commercial model:

- one pooled monthly credit balance per workspace
- monthly reset from the workspace billing anchor date
- hard cap once included credits are exhausted
- optional per-member monthly credit caps inside the shared pool

Current default credit consumption:

- chat requests: 1 credit
- data analysis runs: 8 credits
- chart generation runs: 10 credits
- document generation runs: 12 credits
- knowledge import jobs: 2 credits per accepted file
- company knowledge search: 0 credits

When the workspace or member cap is exhausted, credit-consuming routes return `429` with `status: "credit_exhausted"` plus remaining-balance and reset metadata. Operational rate limits still apply separately and continue to return `status: "rate_limited"`.

Operator incident runbooks live under `apps/web/docs/runbooks/` and cover sandbox, storage, migration, backup/restore, hosted, and on-prem response paths.

If `OPENAI_API_KEY` is missing, the chat API returns a clear configuration error.
If `CRITJECTURE_DEPLOYMENT_MODE=single_org`, missing bootstrap user env vars mean first login will not succeed because no bootstrap accounts will be available.
If `CRITJECTURE_DEPLOYMENT_MODE=single_org`, bootstrap passwords are used only to create missing bootstrap accounts and are expected to be rotated through `/admin/settings` before customer handoff.
If `CRITJECTURE_DEPLOYMENT_MODE=hosted`, tenant orgs and users should be created with `pnpm --filter web provision:hosted-org`.

## Deployment

The supported current deployment envelope is SQLite-backed in both current modes:

- `single_org` for local development, customer-managed hardware, and controlled on-prem deployments
- `single_org` production should point at the repo-owned supervisor in `packages/sandbox-supervisor`
- `hosted` for Railway-style centrally operated deployments with a dedicated sandbox supervisor service
  - one organization/customer per hosted deployment cell

`single_org` is now production-ready for controlled customer-managed deployments inside one clear support envelope:

- persistent SQLite storage and tenant storage roots
- dedicated container-backed sandbox supervisor with Docker Engine on the supervisor host
- `pdftotext` on the web-app host
- explicit backups plus restore-drill and release-proof records
- current sandbox envelope of `1` active run per user, `4` globally, `10s` wall time, `8s` CPU, `512 MiB` memory, `64` processes, `1 MiB` stdio capture, `10 MiB` artifact cap, and `24h` artifact retention

`hosted` remains supported, but it is not yet broadly production-ready because hosted supervisor operations and hosted persistence/scale work still carry a higher bar even after the dedicated-customer-cell boundary.

Start with:

- `pnpm db:migrate`
- `pnpm build`
- `pnpm start`

Recovery tooling is available from the repo root:

- `pnpm backup:create -- --output-dir ./backups`
- `pnpm backup:restore -- --backup ./backups/<timestamped-backup-dir> --database-path ./restore/storage/critjecture.sqlite --storage-root ./restore/storage`
- `pnpm backup:verify -- --deployment-mode both`
- `pnpm restore:drill:single-org -- --environment <label> --operator "<name>"`
- `pnpm release:proof:single-org -- --environment <label> --operator "<name>" --checklist-kind <first_customer_deployment|routine_upgrade> --change-scope <app_only|migration|storage_layout|migration_and_storage> --restore-drill <restore-drill-json-path> ...`

Read [security_review.md](/home/hard2vary/projects/critjecture/apps/web/docs/security_review.md) for the current security, privacy, and deployment boundary summary.
Read [deployment.md](/home/hard2vary/projects/critjecture/apps/web/docs/deployment.md) for exact storage, backup, restore, and hosted/on-prem guidance.
Read [compliance_controls.md](/home/hard2vary/projects/critjecture/apps/web/docs/compliance_controls.md) for the shipped governance and retention controls.
Read [hosted_provisioning.md](/home/hard2vary/projects/critjecture/apps/web/docs/hosted_provisioning.md) for the hosted multi-org provisioning flow.
Read [single-org-first-deployment.md](/home/hard2vary/projects/critjecture/apps/web/docs/runbooks/single-org-first-deployment.md) for the canonical `single_org` cutover checklist.
Read [single-org-routine-upgrade.md](/home/hard2vary/projects/critjecture/apps/web/docs/runbooks/single-org-routine-upgrade.md) for the `single_org` routine-upgrade gate.

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
