# Deployment

Critjecture now supports one SQLite-first deployment model across local development, customer-managed hardware, and Railway.

## Primary Deployment Path

- database: SQLite
- persistent storage root: `CRITJECTURE_STORAGE_ROOT`
- database file: `DATABASE_URL` or the default `<CRITJECTURE_STORAGE_ROOT>/critjecture.sqlite`
- tenant company data: `<CRITJECTURE_STORAGE_ROOT>/organizations/<organization-slug>/company_data`

The repo-root `sample_company_data/` directory is bundled sample data. On first boot, Critjecture copies that sample data into the active organization's storage directory if that organization does not already have company data.

## Local Development

Example env:

```bash
DATABASE_URL=./storage/critjecture.sqlite
CRITJECTURE_STORAGE_ROOT=./storage
CRITJECTURE_ORGANIZATION_NAME=Critjecture Demo
CRITJECTURE_ORGANIZATION_SLUG=critjecture-demo
```

Recommended flow:

```bash
pnpm install
uv sync --project packages/python-sandbox
cp apps/web/.env.local.example apps/web/.env.local
pnpm db:migrate
pnpm dev
```

## Customer-Managed Hardware / On-Prem

- Mount or provision a persistent directory for `CRITJECTURE_STORAGE_ROOT`.
- Point `DATABASE_URL` at a SQLite file inside that persistent directory.
- Install `bubblewrap` and ensure `prlimit` is available on the Linux host.
- Run `pnpm db:migrate` before starting the service for upgrades.
- Back up both the SQLite database file and the storage root content.

## Railway

SQLite on Railway is supported when a persistent volume is attached.

- Mount a Railway volume to a stable path such as `/data`.
- Set `CRITJECTURE_STORAGE_ROOT=/data/critjecture`.
- Set `DATABASE_URL=/data/critjecture/critjecture.sqlite`.
- Ensure the runtime image includes `bubblewrap` and `prlimit`.
- Run `pnpm db:migrate` before the service starts on first deploys and upgrades.

Railway volumes support backups and restores for their stored content, including SQLite files. See Railway's official volume backup docs before relying on this operationally.

## Backup Scope

Back up:

- the SQLite database file
- the persistent storage root, especially `organizations/<organization-slug>/company_data`

Do not treat as durable:

- `/tmp/workspace/*` sandbox workspaces
- expired generated sandbox outputs after their TTL has elapsed

Short-lived generated sandbox outputs are now copied into tenant storage under `generated_assets/` and are intended to remain available only for the configured TTL window.

## Restore Expectations

To restore Critjecture:

1. restore the SQLite database file
2. restore the persistent storage root
3. run `pnpm db:migrate`
4. start the app and verify login, chat search, audit logs, and generated-file access

## Future Scale-Up Path

Step 10 keeps higher-level persistence code organized so a Postgres backend can be added later for larger hosted or higher-concurrency deployments, but Postgres is not required for the supported deployment path today.
