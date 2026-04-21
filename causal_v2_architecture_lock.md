# Critjecture V2 Architecture Lock

Date: 2026-04-20

## Phase

Phase 0: implementation lock and architecture freeze

## Canonical authority confirmation

This repository is locked to the following authority order for the V2 causal-first rebuild:

1. `causal_v2_db_schema_spec.md`
   - canonical database, entity-model, enum, key, index, soft-pointer, and archival authority
2. `causal_guardrail_implementation_plan.md`
   - canonical product flow, routing, intake, DAG, execution, answer-generation, and anti-inductive-error authority
3. `causal_v2_implementation_coordination_plan.md`
   - canonical sequencing, dependency, workstream, and acceptance-gate authority

## Architecture decisions frozen for implementation

The following decisions are implementation-locked and must not be reopened during V2.0 delivery unless product scope changes materially.

### Clean-slate V2
- V2 is a clean-slate rebuild
- backward compatibility is not required
- the old chat/workflow architecture is legacy/archive only

### Top-level product object
- `causal_studies` is the canonical top-level V2 product object
- V2 UI, API, persistence, and audit flows anchor on studies, not conversations or workflows

### Routing contract
The only allowed routing decisions in V2 are:
- `continue_descriptive`
- `open_causal_study`
- `ask_clarification`
- `blocked`

### Anti-inductive boundary
- intent routing happens before any dataset analysis
- causal requests must not flow into descriptive analysis tooling
- correlation must not be narrated as causation
- identification failure must remain durable and visible as `not_identifiable`

### V2 persistence stance
- `current_*` and `active_version_id` are soft pointers in V2.0
- immutable audit truth lives in versioned and run-level tables
- the DAG builder must persist both graph JSON and normalized graph rows
- causal runs must pin `primary_dataset_version_id`, `treatment_node_key`, and `outcome_node_key`
- final answer generation must consume `causal_answer_packages`

### Dataset binding rule
- exactly one active primary dataset binding is required before DAG approval and before causal run creation

### Optional scope
- reference-document support is optional for first ship
- causal-critical path remains:
  - datasets
  - causal studies
  - DAGs
  - approvals
  - runs
  - answer packages

## Contradiction review

No unresolved contradictions were found across:
- `causal_v2_db_schema_spec.md`
- `causal_guardrail_implementation_plan.md`
- `causal_v2_implementation_coordination_plan.md`

Resolution notes:
- schema/entity questions defer to the schema spec
- flow/routing questions defer to the guardrail plan
- sequencing/dependency questions defer to the coordination plan

## Phase 0 acceptance gate

Phase 0 exit criteria from `causal_v2_implementation_coordination_plan.md`:
- no unresolved architectural contradictions remain across the docs

Status: **satisfied**

## Phase 1 entry authorization

Phase 1 may proceed with the following implementation posture:
- rewrite `apps/web/lib/app-schema.ts` around the V2 schema spec
- isolate legacy chat/workflow schema definitions away from the canonical V2 schema
- create a V2 baseline migration posture rather than extending legacy migrations
- define archival/import helpers for foundational records only
