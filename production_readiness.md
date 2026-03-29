# Production Readiness

This document captures the main capabilities still missing before Critjecture should be treated as production-ready. It is based on the current repo as it exists today, not on a generic SaaS checklist.

## Current State

Critjecture already has a strong MVP foundation:

- a Next.js chat app
- real authentication and server-enforced RBAC
- organizations plus organization memberships
- SQLite-backed durable app state with repeatable migrations
- role-aware organization-scoped company-data search
- sandboxed Python analysis with staged inputs
- generated PNG and PDF outputs
- an owner-facing audit dashboard

That is enough to demonstrate the workflow and validate the product shape. It is not yet enough for a real production rollout without important security, persistence, and operations work.

## Launch Blockers

These are the biggest gaps that should be addressed before treating the product as production-ready for real customers.

### 1. Stronger Sandbox Isolation

The Python sandbox is careful, but it is still a local `child_process` model. It stages approved files and strips environment variables, which is good, but that is still not the same as a hardened production isolation boundary.

What is missing:

- stronger process isolation, likely container or VM backed
- explicit CPU, memory, runtime, and concurrency controls
- more robust workspace cleanup and lifecycle handling
- clearer defense against malicious or accidental resource abuse

Why it matters:

- model-generated code is inherently high risk
- a production rollout needs stronger guarantees than a local subprocess sandbox

### 2. Production Backup Discipline and Recovery Drills

The repo now has a real SQLite-backed persistence model with tenant scoping and documented storage layout. That is enough for the primary supported deployment path, but production operations still need stronger verification around recovery.

What is missing:

- regular backup verification
- restore drills for both the SQLite database file and tenant storage root
- retention policies for audits, conversations, uploads, and generated outputs
- disaster recovery expectations

Why it matters:

- production systems need proven recoverable state
- a documented backup policy is not the same as a tested restore path

### 3. Rate Limiting, Abuse Controls, and Cost Controls

The app does not currently appear to have rate limiting or usage governance around chat and tool execution.

What is missing:

- per-user and per-tenant request limits
- protection against repeated expensive tool usage
- budget controls around model usage
- throttling and safety controls for sandbox-backed routes

Why it matters:

- without limits, a production rollout is exposed to both cost spikes and abuse

### 4. Observability and Incident Debugging

The audit log is useful for product behavior, but it is not a replacement for production observability.

What is missing:

- structured application logs
- error tracking and alerting
- request tracing across chat, tool routes, and sandbox execution
- health checks and operational dashboards

Why it matters:

- production failures need fast diagnosis
- customer support becomes difficult without system-level visibility

### 5. Automated Test Coverage and Release Confidence

There does not appear to be a real automated test suite in the repo today.

What is missing:

- backend route tests
- RBAC tests
- sandbox validation tests
- generated file route tests
- audit flow tests
- end-to-end coverage for core chat journeys

Why it matters:

- production rollout without regression protection is high risk
- this product has multiple safety-sensitive paths that should not rely only on manual testing

## Important But Not First-Wave Blockers

These are important production capabilities, but they come after auth, persistence, and platform hardening.

### 1. Server-Backed Chat History

The current chat experience has browser-local session storage wiring, but not a true server-backed conversation history model.

What is missing:

- persistent conversations tied to users and tenants
- resume/reload across devices and browsers
- searchable or navigable history
- clear linkage between chat history and audit entries

Why it matters:

- users expect conversations to persist
- support and compliance workflows are easier with durable history

### 2. File Uploads and Ingestion

Attachments are currently disabled in the chat UI, so customers cannot onboard their own files through the product.

What is missing:

- upload UI
- file validation and storage
- parsing or ingestion flow
- metadata and ownership tracking
- integration with search and sandbox staging

Why it matters:

- this product becomes much more useful once customers can load their own operational files

### 3. Admin and Customer Management

The product currently focuses on the core assistant workflow, not account administration.

What is missing:

- user invites
- membership management
- role assignment
- admin controls for data and audit access

### 4. Data Lifecycle Controls

Production customers will eventually need stronger data governance.

What is missing:

- retention settings
- deletion workflows
- export capabilities
- archive and recovery policies

### 5. Compliance, Privacy, and Security Posture

The current repo is not yet packaged for security review or compliance-heavy customers.

What is missing:

- documented encryption approach
- secrets management expectations
- privacy posture for customer data
- incident response and operational runbooks

## Deployment Mode Matters

The severity of some gaps depends on how Critjecture is deployed.

### On-Prem or Single-Customer Pilot

For a controlled on-prem deployment or a tightly managed single-customer pilot:

- the current SQLite-first deployment model may already be appropriate
- simpler operational tooling may be acceptable sooner
- limited-user rollout may reduce the need for some tenant-management features at first

Even in that model, stronger sandbox isolation, backup verification, and release confidence still need real attention before a serious rollout.

### Multi-Tenant Cloud SaaS

For a real multi-tenant cloud deployment, the standard is much higher.

Before that kind of launch, Critjecture should have:

- stronger execution isolation
- durable backup verification and recovery drills
- observability and cost controls
- automated regression coverage
- likely a higher-concurrency database path once usage grows past the SQLite-first operational envelope

Those are not optional polish items in a multi-tenant SaaS setting. They are launch requirements.

## Recommended Rollout Order

### Before First External Pilot

- stronger sandbox controls
- basic production observability
- minimum regression test coverage for critical routes

### Before Multi-Tenant Production

- production backup verification and restore drills
- rate limiting and cost controls
- stronger operational dashboards and incident handling
- admin controls and tenant management
- server-backed chat history

### Second Wave After Launch

- file uploads and ingestion
- broader compliance and export workflows
- more advanced admin features
- richer conversation management and knowledge lifecycle tools

## Bottom Line

Chat history and file uploads are missing, and they are important. They are not the first production blockers.

The top production priorities are:

1. real authentication
2. server-enforced authorization
3. tenant and persistence foundations
4. stronger sandbox isolation
5. observability, limits, and automated testing

Once those foundations exist, chat history and uploads become much safer and more valuable to implement.
