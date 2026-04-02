# Railway Org Rollout Checklist (Phase 1 -> Phase 2)

Use this checklist for each hosted organization rollout.

## Scope

- one Railway project/service per org
- one persistent Railway volume mounted at `/data`
- one hosted organization slug per cell
- Phase 1 temporary local sandbox (`bubblewrap`) in same service
- later migration to Phase 2 external Docker supervisor

---

## A) Pre-Flight (Per Org)

- [ ] Create a dedicated Railway project for this org.
- [ ] Attach and mount persistent volume at `/data`.
- [ ] Confirm deployment uses the repo root with `railpack.json`.
- [ ] Confirm one target `CRITJECTURE_HOSTED_ORGANIZATION_SLUG` for this org.
- [ ] Confirm this org is not sharing a hosted cell with another org.

Build note:

- New Railway services in this repo should use Railpack from the repo root.
- `railpack.json` forces the Node workspace build and avoids incorrect Python autodetection from `packages/python-sandbox/pyproject.toml`.

---

## B) Phase 1 Env Vars (Railway Service)

Set:

- [ ] `AUTH_SECRET`
- [ ] `OPENAI_API_KEY`
- [ ] `OPENAI_MODEL=gpt-5.4-mini`
- [ ] `DATABASE_URL=/data/critjecture.sqlite`
- [ ] `CRITJECTURE_STORAGE_ROOT=/data`
- [ ] `CRITJECTURE_DEPLOYMENT_MODE=hosted`
- [ ] `CRITJECTURE_HOSTED_ORGANIZATION_SLUG=<org-slug>`
- [ ] `CRITJECTURE_SANDBOX_EXECUTION_BACKEND=local_supervisor`
- [ ] `CRITJECTURE_SANDBOX_BWRAP_PATH=/usr/bin/bwrap`
- [ ] `CRITJECTURE_SANDBOX_PRLIMIT_PATH=/usr/bin/prlimit`
- [ ] `CRITJECTURE_ALERT_WEBHOOK_URL` (recommended)

Notes:

- Do **not** use Postgres for `DATABASE_URL` in this repo’s current envelope.
- Do **not** set remote supervisor vars in Phase 1.
- Keep `AUTH_SECRET` and any operator credentials in Railway secret storage, not in checked-in env files.

---

## C) Deploy + Data Plane Setup (Phase 1)

- [ ] Deploy Railway service.
- [ ] Run migrations:

```bash
pnpm db:migrate
```

- [ ] Provision hosted org + first owner:

```bash
pnpm --filter web provision:hosted-org -- \
  --organization-name "<Org Name>" \
  --organization-slug "<org-slug>" \
  --owner-email "<owner-email>" \
  --owner-password "<temp-password>" \
  --owner-name "<owner-name>"
```

---

## D) Smoke Tests (Phase 1)

- [ ] `GET /api/health` returns healthy or understood degraded state.
- [ ] `/admin/operations` shows valid hosted binding for this org slug.
- [ ] Owner can sign in.
- [ ] Upload one `.csv`/`.txt`/`.md` file succeeds.
- [ ] `search_company_knowledge` succeeds.
- [ ] One `run_data_analysis` request succeeds.
- [ ] One chart/doc generation request succeeds.

If sandbox tests fail with namespace/permission errors, move this org to Phase 2 immediately.

---

## E) Go / No-Go (Phase 1)

Go:

- [ ] all smoke tests pass
- [ ] no repeated sandbox backend errors
- [ ] acceptable latency under expected demo/user load

No-Go:

- [ ] bubblewrap permission failures
- [ ] repeated sandbox timeouts/contention
- [ ] web latency degradation under sandbox activity

---

## F) Phase 2 Migration Trigger

Migrate when any are true:

- [ ] sandbox reliability issues in Railway runtime
- [ ] UI responsiveness impacted by sandbox load
- [ ] org usage/concurrency increasing
- [ ] need stronger hosted isolation boundary

---

## G) Phase 2 Env Switch (Web App)

Change/add:

- [ ] `CRITJECTURE_SANDBOX_EXECUTION_BACKEND=hosted_supervisor`
- [ ] `CRITJECTURE_SANDBOX_SUPERVISOR_URL=<https://supervisor-host>`
- [ ] `CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID=<key-id>`
- [ ] `CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET=<shared-secret>`

Optional cleanup:

- [ ] remove `CRITJECTURE_SANDBOX_BWRAP_PATH`
- [ ] remove `CRITJECTURE_SANDBOX_PRLIMIT_PATH`

---

## H) Phase 2 Supervisor Host Checklist

- [ ] Docker-capable Linux host deployed.
- [ ] Supervisor service configured with matching org slug.
- [ ] TLS/reverse proxy in front of supervisor endpoint.
- [ ] Network/firewall policy restricts access appropriately.
- [ ] Supervisor health endpoint reachable from web app.

Supervisor env:

- [ ] `PORT=4100`
- [ ] `CRITJECTURE_HOSTED_ORGANIZATION_SLUG=<org-slug>`
- [ ] `CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID=<same-key-id>`
- [ ] `CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET=<same-secret>`
- [ ] `CRITJECTURE_SANDBOX_CONTAINER_IMAGE=<runner-image>`
- [ ] `CRITJECTURE_SANDBOX_DOCKER_BIN=docker`
- [ ] `CRITJECTURE_SANDBOX_WORKSPACE_ROOT=<workspace-root>`

---

## I) Post-Migration Validation (Phase 2)

- [ ] `/api/health` reports sandbox backend healthy.
- [ ] `/admin/operations` shows expected hosted binding and supervisor status.
- [ ] One upload succeeds.
- [ ] One search succeeds.
- [ ] One sandbox-backed request succeeds.
- [ ] no sustained error spike in request logs/alerts.

Rollback (if required):

- [ ] revert web env to `CRITJECTURE_SANDBOX_EXECUTION_BACKEND=local_supervisor`
- [ ] redeploy web app
- [ ] re-run smoke checks
