# Sandbox Failures

## Symptoms

- `/api/data-analysis/run`, `/api/visual-graph/run`, or `/api/document/generate` return `429`, `503`, or `500`
- the operations dashboard shows sandbox alerts, rejection bursts, stale runs, or backend unavailable state
- structured logs include `sandbox-supervisor.*` events

## Identify The Incident

- capture the `x-critjecture-request-id` response header when present
- record any `sandboxRunId`, `turnId`, and `runtimeToolCallId` shown in the operations dashboard or logs
- check `/api/health` and the sandbox section of `/admin/operations`

## Immediate Actions

- if the backend is unavailable, restore the dedicated supervisor service first
- if capacity is exhausted, pause new high-volume sandbox usage and let active runs drain
- if stale or abandoned runs are accumulating, review supervisor worker logs before restarting the web process

## Recovery

- `single_org`: confirm `CRITJECTURE_SANDBOX_SUPERVISOR_URL`, `CRITJECTURE_SANDBOX_SUPERVISOR_TOKEN`, Docker Engine, and the configured sandbox image, then retry a single request
- `hosted`: confirm `CRITJECTURE_SANDBOX_SUPERVISOR_URL` and `CRITJECTURE_SANDBOX_SUPERVISOR_TOKEN`, then restore the supervisor service and retry a single request
- verify `/api/health` returns sandbox availability and that queued runs clear

## Escalate When

- the sandbox remains unavailable after one controlled restart
- stale or abandoned runs continue to grow after reconciliation
- multiple organizations are failing sandbox requests at the same time
