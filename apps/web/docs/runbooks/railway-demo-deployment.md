# Railway Demo Deployment

Use this runbook to create a stable demo environment for Critjecture on Railway.

## Purpose

This runbook is for one hosted demo cell serving one fake organization.

- use one hosted cell for one demo org
- keep the environment stable so you can reuse it across demos
- keep the `owner` account for the operator only
- create additional accounts for viewers instead of sharing the owner login

Important hosted constraint:

- `hosted` supports exactly one organization per deployment cell
- if you need a second demo org, create a second hosted Railway cell

## Supported Demo Topology

Use this deployment shape:

- one Railway project for the demo org
- one Railway web service for `apps/web`
- one persistent volume mounted at `/data`
- one external hosted sandbox supervisor endpoint on a Docker-capable host
- one hosted organization slug bound on both the web app and the supervisor
- fake business data only

Suggested demo values:

- Railway project: `critjecture-demo`
- Railway web service: `critjecture-web`
- hosted organization slug: `demo-org`
- volume mount path: `/data`
- environment label for proof records: `railway-demo`

Build note:

- deploy from the repository root, not `apps/web`
- new Railway services should use the repo-root `railpack.json` so Railpack builds the Node workspace instead of auto-detecting Python from `packages/python-sandbox/pyproject.toml`

## Railway Web Service Environment

Set these on the Railway web service:

- `AUTH_SECRET`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `DATABASE_URL=/data/critjecture.sqlite`
- `CRITJECTURE_STORAGE_ROOT=/data`
- `CRITJECTURE_DEPLOYMENT_MODE=hosted`
- `CRITJECTURE_HOSTED_ORGANIZATION_SLUG=demo-org`
- `CRITJECTURE_SANDBOX_SUPERVISOR_URL=<supervisor-url>`
- `CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID=<key-id>`
- `CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET=<shared-secret>`
- `CRITJECTURE_ALERT_WEBHOOK_URL=<webhook>`

Note: company knowledge search falls back to a built-in Node scanner if `rg` is not installed, so a custom Railway image is no longer required for search-only demos. PDF uploads still need `pdftotext` if you plan to show PDF ingestion.

## Hosted Supervisor Environment

Set these on the hosted sandbox supervisor:

- `PORT=4100`
- `CRITJECTURE_HOSTED_ORGANIZATION_SLUG=demo-org`
- `CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID=<same-key-id>`
- `CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET=<same-shared-secret>`
- `CRITJECTURE_SANDBOX_CONTAINER_IMAGE=<runner-image>`
- `CRITJECTURE_SANDBOX_DOCKER_BIN=docker`
- `CRITJECTURE_SANDBOX_WORKSPACE_ROOT=<workspace-root>`

The supervisor must be bound to the same organization slug as the Railway web service.

## Deployment Steps

1. Create the Railway project and attach a persistent volume mounted at `/data`.
2. Deploy the web app service from the repo root and set the hosted Railway env vars above.
3. Deploy the hosted sandbox supervisor on a Docker-capable host and bind it to `demo-org`.
4. Run database migrations for the web app.
5. Provision the demo organization and first owner:

```bash
pnpm --filter web provision:hosted-org -- \
  --organization-name "Critjecture Demo" \
  --organization-slug demo-org \
  --owner-email "<owner-email>" \
  --owner-password "<temporary-password>" \
  --owner-name "<operator-name>"
```

6. Run a hosted restore drill:

```bash
pnpm restore:drill:hosted -- \
  --environment railway-demo \
  --operator "<operator-name>" \
  --backup-output-dir ./backups \
  --output-dir ./release-records
```

7. Run the hosted first-deployment release proof using the generated restore-drill record:

```bash
pnpm release:proof:hosted -- \
  --environment railway-demo \
  --operator "<operator-name>" \
  --checklist-kind first_customer_deployment \
  --change-scope migration_and_storage \
  --restore-drill ./release-records/<hosted-restore-drill>.json \
  --app-deployment-owner "Hosted Platform" \
  --supervisor-deployment-owner "Sandbox Ops" \
  --secret-storage-owner "Platform Security" \
  --credential-rotation-owner "Platform Security" \
  --backup-restore-owner "Recovery Team" \
  --alert-webhook-owner "Platform Ops" \
  --incident-contact "oncall@example.com" \
  --customer-admin-contact "<customer-admin-email>" \
  --escalation-path "Platform Ops -> Recovery Team -> customer administrator" \
  --tls-termination "Managed reverse proxy terminates TLS before the app" \
  --storage-encryption "Persistent hosted storage uses operator-managed disk encryption" \
  --backup-encryption "Hosted backups are stored in encrypted operator-controlled storage" \
  --build-ref "railway-demo-initial" \
  --output-dir ./release-records \
  --backup-output-dir ./backups
```

8. Verify:
   - `/api/health`
   - `/admin/operations`
   - owner login
   - one upload
   - one sandbox-backed request
9. Create reviewer accounts and hand off only the intended credentials.

## Demo Account Model

Use these accounts:

- one `owner` account for the operator only
- one or more `admin` accounts for technical evaluators
- one or more `member` accounts for general product viewers

Guidance:

- create one account per reviewer when possible
- do not share the owner account broadly
- use temporary passwords and rotate them after the demo window

## Demo Data Preparation

Use fake but plausible business data:

- one sales CSV
- one contractor ledger CSV
- one operations notes `.txt` or `.md` file
- a few public documents
- a few admin-only documents
- at least one PDF for ingestion demo

Do not use real customer data.

## Demo Flow

For general viewers:

- give `member` credentials
- show chat, search, file visibility, and a normal sandbox-backed answer

For technical reviewers:

- give `admin` credentials
- let them inspect knowledge, logs, operations, and settings

For guided sessions:

- keep the `owner` account for yourself
- use it to show governance, exports, retention, and user management

## Multi-Org Demos

If you need another demo organization:

- create a new Railway project or equivalent isolated hosted cell
- create a new persistent volume
- choose a new hosted organization slug
- provision a new first owner
- create a new hosted restore-drill record
- create a new hosted release-proof record

Do not place multiple organizations into one hosted Railway web service or one hosted Railway database.

## Post-Demo Cleanup

- rotate all temporary demo passwords
- suspend reviewer accounts you no longer need
- keep the demo org for repeat demos only if you intend to maintain it
- if you need a separate audience or storyline, clone the pattern into a new hosted cell instead of reusing the same org carelessly
