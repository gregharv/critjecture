# Critjecture Causal Intent Gate, Causal Study Workflow, and PyWhy Integration Plan

## Purpose

This document is the **implementation-ready product and execution plan** for Critjecture’s causal-first rebuild.

It is aligned to:
- `causal_v2_db_schema_spec.md` as the **canonical database and entity-model authority**

This document intentionally assumes:
- **no backward compatibility requirement**
- **no obligation to preserve the old chat/workflow model**
- a **clean-slate V2** where causal reasoning is the primary product surface

If this document conflicts with the V2 schema spec on data-model questions, the schema spec wins.

---

## Product promise

Critjecture must not answer causal or counterfactual questions by doing ordinary observational analysis and then narrating the result as if it were causal.

This rebuild exists to prevent **inductive errors**, especially:

- treating correlation as causation
- explaining “why” from patterns alone
- recommending interventions from descriptive associations
- implying counterfactual effects without a causal graph and identification strategy
- hiding missing confounders or unobserved variables inside freeform prose

The product’s causal promise is:

1. classify the question before dataset analysis begins
2. if the request is causal, create or resume a **causal study**
3. bind the study to an explicit dataset version
4. require a DAG with explicit observed, unobserved, and missing variables
5. require sign-off on assumptions
6. run PyWhy / DoWhy on the approved graph and pinned data
7. generate the final answer only from the causal result package

---

## Non-negotiable anti-inductive-error rules

### 1) No causal question may reach descriptive analysis tooling

If the intake classifier determines the question is causal or counterfactual, then the system must not:

- call descriptive data-analysis tools as the primary answer path
- let the general answering model touch the dataset directly
- produce a provisional “why” answer from correlations
- silently fall back to descriptive analytics and word the result as causal

### 2) Intent routing happens before answer generation

Do not let the same unrestricted model both:
- decide whether the question is causal
- and immediately analyze data in the same pass

The routing decision must happen first.

### 3) The DAG is the source of truth for causal assumptions

No causal run may start without:
- a pinned dataset version
- a pinned DAG version
- an explicit treatment
- an explicit outcome
- an acyclic graph
- explicit approval of the graph assumptions if org policy requires approval

### 4) Missing and unobserved variables must remain explicit

A missing confounder must never be silently collapsed into:
- a note
- a comment
- an omitted variable
- or an “assumed observed” dataset feature

### 5) Non-identifiable effects must remain non-identifiable

If identification fails, the system must store and present:
- that the effect is not identified
- why it is not identified
- what assumptions or missing data block identification

It must not substitute a descriptive summary and imply that it answers the causal question.

### 6) Final answers are constrained by the causal result package

The final LLM answer may summarize the result, but it may not invent:
- unsupported mechanisms
- unsupported causal claims
- certainty beyond the stated assumptions

---

## Canonical V2 architecture

The V2 top-level product object is a **causal study**.

A causal study owns:
- the question
- the intent classification history
- dataset bindings
- DAGs and DAG versions
- assumptions
- data requirements
- approvals
- causal runs
- result packages
- final answers

This means V2 is **not** organized around:
- conversations
- chat turns
- assistant message chains
- generic workflows
- generic workflow runs

Those are legacy concepts and should not be the center of implementation.

---

## Standardized routing contract

Use this routing contract everywhere in V2:

- `continue_descriptive`
- `open_causal_study`
- `ask_clarification`
- `blocked`

Do **not** use legacy routing labels such as:
- `continue_normal_chat`
- `open_causal_workflow`

The routing contract must be consistent with `intent_classifications.routing_decision` in `causal_v2_db_schema_spec.md`.

---

## End-to-end V2 flow

## Flow A: causal question

User asks:

> Why did conversion drop?

System behavior:

