# Hosted Operations

## Core Checks

- `/api/health`
- `/admin/operations`
- hosted sandbox supervisor health
- hosted deployment binding for `CRITJECTURE_HOSTED_ORGANIZATION_SLUG`
- hosted persistence metadata shows `sqlite`, `WAL`, and `single_writer_dedicated_hosted_cell`
- persistent SQLite storage and tenant storage mounts
- latest backup is less than `24` hours old

## Required Incident Data

- `requestId`
- `sandboxRunId`
- `governanceJobId`
- `knowledgeImportJobId`
- affected organization slug

## First Response

- confirm the incident is inside the one customer organization bound to this hosted cell
- check webhook-delivered alerts alongside the in-app operations view
- confirm the database path and storage root shown in operations match the expected hosted cell mounts
- restore supervisor or storage dependencies before restarting the app tier
- verify supervisor auth mode, key id, and bound organization slug before rotating app instances
- if storage or SQLite integrity is in doubt, restore or replace the whole hosted cell rather than improvising in place

## Ownership Minimums

- name one owner for the hosted app deployment
- name one owner for the hosted sandbox supervisor deployment
- name one owner for supervisor credential rotation
- name one owner for alert delivery and incident paging

## Recovery Standard

- one successful owner login
- one successful health check
- one successful sandbox-backed request
- no growing stale-run or import-stale alerts
- hosted deployment and sandbox supervisor both report the same bound organization slug
- latest hosted restore drill record is present for the environment and not older than one quarter
