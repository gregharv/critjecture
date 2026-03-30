# Future Steps

This file tracks the next implementation milestones after the work captured in `steps_completed.md`.

Step 28 finished the stronger `single_org` sandbox-boundary pass. The remaining work is now split into two tracks:

1. get `single_org` to a defensible production-ready state for controlled customer-managed deployments
2. raise `hosted` to a higher bar suitable for centrally operated multi-tenant deployment

## Phase 1: `single_org` Production Readiness

## Step 29: `single_org` Production Cutover Package

### Goal

Package the final minimum set of product and operational checks needed to call controlled `single_org` deployments production-ready.

### What Should Be Implemented

- validate the exact supported `single_org` production envelope:
  - customer-managed hardware
  - required host dependencies
  - supported backup and recovery posture
  - supported workload limits
- add any missing small but necessary polish for real production use:
  - safer initial credential handling or first-login rotation guidance
  - final deployment checklist cleanup
  - final doc reconciliation across README, deployment, security, and runbooks
- explicitly mark which remaining items are postponed because they are `hosted` concerns rather than `single_org` blockers

### Acceptance Criteria

- the repo can honestly describe controlled `single_org` deployments as production-ready
- there is one clear supported envelope and one clear operator checklist
- remaining gaps are clearly identified as outside the `single_org` production claim

## Phase 2: `hosted` Production Readiness

## Step 30: Hosted Isolation and Supervisor Hardening

### Goal

Raise the hosted deployment boundary above application-level tenant separation and make the dedicated sandbox supervisor a production-grade dependency.

### What Should Be Implemented

- strengthen hosted tenant isolation beyond the current shared-infrastructure posture
- harden the hosted sandbox supervisor contract and operations:
  - deployment requirements
  - authn/authz between web app and supervisor
  - failure drills
  - monitoring and ownership expectations
- document the hosted trust boundary in production terms rather than pilot terms

### Acceptance Criteria

- hosted deployment has a materially stronger isolation story than the current review-pack caveat
- the supervisor dependency is treated as a first-class production service
- hosted failure and recovery procedures are explicit and tested

## Step 31: Hosted Persistence and Scale Envelope

### Goal

Decide and implement the persistence model that will support centrally operated hosted production as concurrency and tenant count grow.

### What Should Be Implemented

- evaluate whether the current SQLite-first runtime remains acceptable for hosted production
- if not, introduce the next persistence path with a migration plan that preserves current product behavior
- define hosted limits for:
  - tenant count
  - concurrency
  - backup and restore expectations
  - operational recovery objectives

### Acceptance Criteria

- hosted persistence and recovery strategy matches expected production load
- the repo no longer depends on an ambiguous “SQLite-first unless traffic grows” answer
- production docs state the supported hosted operating envelope concretely

## Step 32: Hosted Production Launch Package

### Goal

Finish the remaining platform, product, and documentation work required to describe `hosted` as broadly production-ready.

### What Should Be Implemented

- close the remaining hosted-only launch gaps:
  - final tenant onboarding flow expectations
  - final compliance/security packaging needed for hosted customers
  - final operational ownership and escalation paths
- reconcile all hosted deployment, provisioning, security, and readiness docs
- produce one final hosted launch checklist with explicit go/no-go criteria

### Acceptance Criteria

- the repo can honestly describe `hosted` as production-ready rather than limited-availability or carefully reviewed
- hosted launch no longer depends on implicit operator knowledge
- deployment boundaries, recovery posture, and customer-facing claims are aligned across the docs

## Roadmap Notes

- Step 24 is complete:
  - canonical customer-review docs under `apps/web/docs`
  - consolidated security review pack
  - aligned README, deployment, compliance, hosted provisioning, and readiness docs
  - owner-facing customer-review links served from one shared catalog
- Step 25 is complete:
  - workspace plans seeded per organization with billing-anchor reset windows
  - pooled monthly credit enforcement for chat, analysis, chart, document, and import workloads
  - owner-visible credit balances and per-member monthly caps in settings and operations
  - workspace membership suspension moved to the org-membership layer rather than the global user row
  - customer-facing credit reporting preserved alongside internal USD/token telemetry
- Step 26 is complete:
  - fixed-role `owner`, `admin`, and `member` authorization with centralized capability checks
  - org-membership states `active`, `restricted`, and `suspended`
  - capability-driven gating across answer tools, knowledge, audit, operations, settings, and governance routes
  - restricted-workspace UX and suspension-specific login failures
  - docs aligned to the shipped RBAC model instead of the older `Owner` / `Intern` split
- Step 27 is complete:
  - operator-side `single_org` restore-drill and release-proof commands
  - JSON and Markdown release records with required sign-off fields
  - documented `single_org` operator responsibilities for secrets, TLS, encryption, alerting, and incident ownership
  - first-deployment and routine-upgrade runbooks aligned to the shipped commands
- Step 28 is complete:
  - `single_org` now defaults to a dedicated container-backed sandbox supervisor service
  - remote/container-backed sandbox execution preserves the existing synchronous tool contracts
  - sandbox backend selection is explicit and fail closed instead of silently falling back to local `bubblewrap`
  - a repo-owned sandbox supervisor package and runner image definition now exist for customer-managed deployment
  - deployment, readiness, security, and runbook docs now describe the new production boundary clearly
- The main near-term goal is not more surface area:
  - it is converting the current governed SMB system into a defensible `single_org` production deployment and then raising `hosted` to a higher bar
- `hosted` should be treated as a separate bar:
  - stronger isolation, stronger supervisor operations, and a clearer persistence strategy are still required before calling it broadly production-ready
