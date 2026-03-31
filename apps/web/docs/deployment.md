# Deployment Modes

This is the canonical deployment and cutover guide for Critjecture's currently supported production envelope.

The current repo claim is intentionally split:

- `single_org` is production-ready for controlled customer-managed deployments inside the envelope documented here
- `hosted` is production-ready within the dedicated-customer-cell envelope documented here

For a concise security and trust-boundary summary, pair this document with `security_review.md`.

## `single_org`

Use `single_org` for:

- local development
- customer-managed hardware
- tightly controlled on-prem or single-customer deployments

### Supported Production Envelope

Current production expectations for `single_org`:

- one customer-managed deployment footprint for app, SQLite storage, tenant storage, and operator procedures
- persistent SQLite storage plus persistent organization storage roots
- `CRITJECTURE_SANDBOX_EXECUTION_BACKEND=container_supervisor`
- `CRITJECTURE_SANDBOX_SUPERVISOR_URL`, `CRITJECTURE_SANDBOX_SUPERVISOR_TOKEN`, and `CRITJECTURE_SANDBOX_CONTAINER_IMAGE` configured
- the repo-owned sandbox supervisor service deployed with Docker Engine available on the supervisor host
- `pdftotext` installed on the web-app host
- operator-managed secrets for auth, model access, and sandbox connectivity
- explicit backups for both the database and tenant storage

Bootstrap credential expectations:

- `CRITJECTURE_OWNER_*` and `CRITJECTURE_INTERN_*` create the bootstrap owner/member accounts only when those accounts do not already exist
- those env values are first-access bootstrap credentials, not authoritative long-lived production passwords
- after first access, operators should rotate the bootstrap credentials through the admin member-management flow before customer handoff
- password resets and membership changes are expected to persist across app restarts

Current workload and sandbox limits for the supported envelope:

- per-user active sandbox jobs: `1`
- global active sandbox jobs: `4`
- wall timeout: `10s`
- CPU limit: `8s`
- memory limit: `512 MiB`
- process limit: `64`
- stdout/stderr capture limit: `1 MiB`
- output artifact size limit: `10 MiB`
- generated artifact retention: `24h`

Local development note:

- `local_supervisor` (`bubblewrap` + `prlimit`) remains available only as an explicit dev/test override
- if the dedicated supervisor service is not running, set `CRITJECTURE_SANDBOX_EXECUTION_BACKEND=local_supervisor` intentionally instead of expecting an implicit fallback

### Canonical Cutover Checklist

For a real `single_org` production cutover, use `apps/web/docs/runbooks/single-org-first-deployment.md` as the canonical operator checklist.

That runbook is the required cutover path for:

- environment pre-flight verification
- restore-drill evidence
- release-proof evidence
- bootstrap-credential rotation before handoff
- post-cutover smoke checks

For later production-changing releases, use `apps/web/docs/runbooks/single-org-routine-upgrade.md`.

## `hosted`

Use `hosted` for centrally operated dedicated customer cells.

Current characteristics:

- one hosted deployment cell contains exactly one organization/customer
- `CRITJECTURE_HOSTED_ORGANIZATION_SLUG` binds the app and the supervisor to that one organization
- hosted remains SQLite-backed per dedicated customer cell in the current supported envelope
- one writable web-app instance is supported per hosted cell
- active-active multi-writer replicas sharing one SQLite file are out of scope
- current hosted support assumes the existing synchronous request model only, not queue-backed heavy analytics expansion
- hosted inherits the current sandbox envelope of `1` active run per user and `4` globally
- tenant creation is operator-managed through the provisioning script, not tenant self-service
- the web app must be configured with `CRITJECTURE_SANDBOX_SUPERVISOR_URL`
- hosted supervisor traffic must use signed requests with `CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID` and `CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET`
- the sandbox path depends on a dedicated remote supervisor service and should be treated as a required production dependency
- customer isolation is enforced by dedicated app/SQLite/storage/supervisor placement plus authenticated organization scoping inside that dedicated cell
- customer onboarding remains operator-managed; after first owner handoff, additional users are created through the existing admin settings surface

## Shared Runtime Requirements

- persistent SQLite storage
- persistent organization storage roots
- explicit backups for both the database and tenant storage
- operator-managed secrets for auth, model access, and sandbox connectivity
- `pdftotext` on the host for PDF ingestion

## Backup And Restore

Use the built-in scripts from the repo root:

```bash
pnpm backup:create -- --output-dir ./backups
pnpm backup:restore -- --backup ./backups/<timestamped-backup-dir> --database-path ./restore/storage/critjecture.sqlite --storage-root ./restore/storage
pnpm backup:verify -- --deployment-mode both
```

`pnpm backup:create` writes a timestamped backup directory containing:

- `manifest.json`
- `database.sqlite`
- `storage.tar.gz`

The database snapshot is taken with SQLite's backup API. The storage archive covers the full resolved `CRITJECTURE_STORAGE_ROOT`, including organization `company_data`, `generated_assets`, `knowledge_staging`, and `governance` directories. `/tmp/workspace` is out of backup scope.

