# Critjecture V2 Rung-First Implementation Coordination Plan

## Purpose

This document coordinates the implementation of:

- `analysis_routing_decision_tree.md`
- `causal_presupposition_guardrail.md`
- `causal_guardrail_implementation_plan.md`
- `causal_v2_db_schema_spec.md`

It turns those docs into one execution sequence so the rebuild can happen without architectural drift.

This plan assumes:
- **clean-slate V2**
- **no backward compatibility requirement for the primary path**
- **ordinary chat is distinct from dataset-backed analysis**
- **all analytical work is routed by required Pearl rung first**
- **the old predictive-vs-causal split is legacy, not the target architecture**

---

## Canonical authority split

To avoid conflicting implementation decisions, use this authority model.

### `causal_v2_db_schema_spec.md` owns
- entity model
- table definitions
- enums
- keys and indexes
- pointer strategy
- archival/removal posture for old primary-path abstractions

### `causal_guardrail_implementation_plan.md` owns
- product flow
- routing behavior
- study workspace behavior
- execution flow
- final answer generation flow
- anti-overclaim operating rules

### `analysis_routing_decision_tree.md` owns
- routing contract
- required rung definitions
- claim-label rules

### `causal_presupposition_guardrail.md` owns
- unsupported rung jump detection
- direct-mechanism presupposition handling
- actual-cause presupposition handling
- clarification policy for guardrail-triggered requests

### This coordination plan owns
- phase order
- workstream dependencies
- implementation handoff points
- sequencing constraints
- definition of done across docs

---

## Core implementation principle

The rebuild must not accidentally recreate the old architecture under new names.

Implementation must proceed in this order:

1. freeze the rung-first docs and schema target
2. establish the new schema and factored routing model
3. establish ordinary-chat vs analytical intake separation
4. establish the unified rung-1 observational surface
5. establish higher-rung study authoring and approval
6. establish run execution and grounded answer generation
7. only then remove the remaining predictive-only and mixed-taxonomy compatibility layers

Do **not** start from the old predictive or causal workspaces and merely relabel them.

---

# 1) Coordinated workstreams

Implement V2 through six coordinated workstreams.

## Workstream A: schema and persistence

### Scope
Build the DB foundation defined in `causal_v2_db_schema_spec.md`.

### Owns
- V2 `app-schema.ts` rewrite
- baseline migration
- study/container rename to `analysis_studies`
- classification table redesign
- answer-package claim-label constraints

### Inputs
- `causal_v2_db_schema_spec.md`

### Outputs
- V2 schema code
- V2 baseline SQL migration
- schema validation notes

### Blocking dependencies
None. This is the first workstream.

---

## Workstream B: intake and routing

### Scope
Implement ordinary-chat vs analytical intake, rung classification, task-form classification, and guardrail-aware routing.

### Owns
- `POST /api/analysis/intake`
- classifier contract
- routing enum contract
- creation of `analysis_studies`, `study_questions`, and `analysis_classifications`

### Inputs
- schema from Workstream A
- routing rules from `analysis_routing_decision_tree.md`
- guardrail rules from `causal_presupposition_guardrail.md`

### Outputs
- intake APIs
- routing service layer
- frontend routing contract

### Blocking dependencies
- Workstream A must define tables and enums first

---

## Workstream C: observational workspace consolidation

### Scope
Implement the canonical rung-1 observational surface and retire the predictive-only product split.

### Owns
- rung-1 study UI state
- observational summaries / forecasting / decomposition result packaging
- migration path for predictive-specific codepaths
- nav and handoff redesign

### Inputs
- schema from Workstream A
- routing output from Workstream B

### Outputs
- observational workspace UI
- observational APIs/services
- compatibility plan for `/predictive`

### Blocking dependencies
- Workstream A
- Workstream B

---

## Workstream D: dataset binding and higher-rung study setup

### Scope
Implement dataset pinning, graph authoring, assumptions, missing data requirements, and approvals for rung 2 and rung 3.

### Owns
- dataset binding APIs
- graph builder UI
- assumption panels
- approval flow
- rung-specific setup validation

### Inputs
- schema from Workstream A
- studies from Workstream B

### Outputs
- higher-rung study setup services
- graph CRUD and versioning
- approval APIs and UI

