# Compliance Controls

This document summarizes the customer-visible governance and retention controls currently shipped in Critjecture. It is not a blanket compliance certification. For the broader deployment, privacy, and security posture, pair this document with `security_review.md` and `deployment.md`.

## Current Governance Controls

- member administration for fixed `owner`, `admin`, and `member` roles
- membership states for `active`, `restricted`, and `suspended`
- password resets and member suspension/reactivation
- configurable retention windows for request logs, usage events, alerts, chat history, and import metadata
- full-organization export bundles
- destructive purge jobs that require a completed export from the last 24 hours

These controls are organization-scoped and available through the privileged settings surface.

## Retention And Deletion Model

Current deletion behavior:

- user accounts are suspended rather than hard-deleted
- full organization deletion is not part of the current product surface
- destructive jobs currently target:
  - chat history before a cutoff
  - knowledge import metadata before a cutoff
  - managed uploaded/imported files before a cutoff

Retention controls change what the running app keeps over time, but they do not replace operator-managed backup retention and secure artifact handling.

## Export And Auditability

- governance actions are stored as organization-scoped governance jobs
- automatic retention cleanup produces completed governance job records with the cutoff and counts applied
- exports include organization data, member metadata, audit records, operations data, knowledge metadata, and managed files
- privileged audit logs capture assistant responses, tool calls, parameters, accessed files, summaries, and errors for chat turns in the same organization

## Practical Boundary

These controls support customer review and operational governance for the current MVP, but they do not constitute:

- legal-hold workflows
- automated data classification or DLP
- customer-managed encryption keys
- formal attestations beyond what operators and deployment controls can support
