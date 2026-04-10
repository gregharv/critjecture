# Security Review Pack

This document packages the current Critjecture system for internal or customer security review. It describes the shipped boundaries, the operator assumptions they rely on, and the limits of the current production claim.

## System Summary

Critjecture is an auditable AI data analyst for business data with:

- authenticated users and organization memberships
- server-enforced fixed `owner` / `admin` / `member` role checks plus membership-state enforcement
- organization-scoped company-data storage and retrieval
- constrained search, analysis, chart, and document tooling
- a Python sandbox path for approved analysis and artifact generation
- privileged audit, operations, governance, backup, and recovery surfaces

The current product is designed for governed business-data answers and narrow operational workflows, not open-ended autonomous execution.

## Supported Deployment Envelope

The current deployment answer is intentionally split:

- `single_org`
  - local development
  - customer-managed hardware
  - controlled on-prem or single-customer deployments
  - production-ready inside the documented `single_org` support envelope
- `hosted`
  - centrally operated dedicated customer cells
  - one organization/customer per deployment cell
  - production-ready within the documented dedicated-customer-cell envelope

Explicit non-goals for the current envelope:

- self-service public SaaS onboarding
- arbitrary tenant-managed code execution outside the shipped tool contracts
- broad enterprise compliance claims beyond the controls documented in this repo
- async heavy analytics or warehouse-style workloads beyond the feature-gated workflow scheduler envelope

## Secrets And Credential Handling Expectations

Critjecture expects operators to provide secrets and privileged configuration through environment variables or the deployment platform's secret-management facility.

Current expectations:

- keep `AUTH_SECRET`, `OPENAI_API_KEY`, sandbox supervisor credentials, and `CRITJECTURE_WORKFLOW_TICK_SECRET` (when scheduler is enabled) out of source control
- use distinct secrets per environment
- limit deployment-secret access to operators with production responsibility
- rotate secrets through operator processes when staff or infrastructure boundaries change
- treat `single_org` bootstrap account credentials as first-access credentials, not permanent production passwords
- rotate bootstrap owner/member credentials through the admin member-management flow before customer handoff
- for `single_org` production changes, capture the named secret-storage owner and secret-rotation owner in the release-proof record

The app does not currently provide an in-product secret vault, bring-your-own-key workflow, or customer-managed encryption-key system.

## Encryption Assumptions

Critjecture stores runtime state in SQLite and tenant files on the deployment filesystem or attached volume. The application assumes encryption is primarily provided by the deployment environment, not by app-managed per-record encryption.

Current assumptions:

- TLS termination is handled by the reverse proxy or platform in front of the app
- disk or volume encryption is handled by the host, cloud provider, or customer-managed hardware
- backup archives should be stored only in encrypted operator-controlled locations
- operator access to raw storage and backup artifacts must be restricted because those artifacts can contain customer uploads, audit history, export bundles, and generated files
- `single_org` production changes should record the TLS, storage-encryption, and backup-encryption expectations in the release-proof artifact

Critjecture does not currently claim end-to-end encryption, client-side encryption, or app-managed encryption of SQLite rows and storage artifacts.

## Operator Responsibilities For `single_org`

For controlled customer-managed deployments, the operator is responsible for:

- secret storage and rotation ownership
- TLS termination in front of the app
- storage and backup encryption posture
- `CRITJECTURE_ALERT_WEBHOOK_URL` configuration and delivery ownership
- incident contact ownership for the environment
- bootstrap credential rotation before customer handoff

The repo includes `pnpm restore:drill:single-org` and `pnpm release:proof:single-org` so those responsibilities are captured as release evidence instead of left to tribal knowledge.

## Tenant Isolation And Trust Boundaries

Isolation is primarily enforced at the application and storage-path layers.

Current tenant boundaries:

- authentication derives the acting user, organization, and role on the server
- organization memberships scope access to company data, chat history, audit records, governance jobs, generated assets, and uploads
- generated assets remain bound to the creating user and organization when they are retrieved, with an owner override for same-organization review
- organization-managed files live under organization-specific storage roots

Hosted-mode boundary notes:

- hosted mode uses a dedicated app, SQLite runtime, storage root, logs, and sandbox supervisor per customer organization
- hosted mode depends on operator-managed provisioning plus a dedicated sandbox supervisor service bound to the same organization slug
- hosted mode currently supports one writable app instance and one SQLite database in `WAL` mode per customer cell
- scheduled workflow execution in hosted remains disabled by default unless operators explicitly enable hosted scheduler flags and cron/tick controls
- the app still enforces org scoping and role checks, but hosted no longer claims a shared multi-org deployment model
- production review for hosted mode should treat the hosted app cell and the hosted supervisor as customer-dedicated operator-managed infrastructure with one bound organization

## Privacy Posture

Critjecture processes customer business records uploaded or staged for approved workflows. That can include:

- uploaded `.csv`, `.txt`, `.md`, and text-extractable `.pdf` files
- chat prompts and assistant responses
- audit logs of tool calls and accessed files
- generated charts, documents, exports, and governance artifacts

Current privacy posture:

- access is scoped to the authenticated organization and role
- uploaded files are stored in organization-owned paths and are searchable only when authorization allows it
- audit and governance data are visible through privileged admin surfaces inside the same organization
- retention settings can prune request logs, usage events, chat history, import metadata, and export artifacts according to organization policy
- destructive purge flows are gated behind recent export creation for the covered data classes

The current product does not promise automatic redaction, DLP classification, legal-hold workflows, or tenant self-service data residency controls.

## Sandbox, Recovery, And Operations

The Python sandbox is constrained and fail-closed relative to the shipped tool flow, but it is still part of the product's main risk boundary.

Current controls and expectations:

- approved files are staged into fresh per-run workspaces
- inherited environment variables are stripped before Python execution
- execution is bounded by timeout, memory, process, output, and retention rules
- `single_org` production uses a dedicated container supervisor service and per-run OCI containers
- `local_supervisor` keeps `bubblewrap` + `prlimit` only as an explicit dev/test fallback
- `hosted` requires a dedicated remote sandbox supervisor, signed app-to-supervisor requests, and matching organization binding on both sides
- workflow scheduler/tick controls use token-protected internal routes, unique schedule-window keys, bounded worker concurrency, and stale-run reconciliation runbooks
- `hosted` recovery discipline now includes `pnpm restore:drill:hosted`, at-least-daily backups, `24`-hour RPO, and `2`-hour RTO expectations for the current envelope
- `hosted` production changes should produce a hosted release-proof record that captures launch ownership, escalation, and handoff details
- `single_org` production changes should produce a restore-drill record plus a release-proof record before cutover
- operators should capture `x-critjecture-request-id` together with sandbox, governance, and import identifiers during incident response

Current `single_org` production envelope for sandbox-backed work:

- per-user active sandbox jobs: `1`
- global active sandbox jobs: `4`
- wall timeout: `10s`
- CPU limit: `8s`
- memory limit: `512 MiB`
- process limit: `64`
- stdout/stderr capture limit: `1 MiB`
- output artifact size limit: `10 MiB`
- generated artifact retention: `24h`

See the deployment guide and runbooks for the exact operator procedures.

## Remaining Review Notes

The main remaining limitations are now product-scope exclusions rather than missing hosted launch packaging.

Important caveats:

- `single_org` is the lower-risk first deployment path because it is customer-managed and narrower in scope
- `hosted` still carries centrally operated infrastructure ownership and the dedicated sandbox supervisor dependency, so operators should keep the documented ownership and escalation package intact
- future work such as denser hosted placement or a different hosted persistence path would be new hardening steps, not missing pieces of the current production package
