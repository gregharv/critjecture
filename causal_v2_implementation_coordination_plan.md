# Critjecture Causal V2 Implementation Coordination Plan

## Purpose

This document coordinates the implementation of:

- `causal_guardrail_implementation_plan.md`
- `causal_v2_db_schema_spec.md`

It turns those two documents into one execution sequence so the rebuild can happen without architectural drift.

This plan assumes:
- **clean-slate V2**
- **no backward compatibility requirement**
- **causal analysis is the main product offering**
- the old chat/workflow model is **legacy and archival only**

---

## Canonical authority split

To avoid conflicting implementation decisions, use this authority model.

### `causal_v2_db_schema_spec.md` owns
- entity model
- table definitions
- enums
- keys and indexes
- pointer strategy
- archival/removal of V1 tables
- DB invariants
- baseline migration posture

### `causal_guardrail_implementation_plan.md` owns
- product flow
- routing behavior
- intake behavior
- study workspace behavior
- DAG authoring flow
- causal execution flow
- final answer generation flow
- anti-inductive-error operating rules

### This coordination plan owns
- phase order
- workstream dependencies
- implementation handoff points
- sequencing constraints
- definition of done across docs
- what must be built together vs independently

If the two source docs conflict:
1. database/entity questions -> `causal_v2_db_schema_spec.md`
2. product/flow/routing questions -> `causal_guardrail_implementation_plan.md`
3. sequencing questions -> this file

---

## Core implementation principle

The rebuild must not accidentally recreate the old architecture under new names.

That means implementation must proceed in this order:

1. establish the V2 schema and study-centered domain model
2. establish causal intake and routing against that model
3. establish study workspace and dataset binding
4. establish DAG authoring and approval
5. establish causal execution and answer packaging
6. only then add final answer generation and broader UX polish

Do **not** start from the old chat shell and “wire in” causal behavior as a side path.

---

## What must be removed from the active path

Before or during V2 rollout, the following V1 concepts must be treated as non-authoritative for new product work:

- `conversations`
- `chat_turns`
- `tool_calls`
- `assistant_messages`
- `analysis_results`
- all `workflow_*` tables
- retrieval tables tied to the old chat model

The implementation may keep old code temporarily during the transition, but:
- no new V2 route should depend on those entities
- no new causal feature should persist into those tables
- no new UI should present them as the main product surface

---

# 1) Coordinated workstreams

Implement V2 through six coordinated workstreams.

## Workstream A: schema and persistence

### Scope
Build the DB foundation defined in `causal_v2_db_schema_spec.md`.

### Owns
- V2 `app-schema.ts` rewrite
- baseline migration
- backfill/import scripts for foundational records
- soft-pointer implementation
- V1 archival approach

### Inputs
- `causal_v2_db_schema_spec.md`

### Outputs
- V2 schema code
- V2 baseline SQL migration
- DB import/backfill scripts
- schema validation notes

### Blocking dependencies
None. This is the first workstream.

---

## Workstream B: causal intake and routing

### Scope
Implement question intake, intent classification, and routing into causal studies.

### Owns
- `POST /api/causal/intake`
- classifier contract
- routing enum contract
- creation of `causal_studies`, `study_questions`, `intent_classifications`

### Inputs
- schema from Workstream A
- routing/product rules from `causal_guardrail_implementation_plan.md`

### Outputs
- intake APIs
- intake service layer
- routing contract used by frontend

### Blocking dependencies
- Workstream A must define tables and enums first

---

## Workstream C: dataset registry and study binding

### Scope
Implement dataset selection, dataset-version pinning, and study-to-dataset binding.

### Owns
- dataset read APIs for V2
- dataset binding APIs
- primary dataset binding enforcement
- dataset-version-backed DAG seeding inputs

### Inputs
- schema from Workstream A
- intake-created studies from Workstream B

### Outputs
- study dataset binding services
- dataset selection UI data contract
- dataset column loading for DAG seeding

### Blocking dependencies
- Workstream A
- partial Workstream B

---

## Workstream D: DAG authoring and approval

