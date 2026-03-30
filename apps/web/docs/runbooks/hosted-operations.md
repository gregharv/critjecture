# Hosted Operations

## Core Checks

- `/api/health`
- `/admin/operations`
- hosted sandbox supervisor health
- persistent SQLite storage and tenant storage mounts

## Required Incident Data

- `requestId`
- `sandboxRunId`
- `governanceJobId`
- `knowledgeImportJobId`
- affected organization slug

## First Response

- confirm whether the incident is isolated to one organization or shared across the deployment
- check webhook-delivered alerts alongside the in-app operations view
- restore supervisor or storage dependencies before restarting the app tier

## Recovery Standard

- one successful owner login
- one successful health check
- one successful sandbox-backed request
- no growing stale-run or import-stale alerts
