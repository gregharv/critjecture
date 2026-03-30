# On-Prem Operations

## Core Checks

- local `bubblewrap` and `prlimit` availability
- writable `CRITJECTURE_STORAGE_ROOT`
- `/api/health`
- recent verified backup artifacts

## Required Incident Data

- `requestId`
- `sandboxRunId`
- failing host path or process dependency
- current backup location and timestamp

## First Response

- keep the system in single-user or maintenance mode if storage or migrations are failing
- fix host dependency issues before retrying sandbox work
- do not delete tenant files to free space until a recent verified backup exists

## Recovery Standard

- owner can load `/admin/operations`
- `/api/health` is healthy or degraded without storage/sandbox failure
- one upload or sandbox task succeeds after recovery
