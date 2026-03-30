# Future Steps

This file tracks the next implementation milestones after the work captured in `steps_completed.md`.

Step 24 finished the security/deployment review package. The remaining work is now split into two tracks:

1. get `single_org` to a defensible production-ready state for controlled customer-managed deployments
2. raise `hosted` to a higher bar suitable for centrally operated multi-tenant deployment

## Phase 1: `single_org` Production Readiness

## Step 25: Release-Gated Operations and Deployment Proof

### Goal

Turn the existing backup, restore, runbook, and security guidance into enforced operator practice for `single_org`.

### What Should Be Implemented

- add a release-gated verification path for production-changing builds:
  - backup verification after migration or storage-layout changes
  - a documented restore-drill checklist with required sign-off fields
  - a simple operator release record or artifact proving the checks were run
- document the minimum operator responsibilities for `single_org`:
  - secret storage and rotation ownership
  - TLS termination expectations
  - storage and backup encryption expectations
  - alert-webhook setup and incident contact ownership
- add one clear operational checklist for first customer deployment and one for routine upgrades

### Acceptance Criteria

- production-changing releases have a concrete required verification path, not just optional commands
- `single_org` operators can demonstrate backup verification and restore readiness without tribal knowledge
- secret-handling, encryption, and incident-ownership expectations are explicit

## Step 26: Stronger `single_org` Sandbox Boundary

### Goal

Raise the Python execution boundary from a hardened same-host namespace sandbox toward something that is easier to defend as production-ready for customer-managed deployments.

### What Should Be Implemented

- choose and implement a stronger execution boundary for `single_org`:
  - container-backed isolation
  - lightweight VM-backed isolation
  - or another clearly stronger boundary than the current host-local `bubblewrap` model
- preserve the current tool contracts for analysis, charts, and documents
- keep fail-closed behavior when the stronger sandbox backend is unavailable or unhealthy
- update health, operations, deployment, and runbook surfaces for the new backend model

### Acceptance Criteria

- `single_org` no longer depends on the current same-host sandbox story alone
- sandbox failures remain observable and fail closed
- deployment docs and runbooks describe the new production boundary clearly

## Step 27: `single_org` Production Cutover Package

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

## Step 28: Hosted Isolation and Supervisor Hardening

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

## Step 29: Hosted Persistence and Scale Envelope

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

## Step 30: Hosted Production Launch Package

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
- The main near-term goal is not more surface area:
  - it is converting the current pilot-ready system into a defensible `single_org` production deployment
- `hosted` should be treated as a separate bar:
  - stronger isolation, stronger supervisor operations, and a clearer persistence strategy are still required before calling it broadly production-ready
