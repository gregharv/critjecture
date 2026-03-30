# Production Readiness

This document states what Critjecture is ready for now, what remains out of scope for the current production claim, and how that answer differs between `single_org` and `hosted`.

It reflects the repo after Step 29.

## Readiness Call

Critjecture is not yet broadly production-ready across all deployment modes.

Current call by deployment target:

- `single_org`
  - production-ready for controlled customer-managed deployments inside the documented support envelope
  - intended for customer-managed hardware where the operator follows the documented cutover, backup, restore-drill, and release-proof flows
- `hosted`
  - not yet broadly production-ready
  - still suitable only for carefully reviewed centrally operated dedicated-customer cells

The important distinction is simple: Step 29 closes the minimum production package for `single_org`, not for `hosted`.

## What The `single_org` Claim Covers

The current `single_org` production claim is deliberately narrow. It assumes:

- customer-managed hardware and operator-managed deployment secrets
- persistent SQLite storage plus persistent tenant storage roots
- a dedicated container-backed sandbox supervisor service with Docker Engine available on the supervisor host
- `pdftotext` on the web-app host for PDF ingestion
- explicit backups for database and tenant storage
- one successful restore drill for the exact environment before first cutover
- one release-proof record for first deployment and each production-changing upgrade
- bootstrap owner/member credentials provided out-of-band for first access, then rotated through the documented admin flow

Current workload and sandbox envelope for that claim:

- per-user active sandbox jobs: `1`
- global active sandbox jobs: `4`
- wall timeout: `10s`
- CPU limit: `8s`
- memory limit: `512 MiB`
- process limit: `64`
- stdout/stderr capture limit: `1 MiB`
- output artifact size limit: `10 MiB`
- generated artifact retention: `24h`

Within that envelope, the repo now has the minimum product and operator package needed for a defensible controlled `single_org` deployment.

## What Is Already In Place

The repo already includes the production foundations that matter for this narrower claim:

- authenticated users, organizations, RBAC, and membership-state enforcement
- repeatable SQLite migrations and organization-scoped persistent storage
- auditable search, analysis, chart, document, governance, and admin flows
- fail-closed sandbox execution through a dedicated supervisor boundary for production `single_org`
- scripted backup creation, restore verification, restore drills, and release-proof records
- operator runbooks covering first deployment, routine upgrades, sandbox failures, storage failures, backup failures, and on-prem recovery

These are no longer roadmap placeholders. They are shipped behavior and operator tooling.

## What Remains Outside The Current Production Claim

These items are not blockers for the current `single_org` claim, but they are still outside the repo's broad-production answer:

- self-service public SaaS onboarding
- async heavy-job handling beyond the current synchronous sandbox envelope
- broader enterprise attestations beyond the controls documented here
- richer end-user lifecycle features such as conversation archive/search/delete

## Hosted-Only Remaining Gaps

The remaining production blockers are now primarily `hosted` concerns:

- stronger hosted operating evidence and recovery discipline around the dedicated-customer-cell boundary
- production hardening of the hosted sandbox supervisor as a first-class dependency
- a clearer hosted persistence and scale answer as concurrency and tenant count grow

Those are the next roadmap items because they are required before calling `hosted` broadly production-ready.

## Bottom Line

The repo can now honestly describe controlled `single_org` deployments as production-ready within one clear support envelope and one clear operator cutover path.

The repo still cannot honestly describe Critjecture as broadly production-ready across both deployment modes, because `hosted` still has material isolation, supervisor, and scale work remaining.
