# Migration Failures

## Symptoms

- startup fails during migration
- `pnpm --filter web db:migrate` exits non-zero
- application routes fail before the app reaches healthy state

## Identify The Incident

- capture the exact migration filename and error output
- record the deployment mode and database path
- confirm whether the failure happened on first boot, upgrade, or restore validation

## Immediate Actions

- stop the rollout for that environment
- do not hand-edit the live SQLite database unless you are performing an approved recovery action
- preserve the failing database file before retrying

## Recovery

- restore the latest verified backup into a clean path if the database is no longer trustworthy
- rerun `pnpm --filter web db:migrate` against the recovered database
- only resume traffic after `/api/health` passes and basic admin pages load

## Escalate When

- the migration fails on a clean restore
- a migration partially applies and leaves the database unusable
- production and backup databases both fail on the same migration
