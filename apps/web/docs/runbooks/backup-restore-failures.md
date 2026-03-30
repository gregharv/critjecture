# Backup And Restore Failures

## Symptoms

- `pnpm backup:create`, `pnpm backup:restore`, or `pnpm backup:verify` fails
- `pnpm restore:drill:single-org` or `pnpm release:proof:single-org` fails during backup verification
- checksum validation fails during restore
- restored environments fail migration validation or health checks

## Identify The Incident

- capture the command, failing backup path, and exact error text
- record whether the issue is in `single_org`, `hosted`, or both
- note whether the failure is backup creation, restore validation, or post-restore health
- note whether the failure blocked a `single_org` release-proof record

## Immediate Actions

- preserve the failing backup artifact for inspection
- stop any purge or deletion workflow that depends on a recent successful export or backup
- switch to the latest known-good verified backup if recovery is in progress

## Recovery

- rerun `pnpm backup:verify -- --deployment-mode <mode>` against the current build
- if creation failed, verify both SQLite and storage-root readability and free space
- if restore failed, restore into a fresh clean target path and confirm the database file is not pre-existing
- rerun the blocked `single_org` restore drill or release proof only after the backup failure is understood

## Escalate When

- no recent backup verifies successfully
- restore succeeds but migrations or health checks still fail
- backup artifacts are missing expected files or checksums