Restore expectations:

- restore only into clean target paths
- validate the restored database against current migrations before reopening traffic
- protect backup artifacts as sensitive customer data because they can contain uploads, generated files, audit history, and governance artifacts
- for hosted cells, keep backup cadence at least every `24` hours and take an additional backup before schema or storage-layout changes

Hosted recovery objectives for the current supported envelope:

- target RPO: `24` hours
- target RTO: `2` hours
- rebuild or replace the whole hosted cell if recovery requires more than a clean app restart

## Recovery Drills

- `single_org`: run `pnpm backup:verify -- --deployment-mode single_org` after schema or storage-layout changes
- `hosted`: run `pnpm backup:verify -- --deployment-mode hosted` against the same build artifacts used for hosted deploys
- `hosted`: run `pnpm restore:drill:hosted -- --environment <label> --operator "<name>"` before first hosted cutover and at least quarterly per hosted environment

`pnpm backup:verify` proves the repo's recovery tooling still works in representative fixtures. It is not the production release record for a real `single_org` environment.

`pnpm restore:drill:hosted` is the hosted environment evidence command. It creates a real backup from the configured hosted runtime, restores into a clean temporary target, validates migrations, and emits JSON plus Markdown records.

## `hosted` Release Gate

Use the operator-side hosted release-proof flow for hosted first deployment and later production-changing upgrades.

- release proof:
  - `pnpm release:proof:hosted -- --environment <label> --operator "<name>" --checklist-kind <first_customer_deployment|routine_upgrade> --change-scope <app_only|migration|storage_layout|migration_and_storage> --restore-drill <restore-drill-json-path> ...`

Hosted release-gate rules:

- every hosted launch and production-changing hosted upgrade should retain a hosted release-proof JSON and Markdown record
- `app_only` hosted changes still require a hosted release-proof record that references the latest successful hosted restore drill for the same environment
- `migration`, `storage_layout`, and `migration_and_storage` changes require a fresh backup plus clean temporary restore verification during `pnpm release:proof:hosted`
- hosted release proof must record named ownership for app deployment, supervisor deployment, secret storage, credential rotation, backup / restore, alert delivery, incident response, and the customer administrator handoff path

## `single_org` Release Gate

Use the operator-side release-proof flow for production-changing `single_org` builds.

- restore drill:
  - `pnpm restore:drill:single-org -- --environment <label> --operator "<name>"`
- release proof:
  - `pnpm release:proof:single-org -- --environment <label> --operator "<name>" --checklist-kind <first_customer_deployment|routine_upgrade> --change-scope <app_only|migration|storage_layout|migration_and_storage> --restore-drill <restore-drill-json-path> ...`

Release-gate rules:

- `app_only` releases still require a release-proof record that references the latest successful restore drill for the same environment
- `migration`, `storage_layout`, and `migration_and_storage` releases require a fresh backup plus clean temporary restore verification during `pnpm release:proof:single-org`
- keep the generated JSON and Markdown records as operator evidence

Minimum documented operator responsibilities for `single_org`:

- secret storage owner
- secret rotation owner
- TLS termination expectation
- storage encryption expectation
- backup encryption expectation
- alert-webhook owner
- incident contact

## Observability And Incident Response

Critjecture writes structured JSON application logs to stdout/stderr and propagates `x-critjecture-request-id` on observed API responses. Operators should capture that request id together with any `sandboxRunId`, `governanceJobId`, or `knowledgeImportJobId` shown in the operations surface.

Use `CRITJECTURE_ALERT_WEBHOOK_URL` to deliver critical operational alerts outside the app UI.

Runbooks:

- `apps/web/docs/runbooks/sandbox-failures.md`
- `apps/web/docs/runbooks/storage-failures.md`
- `apps/web/docs/runbooks/migration-failures.md`
- `apps/web/docs/runbooks/backup-restore-failures.md`
- `apps/web/docs/runbooks/hosted-first-deployment.md`
- `apps/web/docs/runbooks/hosted-operations.md`
- `apps/web/docs/runbooks/railway-hosted-deployment.md`
- `apps/web/docs/runbooks/hosted-restore-drill.md`
- `apps/web/docs/runbooks/hosted-routine-upgrade.md`
- `apps/web/docs/runbooks/onprem-operations.md`
- `apps/web/docs/runbooks/single-org-restore-drill.md`
- `apps/web/docs/runbooks/single-org-first-deployment.md`
- `apps/web/docs/runbooks/single-org-routine-upgrade.md`

## Hosted-Only Future Work

These items are outside the current hosted production-ready claim rather than blockers for it:

- further hosted density or cell-sharing work beyond the current dedicated-customer-cell boundary
- public self-service onboarding or tenant self-service organization creation
- async heavy-job infrastructure beyond the current synchronous sandbox envelope

## Retention

Backup retention is operator-managed and separate from in-app retention controls.

- recommended default: `7` daily backups plus `4` weekly backups
- in-app retention settings still govern request logs, usage events, chat history, import metadata, and export artifact cleanup inside the running app
