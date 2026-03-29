# Deployment Modes

Critjecture supports a SQLite-first runtime in both `single_org` and `hosted` deployment modes.

## `single_org`

- intended for local development and on-prem/customer-managed hardware
- keeps the env-seeded default organization flow
- seeds pilot owner/intern users from environment variables
- runs sandbox jobs through the in-app local supervisor using host `bubblewrap` + `prlimit`

## `hosted`

- intended for centrally operated Railway-style deployments
- allows multiple organizations in one deployment
- keeps tenant UX scoped to one primary organization membership
- organization creation is handled by the provisioning script, not tenant self-service
- must point the web app at a dedicated sandbox supervisor service via `CRITJECTURE_SANDBOX_SUPERVISOR_URL`

## Shared Requirements

- persistent SQLite storage
- persistent organization storage roots
- `pdftotext` on the host for PDF ingestion
- explicit backups for both the database and tenant storage
