# Release Checklist

Use this checklist before promoting a new build.

## Environment

- Confirm `DATABASE_URL` points to a writable SQLite file.
- Confirm `CRITJECTURE_STORAGE_ROOT` points to persistent storage.
- Confirm `CRITJECTURE_DEPLOYMENT_MODE` is set correctly for the target environment.
- Confirm seeded owner credentials are set for `single_org` deployments.
- Confirm `OPENAI_API_KEY` is set for live chat environments.
- Confirm `bubblewrap`, `prlimit`, and `pdftotext` are installed on the host.

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

## Deployment Smoke Checks

- Boot in `single_org` mode and verify owner and intern sign-in both work.
- Boot in `hosted` mode and run `pnpm --filter web provision:hosted-org ...` against a temp SQLite file.
- Hit `/api/health` and confirm a healthy response.
- Log in as an owner and load `/admin/logs`, `/admin/operations`, and `/admin/settings`.
- Create an organization export job and confirm it appears in Governance jobs.
- Run `pnpm backup:create -- --output-dir <temp-dir>` and confirm the backup directory contains `manifest.json`, `database.sqlite`, and `storage.tar.gz`.

## Release Notes

- Confirm any new migrations are present and applied.
- Confirm customer-facing docs are updated for admin, compliance, or deployment behavior changes.
- Confirm the mocked Playwright suite is still intercepting all network-dependent browser flows.
