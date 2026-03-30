# Hosted Launch Package

This document is the customer-review summary for Critjecture's hosted production package.

## Hosted Claim

`hosted` is production-ready within the documented dedicated-customer-cell envelope:

- one hosted deployment cell contains exactly one customer organization
- one writable web-app instance is supported per hosted cell
- SQLite in `WAL` mode plus one persistent storage root is required per cell
- hosted sandbox execution depends on the dedicated hosted supervisor with signed request auth
- recovery posture depends on at-least-daily backups, hosted restore-drill evidence, and hosted release-proof evidence

## Onboarding Model

Hosted onboarding remains operator-managed:

- the operator provisions the single bound organization
- the operator creates the first owner account
- first-access credentials are handed to the customer administrator out of band
- after first access, the customer administrator uses the existing admin settings surface to create or manage additional users

Current non-goals:

- public self-service signup
- tenant self-service organization creation
- shared multi-customer hosted cells

## Required Launch Evidence

Every hosted production environment should retain:

- one current hosted restore-drill record
- one hosted release-proof record for first deployment
- one hosted release-proof record for each production-changing routine upgrade
- the canonical hosted first-deployment or hosted routine-upgrade runbook used for the change

## Ownership And Escalation

Minimum named hosted responsibilities:

- app deployment owner
- hosted supervisor deployment owner
- secret storage owner
- credential rotation owner
- backup / restore owner
- alert delivery owner
- incident contact
- customer administrator contact

Escalation should document:

- who owns app/runtime issues
- who owns supervisor issues
- who owns backup and restore actions
- who communicates with the customer administrator during an incident

## Go / No-Go

Hosted launch is `no-go` when any of the following are missing or failing:

- hosted organization binding is unhealthy
- hosted supervisor auth or bound-organization health is unhealthy
- latest backup is older than `24` hours
- hosted restore-drill record is missing
- hosted release-proof record is missing
- owner login fails
- admin/member creation flow after handoff fails
- upload flow fails
- sandbox-backed request fails

## Remaining Exclusions

This hosted production claim still does not include:

- public SaaS onboarding
- shared-cell density work
- async heavy-job infrastructure beyond the current synchronous sandbox envelope
- formal attestations or certifications beyond the controls documented in this repo
