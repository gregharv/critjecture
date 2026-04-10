# Workflow Implementation Steps

This file breaks down the implementation sequence for [`workflow_functions_implementation_plan.md`](./workflow_functions_implementation_plan.md).

It is intended to be the execution checklist for adding the workflow product layer on top of the current Critjecture architecture.

## Scope

This roadmap covers:

- saved workflow objects
- workflow builder from chat
- manual workflow runs
- input validation and missing-input handling
- run history and delivery tracking
- async scheduling and worker execution
- workflow-centric packaging, observability, and docs

This roadmap does not change the current product claim by itself. Hosted scheduled execution and other async workflow features should remain gated until the async platform work is complete and documented.

## Working Rules

- Keep the workflow runtime source of truth in the app database
- Reuse the existing tool contracts and sandbox path
- Treat workflows as typed definitions, not saved prompts
- Keep all workflow actions auditable
- Keep v1 workflow creation and repair limited to `admin` and `owner`
- Do not enable hosted scheduled execution until async worker support is validated for that envelope

## Step 0: Finalize The Technical Spec

Before coding, lock the highest-risk design decisions in a short engineering spec.

Deliverables:

- workflow definition schema
- workflow version schema
- input binding model against `documents`
- validation contract model
- execution identity model for manual and scheduled runs
- delivery payload snapshot model
- scheduler idempotency model
- hosted gating plan for async workers
- canonical spec document: [`workflow_step0_technical_spec.md`](./workflow_step0_technical_spec.md)

Exit criteria:

- the JSON contracts are stable enough to migrate
- scheduled-run identity rules are explicit
- input bindings use logical document references or selector rules, not filesystem paths

## Step 1: Add Database Schema And Core Types

Add the persistent data model for workflows and runs.

Implementation tasks:

- add workflow tables to `apps/web/lib/app-schema.ts`
- create the migration under `apps/web/drizzle/`
- add workflow domain types in `apps/web/lib/workflow-types.ts`
- add parsers/validators for workflow JSON blobs
- add indexes for common read paths and scheduler claims
- add a unique key for scheduled run windows

Tables to add:

- `workflows`
- `workflow_versions`
- `workflow_runs`
- `workflow_run_steps`
- `workflow_run_input_checks`
- `workflow_input_requests`
- `workflow_deliveries`

Exit criteria:

- migrations apply cleanly
- schema supports immutable workflow versioning
- workflow runs can store execution identity and scheduled run-window keys

## Step 2: Add Workflow CRUD And Access Control

Create the basic workflow management layer before any run execution.

Implementation tasks:

- add workflow CRUD helpers in `apps/web/lib/workflows.ts`
- add run query helpers in `apps/web/lib/workflow-runs.ts`
- extend `apps/web/lib/access-control.ts` with workflow capabilities
- enforce v1 permissions:
  - `member`: no workflow create/edit/repair
  - `admin`: create/manage workflows
  - `owner`: create/manage workflows with org-wide override behavior as needed
- add API routes:
  - `GET/POST /api/workflows`
  - `GET/PATCH /api/workflows/[workflowId]`
  - `GET/POST /api/workflows/[workflowId]/runs`

Exit criteria:

- privileged users can create draft workflows
- workflow versions are immutable on update
- unauthorized roles are blocked server-side

## Step 3: Build "Save As Workflow" From Chat

Turn successful chat analyses into typed workflow drafts.

Implementation tasks:

- add a "Save as workflow" action to `apps/web/components/chat-shell.tsx`
- add `apps/web/components/workflow-builder-modal.tsx`
- add `POST /api/workflows/from-chat-turn`
- extract source data from:
  - `chat_turns`
  - `tool_calls`
  - `sandbox_runs`
  - `analysis_results`
- compile the turn into a normalized workflow definition:
  - logical input bindings
  - validation contract
  - analysis step
  - optional chart/document steps
  - thresholds
  - delivery config

Important rule:

- preserve provenance to the original turn, but do not store the workflow as a raw replay of prompt text or unbounded tool-call JSON

Exit criteria:

- an `admin` or `owner` can save a usable draft from a successful turn
- the draft is editable before activation
- the saved recipe is typed and repeatable

## Step 4: Add Manual Workflow Execution

Ship manual run support before scheduling.

Implementation tasks:

- implement `apps/web/lib/workflow-engine.ts`
- create manual run creation logic
- resolve workflow input bindings into authorized knowledge documents
- re-check permissions at run time
- invoke existing tools through the same governed path used by chat
- persist:
  - run status
  - step timeline
  - sandbox run ids
  - generated artifacts
  - failures

Execution rules:

- every run must reference an immutable workflow version
- every run must store `run_as_user_id` and `run_as_role`
- if access is no longer valid, fail closed with a visible reason

Exit criteria:

- privileged users can click "Run now"
- manual runs are fully auditable
- workflow steps use existing tool boundaries instead of a new execution path

## Step 5: Add Input Validation

Prevent invalid or stale inputs from reaching tool execution.

Implementation tasks:

- add `apps/web/lib/workflow-validator.ts`
- validate:
  - input existence
  - required columns
  - row-count minimums
  - freshness/date rules
  - duplicate/stale file conditions
  - null-threshold or sufficiency checks where configured
- persist full reports in `workflow_run_input_checks`
- surface actionable failures in run detail views

Important rule:

- inputs should resolve from logical document bindings or selector rules, not direct file paths

Exit criteria:

- invalid inputs block execution before the first tool step
- validation failures are file-specific and actionable

## Step 6: Add Missing-Input Requests And Resume Logic

