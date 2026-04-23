# Critjecture V2 Architecture Lock

Date: 2026-04-23

## Phase

Phase 1: rung-first documentation lock

## Canonical authority confirmation

This repository is now locked to the following authority order for the V2 analytical rebuild:

1. `causal_v2_db_schema_spec.md`
   - canonical database, entity-model, enum, key, index, soft-pointer, and archival authority
2. `causal_guardrail_implementation_plan.md`
   - canonical product flow, routing, workspace, execution, answer-generation, and anti-overclaim authority
3. `causal_v2_implementation_coordination_plan.md`
   - canonical sequencing, dependency, workstream, and acceptance-gate authority
4. `analysis_routing_decision_tree.md`
   - canonical routing and claim-label authority
5. `causal_presupposition_guardrail.md`
   - canonical presupposition / unsupported-rung-jump authority

## Architecture decisions frozen for implementation

The following decisions are implementation-locked and must not be reopened during V2.0 delivery unless product scope changes materially.

### Top-level product object
- `analysis_studies` is the canonical top-level V2 product object
- V2 UI, API, persistence, and audit flows anchor on studies, not conversations, workflows, or predictive-only runs

### Rung-first classification
- analytical requests are classified by the **minimum Pearl rung required** for a non-misleading answer
- task form is a separate axis
- unsupported presuppositions are tracked separately as guardrail flags

### Ordinary chat vs analytical workflow
- conceptual discussion of causation does not automatically trigger analytical routing
- the system must first distinguish ordinary chat from dataset-backed analytical work

### Routing contract
The only allowed routing decisions in V2 are:
- `continue_chat`
- `open_rung1_analysis`
- `open_rung2_study`
- `open_rung3_study`
- `ask_clarification`
- `blocked`

### Product surfaces
- all rung-1 work belongs to one canonical observational-analysis surface
- the old predictive workspace is legacy/compatibility-only and is not the target architecture
- rung 2 and rung 3 are distinct higher-rung study flows even if they share infrastructure

### Anti-overclaim boundary
- routing happens before dataset-backed answer generation
- rung-1 outputs must not be narrated as intervention effects or actual-cause findings
- unsupported rung jumps must trigger reframing or clarification
- identification failure must remain durable and visible, not overwritten by observational prose

### Persistence stance
- `current_*` and `active_version_id` are soft pointers in V2.0
- immutable audit truth lives in versioned and run-level tables
- study, graph, run, and answer-package records must preserve rung-specific assumptions and outputs explicitly

### Dataset binding rule
- exactly one active primary dataset binding is required before study approval and before rung-2 or rung-3 run creation

### Claim-label lock
- rung-1 branches may not emit `CORROBORATED ROOT-CAUSE CONJECTURE`
- claim labels must align with the rung actually executed

## Contradiction review

The prior repo state contained contradictions between:
- mixed intent taxonomy docs and code
- predictive-route documentation and the earlier architecture lock
- observational diagnostic claims and the intended causal guardrail posture

These are now resolved by the rung-first model.

Resolution notes:
- schema/entity questions defer to the schema spec
- flow/routing questions defer to the implementation plan and routing tree
- sequencing/dependency questions defer to the coordination plan

## Phase 1 acceptance gate

Phase 1 exit criteria:
- the canonical docs describe the same rung-first architecture
- no canonical doc treats `predictive` as a first-class epistemic rung
- no canonical doc allows rung-1 mechanism work to emit root-cause corroboration labels
- no canonical doc treats `loaded_mechanism_from_observation` as the final guardrail abstraction

Status: **in progress**

## Immediate implementation posture

The implementation pass should now proceed under these assumptions:
- rename the top-level study model to `analysis_studies` in docs and upcoming schema work
- replace mixed intent enums with separate fields for required rung, task form, and guardrail flag
- consolidate predictive/associational/descriptive/diagnostic rung-1 work into one observational-analysis surface
- keep any predictive-only codepaths as temporary compatibility shims until the workspace consolidation phase removes them