### Blocking dependencies
- Workstream A
- Workstream B

---

## Workstream E: execution and result packaging

### Scope
Implement study-backed runs, identification/inference, refutation, and grounded result packages.

### Owns
- `analysis_runs`
- run-level dataset pinning
- identification / estimation / refutation persistence
- answer-package generation

### Inputs
- approved setup from Workstream D
- pinned datasets from Workstream D
- observational run contracts from Workstream C

### Outputs
- run APIs
- execution orchestration
- structured result packages

### Blocking dependencies
- Workstream A
- Workstream C for rung 1 packaging
- Workstream D for rung 2 / rung 3 setup

---

## Workstream F: legacy retirement and UX completion

### Scope
Remove the old mixed-taxonomy surfaces and finish the V2 user-facing loop.

### Owns
- redirect/shim strategy for old predictive pages and routes
- final nav cleanup
- final answer-history views
- compatibility removal plan

### Inputs
- stable routing from Workstream B
- observational surface from Workstream C
- run detail/results from Workstream E

### Outputs
- final UX polish
- legacy-removal checklist
- regression protection against taxonomy drift

### Blocking dependencies
- Workstream E
- most of Workstream C

---

# 2) Phase-by-phase implementation order

## Phase 1: documentation lock and architecture freeze

### Goal
Freeze the rung-first doc set before coding proceeds further.

### Required decisions already locked
- `analysis_studies` is the top-level product object in docs
- routing is rung-first
- predictive-only workspace is not the target architecture
- unsupported presuppositions are a first-class guardrail concept
- rung-1 claim labels may not overstate support

### Deliverables
- rewritten canonical docs
- explicit architecture lock
- clear migration target for schema and routing

### Exit criteria
- no unresolved contradictions remain across the canonical docs

---

## Phase 2: schema-first foundation

### Goal
Establish the persistent V2 model before UI or routing shortcuts accumulate.

### Workstreams active
- A only

### Tasks
- rewrite `apps/web/lib/app-schema.ts` around the rung-first schema spec
- create V2 baseline migration or equivalent migration posture
- rename top-level study/container schema to `analysis_studies`
- replace mixed intent enums with factored routing axes
- design claim-label constraints around rung compatibility

### Exit criteria
- V2 schema compiles cleanly
- migration posture is reviewed
- no new code depends on old mixed-intent enums

---

## Phase 3: intake, routing, and study creation

### Goal
Make rung-first intake the entrypoint to the new system.

### Workstreams active
- A (support)
- B

### Tasks
- implement classifier contract and JSON validation
- implement `/api/analysis/intake`
- distinguish ordinary chat from dataset-backed analysis
- persist `analysis_classifications` before analysis begins
- create `analysis_studies` and `study_questions` for analytical flows
- route to rung 1 / rung 2 / rung 3 or clarification
- apply the generalized presupposition guardrail

### Exit criteria
- conceptual chat stays in chat
- analytical requests route by rung
- unsupported rung jumps are challenged before analysis

---

## Phase 4: observational workspace consolidation

### Goal
Create the one canonical rung-1 product surface.

### Workstreams active
- B (support)
- C

### Tasks
- build or rename the observational workspace
- migrate forecasting/predictive capabilities under rung 1
- replace predictive-specific handoff language
- remove predictive workspace from primary navigation
- standardize rung-1 result packaging and labels

### Exit criteria
- all rung-1 work uses one canonical surface
- predictive survives only as temporary compatibility behavior if needed

---

## Phase 5: higher-rung setup and approval

### Goal
Make higher-rung assumptions and structure explicit before execution.

### Workstreams active
- D

### Tasks
- dataset binding enforcement
- graph builder implementation
- assumption capture
- missing-data requirement tracking
- approval/signoff flow
- rung-2 vs rung-3 setup validation

### Exit criteria
- studies can be prepared honestly for rung 2 and rung 3
- no higher-rung run starts without required setup

---

## Phase 6: execution and grounded answers

### Goal
Produce rung-constrained outputs from explicit stored state.

### Workstreams active
- E

### Tasks
- implement observational run packaging
- implement higher-rung run execution
- persist identification / estimation / refutation state
- generate grounded answer packages
- render final answers from packages only