### Scope
Implement the study workspace, normalized DAG persistence, assumptions, missing data requirements, and approvals.

### Owns
- causal study workspace shell
- DAG builder UI
- DAG version persistence
- normalized nodes/edges write path
- assumptions UI
- data requirements UI
- DAG validation
- approval workflow

### Inputs
- schema from Workstream A
- study objects from Workstream B
- dataset bindings and dataset columns from Workstream C

### Outputs
- DAG CRUD and versioning APIs
- approval APIs
- UI for graph authoring and signoff

### Blocking dependencies
- Workstream A
- Workstream B
- Workstream C

---

## Workstream E: causal execution and answer packaging

### Scope
Implement causal runs, compute runs, identification, estimation, refutation, and answer package generation.

### Owns
- `causal_runs`
- `causal_run_dataset_bindings`
- `compute_runs`
- PyWhy / DoWhy runner integration
- result packaging
- non-identifiable flow

### Inputs
- approved DAG version from Workstream D
- pinned dataset version from Workstream C
- schema from Workstream A

### Outputs
- causal run APIs
- runner orchestration
- structured result package persistence

### Blocking dependencies
- Workstream A
- Workstream C
- Workstream D

---

## Workstream F: grounded answer generation and V2 UX completion

### Scope
Implement final causal answer generation and finish the main V2 workspace flows.

### Owns
- final answer prompt/template
- run detail screens
- answer history screens
- study list page
- study detail page polish
- operator-facing status views if needed

### Inputs
- causal answer packages from Workstream E
- study workspace state from Workstream D

### Outputs
- grounded final answer generation
- end-to-end usable study workflow

### Blocking dependencies
- Workstream E
- most of Workstream D

---

# 2) Phase-by-phase implementation order

Each phase coordinates multiple workstreams.

## Phase 0: implementation lock and architecture freeze

### Goal
Freeze the implementation contract before coding starts.

### Required decisions to confirm
- V2 is clean-slate and not backward-compatible
- `causal_studies` is the top-level product object
- routing contract is fixed:
  - `continue_descriptive`
  - `open_causal_study`
  - `ask_clarification`
  - `blocked`
- V1 tables are legacy/archive only
- `current_*` and `active_version_id` are soft pointers in V2.0
- reference-document module is optional for first ship

### Deliverables
- reviewed and approved versions of the three docs:
  - `causal_guardrail_implementation_plan.md`
  - `causal_v2_db_schema_spec.md`
  - `causal_v2_implementation_coordination_plan.md`

### Exit criteria
- no unresolved architectural contradictions remain across the docs

---

## Phase 1: schema-first foundation

### Goal
Establish the persistent V2 model before product code.

### Workstreams active
- A only

### Tasks
- rewrite `apps/web/lib/app-schema.ts` around the V2 schema spec
- create V2 baseline migration
- decide exact archival format for V1 state
- write import/backfill scripts for:
  - users
  - organizations
  - memberships
  - workspace plans / billing if retained
  - data connections
  - data assets -> datasets
  - data asset versions -> dataset versions
  - column metadata -> dataset version columns
- optionally defer reference documents if not needed for first ship

### Coordination notes
Do not build routes against temporary schema names. Get canonical table names stable first.

### Exit criteria
- V2 schema compiles cleanly
- migration plan is reviewed
- import scope is defined
- no product route still assumes `conversations` or `workflows` as canonical

---

## Phase 2: causal intake and study creation

### Goal
Make causal intake the entrypoint to the new system.

### Workstreams active
- A (support)
- B

### Tasks
- implement classifier contract and JSON validation
- implement `/api/causal/intake`
- create `causal_studies`, `study_questions`, `intent_classifications`
- define study resume vs create behavior
- define how descriptive requests are returned to a secondary path
- add initial V2 workspace landing page for studies

### Coordination notes
The intake route should not depend on old chat routes.

### Exit criteria
- a causal question creates or resumes a study
- the system persists classification results before analysis begins
- routing contract is stable and used by frontend consumers

---

## Phase 3: dataset binding and schema-backed DAG seeding

