# Future Steps

This file tracks the next implementation milestones after the work already captured in `steps_completed.md`.

## Step 16: Observability, Rate Limits, and Cost Controls

### Goal

Add the operational controls needed to run the product safely and supportably.

### What Should Be Implemented

- structured server logs
- error reporting and alerting
- health checks and operational diagnostics
- rate limiting for chat and tool routes
- usage accounting for model and tool execution
- cost and abuse controls at user and tenant levels

### Acceptance Criteria

- operators can identify failures and degraded routes quickly
- abusive or runaway usage is limited automatically
- usage and cost data can be reviewed per user or tenant

## Step 17: Bulk Knowledge Imports and Async Ingestion

### Goal

Support real customer knowledge onboarding by importing large file sets safely without blocking web requests.

### What Should Be Implemented

- allow bulk uploads via directory selection or archive upload
- preserve tenant-relative directory structure for imported files
- create durable import jobs and per-file import job rows
- move validation, text extraction, chunking, and indexing into background processing
- show import progress, partial failures, and retryable errors in the web app
- keep uploaded files hidden from search and sandbox staging until ingestion is ready
- lay the groundwork for later embedding/vectorization as a separate async stage

### Acceptance Criteria

- users can start a bulk import without waiting for all files to finish processing inline
- operators and users can see import-job progress and failures clearly
- partial failures do not invalidate the whole import job
- newly imported files only appear in search and tool workflows after successful ingestion

## Step 18: Test Coverage and Release Readiness

### Goal

Create enough automated verification to ship changes with confidence.

### What Should Be Implemented

- route-level tests for search, sandbox, generated files, and audit APIs
- RBAC regression tests
- sandbox validation tests
- integration tests for the planner and audit correlation flows
- end-to-end tests for core chat journeys
- a release checklist for production deployments

### Acceptance Criteria

- critical auth, RBAC, sandbox, and audit flows are covered automatically
- major regressions are catchable before release
- a repeatable release confidence process exists

## Step 19: Admin Operations and Compliance Controls

### Goal

Add the operational and governance capabilities expected by real customer deployments.

### What Should Be Implemented

- user and organization administration
- role assignment and membership management
- retention and deletion controls
- export capabilities for audits and customer data
- deployment, security, and operations documentation for customer review

### Acceptance Criteria

- admins can manage users and permissions without code changes
- data lifecycle actions are deliberate and traceable
- customers can review the operational posture of the product

## Roadmap Notes

- Chat history and file uploads are important future capabilities, but they should follow authentication and persistence foundations.
- Bulk directory imports should follow observability work because they depend on background jobs, progress tracking, retries, and clear failure reporting.
- Embedding and vectorization should be treated as a later stage on top of durable bulk ingestion rather than bundled into the first bulk-import release.
- The order above reflects dependency order and production risk, not just feature desirability.
- A small on-prem pilot may be able to adopt parts of this roadmap more gradually than a multi-tenant cloud rollout.
