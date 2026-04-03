# Railway Hosted Sandbox On A Locally Owned Server

Use this runbook when the Railway web app stays on Railway but the hosted Docker sandbox supervisor runs on a server you control.

This is intended for:

- a short-lived demo
- a customer proof-of-concept
- a temporary bridge before moving the supervisor to a managed VM

It is not the preferred long-term production shape.

## Topology

- Railway hosts the web app
- Railway keeps the persistent `/data` volume for SQLite and tenant storage
- one locally owned Linux server runs the hosted sandbox supervisor
- that server also runs Docker for the per-request sandbox runner containers
- the supervisor is exposed to Railway over HTTPS

For a local demo, the locally owned server can be:

- your own workstation
- a spare on-prem Linux box
- another machine on hardware you control

## Why Use This Shape

- Railway `local_supervisor` with `bubblewrap` can fail on managed container runtimes
- the hosted supervisor path avoids Railway kernel namespace limitations
- the web app stays easy to deploy while sandbox execution moves to infrastructure you control

## Web App Environment

Set these on the Railway web service:

- `AUTH_SECRET`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `DATABASE_URL=/data/critjecture.sqlite`
- `CRITJECTURE_STORAGE_ROOT=/data`
- `CRITJECTURE_DEPLOYMENT_MODE=hosted`
- `CRITJECTURE_HOSTED_ORGANIZATION_SLUG=<org-slug>`
- `CRITJECTURE_SANDBOX_EXECUTION_BACKEND=hosted_supervisor`
- `CRITJECTURE_SANDBOX_SUPERVISOR_URL=https://<supervisor-hostname>`
- `CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID=<key-id>`
- `CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET=<shared-secret>`

Remove the Phase 1 local sandbox variables from Railway:

- `CRITJECTURE_SANDBOX_BWRAP_PATH`
- `CRITJECTURE_SANDBOX_PRLIMIT_PATH`

## Locally Owned Server Requirements

- Linux host you control
- Docker installed and working
- outbound internet access so Docker can pull or build images
- inbound HTTPS reachability from Railway to the supervisor
- enough disk for temporary sandbox workspaces and Docker image layers

## Supervisor Environment

Set these on the locally owned server when starting the supervisor:

- `PORT=4100`
- `CRITJECTURE_HOSTED_ORGANIZATION_SLUG=<org-slug>`
- `CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID=<same-key-id>`
- `CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET=<same-shared-secret>`
- `CRITJECTURE_SANDBOX_CONTAINER_IMAGE=critjecture/sandbox-runner:latest`
- `CRITJECTURE_SANDBOX_DOCKER_BIN=docker`
- `CRITJECTURE_SANDBOX_WORKSPACE_ROOT=<workspace-root>`

## Bring-Up Sequence

1. Build or pull the sandbox runner image on the locally owned server.
2. Start the supervisor on that server.
3. Put HTTPS in front of the supervisor.
4. Update Railway to `CRITJECTURE_SANDBOX_EXECUTION_BACKEND=hosted_supervisor`.
5. Redeploy the Railway web service.
6. Verify `/api/health` and `/admin/operations`.
7. Run one sandbox-backed request.

## Demo Notes

- for a demo, a locally owned workstation is acceptable if uptime is not critical
- for a demo, Cloudflare Tunnel is a reasonable way to expose the supervisor over HTTPS
- do not put Cloudflare Access in front of the supervisor unless the web app is updated to send the required Access auth headers

## Risks

- your workstation uptime becomes part of the demo
- local reboots or sleep will break sandbox-backed requests
- home or office networking can interrupt the public supervisor endpoint
- Docker issues on the locally owned server will stop all sandbox-backed features

## Exit Criteria

Move off the locally owned server when any are true:

- the demo needs predictable uptime
- more than one organization depends on the supervisor
- you need repeatable operator handoff
- you need stronger recovery, monitoring, or credential ownership

At that point, move the supervisor to a dedicated VM while keeping the same hosted supervisor web-app configuration.