### Goal
Bind studies to exact dataset versions and enable DAG seeding from durable column metadata.

### Workstreams active
- A (support)
- B (support)
- C

### Tasks
- implement study dataset binding services and APIs
- enforce exactly one active primary dataset binding for runnable studies
- expose dataset version and column metadata to the study workspace
- implement schema seeding contract for DAG builder
- block DAG approval if no primary dataset version is pinned

### Coordination notes
This phase is where the anti-inductive boundary matters: schema discovery is allowed; causal/descriptive explanation is not.

### Exit criteria
- study can pin exact primary dataset version
- dataset columns can seed the DAG builder
- approval/run creation blockers are enforced

---

## Phase 4: DAG authoring, assumptions, and approval

### Goal
Make the causal graph the explicit center of user interaction.

### Workstreams active
- C (support)
- D

### Tasks
- implement study workspace shell
- implement React Flow DAG builder
- implement DAG version creation
- persist graph JSON and normalized nodes/edges
- persist assumptions and missing data requirements
- validate DAG acyclicity and treatment/outcome rules
- implement approval/signoff flow

### Coordination notes
This phase must use the normalized schema from day one, not graph-JSON-only shortcuts.

### Exit criteria
- user can create versioned DAGs
- user can mark missing/unobserved variables explicitly
- user can approve a DAG version
- approved DAG version is auditable and queryable

---

## Phase 5: causal execution pipeline

### Goal
Run identification, estimation, and refutation from approved DAGs and pinned datasets.

### Workstreams active
- D (support)
- E

### Tasks
- implement `causal_runs`
- implement run-level dataset pinning
- implement `compute_runs`
- validate Python environment strategy
- integrate PyWhy / DoWhy runner
- implement identification-first execution logic
- stop estimation when effect is not identified
- persist estimands, estimates, refutations, and artifacts
- build `causal_answer_packages`

### Coordination notes
Do not start with open-ended estimator automation. Use the narrow estimator set already defined in the guardrail plan.

### Exit criteria
- approved studies can produce real causal runs
- non-identifiable effects are stored correctly
- run outputs are persisted in first-class tables

---

## Phase 6: grounded final answer generation and V2 completion

### Goal
Finish the user-facing product loop with grounded answers and run history.

### Workstreams active
- E (support)
- F

### Tasks
- implement final answer generation from `causal_answer_packages`
- build run detail UI
- build answer history UI
- surface assumptions, limitations, and refutations in the UI
- verify no final answer path has direct dataset analysis access
- finalize study list and study detail UX

### Coordination notes
This phase is complete only when final answers are constrained by the stored causal result package, not fresh dataset analysis.

### Exit criteria
- user sees grounded final causal answer
- answer cites assumptions and limitations
- non-identifiable state is shown cleanly and honestly

---

# 3) Cross-document implementation map

This section maps the major concepts from the guardrail plan to the schema spec.

| Guardrail concept | V2 schema entity | Implementation owner |
| --- | --- | --- |
| causal intake | `causal_studies`, `study_questions`, `intent_classifications` | Workstream B |
| dataset selection | `study_dataset_bindings`, `datasets`, `dataset_versions` | Workstream C |
| DAG builder | `causal_dags`, `causal_dag_versions` | Workstream D |
| observed/unobserved variables | `causal_dag_nodes` | Workstream D |
| graph edges | `causal_dag_edges` | Workstream D |
| assumptions | `causal_assumptions` | Workstream D |
| missing external data | `causal_data_requirements` | Workstream D |
| sign-off | `causal_approvals` | Workstream D |
| causal run | `causal_runs` | Workstream E |
| pinned run datasets | `causal_run_dataset_bindings` | Workstream E |
| identification output | `causal_identifications` | Workstream E |
| estimands | `causal_estimands` | Workstream E |
| estimates | `causal_estimates` | Workstream E |
| refutations | `causal_refutations` | Workstream E |
| execution envelope | `compute_runs`, `run_artifacts` | Workstream E |
| final answer package | `causal_answer_packages` | Workstream E |
| grounded final answer | `causal_answers` | Workstream F |