1. user submits the question to causal intake
2. backend classifies intent with no dataset access and no tools
3. backend creates or resumes a `causal_study`
4. backend creates a `study_question`
5. backend writes an `intent_classification`
6. routing decision is `open_causal_study`
7. frontend opens the study workspace
8. user selects or confirms the primary dataset
9. system seeds the DAG from the pinned dataset version’s columns
10. user adds edges, treatment, outcome, latent variables, and missing external variables
11. user signs off on assumptions
12. backend creates a `causal_run`
13. backend executes identification, estimation, and refutation
14. backend writes a `causal_answer_package`
15. final answer is generated from that package only

## Flow B: intervention question

User asks:

> What happens if we increase discount rate by 5%?

System behavior is the same as Flow A, except the treatment suggestion can be pre-filled from the question text.

## Flow C: descriptive question

User asks:

> What happened to conversion last month?

System behavior:

1. user submits the question to causal intake
2. backend classifies intent
3. routing decision is `continue_descriptive`
4. descriptive-mode handling can continue through a separate path if the product keeps one

Important:
- the causal-first rebuild does **not** need to preserve the legacy chat-first implementation for descriptive handling
- descriptive handling is secondary and must not dictate the causal architecture

---

## Implementation-ready architectural decisions

### 1) Clean-slate V2, not incremental extension

This work should be implemented as a **ground-up V2**, not as an add-on migration inside the old chat/workflow product model.

Implications:
- do not design around `conversations`
- do not design around `chat_turns`
- do not design around `workflows`
- do not add new causal tables as a thin extension on top of the legacy app model

### 2) `causal_v2_db_schema_spec.md` is the canonical entity map

This plan should be implemented using the V2 schema entities, especially:
- `causal_studies`
- `study_questions`
- `intent_classifications`
- `study_dataset_bindings`
- `causal_dags`
- `causal_dag_versions`
- `causal_dag_nodes`
- `causal_dag_edges`
- `causal_assumptions`
- `causal_data_requirements`
- `causal_approvals`
- `causal_runs`
- `causal_run_dataset_bindings`
- `causal_identifications`
- `causal_estimands`
- `causal_estimates`
- `causal_refutations`
- `causal_answer_packages`
- `causal_answers`

### 3) The primary UI surface is the causal study workspace

The main V2 workspace should list and open `causal_studies`, not conversations or workflows.

### 4) Persist both graph JSON and normalized graph structure from day one

Do not defer normalization of DAG structure.

For V2, store both:
- exact React Flow graph JSON for reproduction
- normalized nodes, edges, assumptions, and data requirements for validation, querying, and auditability

### 5) Use a dedicated causal runner if PyWhy support on Python 3.13 is incomplete

Validate the Python dependency stack early.

If PyWhy / DoWhy support on Python 3.13 is weak, use a dedicated causal runner pinned to Python 3.11 or 3.12 rather than weakening the rest of the app runtime.

---

## V2 product surfaces

### Workspace pages

Recommended V2 pages:
- `apps/web/app/(workspace)/causal/page.tsx` -> study list / landing page
- `apps/web/app/(workspace)/causal/studies/[studyId]/page.tsx` -> study workspace
- `apps/web/app/(workspace)/causal/studies/[studyId]/runs/[runId]/page.tsx` -> run detail

The study workspace should include:
- question summary
- dataset binding panel
- DAG builder
- assumption panel
- missing data requirements panel
- approval status
- run history
- final answer history

### API routes

Recommended V2 routes:
- `POST /api/causal/intake`
- `POST /api/causal/studies`
- `GET /api/causal/studies`
- `GET /api/causal/studies/[studyId]`
- `PATCH /api/causal/studies/[studyId]`
- `POST /api/causal/studies/[studyId]/dataset-bindings`
- `POST /api/causal/studies/[studyId]/dags`
- `POST /api/causal/dags/[dagId]/versions`
- `POST /api/causal/dags/[dagId]/approve`
- `POST /api/causal/runs`
- `GET /api/causal/runs/[runId]`

Do not make `/api/chat/preflight` the primary causal entrypoint in V2.

---

## Control-plane design

## A) Causal intake

### Recommended files
- `apps/web/lib/causal-intake.ts`
- `apps/web/lib/causal-intent.ts`
- `apps/web/lib/causal-intent-types.ts`
- `apps/web/lib/causal-studies.ts`
- `apps/web/app/api/causal/intake/route.ts`

