# Critjecture Workflow Product: Detailed Implementation Plan

## Goal

Implement the workflow product direction **on top of the existing Critjecture architecture** (chat + knowledge search + sandbox analysis + chart/doc generation + audit/ops), not as a rewrite.

The workflow product should make Critjecture meaningfully deeper than a one-off chat interface. The goal is to turn successful analyses into governed, repeatable operating procedures with typed inputs, validation, scheduling, delivery, and audit history, not just saved prompts or raw tool-call replay.

Target user flow:

> interactive exploration → save as workflow → scheduled execution → request missing files → validate inputs → run analysis → send standardized outputs

---

## 1) Scope and guiding principles

### In scope (from your 8 requested functions)

1. Saved workflow objects
2. Workflow builder from chat
3. Scheduled runs
4. Missing-input request loop for non-API customers
5. Per-run file validation
6. Workflow run history dashboard
7. Delivery outputs (email/PDF/chart pack/table/webhook)
8. Packaging/pricing shift to workflow-centric plans

### Out of scope for v1

- Generic external connector platform (Google Drive/QuickBooks/Salesforce live connectors)
- Cross-org shared workflow marketplace
- Full async data-warehouse scale jobs

### Architectural principles

- Reuse existing tooling (`search_company_knowledge`, `run_data_analysis`, `generate_visual_graph`, `generate_document`)
- Keep server-side RBAC + tenancy enforcement as-is
- Keep sandbox safety envelope as-is
- Add workflow execution as a **new orchestration layer**, not a new analysis engine
- Keep each workflow run auditable at the same level as chat runs
- Compile chat traces into **typed workflow definitions** instead of replaying raw prompt text or unbounded tool JSON
- Keep the workflow runtime source of truth in the application database
- Restrict v1 workflow creation, activation, and repair to `admin` and `owner` roles until a separate controlled input-submission flow exists for `member`

---

## 2) Current repo leverage points (what already exists and should be reused)

- **Tool execution paths:**
  - `apps/web/app/api/company-knowledge/search/route.ts`
  - `apps/web/app/api/data-analysis/run/route.ts`
  - `apps/web/app/api/visual-graph/run/route.ts`
  - `apps/web/app/api/document/generate/route.ts`
- **Sandbox + run tracking:** `apps/web/lib/python-sandbox.ts`, `apps/web/lib/sandbox-runs.ts`
- **Audit/event trail:** `apps/web/lib/audit-log.ts`, `apps/web/lib/operations.ts`
- **Async worker patterns already in repo:**
  - Knowledge imports worker (`apps/web/lib/knowledge-imports.ts`)
  - Governance worker (`apps/web/lib/governance.ts`)
- **Knowledge metadata + ingestion state:** `documents`, `knowledge_import_jobs`, `knowledge_import_job_files`

This means we can ship workflows by adding orchestration/state + UI + scheduling, while reusing the already-tested tool contracts.

---

## 3) Implementation breakdown by requested function

## 3.1 Add “saved workflow” objects

### What to build

Persist versioned workflow definitions that include:

- input bindings + schema contract
- tool-step recipe
- output format rules
- threshold rules
- schedule
- recipients + delivery channels
- execution identity policy

### Data model (new tables)

Add to `apps/web/lib/app-schema.ts` + new migration file (example `apps/web/drizzle/0013_step33_workflows.sql`):

- `workflows`
  - `id`, `organization_id`, `created_by_user_id`
  - `name`, `description`
  - `visibility` (`private|organization`)
  - `status` (`draft|active|paused|archived`)
  - `current_version_id`
  - `last_enabled_by_user_id`
  - `next_run_at`, `last_run_at`
  - timestamps
- `workflow_versions`
  - immutable version snapshots
  - `workflow_id`, `version_number`
  - `input_contract_json`, `input_bindings_json`
  - `recipe_json`, `thresholds_json`, `outputs_json`, `delivery_json`, `schedule_json`
  - `execution_identity_json`
  - `created_by_user_id`, timestamps
- `workflow_runs`
  - `workflow_id`, `workflow_version_id`, `organization_id`
  - `trigger_kind` (`manual|scheduled|resume`)
  - `trigger_window_key`
  - `status` (`queued|running|waiting_for_input|blocked_validation|completed|failed|cancelled`)
  - `run_as_user_id`, `run_as_role`
  - `started_at`, `completed_at`, `failure_reason`
  - `request_id`, `metadata_json`
- `workflow_run_steps`
  - step-by-step trace (`tool_name`, input/output json, sandbox_run_id, status, timings)
- `workflow_run_input_checks`
  - per-file validation results/errors
- `workflow_input_requests`
  - missing-file request lifecycle (`open|sent|fulfilled|expired|cancelled`)