---

# 4) Dependency rules that must not be violated

## Rule 1
Do not implement the DAG builder against ad hoc JSON-only persistence.

Required before DAG UI completion:
- `causal_dag_versions`
- `causal_dag_nodes`
- `causal_dag_edges`
- `causal_assumptions`
- `causal_data_requirements`

## Rule 2
Do not implement run execution before run-level pinning exists.

Required before causal run execution:
- `causal_runs.primary_dataset_version_id`
- `causal_runs.treatment_node_key`
- `causal_runs.outcome_node_key`
- `causal_run_dataset_bindings`

## Rule 3
Do not implement final answer generation before answer packaging exists.

Required before final answer UI:
- `causal_answer_packages`
- `causal_answers`

## Rule 4
Do not let descriptive-mode concerns pull V2 back into chat-first design.

Descriptive handling is secondary. It must not dictate the V2 domain model.

## Rule 5
Do not rely on current pointers for audit correctness.

`current_*` and `active_version_id` are convenience pointers only.
Use versioned/run tables for anything audit-critical.

---

# 5) File-by-file coordination plan

This is the order in which the codebase should be reshaped.

## Step group A: persistence layer rewrite

### Rewrite
- `apps/web/lib/app-schema.ts`

### Add
- new V2 migration file(s)
- import/backfill scripts
- any new data access helpers for studies, datasets, DAGs, runs

### Freeze / deprecate
- old chat/workflow schema usage in active codepaths

---

## Step group B: new V2 domain libraries

### Add
- `apps/web/lib/causal-intake.ts`
- `apps/web/lib/causal-intent.ts`
- `apps/web/lib/causal-intent-types.ts`
- `apps/web/lib/causal-studies.ts`
- `apps/web/lib/study-dataset-bindings.ts`
- `apps/web/lib/causal-dags.ts`
- `apps/web/lib/causal-dag-validator.ts`
- `apps/web/lib/causal-runs.ts`
- `apps/web/lib/causal-graph.ts`
- `apps/web/lib/compute-runs.ts`
- `apps/web/lib/causal-result-package.ts`

---

## Step group C: API layer

### Add
- `apps/web/app/api/causal/intake/route.ts`
- `apps/web/app/api/causal/studies/route.ts`
- `apps/web/app/api/causal/studies/[studyId]/route.ts`
- `apps/web/app/api/causal/studies/[studyId]/dataset-bindings/route.ts`
- `apps/web/app/api/causal/studies/[studyId]/dags/route.ts`
- `apps/web/app/api/causal/dags/[dagId]/versions/route.ts`
- `apps/web/app/api/causal/dags/[dagId]/approve/route.ts`
- `apps/web/app/api/causal/runs/route.ts`
- `apps/web/app/api/causal/runs/[runId]/route.ts`

### Deprioritize from active path
- `apps/web/app/api/chat/*`
- `apps/web/app/api/workflows/*`

Those can remain temporarily in the codebase, but not as the primary V2 path.

---

## Step group D: workspace UI

### Add
- `apps/web/app/(workspace)/causal/page.tsx`
- `apps/web/app/(workspace)/causal/studies/[studyId]/page.tsx`
- `apps/web/app/(workspace)/causal/studies/[studyId]/runs/[runId]/page.tsx`
- study list and study workspace components
- DAG builder components
- assumptions/data-requirements/approval panels

### Deprioritize from active path
- old chat page as the primary product landing surface
- old workflows page as the primary product management surface

---

## Step group E: execution environment

### Add / decide
- causal runner integration approach
- dependency validation for PyWhy / DoWhy
- `compute_runs` orchestration
- artifact storage integration

### Keep if reusable
- existing sandbox supervisor mechanics, if suitable

### But rename conceptually
Execution should be treated as `compute_runs`, not chat-driven sandbox runs.

---

# 6) Acceptance gates by phase

## Gate A: schema gate
Must be true before intake implementation is considered stable:
- V2 schema finalized
- pointer strategy finalized
- run pinning fields finalized
- primary dataset binding rule finalized