### Intake responsibilities

`causal-intent-types.ts`
- define the classifier contract
- define strict JSON validation
- define normalized routing enums

`causal-intent.ts`
- build the classifier prompt
- run the classifier model with no tools
- parse JSON strictly
- normalize temporary compatibility aliases if they ever appear
- apply conservative fallback behavior

`causal-intake.ts`
- create or resume the correct `causal_study`
- create a `study_question`
- persist `intent_classifications`
- return the routing decision and study metadata

### Recommended intake response shape

```json
{
  "decision": "open_causal_study",
  "studyId": "...",
  "studyQuestionId": "...",
  "intent": {
    "is_causal": true,
    "intent_type": "causal",
    "reason": "The user asks why the outcome changed.",
    "confidence": 0.97
  },
  "suggestedDatasetIds": []
}
```

### Recommended classifier schema

```json
{
  "is_causal": true,
  "intent_type": "causal",
  "reason": "short explanation",
  "confidence": 0.9
}
```

### Allowed `intent_type` values
- `descriptive`
- `diagnostic`
- `causal`
- `counterfactual`
- `unclear`

### Recommended routing policy

- `causal` -> `open_causal_study`
- `counterfactual` -> `open_causal_study`
- `unclear` with intervention language -> `open_causal_study`
- `unclear` without intervention language -> `ask_clarification`
- `descriptive` or `diagnostic` -> `continue_descriptive`

### Fallback behavior

If classifier output is malformed:
- do not allow dataset analysis
- retry once
- if it still fails, return `ask_clarification`

That is safer than guessing.

---

## B) Study creation and dataset binding

### Recommended files
- `apps/web/lib/study-dataset-bindings.ts`
- `apps/web/app/api/causal/studies/[studyId]/dataset-bindings/route.ts`

### Required behavior

Before a DAG can be approved or a run can start:
- the study must have exactly one active `primary` dataset binding
- that primary binding must point to an exact `dataset_version`

This must align with the V2 schema rule in `study_dataset_bindings`.

### Dataset seeding rule

When a study enters DAG-authoring mode:
1. load the primary dataset version
2. load all `dataset_version_columns` for that version
3. seed DAG nodes from those columns
4. allow the user to add user-defined nodes for latent variables and external data needs

### Important boundary

Schema discovery is allowed.

What is not allowed during dataset seeding:
- correlation discovery
- feature importance scoring
- descriptive explanation of the outcome
- any attempt to answer the question before the DAG exists

---

## C) Causal study workspace and DAG builder

### Recommended files
- `apps/web/components/causal-study-shell.tsx`
- `apps/web/components/causal-dag-builder.tsx`
- `apps/web/components/causal-dag-sidebar.tsx`
- `apps/web/components/causal-dag-toolbar.tsx`
- `apps/web/components/causal-data-requirements-panel.tsx`
- `apps/web/components/causal-approval-panel.tsx`
- `apps/web/lib/causal-dags.ts`
- `apps/web/lib/causal-dag-validator.ts`

### DAG builder requirements

The DAG builder must support:
- all dataset features from the bound primary dataset version
- user-created nodes
- directed edges only
- explicit treatment selection
- explicit outcome selection
- explicit observed vs unobserved vs missing-external state
- node notes
- assumption capture
- autosave drafts
- version history
- approval/sign-off
- missing data requirement tracking

### Recommended node model

Use the node and edge structure defined in the V2 schema spec.

The UI should map directly to:
- `causal_dag_versions`
- `causal_dag_nodes`
- `causal_dag_edges`
- `causal_assumptions`
- `causal_data_requirements`

### Approval rules

Block approval unless:
- the graph is acyclic
- exactly one treatment is selected in V2.0
- at least one outcome is selected
- every dataset-backed node maps to a real `dataset_version_column`
- missing and unobserved variables are explicitly marked
- the study has an active primary dataset version pinned