- `workflow_deliveries`
  - delivery attempts + status (`pending|sent|failed`)
  - persisted delivery payload snapshot / artifact manifest references

### Backend modules (new)

- `apps/web/lib/workflow-types.ts`
- `apps/web/lib/workflows.ts` (CRUD + versioning)
- `apps/web/lib/workflow-runs.ts` (run persistence + querying)

### API routes (new)

- `apps/web/app/api/workflows/route.ts` (`GET`, `POST`)
- `apps/web/app/api/workflows/[workflowId]/route.ts` (`GET`, `PATCH`, maybe `DELETE`)
- `apps/web/app/api/workflows/[workflowId]/runs/route.ts` (`GET`, `POST` manual run)

### Acceptance criteria

- `admin` and `owner` users can create/edit/pause/archive workflows in v1
- Every definition change creates a new immutable version
- Every run references the exact version that executed
- Runtime execution identity is explicit and auditable

---

## 3.2 Add a “workflow builder from chat” flow

### What to build

From a successful chat turn, create a workflow draft from actual tool execution, not raw prompt text.

### Extraction source

Use audit + run records:

- `chat_turns`
- `tool_calls`
- `sandbox_runs`
- `analysis_results` (when available)

### Builder behavior

- Add **Save as workflow** action after successful analysis/chat turn
- Pre-fill:
  - workflow name (from prompt/title)
  - detected input files (from `accessedFiles`/`inputFiles`)
  - detected step sequence (tool calls in order)
  - output hints (chart/doc/text artifacts)
- Open “Finalize workflow” modal:
  - required input contract
  - logical input bindings (knowledge document ids, aliases, or selector rules), not filesystem paths
  - schedule
  - thresholds
  - recipients/delivery
  - execution identity preview

### Important design constraint

- The saved workflow should be a **normalized recipe**, not a blind replay of raw tool parameters.
- Chat-derived values should compile into typed workflow steps such as:
  - input selection
  - validation contract
  - analysis step
  - optional chart/document generation
  - threshold evaluation
  - delivery rules

### Files to update

- `apps/web/components/chat-shell.tsx` (add action wiring)
- Add workflow builder UI component:
  - `apps/web/components/workflow-builder-modal.tsx` (new)
- New route for extraction:
  - `apps/web/app/api/workflows/from-chat-turn/route.ts`

### Acceptance criteria

- User can save a workflow from a real turn in <60s
- Saved recipe preserves provenance to the original turn but stores a typed workflow definition suitable for repeat execution

---

## 3.3 Add scheduled runs

### What to build

A scheduler + worker pipeline that queues and executes due workflows weekly/monthly (and manual trigger).

### Scheduling approach (recommended)

- Add DB-driven scheduler state (`next_run_at` on workflows)
- Add internal tick endpoint (authenticated secret):
  - `POST /api/internal/workflows/tick`
- Trigger this endpoint every minute via platform cron
- Tick does:
  1. claim due workflows transactionally
  2. enqueue `workflow_runs`
  3. wake worker loop

### Worker execution

- New module: `apps/web/lib/workflow-scheduler.ts`
- New module: `apps/web/lib/workflow-engine.ts`
- Pattern should mirror knowledge-import/governance workers
- Use claiming to avoid duplicate execution

### Important constraint

Current hosted docs call out synchronous model boundaries; this adds async workflow jobs, so deployment docs/readiness docs must be updated and the hosted support envelope should remain explicitly gated until worker hardening is validated.

### Platform hardening requirements before enabling scheduled runs broadly

- define worker lifecycle and restart behavior
- reconcile queued/running workflow runs after process crash or deploy
- enforce bounded worker concurrency and backpressure relative to current sandbox limits
- add idempotent run-window claiming with a unique key on `workflow_runs`
- document operator procedures, release-proof updates, and rollback steps for async workers

### Acceptance criteria

- Workflow runs execute on schedule without user interaction
- No duplicate run creation for same schedule window
- Paused workflows do not run

---

## 3.4 Add input collection for non-API customers

### What to build

Before run execution, detect missing required files. If missing:

1. mark run `waiting_for_input`
2. create `workflow_input_requests` record
3. notify user (email/message/webhook)
4. auto-resume when files appear and validate

### Notification abstraction

New module: `apps/web/lib/workflow-notifications.ts`

Implement channels in phases:

- v1 required: in-app + webhook
- v1.1 optional: email provider (SMTP/Resend/etc) behind env config

### Upload/resume loop

- Link authorized users to `/knowledge` with context (required files list)
- On import completion or periodic tick, re-check waiting runs
- If all inputs valid, move run back to `queued`

### Acceptance criteria