### Exit criteria
- runs persist honest rung-specific results
- final answers do not re-analyze raw data outside the package path

---

## Phase 7: legacy retirement and final UX cleanup

### Goal
Remove the old predictive-vs-causal split from the primary experience.

### Workstreams active
- F

### Tasks
- redirect or retire old predictive pages/routes
- remove leftover mixed-taxonomy copy
- update tests and docs for the final state
- archive obsolete compatibility helpers

### Exit criteria
- no primary user journey depends on the old taxonomy or old workspace split

---

# 3) Cross-document implementation map

| Product concept | V2 schema entity | Implementation owner |
| --- | --- | --- |
| study container | `analysis_studies` | Workstream A |
| question intake | `study_questions` | Workstream B |
| routing result | `analysis_classifications` | Workstream B |
| study dataset binding | `study_dataset_bindings` | Workstream D |
| higher-rung graph | `analysis_graphs`, `analysis_graph_versions` | Workstream D |
| normalized graph state | `analysis_graph_nodes`, `analysis_graph_edges` | Workstream D |
| assumptions | `analysis_assumptions` | Workstream D |
| missing data requirements | `analysis_data_requirements` | Workstream D |
| approval/signoff | `study_approvals` | Workstream D |
| study-backed run | `analysis_runs` | Workstream E |
| run datasets | `analysis_run_dataset_bindings` | Workstream E |
| identification result | `analysis_identifications` | Workstream E |
| estimands | `analysis_estimands` | Workstream E |
| estimates / observational result packages | `analysis_estimates` | Workstream E |
| refutations | `analysis_refutations` | Workstream E |
| grounded output package | `answer_packages` | Workstream E |
| user-visible grounded answer | `answers` | Workstream F |

---

# 4) Dependency rules that must not be violated

## Rule 1
Do not implement the observational workspace as a thin compatibility skin over the old predictive taxonomy.

Required before C is considered complete:
- rung-1 labels and copy are canonical
- predictive-only naming is no longer primary

## Rule 2
Do not implement higher-rung execution before higher-rung setup persistence exists.

Required before higher-rung runs:
- study dataset bindings
- graph versions
- assumptions
- approvals
- run-level focal field pinning

## Rule 3
Do not implement final answer generation before grounded answer packages exist.

Required before final answer UI:
- `answer_packages`
- `answers`

## Rule 4
Do not let ordinary chat concerns collapse the analytical schema back into conversations.

Ordinary chat is a routing outcome, not the main product object.

## Rule 5
Do not reintroduce mixed intent enums through compatibility layers.

Compatibility code may translate legacy values, but the canonical model must remain factored and rung-first.

---

# 5) File-by-file coordination plan

## Step group A: persistence layer rewrite

### Rewrite
- `apps/web/lib/app-schema.ts`

### Add or rename
- migration files for `analysis_studies` and factored classifications
- new data access helpers for studies, routing, graph setup, runs, and answer packages

---

## Step group B: new V2 domain libraries

### Add or rename
- `apps/web/lib/analysis-routing-types.ts`
- `apps/web/lib/analysis-router.ts`
- `apps/web/lib/analysis-intake.ts`
- `apps/web/lib/analysis-studies.ts`
- `apps/web/lib/causal-presupposition-guardrail.ts`
- `apps/web/lib/study-dataset-bindings.ts`
- `apps/web/lib/analysis-graphs.ts`
- `apps/web/lib/analysis-graph-validator.ts`
- `apps/web/lib/analysis-runs.ts`
- `apps/web/lib/analysis-result-package.ts`

### Deprioritize from active path
- predictive-only router types
- old causal-intent naming as the canonical interface

---

## Step group C: API layer

### Add
- `apps/web/app/api/analysis/intake/route.ts`
- `apps/web/app/api/analysis/studies/route.ts`
- `apps/web/app/api/analysis/studies/[studyId]/route.ts`
- `apps/web/app/api/analysis/studies/[studyId]/dataset-bindings/route.ts`
- `apps/web/app/api/analysis/studies/[studyId]/graphs/route.ts`
- `apps/web/app/api/analysis/graphs/[graphId]/versions/route.ts`
- `apps/web/app/api/analysis/graphs/[graphId]/approve/route.ts`
- `apps/web/app/api/analysis/runs/route.ts`
- `apps/web/app/api/analysis/runs/[runId]/route.ts`

