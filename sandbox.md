# Sandbox Decisions

This document captures the current sandbox policy for Critjecture and the places where that policy may change later.

The goal is to keep the main decisions easy to revisit as deployment environments, customer requirements, and risk tolerance change.

## Why This Exists

Sandbox policy is not static.

- model-generated Python is a high-risk capability
- the right limits for a single-customer pilot may be too weak for multi-tenant hosting
- some organizations may need tighter retention, stricter concurrency, or stronger operator controls

This file is the decision record for those choices. It is not meant to replace implementation details in code or milestone notes in the roadmap files.

## Current Step 28 Defaults

- execution model: synchronous request/response at the route layer, but supervisor-owned run lifecycle underneath
- `single_org` backend: `container_supervisor` reached over a dedicated service boundary and running each job in a fresh OCI container
- local dev/test fallback: `local_supervisor` running Linux namespaces via `bubblewrap` + `prlimit`
- hosted backend: `hosted_supervisor` reached over a dedicated service boundary
- remote-backend fallback: none; `single_org` and `hosted` fail closed if the supervisor is unavailable or unconfigured
- network access: disabled inside the container-backed and local `bubblewrap` sandboxes
- per-user active sandbox jobs: `1`
- global active sandbox jobs: `4`
- wall timeout: `10s`
- CPU time limit: `8s`
- memory limit: `512 MiB`
- process limit: `64`
- stdout/stderr capture limit: `1 MiB`
- output artifact size limit: `10 MiB`
- output retention: persisted for `24h`
- supervisor lease / heartbeat: tracked durably in `sandbox_runs`
- temporary workspace retention: delete `/tmp/workspace/<run-id>` after finalization or stale-run reconciliation

Current generated-output rules:

- `run_data_analysis`: no persisted generated files
- `generate_visual_graph`: exactly one `outputs/chart.png`
- `generate_document`: exactly one `outputs/notice.pdf`

Current generated-file behavior:

- accepted outputs are copied into tenant storage under `generated_assets/<run-id>/...`
- generated files are served from persistent tenant storage, not from `/tmp/workspace`
- expired generated files should become inaccessible immediately

## Decision Rationale

### 1. Supervisor-owned execution over request-local child process ownership

Critjecture previously relied on request-local child process lifetime plus best-effort cleanup. That was acceptable for early MVP work, but it was not restart-safe enough for real customer environments.

The current policy is:

- `single_org` and `hosted` both keep the current synchronous route UX, but production execution happens across a dedicated supervisor service boundary
- the web app still owns queueing, run persistence, finalization, and reconciliation
- hosted deployments must submit work to a dedicated supervisor service boundary

This keeps the current synchronous product UX while making lifecycle ownership durable and making hosted trust boundaries explicit.

### 2. Container-backed isolation is now the production `single_org` primitive

For customer-managed `single_org` production installs, the concrete execution runner is now a fresh OCI container launched by the dedicated supervisor service.

The repo still keeps `bubblewrap` for explicit local-dev/test fallback, but it is no longer the supported production boundary.

Hosted still requires separate hardening work beyond this step.

### 3. Immediate workspace cleanup plus short-lived persistent artifacts

Serving generated files directly from `/tmp/workspace/<run-id>` couples file availability to temporary workspace lifetime.

The current policy instead:

- validates outputs first
- copies only approved outputs into persistent tenant storage
- deletes the temp workspace afterward
- retries cleanup during reconciliation if a run dies mid-finalization

This gives better cleanup guarantees without breaking the chart/PDF download experience.

### 4. Reject-on-contention instead of queueing

Sandbox-backed tool calls are still synchronous HTTP requests from the chat UI.

Because the product does not yet have async job handling or queue-aware UI states, the current behavior is:

- queue a durable run record first
- let the supervisor claim work and enforce concurrency ceilings there
- reject a second active sandbox run for the same user
- reject new work when the global cap is reached

This keeps behavior predictable and limits noisy-neighbor risk without introducing a larger async-job architecture in the same milestone.

## What May Vary By Deployment

Some settings are intentionally expected to vary later.

### On-Prem or Single-Customer Pilot

Possible adjustments:

- slightly higher memory or timeout limits
- longer artifact retention if the customer explicitly wants it
- lower global concurrency if hardware is small
- continued use of the dedicated container supervisor service

### Multi-Tenant Hosted Deployment

Current hosted posture:

- the web app must submit sandbox work to a dedicated supervisor service
- hosted should not fall back to in-process `bubblewrap` execution