- Missing inputs never cause silent failure
- User receives clear required-file list + upload instruction
- Run resumes automatically once requirements are met
- v1 repair flow assumes an `admin` or `owner` can supply the missing input

---

## 3.5 Add file validation before each run

### What to build

Validation engine in `apps/web/lib/workflow-validator.ts`:

- existence check
- schema/columns check
- freshness check
- duplicate/stale file check (content hash and/or unchanged period)
- minimum data sufficiency checks (row count, null thresholds)
- date recency checks (e.g., max date in required date column)

### Validation contract in workflow definition

Store per required input:

- logical document binding or selector rule
- required columns
- optional date column + freshness SLA
- minimum row count
- duplicate policy

### Execution behavior

- validation failures set run status `blocked_validation` or `waiting_for_input`
- persist full validation report in `workflow_run_input_checks`
- surface these failures in UI + notifications

### Acceptance criteria

- No workflow proceeds to tool execution with invalid inputs
- Validation error messages are actionable and file-specific

---

## 3.6 Add workflow run history dashboard

### What to build

A dedicated workflows page showing definitions + run history + artifacts + diffs.

### New UI surface

- `apps/web/app/workflows/page.tsx` (new)
- `apps/web/components/workflows-page-client.tsx` (new)
- Update nav in `apps/web/components/workspace-shell.tsx`

### Dashboard sections

- Workflow list (status, schedule, owner, next run)
- Run list (success/failure/waiting, timestamps, trigger)
- Run detail drawer:
  - files used
  - validation report
  - step timeline (tool-level)
  - alerts triggered
  - generated assets + delivery attempts
  - durable delivery payload snapshot / manifest
  - “changes from previous run” summary

### Backend endpoints (new)

- `GET /api/workflows`
- `GET /api/workflows/:id/runs`
- `GET /api/workflow-runs/:runId`

### Acceptance criteria

- User can answer “what ran, what data was used, what changed, what was sent” for any run

---

## 3.7 Add delivery outputs

### What to build

Standardized post-run outputs:

- emailed summary
- PDF brief
- chart pack (links/assets)
- ranked table (CSV/Markdown)
- webhook/Slack-style payload

### Output assembly

New module: `apps/web/lib/workflow-delivery.ts`

- Build canonical run summary payload
- Attach links to generated artifacts
- Persist a delivery payload snapshot and artifact manifest so run history remains useful after short-lived asset URLs expire
- Optionally trigger `generate_document` for standardized PDF brief template

### Delivery config schema

Per workflow version:

- channels
- recipients
- webhook endpoints
- retry policy
- template options

### Delivery reliability

- persist each attempt in `workflow_deliveries`
- retry failed deliveries with backoff
- expose status in run history

### Acceptance criteria

- Completed runs emit configured outputs reliably
- Delivery success/failure is visible and auditable

---

## 3.8 Change product packaging toward workflows

### Product model changes

Shift plan framing to:

- solo analyst/builder
- team/shared workflows
- usage based on saved workflows + scheduled runs + existing step credits

### Technical changes

- Extend plan metadata (`workspace_plans`) with workflow entitlements (JSON or columns):
  - max active workflows
  - included scheduled runs/window
- Enforce limits at workflow create/activate and run enqueue
- Show limits in settings/operations views

### Files to update

- `apps/web/lib/workspace-plans.ts`
- `apps/web/lib/operations-policy.ts`
- `apps/web/components/admin-settings-page-client.tsx`
- product docs:
  - `README.md`
  - `overview.md`
  - `pricing_go_to_market_draft.md`

### Acceptance criteria

- Plan limits are enforced consistently and visible to owners/admins

---

## 4) Cross-cutting changes required

## 4.1 Access control and permissions

Update `apps/web/lib/access-control.ts` to include workflow capabilities, for example:

- `workflow_view`
- `workflow_manage`
- `workflow_manage_org`

Suggested policy:

- `member`: view workflow outputs only when separately authorized; no workflow creation or repair in v1
- `admin`: create/manage workflows within the organization
- `owner`: same as admin plus org-wide overrides where needed

---

## 4.2 Observability and operations

### Add workflow route group + metrics

- Extend `OperationsRouteGroup` in `apps/web/lib/operations-policy.ts` (e.g., `workflow`)
- Emit usage events:
  - `workflow_run_started`
  - `workflow_run_completed`
  - `workflow_run_failed`
  - `workflow_waiting_for_input`
  - `workflow_delivery_sent`
  - `workflow_delivery_failed`

### Alerts

Use `upsertOperationalAlert` for:

- repeated workflow failures
- stale waiting-for-input runs
- delivery failure bursts

### Dashboard updates

Extend `apps/web/components/operations-page-client.tsx` with workflow summary cards.

---

## 4.3 Security and compliance