### Compatibility-only during transition
- old predictive routes
- old causal intake routes

---

## Step group D: workspace UI

### Add or rename
- `apps/web/app/(workspace)/analysis/page.tsx`
- `apps/web/app/(workspace)/analysis/studies/[studyId]/page.tsx`
- `apps/web/app/(workspace)/analysis/studies/[studyId]/runs/[runId]/page.tsx`
- observational workspace components
- higher-rung setup components

### Deprioritize from active path
- `/predictive` as a primary nav destination
- predictive-specific planning UI as the long-term canonical flow

---

# 6) Acceptance gates by phase

## Gate A: schema gate
Must be true before intake implementation is considered stable:
- `analysis_studies` finalized
- factored classification enums finalized
- run focal-field requirements finalized
- answer-package rung constraints finalized

## Gate B: intake gate
Must be true before workspace work is considered stable:
- ordinary chat vs analytical routing works
- classifications persist before analysis begins
- unsupported rung jumps trigger clarification or reframe

## Gate C: observational gate
Must be true before higher-rung cleanup is considered stable:
- one canonical rung-1 surface exists
- predictive-only primary nav is gone or deprecated
- rung-1 labels are correct

## Gate D: higher-rung setup gate
Must be true before execution work starts:
- dataset pinning works
- graph versions persist correctly
- assumptions and approvals persist correctly
- rung-2 and rung-3 setup validation is enforced

## Gate E: execution gate
Must be true before final UX cleanup starts:
- runs persist honest rung-specific outputs
- identification failure remains durable and visible
- grounded answer packages are generated

## Gate F: release gate
Must be true before V2 is considered shippable:
- the study/workspace UX is usable
- final answers are package-grounded only
- the old predictive-vs-causal primary split is retired
- anti-overclaim safeguards pass regression coverage

---

# 7) Testing coordination plan

## Schema tests
Verify:
- table creation
- enum constraints
- one active primary dataset binding rule
- answer-package claim-label compatibility with rung

## Intake tests
Verify:
- conceptual chat stays in chat
- study creation for analytical requests
- classification persistence
- guardrail-triggered clarification

## Observational tests
Verify:
- forecasting routes to rung 1
- observational explanation routes to rung 1 by default
- rung-1 labels stay observational

## Higher-rung tests
Verify:
- intervention questions route to rung 2
- counterfactual questions route to rung 3
- non-identifiable higher-rung flows do not degrade into fake answers

## Answer tests
Verify:
- final answers consume only answer packages
- no higher-rung claim emerges from a rung-1 package
- unsupported direct-mechanism prompts are reframed before answering

---

# 8) Risks and coordination mitigations

## Risk 1: incremental drift back to old taxonomy

### Mitigation
- review all new enums and copy for mixed-taxonomy reintroduction
- reject PRs that make predictive a first-class epistemic route again

## Risk 2: observational workspace remains predictive-branded

### Mitigation
- require explicit nav and naming cleanup in Phase 4
- move forecasting under rung-1 language immediately

## Risk 3: higher-rung distinction collapses back into a single causal bucket

### Mitigation
- require separate routing, setup validation, and claim labels for rung 2 vs rung 3

## Risk 4: schema rename creates migration hesitation

### Mitigation
- accept temporary compatibility adapters, but keep docs and target schema neutral now

## Risk 5: guardrail remains prompt-only

### Mitigation
- implement it as a typed helper/module used by intake and answer-generation layers

---

# 9) Definition of implementation readiness

The coordinated implementation is ready to start when:

1. the doc set is consistent on the rung-first model
2. `analysis_studies` is accepted as the DB authority target
3. the routing contract is accepted as the only canonical routing contract
4. the predictive-only workspace is accepted as a legacy compatibility surface, not a target architecture
5. no unresolved contradictions remain across the canonical docs

---

# 10) Final coordinated implementation principle

The rebuild should be judged by one standard:

> Does this implementation make it impossible for the product’s primary path to answer a higher-rung question as if it were settled by a lower-rung workflow?

If the answer is no, the implementation is drifting away from the point of the rebuild.
