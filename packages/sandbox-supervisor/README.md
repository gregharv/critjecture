# Sandbox Supervisor

This package provides the dedicated sandbox supervisor service for `single_org` production and hosted dedicated-customer cells.

It exposes:

- `GET /health`
- `POST /runs/execute`

The service is intentionally narrow:

- validates either bearer-token auth (`single_org`) or signed requests (`hosted`)
- stages inline and input files into a per-run workspace
- runs Python inside a fresh Docker container with network disabled and a read-only root filesystem
- returns stdout, stderr, status, and generated output bytes to the web app

## Environment

```bash
PORT=4100
CRITJECTURE_SANDBOX_SUPERVISOR_TOKEN=replace-me
CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID=
CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET=
CRITJECTURE_HOSTED_ORGANIZATION_SLUG=
CRITJECTURE_SANDBOX_CONTAINER_IMAGE=critjecture/sandbox-runner:latest
CRITJECTURE_SANDBOX_DOCKER_BIN=docker
CRITJECTURE_SANDBOX_WORKSPACE_ROOT=/tmp/critjecture-sandbox-supervisor
```

## Start

```bash
pnpm --filter sandbox-supervisor start
```

## Build The Sandbox Runner Image

Build from the repo root so the Dockerfile can copy `packages/python-sandbox`:

```bash
docker build -f packages/sandbox-supervisor/runner.Dockerfile -t critjecture/sandbox-runner:latest .
```

Point the web app at the supervisor:

```bash
CRITJECTURE_SANDBOX_EXECUTION_BACKEND=container_supervisor
CRITJECTURE_SANDBOX_SUPERVISOR_URL=http://127.0.0.1:4100
CRITJECTURE_SANDBOX_SUPERVISOR_TOKEN=replace-me
CRITJECTURE_SANDBOX_CONTAINER_IMAGE=critjecture/sandbox-runner:latest
```

Hosted deployments should instead set:

```bash
CRITJECTURE_DEPLOYMENT_MODE=hosted
CRITJECTURE_HOSTED_ORGANIZATION_SLUG=acme
CRITJECTURE_SANDBOX_SUPERVISOR_URL=http://127.0.0.1:4100
CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID=hosted-app
CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET=replace-me
```