- Ensure workflow execution enforces current org/user permissions at run time
- Define explicit execution identity rules for scheduled runs, including what happens if the creator is suspended, downgraded, or loses access to an input
- Ensure workflows cannot stage files outside authorized scope
- Sign outbound webhooks (HMAC) for delivery endpoints
- Add retention knobs for workflow runs/deliveries in compliance settings
- Update security docs:
  - `apps/web/docs/security_review.md`
  - `apps/web/docs/deployment.md`

---

## 5) Suggested delivery phases (implementation order)

## Phase 0 — Design + schema prep (3–5 days)

- finalize workflow JSON contracts
- finalize execution identity model
- finalize logical input binding model against knowledge documents
- add tables + migration
- add base types and CRUD APIs

## Phase 1 — Save from chat + manual run MVP (1–2 weeks)

- workflow builder from turn logs
- workflow create/edit/publish
- manual “Run now” execution only
- basic run history

## Phase 2 — Validation + input request loop (1–2 weeks)

- validation engine
- waiting-for-input statuses
- notification + auto-resume loop

## Phase 3 — Async platform hardening (1 week)

- worker lifecycle, reconciliation, and backpressure controls
- idempotent enqueue/claim model
- deployment/runbook/release-proof updates
- hosted gating and feature-flag rollout plan

## Phase 4 — Scheduler + background execution (1 week)

- tick endpoint + cron setup
- queue claim/run worker
- idempotency/locking hardening

## Phase 5 — Delivery outputs + thresholds (1 week)

- standardized delivery payloads
- delivery retries and status tracking
- threshold evaluation + alerts

## Phase 6 — Packaging, docs, polish (1 week)

- plan entitlements and enforcement
- settings/ops UI updates
- docs/runbooks + release checklist updates

---

## 6) Test plan

### Unit tests

Add under `apps/web/tests/`:

- `workflow-validator.test.ts`
- `workflow-scheduler.test.ts`
- `workflow-builder.test.ts`
- `workflow-delivery.test.ts`

### Route tests

- `workflows-route.test.ts`
- `workflow-runs-route.test.ts`
- `workflow-tick-route.test.ts`

### Integration tests

- save from chat turn → create workflow version
- manual run with valid files → success + outputs
- scheduled run with missing files → waiting_for_input + notification
- upload missing files → auto-resume → success
- creator loses access after save → run is blocked with explicit reason
- worker restart during queued/running jobs → reconciliation is correct and idempotent
- duplicate scheduler ticks for same window → only one run is created

### E2E

- `/chat` “Save as workflow” flow
- `/workflows` run history and details

---

## 7) Rollout and migration strategy

- Introduce feature flag: `CRITJECTURE_ENABLE_WORKFLOWS`
- Ship hidden/internal APIs first
- Enable for owner/admin first
- Keep scheduled execution disabled in hosted environments until async worker support is explicitly validated for that envelope
- Keep rollback path by pausing scheduler + hiding UI
- Run DB backup before migration (`pnpm backup:create`) and migration (`pnpm db:migrate`)

---

## 8) Risks and mitigations

- **Risk:** duplicate scheduled runs
  - **Mitigation:** transactional claim + unique run-window keys
- **Risk:** workflow code drift or brittle recipes
  - **Mitigation:** immutable versioning + typed workflow recipes + editable validation contracts
- **Risk:** notification noise
  - **Mitigation:** dedupe keys + cooldown windows
- **Risk:** hosted envelope drift due async jobs
  - **Mitigation:** explicit deployment/runbook updates + bounded worker concurrency
- **Risk:** scheduled runs execute with stale or invalid permissions
  - **Mitigation:** explicit run identity model + permission re-check at enqueue and at execution time
- **Risk:** run history loses value after artifact TTL expiry
  - **Mitigation:** persist durable delivery payload snapshots and artifact manifests

---

## 9) Definition of done (v1)

v1 is done when:

1. Users can save a chat analysis as a versioned workflow
2. Workflows can run manually and on schedule
3. Missing inputs are requested and resumed automatically
4. Every run validates input contracts before tool execution
5. Run history shows files, outcomes, alerts, and artifacts
6. Configured delivery channels are attempted and tracked
7. Workflow-related limits/usage are visible to admins and enforced
8. Workflow definitions are typed and replayable without depending on raw prompt text
9. Scheduled runs have explicit audited execution identity and permission checks

---

## 10) Practical first sprint ticket set (recommended)

1. Add workflow schema + migration + types
2. Add workflow CRUD routes + minimal `/workflows` page
3. Add “Save as workflow” from chat turn
4. Add manual run engine (no scheduler yet)
5. Add run history list/detail
6. Keep scheduled execution out of the first sprint

That gets real user value quickly and de-risks the later scheduler + delivery layers.
