# Plan: Two-Phase Hosted Rollout on Railway (Phase 1 Co-Located Bubblewrap -> Phase 2 External Supervisor)

This plan intentionally uses a transitional architecture:

- **Phase 1 (temporary):** run web app + `local_supervisor` (`bubblewrap`) in the same Railway service
- **Phase 2 (target):** move sandbox execution to a dedicated external Docker-based supervisor

It is designed to let you launch quickly per org, then migrate cleanly once runtime constraints appear.

---

## 0) Decision Summary

### Phase 1 (temporary launch model)
Per org:
- **1 Railway service** (web app + local bubblewrap sandbox)
- **1 Railway volume** mounted at `/data`
- Hosted one-org-per-cell rules still apply

### Phase 2 (target model)
Per org:
- **1 Railway service** (web app)
- **1 external supervisor service** on Docker-capable host
- **1 Railway volume** mounted at `/data`

---

## 1) Non-Negotiables

1. **Use SQLite file paths, not Postgres URLs** in current supported repo envelope.
2. Keep **one org per hosted cell** (`CRITJECTURE_HOSTED_ORGANIZATION_SLUG`).
3. Validate with real sandbox runs, not just dependency checks.
4. Treat Phase 1 as risk-accepted temporary architecture.

---

## 2) Phase 1: Co-Located Railway + Bubblewrap (Temporary)

## 2.1 Intended use

Use for first rollout/demo per org when speed matters and usage is modest.

## 2.2 Known risks

- Bubblewrap/kernel namespace support may fail on managed platform runtime.
- Sandbox CPU/memory pressure can impact web request responsiveness.
- This is outside the repository’s recommended hosted production boundary.

## 2.3 Railway runtime requirements

Install at runtime/build:

- `bubblewrap` (`bwrap`)
- `util-linux` (`prlimit`)
- Python runtime + uv-managed sandbox venv (`packages/python-sandbox/.venv`)

## 2.4 Suggested `railpack.json` (Phase 1)

Create at repo root:

```json
{
  "$schema": "https://schema.railpack.com",
  "provider": "node",
  "buildAptPackages": ["bubblewrap", "util-linux", "curl"],
  "packages": {
    "node": "20",
    "python": "3.13"
  },
  "steps": {
    "install": {
      "commands": [
        "pnpm install --frozen-lockfile",
        "curl -LsSf https://astral.sh/uv/install.sh | sh",
        "PATH:/root/.local/bin",
        "cd packages/python-sandbox && uv sync --frozen"
      ]
    },
    "build": {
      "commands": ["pnpm build"]
    }
  },
  "deploy": {
    "startCommand": "pnpm start",
    "aptPackages": ["bubblewrap", "util-linux"]
  }
}
```

Why this is needed:

- new Railway services use Railpack by default
- this repo includes `packages/python-sandbox/pyproject.toml`, so autodetection can incorrectly treat the repo as a Python app unless the repo-root build is pinned explicitly

## 2.5 Required env vars (Phase 1)

Set on Railway service:

- `AUTH_SECRET=<random>`
- `OPENAI_API_KEY=<key>`
- `OPENAI_MODEL=gpt-5.4-mini`
- `DATABASE_URL=/data/critjecture.sqlite`
- `CRITJECTURE_STORAGE_ROOT=/data`
- `CRITJECTURE_DEPLOYMENT_MODE=hosted`
- `CRITJECTURE_HOSTED_ORGANIZATION_SLUG=<org-slug>`
- `CRITJECTURE_SANDBOX_EXECUTION_BACKEND=local_supervisor`
- `CRITJECTURE_SANDBOX_BWRAP_PATH=/usr/bin/bwrap`
- `CRITJECTURE_SANDBOX_PRLIMIT_PATH=/usr/bin/prlimit`
- `CRITJECTURE_ALERT_WEBHOOK_URL=<optional-recommended>`

Do **not** set remote supervisor vars in this phase.

## 2.6 Deploy steps (Phase 1)

1. Create Railway project/service for org.
2. Attach persistent volume at `/data`.
3. Deploy from the repo root with `railpack.json` and the env vars above.
4. Run migrations:
   - `pnpm db:migrate`
