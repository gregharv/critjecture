# Production Readiness

This document states what Critjecture is ready for now, what still blocks a production claim, and how that answer changes between `single_org` and `hosted` deployments.

It reflects the repo after Step 27. It is intentionally specific to the current codebase, docs, and operator tooling.

## Readiness Call

Critjecture is not yet broadly production-ready across all deployment modes.

Current call by deployment target:

- `single_org`
  - close to production-ready for controlled customer-managed deployments
  - reasonable for a serious on-prem or single-customer rollout once the dedicated container supervisor is deployed and the operator follows the documented security, backup, restore-drill, and release-proof requirements
- `hosted`
  - not yet a comfortable broad-production target
  - usable only for teams willing to accept the current shared-infrastructure boundary and the dedicated sandbox-supervisor dependency

The main point is this: the product surface is no longer the blocker. The remaining work is mostly platform hardening and operational proof.

## What Already Exists

The repo already includes the foundations you would expect before a serious deployment:

- authenticated users, organizations, and server-enforced RBAC
- durable SQLite-backed app state with repeatable migrations
- organization-scoped company-data search, uploads, and generated-file handling
- constrained Python analysis/chart/document tooling
- owner-visible audit logs, governance controls, exports, and purge flows
- route health checks, usage/rate-limit controls, and operational alerts
- scripted backup creation, clean restore tooling, and repeatable recovery drills
- customer-review deployment, compliance, provisioning, and security docs
- automated route, integration, and end-to-end test coverage

Those are real production foundations. They are no longer hypothetical roadmap items.

## Required Before We Should Call It Production-Ready

These are the remaining items that still look like true production blockers rather than optional polish.

### 1. Stronger Sandbox Isolation

The sandbox boundary is now split more clearly by deployment:

- `single_org` uses a dedicated container-backed supervisor service
- `hosted` still uses a supervisor-mediated remote boundary that needs more production hardening

Still needed for the broader platform story:

- finish the hosted-side hardening and operating model
- prove the new boundary in real `single_org` environments through deployment and runbook evidence

Why this is still a blocker:

- code execution is the highest-risk feature in the product
- model-generated code is still the highest-risk feature, so the new boundary has to be operated deliberately and fail closed

### 2. Operational Proof Now Exists For `single_org`

The repo now includes the missing `single_org` operator workflow:

- `pnpm restore:drill:single-org` for real environment restore drills
- `pnpm release:proof:single-org` for release-gated operator sign-off
- dedicated first-deployment and routine-upgrade runbooks

That closes the earlier repo-level gap around release-gated operations. The remaining work is execution per environment, not missing product or tooling surface.

### 3. Hosted Deployment Hardening

`hosted` has a meaningfully higher bar than `single_org`.

Still needed:

- a stronger answer for tenant isolation inside shared operator-managed infrastructure
- production validation of the dedicated sandbox supervisor as a first-class dependency
- a decision on whether the SQLite-first envelope is still acceptable as hosted concurrency grows

Why this is still a blocker:

- hosted mode places multiple organizations inside one deployment footprint
- application-level org scoping is necessary, but many production customers will want stronger infrastructure guarantees

## Things That Matter, But Are Not The Main Blockers

These are real gaps, but they are not the reason the repo is still short of a production claim.

- invite-based onboarding instead of manual account creation and credential handoff
- richer conversation lifecycle tools such as search, rename, archive, or delete
- broader compliance packaging or formal attestations if a customer requires them
- async heavy-job support for workloads that exceed the current synchronous sandbox envelope

## Deployment-Specific Guidance

### `single_org`

If the goal is a real customer-managed deployment on their own hardware, the remaining list is relatively short.

Before calling that mode production-ready, operators should execute:

- an explicit release-proof record covering secret storage, TLS termination, storage encryption, backup encryption, alert ownership, and incident ownership
- at least one successful restore drill against the exact environment shape that will be deployed
- the container supervisor is deployed, healthy, and using the intended sandbox image

If those are satisfied, `single_org` is much closer to a production decision than it was earlier in the roadmap.

### `hosted`

If the goal is a broadly offered centrally managed multi-tenant deployment, more work is still needed.

Before calling that mode production-ready, we should have:

- stronger sandbox and infrastructure isolation than the current shared deployment story
- production operations around the hosted sandbox supervisor, including failure drills and monitoring ownership
- confidence that the SQLite-first runtime is still the right fit for the concurrency and recovery expectations of hosted customers

Without those, `hosted` should still be described as carefully reviewed or limited-availability, not broadly production-ready.

## Bottom Line

Yes, there is still more to do before Critjecture should be described as production-ready in the broad sense.

The remaining must-do items are:

1. strengthen the sandbox isolation boundary
2. raise the hosted deployment story to a higher tenant-isolation and infrastructure-hardening standard

If the target is a controlled `single_org` rollout, the remaining repo gap is now mostly the sandbox boundary and final supported-envelope packaging. If the target is broadly offered `hosted` multi-tenant production, the remaining gap is still material.
