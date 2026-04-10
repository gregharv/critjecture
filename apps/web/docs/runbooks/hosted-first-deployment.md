# Hosted First Deployment

Use this checklist before the first customer-facing `hosted` cutover for an environment.

## Pre-Flight

- run repo verification:

```bash
pnpm lint
pnpm test
pnpm build
pnpm backup:verify -- --deployment-mode hosted
```

- confirm `CRITJECTURE_DEPLOYMENT_MODE=hosted`
- confirm `CRITJECTURE_HOSTED_ORGANIZATION_SLUG` matches the one organization provisioned into the hosted cell
- confirm `DATABASE_URL` and `CRITJECTURE_STORAGE_ROOT` point to persistent cell-local storage
- confirm `CRITJECTURE_ALERT_WEBHOOK_URL` is configured for the hosted environment
- confirm `CRITJECTURE_SANDBOX_SUPERVISOR_URL`, `CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID`, and `CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET`
- confirm the hosted supervisor reports the same bound organization slug as the web app
- if scheduled workflows are enabled, confirm `CRITJECTURE_ENABLE_WORKFLOW_SCHEDULER=true`, `CRITJECTURE_ENABLE_HOSTED_SCHEDULED_WORKFLOWS=true`, and `CRITJECTURE_WORKFLOW_TICK_SECRET` are set
- if scheduled workflows are enabled, confirm platform cron calls `POST /api/internal/workflows/tick` every minute with the internal token
- confirm the latest backup is less than `24` hours old
- confirm `pdftotext` is installed on the web-app host

## Required Ownership

- hosted app deployment owner documented
- hosted supervisor deployment owner documented
- secret storage owner documented
- credential rotation owner documented
- backup / restore owner documented
- alert-webhook owner documented
- incident contact documented
- customer administrator contact documented
- escalation path documented

## Required Proof

1. Run a hosted restore drill:

```bash
pnpm restore:drill:hosted -- \
  --environment hosted-prod \
  --operator "Pat Operator" \
  --backup-output-dir ./backups \
  --output-dir ./release-records
```

2. Use the generated restore-drill JSON path to create the hosted first-deployment release proof:

```bash
pnpm release:proof:hosted -- \
  --environment hosted-prod \
  --operator "Pat Operator" \
  --checklist-kind first_customer_deployment \
  --change-scope migration_and_storage \
  --restore-drill ./release-records/<hosted-restore-drill>.json \
  --app-deployment-owner "Hosted Platform" \
  --supervisor-deployment-owner "Sandbox Ops" \
  --secret-storage-owner "Platform Security" \
  --credential-rotation-owner "Platform Security" \
  --backup-restore-owner "Recovery Team" \
  --alert-webhook-owner "Platform Ops" \
  --incident-contact "oncall@example.com" \
  --customer-admin-contact "customer-admin@example.com" \
  --escalation-path "Platform Ops -> Recovery Team -> customer administrator" \
  --tls-termination "Managed reverse proxy terminates TLS before the app" \
  --storage-encryption "Persistent hosted storage uses operator-managed disk encryption" \
  --backup-encryption "Hosted backups are stored in encrypted operator-controlled storage" \
  --build-ref "hosted-prod-initial" \
  --output-dir ./release-records \
  --backup-output-dir ./backups
```

## Go / No-Go

- `/api/health` returns healthy or an understood degraded state
- `/admin/operations` shows matching hosted organization binding and supervisor binding
- latest backup is less than `24` hours old
- hosted restore-drill JSON and Markdown records are stored with deployment evidence
- hosted release-proof JSON and Markdown records are stored with deployment evidence
- the first customer owner can sign in successfully
- after handoff, that owner can create at least one additional admin or member through `/admin/settings`
- one upload succeeds
- one sandbox-backed request succeeds
- alert delivery is confirmed for the target environment
- if scheduler is enabled, one authenticated `POST /api/internal/workflows/tick` call succeeds with `202` and expected summary payload
