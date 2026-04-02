# Railway Hosted Deployment

Use this checklist when deploying Critjecture `hosted` cells to Railway.

## Important Model Constraint

`hosted` supports exactly one organization per deployment cell.

For Railway, that means:

- one Railway project or equivalent isolated service set per organization
- one persistent SQLite volume per organization
- one `CRITJECTURE_HOSTED_ORGANIZATION_SLUG` per organization
- one first owner account per organization

Do not try to place multiple organizations into one hosted Railway database or one hosted Railway web service.

## Recommended Per-Org Layout

For each organization, provision:

- one Railway web service for `apps/web`
- one persistent volume mounted for SQLite and storage
- one dedicated hosted supervisor endpoint bound to the same organization slug
- one owner credential handoff for that organization

Suggested naming pattern:

- Railway project: `critjecture-<org-slug>`
- web service: `critjecture-web`
- volume mount path: `/data`

Build note:

- deploy from the repository root, not `apps/web`
- new Railway services should use the repo-root `railpack.json` so Railpack builds the Node workspace instead of auto-detecting Python from `packages/python-sandbox/pyproject.toml`

## Per-Org Environment

Set these on the Railway web service for each organization:

- `AUTH_SECRET`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `DATABASE_URL=/data/critjecture.sqlite`
- `CRITJECTURE_STORAGE_ROOT=/data`
- `CRITJECTURE_DEPLOYMENT_MODE=hosted`
- `CRITJECTURE_HOSTED_ORGANIZATION_SLUG=<org-slug>`
- `CRITJECTURE_SANDBOX_SUPERVISOR_URL=<supervisor-url>`
- `CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID=<key-id>`
- `CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET=<shared-secret>`
- `CRITJECTURE_ALERT_WEBHOOK_URL=<webhook>`

## Per-Org Deployment Checklist

1. Create the Railway project and attach a persistent volume.
2. Deploy the web app service from the repo root and set the hosted env vars for that one organization.
3. Deploy the hosted sandbox supervisor on a Docker-capable host and bind it to the same organization slug.
4. Run database migrations for the web app.
5. Provision the organization and first owner:

```bash
pnpm --filter web provision:hosted-org -- \
  --organization-name "<Organization Name>" \
  --organization-slug "<org-slug>" \
  --owner-email "<owner-email>" \
  --owner-password "<temporary-password>" \
  --owner-name "<owner-name>"
```

6. Run hosted launch evidence:
   - `pnpm restore:drill:hosted -- --environment <railway-env-label> --operator "<name>"`
   - `pnpm release:proof:hosted -- --environment <railway-env-label> --operator "<name>" --checklist-kind first_customer_deployment --change-scope migration_and_storage --restore-drill <path> ...`
7. Verify `/api/health`, `/admin/operations`, owner login, one upload, and one sandbox-backed request.
8. Hand the first owner credentials to that organization's administrator.
9. After first access, that owner can create additional admins or members for their own organization through `/admin/settings`.

## Multiple Organizations

To add another organization, repeat the full flow above in a new hosted cell:

- new Railway project or isolated deployment cell
- new persistent volume
- new hosted organization slug
- new first owner account
- new hosted restore-drill and release-proof records

This is the supported way to run multiple organizations on Railway today.