Handle non-API users who need to provide fresh data between runs.

Implementation tasks:

- add `apps/web/lib/workflow-notifications.ts`
- create `workflow_input_requests` lifecycle handling
- mark runs `waiting_for_input` when requirements are missing
- send in-app and webhook notifications in v1
- link authorized users to `/knowledge` with the required file list
- re-check waiting runs after import completion or on periodic tick
- auto-resume once inputs validate

Important rule:

- v1 assumes an `admin` or `owner` supplies missing inputs

Exit criteria:

- missing inputs never fail silently
- waiting runs resume automatically after valid files arrive

## Step 7: Build Workflow Run History UI

Expose workflow definitions and full run traces in the product.

Implementation tasks:

- add `apps/web/app/workflows/page.tsx`
- add `apps/web/components/workflows-page-client.tsx`
- update `apps/web/components/workspace-shell.tsx` navigation
- add run list and run detail endpoints
- show for each run:
  - version used
  - trigger kind
  - execution identity
  - files used
  - validation report
  - step timeline
  - alerts
  - artifacts
  - delivery attempts
  - change summary from previous run

Exit criteria:

- admins can answer "what ran, using what data, and what happened"
- workflow activity is visible without reading raw database rows or logs

## Step 8: Add Delivery Outputs And Durable Delivery Records

Turn successful runs into standardized outputs and make them reviewable later.

Implementation tasks:

- add `apps/web/lib/workflow-delivery.ts`
- build canonical run summary payloads
- support delivery channels:
  - webhook
  - chart pack / asset links
  - ranked table output
  - generated document / PDF brief
  - email as a later optional provider-backed step
- persist each delivery attempt
- persist durable payload snapshots and artifact manifests
- add retry with backoff for transient delivery failures

Important rule:

- run history should remain useful after short-lived asset URLs expire

Exit criteria:

- completed runs produce configured outputs
- delivery success or failure is visible and auditable

## Step 9: Add Observability, Alerts, And Plan Enforcement

Make workflows a first-class operational surface.

Implementation tasks:

- extend `apps/web/lib/operations-policy.ts` for workflow route groups
- emit workflow usage and lifecycle events
- add workflow summary cards to the operations UI
- trigger operational alerts for:
  - repeated workflow failures
  - stale waiting-for-input runs
  - delivery failure bursts
- extend `apps/web/lib/workspace-plans.ts` with workflow entitlements
- enforce limits for:
  - active workflows
  - scheduled runs per window

Exit criteria:

- workflow activity shows up in operations
- plan limits are visible and enforced consistently

## Step 10: Harden Async Worker Infrastructure

Do this before broadly enabling scheduled runs.

Implementation tasks:

- implement worker lifecycle management
- define crash recovery and reconciliation rules
- reconcile queued/running workflow runs after restart or deploy
- enforce bounded concurrency and backpressure
- make scheduler enqueue and worker claim logic idempotent
- document rollback behavior

Important rule:

- this step is required before hosted scheduled execution can be considered in-scope

Exit criteria:

- duplicate scheduler ticks do not create duplicate runs
- worker restarts do not leave the system in an ambiguous state
- async behavior fits inside the documented platform envelope

## Step 11: Add Scheduled Runs

Enable recurring execution only after the async foundation is ready.

Implementation tasks:

- add `apps/web/lib/workflow-scheduler.ts`
- add `POST /api/internal/workflows/tick`
- trigger the tick from platform cron
- claim due workflows transactionally
- enqueue runs with unique window keys
- wake workers to execute queued runs
- keep scheduled execution behind feature flags where needed

Execution rules:

- paused workflows must not run
- scheduled runs must re-check permissions at enqueue and execution time
- scheduled runs must record explicit execution identity

Exit criteria:

- workflows can run on schedule without manual intervention
- the same schedule window cannot enqueue duplicate runs

## Step 12: Update Product Docs And Support Envelope

Make the docs match the shipped behavior and gating.

Implementation tasks:

- update `README.md`
- update `overview.md`
- update `apps/web/docs/deployment.md`
- update `apps/web/docs/security_review.md`
- update runbooks and release-checklist docs for async workers if scheduled runs ship
- document hosted gating clearly if hosted scheduled execution remains disabled

Exit criteria:

- product docs distinguish current shipped behavior from planned workflow features
- deployment docs reflect any new async worker requirements

## Step 13: Test And Roll Out In Layers

Use progressive rollout instead of turning everything on at once.

Implementation tasks:

- add unit tests for:
  - workflow validation
  - workflow builder
  - workflow scheduler
  - workflow delivery
- add route tests for workflow CRUD and tick routes
- add integration tests for:
  - save from chat
  - manual run success
  - missing-input wait and resume
  - permission loss after save
  - duplicate scheduler ticks
  - worker restart reconciliation
- add E2E coverage for:
  - `/chat` save-as-workflow
  - `/workflows` run history
- roll out in this order:
  1. hidden schema + internal APIs
  2. owner/admin manual workflows
  3. validation and input request loop
  4. delivery outputs
  5. async workers
  6. scheduled runs

Exit criteria:

- manual workflows are stable before scheduling is enabled
- async features remain feature-flagged until operationally proven

## Immediate Recommended Build Order

If implementation starts now, use this short sequence first:

1. finalize the technical spec
2. add schema, types, and CRUD
3. add save-from-chat
4. add manual run execution
5. add validation
6. add run history UI

That gets the project beyond a chat wrapper quickly while deferring the highest-risk async work until the core workflow model is solid.
