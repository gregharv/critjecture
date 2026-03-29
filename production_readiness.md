# Production Readiness

This document captures the main capabilities still missing before Critjecture should be treated as production-ready. It is based on the current repo as it exists today, not on a generic SaaS checklist.

## Current State

Critjecture already has a strong foundation:

- a Next.js chat app with real authentication and server-enforced RBAC
- organizations plus organization memberships
- SQLite-backed durable app state with repeatable migrations
- role-aware organization-scoped company-data search
- sandboxed Python analysis with staged inputs
- generated PNG and PDF outputs
- owner-facing audit logs
- per-route rate limits, usage budgets, and an operations dashboard
- server-backed conversation persistence and history loading
- knowledge uploads, ingestion jobs, and searchable managed files
- owner-managed member administration, retention settings, exports, and purge jobs
- automated route, policy, and end-to-end test coverage

That is enough to demonstrate the workflow and validate the product shape. It is not yet enough for a real production rollout without stronger isolation, recovery validation, and security posture work.

## Launch Blockers

These are the biggest gaps that should be addressed before treating the product as production-ready for real customers.

### 1. Stronger Sandbox Isolation Boundary

The Python sandbox is much better than a naive subprocess model. It uses `bubblewrap`, resource limits, concurrency admission controls, staged inputs, and workspace cleanup. That is still not the same as a stronger production isolation boundary.

What is missing:

- stronger isolation, likely container or VM backed, beyond the current same-host sandbox model
- clearer guarantees against hostile code escaping or materially impacting the host

Why it matters:

- model-generated code is inherently high risk
- a production rollout needs stronger guarantees than a same-host namespace sandbox

### 2. Backup Verification and Restore Drills

The repo now has a real SQLite-backed persistence model, documented storage layout, export jobs, retention controls, and restore guidance. What is still missing is proof that recovery works under pressure.

What is missing:

- regular backup verification
- restore drills for both the SQLite database file and tenant storage root

Why it matters:

- production systems need proven recoverable state
- a documented backup policy is not the same as a tested restore path

### 3. Compliance, Privacy, and Security Posture

The current repo is still not packaged for security review or compliance-heavy customers.

What is missing:

- documented encryption approach
- secrets management expectations
- privacy posture for customer data
- incident response and operational runbooks

Why it matters:

- production customers will ask how data is protected, handled, and recovered
- security review requires more than implementation alone

## Important But Not First-Wave Blockers

These are important production capabilities, but they come after platform hardening and recovery confidence.

### 1. Invite and Onboarding Workflow

The product now has owner-managed membership creation, role assignment, suspension, and password resets. What it does not have is a smoother invite-based onboarding flow.

What is missing:

- user invite flow instead of manual account creation and credential handoff

Why it matters:

- manual account provisioning is workable for a pilot
- a broader rollout benefits from safer and more polished onboarding

### 2. Richer Conversation Management

Server-backed conversation persistence and history loading now exist, but conversation management is still basic.

What is missing:

- searchable history
- richer conversation management such as rename, archive, or delete workflows

Why it matters:

- durable history exists now, but larger real-world usage needs stronger organization and retrieval

## Deployment Mode Matters

The severity of some gaps depends on how Critjecture is deployed.

### On-Prem or Single-Customer Pilot

For a controlled on-prem deployment or a tightly managed single-customer pilot:

- the current SQLite-first deployment model may already be appropriate
- the current admin, upload, governance, observability, and testing foundations may already be enough for a serious pilot

Even in that model, stronger sandbox isolation and verified recovery drills still need real attention before a serious rollout.

### Multi-Tenant Cloud SaaS

For a real multi-tenant cloud deployment, the standard is much higher.

Before that kind of launch, Critjecture should still have:

- stronger execution isolation
- verified backup and restore practice
- a clearer compliance and security posture
- likely a higher-concurrency database path once usage grows past the SQLite-first operational envelope

Those are not optional polish items in a multi-tenant SaaS setting. They are launch requirements.

## Recommended Rollout Order

### Before First External Pilot

- stronger sandbox isolation
- at least one tested restore drill covering the database and tenant storage

### Before Multi-Tenant Production

- recurring backup verification and restore drills
- documented compliance, privacy, and security posture
- stronger tenant onboarding flow
- a higher-concurrency database path if usage exceeds the SQLite-first envelope

### Second Wave After Launch

- searchable conversation history
- richer conversation lifecycle tools
- broader compliance packaging and customer-facing operational docs

## Bottom Line

Chat history, uploads, admin controls, governance controls, operations dashboards, rate limits, and automated tests are no longer missing. Those foundations now exist in the repo.

The top remaining production priorities are:

1. stronger sandbox isolation
2. proven backup verification and restore drills
3. clearer compliance, privacy, and security posture

Once those gaps are addressed, Critjecture is much closer to being ready for a serious pilot and can be hardened further for multi-tenant production.