### Approval statement

Recommended approval text:

> I confirm that this DAG reflects my current causal assumptions, including observed variables, unobserved variables, and any external data still needed.

---

## D) Causal execution layer

### Recommended files
- `apps/web/lib/causal-runs.ts`
- `apps/web/lib/causal-graph.ts`
- `apps/web/lib/causal-result-package.ts`
- `apps/web/lib/compute-runs.ts`
- `apps/web/app/api/causal/runs/route.ts`
- `apps/web/app/api/causal/runs/[runId]/route.ts`

### Run creation rules

A `causal_run` may only be created if:
- the study question exists
- the DAG version exists
- the required approval exists if org policy requires it
- the run is pinned to an exact primary dataset version
- treatment and outcome are pinned on the run

### Execution pipeline

1. load the `causal_run`
2. load the pinned dataset version(s)
3. load the exact DAG version
4. map nodes to observed columns and explicit unobserved variables
5. convert the graph into a DoWhy / PyWhy-compatible structure
6. identify estimands
7. if identification fails, write a non-identifiable result and stop estimation
8. if identification succeeds, run estimation
9. run refutation checks
10. build the `causal_answer_package`
11. generate the final answer from that package only

### Estimator policy

Support a narrow set first:
- backdoor linear regression adjustment
- backdoor propensity-score adjustment
- doubly robust estimation if stable
- IV or frontdoor only after explicit validation and tests

Do not start with a broad automatic-estimator strategy.

### Refutation policy

Run where possible:
- placebo treatment test
- random common cause check
- subset / bootstrap robustness
- sensitivity notes for unobserved confounding where supported

---

## E) Causal result package and answer generation

### Result package requirements

The result package must contain, at minimum:
- study id
- study question id
- run id
- dataset version id(s)
- DAG version id
- treatment
- outcome
- identification status
- estimand metadata
- estimate metadata if available
- refutation results
- explicit assumptions
- explicit limitations
- recommended next steps if not identifiable

### Final answer rule

The final answer generator must not receive descriptive analysis tools or direct dataset access.

It should receive only:
- the question
- the study context needed for phrasing
- the causal answer package

### Required answer behavior

The final answer must:
- distinguish observed facts from estimated effects
- cite assumptions
- cite limitations
- say clearly when the effect is not identifiable
- avoid speculative mechanism claims

---

## API contract summary

## 1) `POST /api/causal/intake`

### Request

```json
{
  "message": "Why did conversion rate drop?",
  "studyId": null
}
```

### Response: causal

```json
{
  "decision": "open_causal_study",
  "studyId": "study_123",
  "studyQuestionId": "question_456",
  "intent": {
    "is_causal": true,
    "intent_type": "causal",
    "reason": "The user asks for causal explanation.",
    "confidence": 0.97
  },
  "suggestedDatasetIds": []
}
```

### Response: descriptive

```json
{
  "decision": "continue_descriptive",
  "intent": {
    "is_causal": false,
    "intent_type": "descriptive",
    "reason": "The user asks what happened, not why.",
    "confidence": 0.98
  }
}
```

### Response: clarification needed

```json
{
  "decision": "ask_clarification",
  "question": "Do you want a descriptive summary of what changed, or a causal analysis of why it changed?"
}
```

## 2) `POST /api/causal/studies/[studyId]/dataset-bindings`
Bind or update the primary dataset version for the study.

## 3) `POST /api/causal/studies/[studyId]/dags`
Create a logical DAG for the study.

## 4) `POST /api/causal/dags/[dagId]/versions`
Persist a new DAG version.

## 5) `POST /api/causal/dags/[dagId]/approve`
Validate and approve a DAG version.

## 6) `POST /api/causal/runs`
Start a run from an approved DAG version and pinned dataset version.

## 7) `GET /api/causal/runs/[runId]`
Return run status and the final causal result package.

---

## Database alignment notes

