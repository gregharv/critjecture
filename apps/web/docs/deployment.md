# Deployment Modes

Critjecture supports a SQLite-first runtime in both `single_org` and `hosted` deployment modes.

## `single_org`

- intended for local development and on-prem/customer-managed hardware
- keeps the env-seeded default organization flow
- seeds pilot owner/intern users from environment variables

## `hosted`

- intended for centrally operated Railway-style deployments
- allows multiple organizations in one deployment
- keeps tenant UX scoped to one primary organization membership
- organization creation is handled by the provisioning script, not tenant self-service

## Shared Requirements

- persistent SQLite storage
- persistent organization storage roots
- Linux host with `bubblewrap`, `prlimit`, and `pdftotext`
- explicit backups for both the database and tenant storage
