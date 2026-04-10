# Workflow Worker Reconciliation And Rollback

This runbook covers the async workflow run worker introduced for Step 10 hardening.

## Scope

It applies to:

- queued workflow run processing
- stale `running` run reconciliation
- scheduled workflow tick enqueueing
- delivery retry processing

Scheduled execution remains feature-gated.

## Worker model

The worker consumes `workflow_runs.status = queued` and executes runs through the existing workflow engine.

Key behaviors:

- bounded concurrency (`CRITJECTURE_WORKFLOW_WORKER_MAX_CONCURRENCY`)
- stale run reclamation (`running` -> `queued`) after timeout
- step/input-check cleanup during stale reconciliation to allow safe rerun
- idempotent claim (`queued` -> `running` compare-and-swap)

## Environment knobs

- `CRITJECTURE_WORKFLOW_WORKER_MAX_CONCURRENCY` (default: `2`)
- `CRITJECTURE_WORKFLOW_WORKER_MAX_RUNS_PER_SWEEP` (default: `20`)
- `CRITJECTURE_WORKFLOW_WORKER_STALE_RUN_MINUTES` (default: `45`)
- `CRITJECTURE_ENABLE_WORKFLOW_ASYNC_MANUAL_RUNS` (default: disabled)
- `CRITJECTURE_ENABLE_WORKFLOW_SCHEDULER` (default: disabled)
- `CRITJECTURE_ENABLE_HOSTED_SCHEDULED_WORKFLOWS` (default: disabled)
- `CRITJECTURE_WORKFLOW_SCHEDULER_MAX_WORKFLOWS_PER_TICK` (default: `25`)
- `CRITJECTURE_WORKFLOW_SCHEDULER_MAX_WINDOWS_PER_WORKFLOW` (default: `24`)
- `CRITJECTURE_WORKFLOW_SCHEDULER_QUEUE_BACKPRESSURE_LIMIT` (default: `100` queued runs)
- `CRITJECTURE_WORKFLOW_TICK_SECRET` (required for internal workflow worker routes)

## Internal control routes

All routes require bearer/internal token matching `CRITJECTURE_WORKFLOW_TICK_SECRET`.

- `POST /api/internal/workflows/tick`
  - claims due workflows, enqueues scheduled windows, wakes worker
  - expected cron cadence: every minute (platform scheduler)
- `POST /api/internal/workflows/process-queue`
  - one sweep of queue processing + stale reconciliation
- `POST /api/internal/workflows/recheck-waiting`
  - waiting-for-input recheck + delivery retries
- `POST /api/internal/workflows/retry-deliveries`
  - delivery retries only

## Crash / restart reconciliation rules

On each sweep, stale `running` runs (older than configured threshold) are reclaimed:

1. run status reset to `queued`
2. stale step rows removed
3. stale input-check rows removed
4. open/sent input requests cancelled with reconciliation note
5. pending delivery rows removed

This keeps reruns deterministic and avoids unique-key conflicts on step rows.

## Rollback procedure

If worker behavior is unstable:

1. Disable async manual execution:
   - set `CRITJECTURE_ENABLE_WORKFLOW_ASYNC_MANUAL_RUNS=false`
2. Disable scheduler enqueueing:
   - set `CRITJECTURE_ENABLE_WORKFLOW_SCHEDULER=false`
3. Stop queue ticks/calls to:
   - `/api/internal/workflows/tick`
   - `/api/internal/workflows/process-queue`
4. Keep recheck route disabled temporarily if needed:
   - stop calls to `/api/internal/workflows/recheck-waiting`
5. Continue manual runs in synchronous mode from `/api/workflows/[workflowId]/runs`
6. Inspect open alerts:
   - `workflow-failure-burst`
   - `workflow-waiting-stale`
   - `workflow-delivery-failure-burst`

If runs are stuck in `running`, execute a guarded queue sweep once after config rollback:

- `POST /api/internal/workflows/process-queue` with low `limit` (e.g. `1` to `5`)

## Verification checklist

- No unbounded growth of `queued` or stale `running` runs
- Scheduler tick does not create duplicate runs for the same `trigger_window_key`
- Reclaimed runs return to normal terminal states (`completed`, `failed`, `waiting_for_input`, `blocked_validation`)
- Delivery retry queue drains over successive retries
- Operational alerts clear once thresholds recover
