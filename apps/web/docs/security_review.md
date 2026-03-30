# Security Review Pack

This document packages the current Critjecture MVP for internal or customer security review. It describes the shipped system as it exists today, the operator assumptions it relies on, and the boundaries of the currently supported deployment envelope.

## System Summary

Critjecture is a local-first property-management assistant with:

- authenticated users and organization memberships
- server-enforced `Owner` / `Intern` role checks
- organization-scoped company-data storage and retrieval
- a constrained tool surface for search, analysis, chart generation, and document generation
- a Python sandbox path for approved analysis and artifact generation
- owner-visible audit, operations, governance, backup, and recovery surfaces

The current product is designed for narrow operational workflows, not open-ended autonomous execution.

## Supported Deployment Envelope

The current supported deployment modes are:

- `single_org`
  - local development
  - customer-managed hardware
  - tightly controlled on-prem or single-customer pilot environments
- `hosted`
  - centrally operated Railway-style deployments
  - multiple organizations in one deployment
  - a required dedicated sandbox supervisor service for Python execution

Explicit non-goals for the current envelope:

- self-service public SaaS onboarding
- arbitrary tenant-managed code execution outside the shipped tool contracts
- broad enterprise compliance claims beyond the controls documented in this repo
- async heavy analytics or large warehouse-style workloads

## Secrets And Credential Handling Expectations

Critjecture expects operators to provide secrets and privileged configuration through environment variables or the deployment platform's secret-management facility.

Current expectations:

- keep `AUTH_SECRET`, `OPENAI_API_KEY`, and any hosted sandbox supervisor credentials out of source control
- use distinct secrets per environment
- limit access to deployment secrets to operators with production responsibility
- rotate secrets through operator processes when staff or infrastructure boundaries change
- avoid sharing seeded pilot credentials outside controlled `single_org` environments

The app does not currently provide an in-product secret vault, bring-your-own-key workflow, or customer-managed encryption-key system.

## Encryption Assumptions

Critjecture stores runtime state in SQLite and tenant files on the deployment filesystem or attached volume. The application assumes encryption is primarily provided by the deployment environment, not by app-managed per-record encryption.

Current assumptions:

- TLS termination is handled by the reverse proxy or platform in front of the app
- disk or volume encryption is handled by the host, cloud provider, or customer-managed hardware
- backup archives should be stored only in encrypted operator-controlled locations
- operator access to raw storage and backup artifacts must be restricted because those artifacts can contain customer uploads, audit history, export bundles, and generated files

Critjecture does not currently claim end-to-end encryption, client-side encryption, or app-managed encryption of SQLite rows and storage artifacts.

## Tenant Isolation And Trust Boundaries

Isolation is primarily enforced at the application and storage-path layers.

Current tenant boundaries:

- authentication derives the acting user, organization, and role on the server
- organization memberships scope access to company data, chat history, audit records, governance jobs, generated assets, and uploads
- generated assets remain bound to the creating user and organization when they are retrieved
- organization-managed files live under organization-specific storage roots

Hosted-mode boundary notes:

- multiple organizations share one web deployment and one logical runtime stack
- hosted mode depends on a dedicated sandbox supervisor service and operator-managed provisioning
- the app enforces org scoping and role checks, but hosted mode is not documented as a hard infrastructure-isolation boundary between tenants
- production review for hosted mode should treat the web app, SQLite runtime, storage root, logs, and supervisor operations as shared operator-managed infrastructure with application-level tenant separation

## Privacy Posture

Critjecture processes customer business records uploaded or staged for approved workflows. That can include:

- uploaded `.csv`, `.txt`, `.md`, and text-extractable `.pdf` files
- chat prompts and assistant responses
- audit logs of tool calls and accessed files
- generated charts, documents, exports, and governance artifacts

Current privacy posture:

- access is scoped to the authenticated organization and role
- uploaded files are stored in organization-owned paths and are searchable only when authorization allows it
- audit and governance data are visible through owner-admin surfaces inside the same organization
- retention settings can prune request logs, usage events, chat history, import metadata, and export artifacts according to organization policy
- destructive purge flows are gated behind recent export creation for the covered data classes

The current product does not promise automatic redaction, DLP classification, legal-hold workflows, or tenant self-service data residency controls.

## Sandbox, Recovery, And Operations

The Python sandbox is constrained and fail-closed relative to the shipped tool flow, but it is still part of the product's main risk boundary.

Current controls and expectations:

- approved files are staged into fresh per-run workspaces
- inherited environment variables are stripped before Python execution
- execution is bounded by timeout, memory, process, and output validation rules
- `single_org` uses local `bubblewrap` + `prlimit`
- `hosted` requires a dedicated remote sandbox supervisor and should be reviewed as a separate operational dependency
- operators should run the documented backup and restore verification flow after storage-layout or migration changes
- operators should capture `x-critjecture-request-id` together with sandbox, governance, and import identifiers during incident response

See the deployment guide and runbooks for the exact operator procedures.

## Remaining Review Notes

The main remaining hardening gap is not missing product surface area; it is the review and approval bar around the current system boundaries.

Important caveats:

- `single_org` is the lower-risk first deployment path because it is customer-managed and narrower in scope
- `hosted` has a higher review bar because it introduces shared operator-managed infrastructure and the dedicated sandbox supervisor dependency
- future work such as stronger sandbox isolation, broader invite/onboarding workflows, or async heavy-job support would be new hardening/product steps, not claims of the current MVP
