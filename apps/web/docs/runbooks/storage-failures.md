# Storage Failures

## Symptoms

- `/api/health` reports storage failure
- uploads, governance exports, or generated asset downloads fail with file-system errors
- structured logs show storage-related request failures or governance export errors

## Identify The Incident

- capture the `requestId` from logs or the `x-critjecture-request-id` response header
- note the affected organization and any `governanceJobId` or `knowledgeImportJobId`
- confirm the resolved `CRITJECTURE_STORAGE_ROOT` is mounted and writable

## Immediate Actions

- stop destructive governance operations until storage health is restored
- ensure the storage path is mounted, writable, and not full
- if only one organization is affected, confirm that organization’s directory tree still exists

## Recovery

- restore the storage mount or permissions
- retry one upload or governance export to confirm recovery
- if files were lost, restore from the latest verified backup before reopening write traffic

## Escalate When

- the storage root is missing or corrupted
- multiple organization trees are unreadable
- generated assets or governance exports cannot be restored from backup
