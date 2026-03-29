# Compliance Controls

Critjecture Step 19 adds owner-managed governance controls scoped to the active organization.

## Included Controls

- member administration for `Owner` and `Intern`
- password resets and member suspension
- configurable retention windows for request logs, usage events, alerts, chat history, and import metadata
- full-organization export bundles
- destructive purge jobs that require a completed export from the last 24 hours

## Deletion Model

- user accounts are suspended, not hard-deleted
- full organization deletion is not part of this step
- destructive jobs currently target:
  - chat history before a cutoff
  - knowledge import metadata before a cutoff
  - managed uploaded/imported files before a cutoff

## Auditability

- governance actions are stored as organization-scoped governance jobs
- automatic retention cleanup creates completed governance job records with the cutoff and counts applied
- exports include organization data, member metadata, audit records, operations data, knowledge metadata, and managed files
