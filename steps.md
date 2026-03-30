# Future Steps

This file tracks the next implementation milestones after the work captured in `steps_completed.md`.

Step 31 finished the hosted persistence and recovery-discipline pass. The remaining work is now the hosted production launch package:

1. raise `hosted` to a higher bar suitable for centrally operated dedicated-customer-cell deployment
2. preserve the narrower `single_org` production claim while hosted-only hardening continues

## Phase 2: `hosted` Production Readiness

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
- Step 29 is complete:
  - bootstrap `single_org` credentials now create missing first-access accounts without overwriting existing passwords or membership state on restart
  - the `single_org` production envelope is now documented concretely across readiness, deployment, security, and README materials
  - one canonical `single_org` cutover checklist now exists in the first-deployment runbook
  - remaining production blockers are now called out explicitly as hosted-only work rather than `single_org` gaps
- Step 30 is complete:
  - `hosted` now enforces one bound organization per deployment cell instead of a shared multi-org runtime
  - hosted sandbox supervisor requests now use signed auth plus bound-organization verification
  - hosted health, alerts, provisioning, and runbooks now treat the supervisor as a first-class production dependency
  - customer-review docs now describe hosted as a dedicated-customer-cell boundary instead of shared infrastructure with application-only separation
- Step 31 is complete:
  - hosted now has an explicit SQLite-backed dedicated-cell support envelope instead of an ambiguous future persistence answer
  - health and operations now surface SQLite/WAL/topology/runtime-path metadata for the current hosted boundary
  - hosted restore drills now produce real JSON and Markdown evidence records with documented RPO/RTO expectations
  - backup verification fixtures, runbooks, and customer-review docs now align with one-org-per-hosted-cell recovery
- The main near-term goal is not more surface area:
  - it is raising `hosted` to a materially stronger production bar without weakening the now-narrower `single_org` claim
- `hosted` should be treated as a separate bar:
  - broader hosted launch packaging and final go/no-go criteria are still required before calling it broadly production-ready
