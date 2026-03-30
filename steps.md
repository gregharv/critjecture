# Future Steps

This file tracks the next implementation milestones after the work already captured in `steps_completed.md`.

Critjecture is closer to a controlled pilot than to full production readiness. Several items in `production_readiness.md` are now outdated because Steps 16 through 23 already shipped rate limits, operations dashboards, tests, uploads, chat history, admin/governance controls, supervisor-backed sandbox hardening, tested recovery tooling, production observability/runbooks, and durable chart intermediates. The remaining gaps are narrower and more packaging-oriented.

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
- Step 21 is complete:
  - scripted SQLite and storage-root backup flows
  - checksum-verified clean-environment restore tooling
  - repeatable `single_org` and `hosted` recovery drills
  - release-gated backup verification guidance and retention expectations
- Step 22 is complete:
  - structured application logs with stable request/job correlation
  - webhook-delivered external operational alerts
  - observed admin/governance/health routes with propagated request ids
  - runbooks for sandbox, storage, migration, backup/restore, hosted, and on-prem incidents
- Step 23 is complete:
  - durable SQLite-backed `analysisResultId` storage with TTL cleanup and org/user/turn binding
  - chart rendering from server-staged structured payload files instead of JSON embedded back into Python source
  - explicit chart-ready point-count and payload-byte limits for synchronous rendering
  - documented boundary that larger chart/document workloads remain future async-job work
- The main remaining blocker is now deployment/security packaging, not core product surface area.
- A controlled on-prem single-org pilot may be viable sooner than a broadly hosted production rollout.
- Hosted production still has a higher bar than on-prem because the web app expects a dedicated sandbox supervisor service and the remaining work is concentrated in security/deployment review packaging plus any later async-job expansion.