5. Provision hosted org + owner:

```bash
pnpm --filter web provision:hosted-org -- \
  --organization-name "<Org Name>" \
  --organization-slug "<org-slug>" \
  --owner-email "<owner-email>" \
  --owner-password "<temp-password>" \
  --owner-name "<owner-name>"
```

6. Smoke test (must include real sandbox execution).

## 2.7 Phase 1 smoke tests

- `GET /api/health` (expect healthy or understood degraded)
- `/admin/operations` (binding + runtime checks)
- Owner login works
- Upload `.csv` / `.txt` / `.md`
- Run `search_company_knowledge`
- Run one `run_data_analysis`
- Run one chart/doc generation request

> There is no `/api/admin/sandbox/health` route in this repo.

---

## 3) Phase 1 Exit Criteria (Move to Phase 2)

Migrate when any of the following are observed:

- bubblewrap failures due to runtime/kernel restrictions
- p95/p99 web latency degradation during sandbox load
- repeated sandbox timeouts or queue contention
- need for stronger failure-domain isolation
- increasing org/user concurrency

---

## 4) Phase 2: External Docker Supervisor (Target)

## 4.1 Architecture

Per org:
- Railway web app service (unchanged)
- External sandbox supervisor on Docker-capable host
- Same `/data` storage model in Railway web app

## 4.2 Required env changes (web app)

Switch sandbox backend:

- `CRITJECTURE_SANDBOX_EXECUTION_BACKEND=hosted_supervisor`
- `CRITJECTURE_SANDBOX_SUPERVISOR_URL=<https://supervisor-host>`
- `CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID=<key-id>`
- `CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET=<shared-secret>`

Remove local-only vars if desired:
- `CRITJECTURE_SANDBOX_BWRAP_PATH`
- `CRITJECTURE_SANDBOX_PRLIMIT_PATH`

## 4.3 Required env (external supervisor)

- `PORT=4100`
- `CRITJECTURE_HOSTED_ORGANIZATION_SLUG=<org-slug>`
- `CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID=<same-key-id>`
- `CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET=<same-secret>`
- `CRITJECTURE_SANDBOX_CONTAINER_IMAGE=<runner-image>`
- `CRITJECTURE_SANDBOX_DOCKER_BIN=docker`
- `CRITJECTURE_SANDBOX_WORKSPACE_ROOT=<workspace-root>`

## 4.4 Migration runbook (Phase 1 -> Phase 2)

1. Deploy supervisor externally and verify `/health` on supervisor endpoint.
2. Keep existing Railway app live.
3. Update web env vars to `hosted_supervisor` and supervisor auth/url.
4. Redeploy web app.
5. Run smoke tests again.
6. Monitor `sandbox` and `hosted-deployment` checks in `/api/health` + `/admin/operations`.

Rollback:
- revert env to `CRITJECTURE_SANDBOX_EXECUTION_BACKEND=local_supervisor`
- redeploy web app

---

## 5) Data & Backup Discipline (Both Phases)

- Keep SQLite + storage on persistent `/data` volume.
- Run regular backups (target <=24h cadence).
- Keep restore-drill and release-proof artifacts for hosted environments.

---

## 6) Org Scaling Pattern

For each additional org:

- new Railway project/service/volume
- unique `CRITJECTURE_HOSTED_ORGANIZATION_SLUG`
- provision org + owner via script
- Phase 1 or Phase 2 sandbox mode selected per org

Do not place multiple organizations in one hosted cell.

---

## 7) Demo-Focused Notes

- Knowledge search now falls back to Node scanner if `rg` is unavailable.
- PDF ingestion is optional; missing `pdftotext` should show as degraded health for PDF ingestion.
- Use CSV/TXT/MD-heavy demo flows to minimize environment sensitivity.

---

## 8) Recommended Final State

Treat Phase 1 as temporary. Target Phase 2 for durable hosted operation:

- cleaner isolation boundary
- lower noisy-neighbor risk
- easier incident response and scaling
