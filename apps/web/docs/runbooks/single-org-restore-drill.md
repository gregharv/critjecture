# Single-Org Restore Drill

Use this runbook to prove that a real `single_org` environment can be backed up and restored without improvisation.

## When To Run It

- before the first customer deployment
- after a major environment move or storage-path change
- after any incident that changes the supported recovery posture

## Inputs

- production-like `single_org` environment with `DATABASE_URL` and `CRITJECTURE_STORAGE_ROOT` pointed at the real runtime
- `CRITJECTURE_DEPLOYMENT_MODE=single_org`
- an operator name for sign-off
- a secure location for:
  - backup artifacts
  - release-record JSON and Markdown files

## Command

Run from the repo root:

```bash
pnpm restore:drill:single-org -- \
  --environment customer-prod \
  --operator "Pat Operator" \
  --backup-output-dir ./backups \
  --output-dir ./release-records \
  --notes "Quarterly restore drill before rollout." \
  --follow-up-items "Store record in ops vault|Review backup retention timestamp"
```

## Required Sign-Off

- confirm the environment label matches the deployment being validated
- confirm the operator name is the person approving the drill
- record any follow-up work needed before release
- keep the generated `.json` and `.md` records with normal operator evidence

## Success Standard

- the command creates a real backup from the configured runtime
- the backup restores into a clean temporary target
- checksum validation passes
- migration validation passes on the restored SQLite file
- the generated record is retained with the release evidence for that environment
