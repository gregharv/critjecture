# Deployment Modes

Critjecture's current supported deployment envelope is SQLite-first in both `single_org` and `hosted` modes. The intended first production path is a controlled `single_org` pilot or customer-managed on-prem deployment. `hosted` is supported for Railway-style operation, but it has a higher review and operational bar because it depends on shared operator-managed infrastructure and a dedicated sandbox supervisor service.

For a concise review summary of deployment and security boundaries, start with `security_review.md`.

## `single_org`

Use `single_org` for:

- local development
- customer-managed hardware
- tightly controlled on-prem or single-customer pilot environments

Current characteristics:

- seeds the default organization and pilot `Owner` / `Member` users from environment variables
- keeps storage, logs, and operations under one customer-managed deployment footprint
- runs sandbox jobs through the in-app local supervisor using host `bubblewrap` + `prlimit`

## `hosted`

Use `hosted` for centrally operated multi-organization deployments.

Current characteristics:

- one deployment can contain multiple organizations
- tenant creation is operator-managed through the provisioning script, not tenant self-service
- the web app must be configured with `CRITJECTURE_SANDBOX_SUPERVISOR_URL`
- the sandbox path depends on a dedicated remote supervisor service and should be treated as a required production dependency

Hosted-mode review note:

- tenant separation is enforced by authenticated organization scoping and storage-path boundaries inside shared operator-managed infrastructure

## Shared Runtime Requirements

- persistent SQLite storage
- persistent organization storage roots
- `pdftotext` on the host for PDF ingestion
- explicit backups for both the database and tenant storage
- operator-managed secrets for auth, model access, and hosted sandbox connectivity

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

## Recovery Drills

- `single_org`: run `pnpm backup:verify -- --deployment-mode single_org` after schema or storage-layout changes
- `hosted`: run `pnpm backup:verify -- --deployment-mode hosted` against the same build artifacts used for Railway-style deploys
- release gating: run `pnpm backup:verify` before promoting a build that changes migrations or persistent storage layout

## Observability And Incident Response

Critjecture writes structured JSON application logs to stdout/stderr and propagates `x-critjecture-request-id` on observed API responses. Operators should capture that request id together with any `sandboxRunId`, `governanceJobId`, or `knowledgeImportJobId` shown in the operations surface.

Use `CRITJECTURE_ALERT_WEBHOOK_URL` to deliver critical operational alerts outside the app UI.

Runbooks:

- `apps/web/docs/runbooks/sandbox-failures.md`
- `apps/web/docs/runbooks/storage-failures.md`
- `apps/web/docs/runbooks/migration-failures.md`
- `apps/web/docs/runbooks/backup-restore-failures.md`
- `apps/web/docs/runbooks/hosted-operations.md`
- `apps/web/docs/runbooks/onprem-operations.md`

## Retention

Backup retention is operator-managed and separate from in-app retention controls.

- recommended default: `7` daily backups plus `4` weekly backups
- in-app retention settings still govern request logs, usage events, chat history, import metadata, and export artifact cleanup inside the running app
