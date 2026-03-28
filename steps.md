# Future Steps

This file tracks the next implementation milestones after the work already captured in `steps_completed.md`.

## Step 10: Tenant and Data Persistence Foundations

### Goal

Add durable application state for users, organizations, and core records so the product is not tied to local-only or browser-only assumptions.

### What Should Be Implemented

- add a production-ready persistence layer for users and organizations
- define tenant ownership of company data, conversations, audits, and uploaded files
- establish production migration practices
- define backup and restore expectations
- preserve the option for simpler single-customer on-prem deployment where appropriate

### Acceptance Criteria

- users and organizations are stored durably
- data records are scoped to the correct tenant
- database migrations are repeatable
- backup and restore expectations are documented and testable

## Step 11: Server-Backed Chat History

### Goal

Persist conversations server-side so users can reload, resume, and review prior assistant interactions.

### What Should Be Implemented

- store conversations and messages in the backend
- associate conversations with authenticated users and tenants
- support loading prior sessions in the chat UI
- link audit records to persistent conversation identifiers
- support safe session reset and history navigation

### Acceptance Criteria

- a user can reload the app and recover prior conversations
- history is available across browsers or devices for the same account
- audit entries remain associated with the correct stored conversation

## Step 12: File Uploads and Knowledge Ingestion

### Goal

Let customers bring their own files into Critjecture and use them safely in search and tool workflows.

### What Should Be Implemented

- add upload support in the web app
- validate file size and file type
- store uploaded files under tenant ownership
- create an ingestion or indexing path for uploaded content
- integrate uploaded files into search and sandbox staging
- track file metadata for audit and admin visibility

### Acceptance Criteria

- authenticated users can upload approved files
- uploads are stored under the correct tenant
- uploaded content can be surfaced by the search flow
- sandbox tools can use approved uploaded files without bypassing authorization

## Step 13: Sandbox Hardening and Execution Controls

### Goal

Strengthen the execution model for model-generated code so it is appropriate for real customer environments.

### What Should Be Implemented

- move toward a stronger isolation boundary than the current local subprocess model
- enforce CPU, memory, runtime, and concurrency limits
- guarantee workspace cleanup and artifact lifecycle handling
- tighten execution auditing around sandbox runs
- formalize allowed output types and safer generated-file handling

### Acceptance Criteria

- sandbox jobs have enforced resource limits
- failed or abandoned jobs do not leave unsafe residual state
- execution isolation is materially stronger than the current local child-process model

## Step 14: Observability, Rate Limits, and Cost Controls

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

## Step 15: Test Coverage and Release Readiness

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

## Step 16: Admin Operations and Compliance Controls

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
- The order above reflects dependency order and production risk, not just feature desirability.
- A small on-prem pilot may be able to adopt parts of this roadmap more gradually than a multi-tenant cloud rollout.
