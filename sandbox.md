# Sandbox Decisions

This document captures the current sandbox policy for Critjecture and the places where that policy may change later.

The goal is to keep the main decisions easy to revisit as deployment environments, customer requirements, and risk tolerance change.

## Why This Exists

Sandbox policy is not static.

- model-generated Python is a high-risk capability
- the right limits for a single-customer pilot may be too weak for multi-tenant hosting
- some organizations may need tighter retention, stricter concurrency, or stronger operator controls

This file is the decision record for those choices. It is not meant to replace implementation details in code or milestone notes in the roadmap files.

## Current Step 14 Defaults

- isolation runner: Linux namespaces via `bubblewrap`
- network access: disabled inside the sandbox
- execution model: synchronous request/response, no background queue
- per-user active sandbox jobs: `1`
- global active sandbox jobs: `4`
- wall timeout: `10s`
- CPU time limit: `8s`
- memory limit: `512 MiB`
- process limit: `64`
- stdout/stderr capture limit: `1 MiB`
- output artifact size limit: `10 MiB`
- output retention: persisted for `24h`
- temporary workspace retention: delete `/tmp/workspace/<run-id>` immediately after finalization

Current generated-output rules:

- `run_data_analysis`: no persisted generated files
- `generate_visual_graph`: exactly one `outputs/chart.png`
- `generate_document`: exactly one `outputs/notice.pdf`

Current generated-file behavior:

- accepted outputs are copied into tenant storage under `generated_assets/<run-id>/...`
- generated files are served from persistent tenant storage, not from `/tmp/workspace`
- expired generated files should become inaccessible immediately

## Decision Rationale

### 1. Linux namespace isolation over plain subprocess hardening

Critjecture previously executed model-generated Python as a local child process with a stripped environment. That was acceptable for early MVP work, but it was not a strong enough boundary for real customer environments.

`bubblewrap` was chosen because it materially improves isolation while fitting the current deployment model:

- local Linux hardware
- customer-managed Linux hardware
- Linux-based hosted environments

It is a better fit for the current single-service architecture than introducing a separate sandbox worker or VM service in the same step.

### 2. Immediate workspace cleanup plus short-lived persistent artifacts

Serving generated files directly from `/tmp/workspace/<run-id>` couples file availability to temporary workspace lifetime.

The current policy instead:

- validates outputs first
- copies only approved outputs into persistent tenant storage
- deletes the temp workspace immediately afterward

This gives better cleanup guarantees without breaking the chart/PDF download experience.

### 3. Reject-on-contention instead of queueing

Sandbox-backed tool calls are still synchronous HTTP requests from the chat UI.

Because the product does not yet have async job handling or queue-aware UI states, the current behavior is:

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

### Multi-Tenant Hosted Deployment

Likely stricter settings:

- tighter concurrency enforcement
- stricter artifact retention
- stronger abuse detection around repeated sandbox use
- possible move from in-process execution to an external worker or stronger isolation boundary later

### Higher-Risk Organizations

Possible stricter controls:

- shorter artifact retention
- lower memory or timeout ceilings
- reduced tool availability
- additional approval or audit review requirements for generated documents

## Organization Tuning Matrix

| Setting | Default | May Vary Per Org | Why It Might Change | Notes / Constraints |
| --- | --- | --- | --- | --- |
| Isolation runner | `bubblewrap` | Rarely | Deployment platform or compliance review | Changing this is a platform decision, not a simple per-org toggle |
| Wall timeout | `10s` | Yes | Larger reports or heavier analytics | Raising it increases abuse and denial-of-service risk |
| CPU limit | `8s` | Yes | Hardware profile or expected workload | Should remain below wall timeout |
| Memory limit | `512 MiB` | Yes | Larger CSVs or richer document generation | Higher memory increases noisy-neighbor risk |
| Max processes | `8` | Maybe | Library/runtime needs | Should stay small unless a concrete need is proven |
| Per-user concurrency | `1` | Maybe | Dedicated single-customer installs | Shared deployments should stay strict |
| Global concurrency | `4` | Yes | Host capacity | This is deployment-level more than org-level |
| Artifact size limit | `10 MiB` | Yes | Customers generating richer PDFs | Larger artifacts increase storage pressure |
| Artifact TTL | `24h` | Yes | Customer expectation for download availability | Longer retention should be deliberate |
| Allowed output types | PNG/PDF only | Rarely | New product capabilities | New types need explicit validation and serving rules |
| Tool availability | analysis/chart/document | Yes | Customer policy or compliance posture | Restricting tool classes is safer than widening output rules |
| Audit retention/detail | current app defaults | Yes | Customer review and governance expectations | Sandbox attempts must remain auditable even if retention changes |

## Non-Negotiable Invariants

These should not vary without a deeper redesign.

- RBAC is enforced before any company file is staged into the sandbox.
- Model-generated code does not receive unrestricted host filesystem access.
- Sandbox execution does not have normal network access.
- Only explicitly approved output types and locations are retrievable.
- Every sandbox attempt, including rejection and timeout, should be auditable.
- Temporary workspaces should be cleaned after completion or failure.
- Generated-file access remains scoped to the authenticated user and organization.

## Future Change Triggers

Revisit this policy when any of these become true:

- Critjecture adds async sandbox jobs or background processing
- deployment moves beyond Linux or needs cross-platform sandboxing
- a hosted deployment needs stronger noisy-neighbor isolation
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
- [`steps.md`](/home/hard2vary/projects/critjecture/steps.md)
