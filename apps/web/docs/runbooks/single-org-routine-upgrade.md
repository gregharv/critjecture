# Single-Org Routine Upgrade

Use this checklist for every production-changing `single_org` upgrade after initial deployment.

## Choose The Change Scope

- `app_only`
  - no migration and no persistent storage-layout change
  - still requires a release-proof record
- `migration`
  - database schema or migration-set change
- `storage_layout`
  - persistent storage-path, archive, or backup-layout change
- `migration_and_storage`
  - both kinds of persistent change

## Required Inputs

- the environment label
- the operator approving the release
- the most recent successful restore-drill JSON for the same environment
- documented secret, TLS, encryption, alerting, and incident ownership

## Upgrade Gate

- `app_only` releases:

```bash
pnpm release:proof:single-org -- \
  --environment customer-prod \
  --operator "Pat Operator" \
  --checklist-kind routine_upgrade \
  --change-scope app_only \
  --restore-drill ./release-records/<restore-drill-record>.json \
  --secret-storage-owner "Platform Ops" \
  --secret-rotation-owner "Security Team" \
  --tls-termination "Customer-managed reverse proxy terminates TLS before the app" \
  --storage-encryption "Persistent storage uses operator-managed disk encryption" \
  --backup-encryption "Backups are stored in encrypted operator-controlled storage" \
  --alert-webhook-owner "Platform Ops" \
  --incident-contact "oncall@example.com" \
  --build-ref "customer-prod-2026-03-30" \
  --output-dir ./release-records
```

- `migration`, `storage_layout`, or `migration_and_storage` releases:
  - run the same command with the matching `--change-scope`
  - the command will create a fresh backup and clean temporary restore automatically
  - keep the resulting proof record with the release evidence

## Post-Upgrade Checks

- `/api/health` is healthy or understood
- owner can load `/admin/operations`
- one upload or sandbox task succeeds
- the generated release-proof records are retained with the environment history
