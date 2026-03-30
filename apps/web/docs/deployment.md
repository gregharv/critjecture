# Deployment Modes

Critjecture supports a SQLite-first runtime in both `single_org` and `hosted` deployment modes.

## `single_org`

- intended for local development and on-prem/customer-managed hardware
- keeps the env-seeded default organization flow
- seeds pilot owner/intern users from environment variables
- runs sandbox jobs through the in-app local supervisor using host `bubblewrap` + `prlimit`

## `hosted`

- intended for centrally operated Railway-style deployments
- allows multiple organizations in one deployment
- keeps tenant UX scoped to one primary organization membership
- organization creation is handled by the provisioning script, not tenant self-service
- must point the web app at a dedicated sandbox supervisor service via `CRITJECTURE_SANDBOX_SUPERVISOR_URL`

## Shared Requirements

- persistent SQLite storage
- persistent organization storage roots
- `pdftotext` on the host for PDF ingestion
- explicit backups for both the database and tenant storage

## Backup Artifacts

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

The database snapshot is taken with SQLite's backup API. The storage archive covers the full resolved `CRITJECTURE_STORAGE_ROOT`, including organization `company_data`, `generated_assets`, `knowledge_staging`, and `governance` directories. `/tmp/workspace` is not part of backup scope.

## Restore Guidance

- Restore only into clean target paths. The restore script rejects non-empty storage roots and existing database files.
- After restore, Critjecture validates the restored database against current migrations before reporting success.
- For default layouts where the live database sits under `CRITJECTURE_STORAGE_ROOT`, the storage archive excludes that live database file because it is already captured as `database.sqlite`.

## Recovery Drills

- `single_org`: run `pnpm backup:verify -- --deployment-mode single_org` after schema or storage-layout changes.
- `hosted`: run `pnpm backup:verify -- --deployment-mode hosted` against the same build artifacts used for Railway-style deploys.
- release gating: run `pnpm backup:verify` before promoting a build that changes migrations or persistent storage layout.

## Observability And Incident Response

Critjecture writes structured JSON application logs to stdout/stderr and propagates `x-critjecture-request-id` on observed API responses. Hosted and on-prem operators should capture that request id together with any `sandboxRunId`, `governanceJobId`, or `knowledgeImportJobId` shown in the operations surface.

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
