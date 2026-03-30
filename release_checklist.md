# Release Checklist

Use this checklist before promoting a new build. This is the repo-level verification checklist, not the canonical `single_org` production cutover runbook.

## Environment

- Confirm `DATABASE_URL` points to a writable SQLite file.
- Confirm `CRITJECTURE_STORAGE_ROOT` points to persistent storage.
- Confirm `CRITJECTURE_DEPLOYMENT_MODE` is set correctly for the target environment.
- Confirm `OPENAI_API_KEY` is set for live chat environments.
- Confirm `pdftotext` is installed on the host when PDF ingestion is enabled.
- If using `local_supervisor` for dev/test, confirm `bubblewrap` and `prlimit` are installed on the host.
- If using `container_supervisor` or `hosted_supervisor`, confirm the supervisor URL/token configuration is present.

## Automated Verification

Run these from the repo root:

```bash
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
pnpm db:migrate
pnpm backup:verify
```

`pnpm backup:verify` is the repo regression check for recovery tooling. It does not replace the production release-proof flow for a real `single_org` environment.

## Deployment Smoke Checks

- Boot in `single_org` mode and verify bootstrap owner and member sign-in both work.
- Boot in `hosted` mode and run `pnpm --filter web provision:hosted-org ...` against a temp SQLite file.
- Hit `/api/health` and confirm a healthy response.
- Log in as an owner and load `/admin/logs`, `/admin/operations`, and `/admin/settings`.
- Create an organization export job and confirm it appears in Governance jobs.
- Run `pnpm backup:create -- --output-dir <temp-dir>` and confirm the backup directory contains `manifest.json`, `database.sqlite`, and `storage.tar.gz`.

## `single_org` Production Cutover

For a real `single_org` deployment, use these docs as the operator source of truth:

- `apps/web/docs/runbooks/single-org-first-deployment.md`
- `apps/web/docs/runbooks/single-org-restore-drill.md`
- `apps/web/docs/runbooks/single-org-routine-upgrade.md`

Production-changing `single_org` releases should retain:

- one restore-drill JSON and Markdown record for the environment
- one release-proof JSON and Markdown record per first deployment or routine upgrade

## Release Notes

- Confirm any new migrations are present and applied.
- Confirm customer-facing docs are updated for admin, compliance, deployment, or cutover behavior changes.
- Confirm the mocked Playwright suite is still intercepting all network-dependent browser flows.
- Confirm the correct `single_org` release-proof command was run when the target build changes migrations or persistent storage layout.
