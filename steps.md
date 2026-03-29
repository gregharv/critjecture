# Future Steps

This file tracks the next implementation milestones after the work already captured in `steps_completed.md`.

Critjecture is closer to a controlled pilot than to full production readiness. Several items in `production_readiness.md` are now outdated because Steps 16 through 20 already shipped rate limits, operations dashboards, tests, uploads, chat history, admin/governance controls, and supervisor-backed sandbox hardening. The remaining gaps are narrower and more operational.

## Step 21: Backup Verification and Disaster Recovery

### Goal

Turn the documented SQLite/storage backup model into a tested recovery process.

### What Should Be Implemented

- add scripted backup flows for:
  - SQLite database state
  - organization storage roots
  - governance/export artifacts as needed
- add restore procedures that can rebuild a clean environment from backup artifacts
- run and document repeatable recovery drills for:
  - single-org on-prem deployments
  - hosted Railway-style deployments
- define retention expectations for backups separately from in-app data retention controls
- add release or ops checks that verify backup/restore paths still work after schema/storage changes

### Acceptance Criteria

- a backup can be taken and restored into a clean environment without manual improvisation
- recovery procedures are written down and rehearsed
- schema migrations and storage layout changes are covered by recovery validation

## Step 22: Production Observability and Incident Response

### Goal

Close the gap between product auditability and real production operations.

### What Should Be Implemented

- add structured application logs that correlate:
  - chat requests
  - tool routes
  - sandbox runs
  - governance jobs
- add error tracking and operator alert delivery beyond the in-app owner dashboard
- propagate stable request/run identifiers through logs and operational views
- document incident response expectations for:
  - sandbox failures
  - storage failures
  - migration failures
  - backup/restore failures
- add a small operator runbook set for hosted and on-prem environments

### Acceptance Criteria

- production failures can be traced across the main request and job flows
- critical failures surface outside the app UI
- operators have written runbooks for the most important incident classes

## Step 23: Durable Analysis Results and Chart Pipeline Scaling

### Goal

Remove the current same-process, in-memory limitation from `analysisResultId` and make chart generation safer for larger workloads.

### What Should Be Implemented

- persist analysis-result payloads outside in-memory process state
- bind persisted analysis results to user, org, turn, TTL, and cleanup policy
- let chart generation read structured stored payloads directly instead of embedding larger JSON blobs back into Python source
- add explicit payload-size or point-count limits for chart-ready data
- define when large chart/document work should stay synchronous vs move to async jobs

### Acceptance Criteria

- `analysisResultId` survives normal app restarts within its intended TTL
- chart rendering no longer depends on same-process memory continuity
- oversized chart payloads are rejected or reduced predictably before rendering

## Step 24: Security and Deployment Review Package

### Goal

Package Critjecture for real customer security review and repeatable deployment approval.

### What Should Be Implemented

- document:
  - secrets management expectations
  - encryption assumptions for storage and backups
  - tenant-isolation boundaries in hosted mode
  - privacy posture for uploaded customer data and audit records
- add a concise security review pack for customer or internal review
- reconcile `production_readiness.md`, `README.md`, deployment docs, and admin/compliance docs so they reflect the post-Step-20 system accurately
- define the supported production envelope clearly:
  - on-prem single-org
  - hosted Railway multi-org
  - non-goals beyond that envelope

### Acceptance Criteria

- deployment/security documentation matches the real shipped system
- customer review of data handling and deployment boundaries no longer depends on tribal knowledge
- the supported production modes and their limits are explicit

## Roadmap Notes

- Step 18 is complete:
  - reusable test reset hooks
  - route/integration coverage for critical server flows
  - mocked Playwright coverage for login, history, and owner-admin access
  - release checklist and full test scripts
- Step 19 is complete:
  - owner-managed member administration
  - compliance settings and governance jobs
  - export-gated purge flows
  - hosted multi-org support for Railway
- Step 20 is complete:
  - supervisor-backed sandbox lifecycle and reconciliation
  - fail-closed hosted sandbox backend expectations
  - sandbox capacity and recovery metrics in health/operations surfaces
- The main remaining blockers are now operational hardening, not core product surface area.
- A controlled on-prem single-org pilot may be viable sooner than a broadly hosted production rollout.
- Hosted production still has a higher bar than on-prem because the web app now expects a dedicated sandbox supervisor service and broader incident/runbook work remains.
