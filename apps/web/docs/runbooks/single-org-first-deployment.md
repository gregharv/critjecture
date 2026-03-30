# Single-Org First Deployment

Use this checklist before the first customer-facing `single_org` cutover.

## Pre-Flight

- run repo verification:

```bash
pnpm lint
pnpm test
pnpm build
pnpm backup:verify -- --deployment-mode single_org
```

- confirm `CRITJECTURE_DEPLOYMENT_MODE=single_org`
- confirm `DATABASE_URL` and `CRITJECTURE_STORAGE_ROOT` point to persistent customer-managed storage
- confirm `CRITJECTURE_ALERT_WEBHOOK_URL` is configured for the target environment
- confirm `CRITJECTURE_SANDBOX_EXECUTION_BACKEND=container_supervisor`
- confirm `CRITJECTURE_SANDBOX_SUPERVISOR_URL`, `CRITJECTURE_SANDBOX_SUPERVISOR_TOKEN`, and `CRITJECTURE_SANDBOX_CONTAINER_IMAGE`
- confirm the sandbox supervisor service is running and Docker can start the configured image
- confirm `pdftotext` is installed on the web-app host
- confirm the bootstrap owner/member credentials are set only for first access and are stored outside source control

## Required Operator Responsibilities

- secret storage owner documented
- secret rotation owner documented
- TLS termination expectation documented
- storage encryption expectation documented
- backup encryption expectation documented
- alert-webhook owner documented
- incident contact documented

## Required Proof

1. Run a restore drill:

```bash
pnpm restore:drill:single-org -- \
  --environment customer-prod \
  --operator "Pat Operator" \
  --backup-output-dir ./backups \
  --output-dir ./release-records
```

2. Use the generated restore-drill JSON path to create the first-deployment release proof:

```bash
pnpm release:proof:single-org -- \
  --environment customer-prod \
  --operator "Pat Operator" \
  --checklist-kind first_customer_deployment \
  --change-scope migration_and_storage \
  --restore-drill ./release-records/<restore-drill-record>.json \
  --secret-storage-owner "Platform Ops" \
  --secret-rotation-owner "Security Team" \
  --tls-termination "Customer-managed reverse proxy terminates TLS before the app" \
  --storage-encryption "Persistent storage uses operator-managed disk encryption" \
  --backup-encryption "Backups are stored in encrypted operator-controlled storage" \
  --alert-webhook-owner "Platform Ops" \
  --incident-contact "oncall@example.com" \
  --build-ref "customer-prod-initial" \
  --output-dir ./release-records \
  --backup-output-dir ./backups
```

## Cutover Smoke Checks

- `/api/health` returns healthy or an understood degraded state
- owner can sign in and load `/admin/logs`, `/admin/operations`, and `/admin/settings`
- bootstrap owner/member credentials are rotated through `/admin/settings` before customer handoff
- an app restart does not revert the rotated credentials
- one upload succeeds
- one sandbox task succeeds
- the release-proof JSON and Markdown records are stored with the deployment evidence