Likely future stricter settings:

- tighter concurrency enforcement
- stricter artifact retention
- stronger abuse detection around repeated sandbox use
- stronger execution isolation inside the hosted supervisor service later if needed

### Higher-Risk Organizations

Possible stricter controls:

- shorter artifact retention
- lower memory or timeout ceilings
- reduced tool availability
- additional approval or audit review requirements for generated documents

## Organization Tuning Matrix

| Setting | Default | May Vary Per Org | Why It Might Change | Notes / Constraints |
| --- | --- | --- | --- | --- |
| Execution backend | `container_supervisor`, `local_supervisor`, or `hosted_supervisor` | Rarely | Deployment platform or compliance review | `single_org` now defaults to `container_supervisor`; `local_supervisor` is dev/test only |
| Container image | env-controlled | Rarely | Patch cadence or Python dependency changes | Applies to container-backed supervisor execution |
| Local isolation runner | `bubblewrap` | Rarely | Dev/test platform support | Only applies to the explicit `local_supervisor` fallback |
| Wall timeout | `10s` | Yes | Larger reports or heavier analytics | Raising it increases abuse and denial-of-service risk |
| CPU limit | `8s` | Yes | Hardware profile or expected workload | Should remain below wall timeout |
| Memory limit | `512 MiB` | Yes | Larger CSVs or richer document generation | Higher memory increases noisy-neighbor risk |
| Max processes | `64` | Maybe | Library/runtime needs | Should stay bounded unless a concrete need is proven |
| Per-user concurrency | `1` | Maybe | Dedicated single-customer installs | Shared deployments should stay strict |
| Global concurrency | `4` | Yes | Host capacity | This is deployment-level more than org-level |
| Artifact size limit | `10 MiB` | Yes | Customers generating richer PDFs | Larger artifacts increase storage pressure |
| Artifact TTL | `24h` | Yes | Customer expectation for download availability | Longer retention should be deliberate |
| Supervisor lease/heartbeat timings | env-controlled defaults | Rarely | Infrastructure latency or timeout tuning | This is an operator/platform control, not a normal tenant-facing setting |
| Allowed output types | PNG/PDF only | Rarely | New product capabilities | New types need explicit validation and serving rules |
| Tool availability | analysis/chart/document | Yes | Customer policy or compliance posture | Restricting tool classes is safer than widening output rules |
| Audit retention/detail | current app defaults | Yes | Customer review and governance expectations | Sandbox attempts must remain auditable even if retention changes |

## Non-Negotiable Invariants

These should not vary without a deeper redesign.

- RBAC is enforced before any company file is staged into the sandbox.
- Model-generated code does not receive unrestricted host filesystem access.
- Sandbox execution does not have normal network access.
- Only explicitly approved output types and locations are retrievable.
- Every sandbox attempt, including rejection, timeout, abandonment, and backend unavailability, should be auditable.
- Hosted mode must not silently fall back to in-web-process local sandbox execution.
- Temporary workspaces should be cleaned after completion, failure, or reconciliation.
- Generated-file access remains scoped to the authenticated user and organization.

## Future Change Triggers

Revisit this policy when any of these become true:

- Critjecture adds async sandbox jobs or background processing
- deployment moves beyond Docker-backed Linux installs or needs cross-platform sandboxing
- a hosted deployment needs stronger noisy-neighbor isolation inside the dedicated supervisor service
- customers request longer-lived generated files
- observed failures show the current limits are too low
- observed abuse shows the current limits are too generous
- security or compliance review requires a stronger isolation boundary

## Related Code And Docs

Main implementation paths:

- [`apps/web/lib/python-sandbox.ts`](/home/hard2vary/projects/critjecture/apps/web/lib/python-sandbox.ts)
- [`apps/web/lib/sandbox-runs.ts`](/home/hard2vary/projects/critjecture/apps/web/lib/sandbox-runs.ts)
- [`apps/web/lib/sandbox-policy.ts`](/home/hard2vary/projects/critjecture/apps/web/lib/sandbox-policy.ts)
- [`apps/web/lib/app-schema.ts`](/home/hard2vary/projects/critjecture/apps/web/lib/app-schema.ts)

Related project docs:

- [`README.md`](/home/hard2vary/projects/critjecture/README.md)
- [`deployment.md`](/home/hard2vary/projects/critjecture/deployment.md)
- [`steps_completed.md`](/home/hard2vary/projects/critjecture/steps_completed.md)