## Gate B: intake gate
Must be true before workspace development is considered stable:
- intake creates study/question/classification
- routing enum stable
- no causal request reaches descriptive analysis tooling

## Gate C: study binding gate
Must be true before DAG approval work is considered stable:
- one active primary dataset binding enforced
- dataset version pinned
- dataset columns available for seeding

## Gate D: DAG gate
Must be true before causal execution work starts:
- DAG versions persist correctly
- normalized nodes/edges persist correctly
- approval flow works
- missing/unobserved variables remain explicit

## Gate E: execution gate
Must be true before answer-generation work starts:
- run creation validates pinned dataset + approved DAG
- non-identifiable path works
- estimands/estimates/refutations persist correctly
- answer package is generated

## Gate F: release gate
Must be true before V2 is considered shippable:
- study list/workspace UX is usable
- final answers are grounded in packages only
- V1 chat/workflow model is not part of active implementation path
- anti-inductive safeguards pass test coverage

---

# 7) Testing coordination plan

## Schema tests
Verify:
- table creation
- enum constraints
- unique constraints
- partial unique rule for one active primary dataset binding if implemented at DB layer
- pointer fields behave as intended

## Intake tests
Verify:
- study creation
- question creation
- classification persistence
- routing contract
- malformed classifier fallback

## Dataset binding tests
Verify:
- cannot approve DAG without pinned primary dataset version
- cannot run without pinned primary dataset version
- only one active primary binding exists

## DAG tests
Verify:
- version creation
- normalized graph persistence
- acyclicity validation
- explicit missing/unobserved variable handling
- approval persistence

## Execution tests
Verify:
- causal run creation uses exact approved DAG version
- causal run uses exact pinned dataset version
- non-identifiable path prevents fake estimate generation
- estimands, estimates, refutations persist correctly

## Answer tests
Verify:
- final answer consumes only `causal_answer_packages`
- no descriptive re-analysis tools are available during final answer generation
- answer text distinguishes assumptions, effects, and limitations

## E2E tests
Verify:
1. causal intake -> study opens
2. dataset binding -> DAG seeds from columns
3. DAG approval -> approval stored
4. causal run -> results package created
5. non-identifiable run -> honest blocked answer

---

# 8) Risks and coordination mitigations

## Risk 1: incremental implementation drift
Teams may try to reuse old chat/workflow abstractions for speed.

### Mitigation
- require all new V2 code to anchor on `causal_studies`
- review PRs for any dependency on `conversations` or `workflows`

## Risk 2: JSON-only DAG shortcuts
Graph JSON may be easier initially than normalized graph persistence.

### Mitigation
- treat normalized persistence as required for Phase 4 completion

## Risk 3: weak run auditability
If treatment/outcome or dataset version are only implicit in the DAG, audits become fragile.

### Mitigation
- pin them explicitly on `causal_runs`
- pin datasets again in `causal_run_dataset_bindings`

## Risk 4: execution environment delays
PyWhy dependency friction may block the runner.

### Mitigation
- validate Python support early in Phase 1/2
- split runner environment if needed

## Risk 5: descriptive-mode scope creep
Descriptive questions may tempt the team to keep chat-first architecture central.

### Mitigation
- keep descriptive handling secondary
- do not let descriptive UX decide the V2 schema or route design

---

# 9) Definition of implementation readiness

The coordinated implementation is ready to start when:

1. `causal_v2_db_schema_spec.md` is accepted as the DB authority
2. `causal_guardrail_implementation_plan.md` is accepted as the flow authority
3. this coordination plan is accepted as the sequencing authority
4. no unresolved contradictions remain across the three docs
5. the team agrees to build V2 around `causal_studies`, not chat/workflow records

---

# 10) Final coordinated implementation principle

The rebuild should be judged by one standard:

> **Does this implementation make causal claims impossible to produce without explicit study state, explicit data versioning, explicit causal structure, explicit assumptions, and explicit identification?**

If the answer is no, the implementation is drifting away from the purpose of the rebuild.