This implementation plan assumes the V2 schema described in `causal_v2_db_schema_spec.md`, including:
- `causal_studies` as the top-level saved object
- no `conversation_id` or `chat_turn_id` on causal runs
- a clean-slate baseline migration
- archival, not migration, for old chat/workflow history
- normalized DAG nodes and edges from day one

This plan does **not** assume:
- `apps/web/drizzle/0018_causal_dags_and_runs.sql`
- incremental extension of the old app schema
- chat-first routing contracts

---

## Suggested implementation phases

## Phase 1: V2 schema and intake foundation

### Add / rewrite
- `apps/web/lib/app-schema.ts` -> rewrite to match V2 schema spec
- baseline migration for V2 schema
- `apps/web/lib/causal-intent-types.ts`
- `apps/web/lib/causal-intent.ts`
- `apps/web/lib/causal-intake.ts`
- `apps/web/lib/causal-studies.ts`
- `apps/web/app/api/causal/intake/route.ts`

### Deliverable
A causal question creates a study/question/classification record and routes into the causal workspace.

---

## Phase 2: study workspace and dataset binding

### Add
- study list page
- study workspace page
- dataset binding APIs and UI
- dataset-version-backed DAG seeding

### Deliverable
The user can open a study and pin a primary dataset version before DAG work begins.

---

## Phase 3: DAG authoring and approval

### Add
- DAG builder components
- DAG validation
- assumptions UI
- missing data requirements UI
- approval flow

### Deliverable
The user can create versioned, approvable DAGs backed by normalized graph data.

---

## Phase 4: PyWhy runner and causal execution

### Add
- causal run creation
- compute run integration
- identification / estimation / refutation pipeline
- result package generation

### Deliverable
Approved studies can produce grounded causal runs.

---

## Phase 5: grounded final answer generation

### Add
- causal answer package consumer
- answer-generation prompt/template
- study run detail UI

### Deliverable
Final answers cite assumptions, estimands, limitations, and refutations, and avoid inductive overclaiming.

---

## Testing plan

## Unit tests

### Intent classification
- “what happened?” -> `continue_descriptive`
- “why did it happen?” -> `open_causal_study`
- “what happens if we change X?” -> `open_causal_study`
- malformed classifier output -> safe fallback

### Study binding rules
- cannot approve DAG without one active primary dataset binding
- cannot run without pinned dataset version

### DAG validation
- cycle detection
- missing treatment
- missing outcome
- latent node handling
- missing external variable handling

### Causal packaging
- identifiable result serialization
- non-identifiable result serialization

## Integration tests

- intake creates `causal_study`, `study_question`, and `intent_classification`
- causal intake does not invoke descriptive analysis tools
- DAG approval stores exact versioned graph state
- causal run uses the exact approved DAG version and dataset version
- final answer generation uses only the causal result package

## E2E tests

1. ask a causal question
   - verify study workspace opens
   - verify no descriptive answer is produced first
2. bind a dataset version and create a DAG
   - verify dataset columns appear as nodes
3. add missing variables and approve
   - verify approval is recorded
4. run causal analysis
   - verify run status advances correctly
5. run a non-identifiable DAG
   - verify the UI says the effect is not identified
   - verify no fake causal answer is produced

---

## Acceptance criteria

This plan is ready to implement when all of the following are true:

1. the primary product object is `causal_studies`
2. causal intake creates study/question/classification records
3. no causal question reaches descriptive analysis tooling before routing
4. studies must bind an exact primary dataset version before approval and run creation
5. DAGs are versioned and stored both as graph JSON and normalized rows
6. missing and unobserved variables remain explicit
7. runs persist identification, estimands, estimates, and refutations separately
8. final answers are generated from `causal_answer_packages`
9. the old chat/workflow model is not part of the active implementation path
10. non-identifiable effects remain non-identifiable in both data and UI

---

## Final implementation principle

If one rule governs the entire rebuild, it should be this:

> **Never let the product answer a causal question unless causal structure, assumptions, data versioning, and identification have been made explicit and stored durably.**

That is how Critjecture uses DoWhy / PyWhy for their actual purpose here: preventing inductive errors rather than decorating them.
