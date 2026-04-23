# Critjecture Rung-First Analysis Intake, Study Workflow, and Inference Guardrail Implementation Plan

## Purpose

This document is the implementation-ready product and execution plan for Critjecture’s **rung-first analytical rebuild**.

It is aligned to:
- `analysis_routing_decision_tree.md` as the canonical routing and claim-label authority
- `causal_presupposition_guardrail.md` as the canonical unsupported-rung-jump authority
- `causal_v2_db_schema_spec.md` as the canonical schema and entity-model authority

This document assumes:
- **no backward compatibility requirement** for primary V2 architecture
- **ordinary chat and analytical workflow are separate control-plane decisions**
- **rung 1, rung 2, and rung 3 are distinct epistemic modes**
- **all rung-1 work belongs to one observational-analysis product surface**

If this document conflicts with the schema spec on data-model questions, the schema spec wins.

---

## Product promise

Critjecture must not answer a higher-rung question with lower-rung evidence merely because the user phrased the request that way.

This rebuild exists to prevent the most important assistant failures:

- narrating correlation as intervention effect
- narrating observational patterns as established direct mechanisms
- narrating an observed outcome as if actual cause were already known
- treating forecasting as if it were a separate epistemic rung
- letting a diagnostic path claim stronger support than the workflow warranted

The product promise is:

1. decide first whether the request is ordinary chat or dataset-backed analysis
2. if it is analytical, classify the **minimum required Pearl rung** before analysis begins
3. classify **task form** separately from rung
4. detect any unsupported causal presupposition separately from both
5. route the request into:
   - ordinary chat
   - rung-1 observational analysis
   - rung-2 interventional study
   - rung-3 counterfactual study
6. constrain all final answers to the rung actually executed

---

## Non-negotiable anti-overclaim rules

### 1) No higher-rung answer from a lower-rung workflow

If the router determines a question requires rung 2 or rung 3, the system must not:
- answer it from ordinary chat as if conceptually settled
- answer it from rung-1 observational analysis
- narrate observational contributors as intervention effects
- narrate an observational story as an actual-cause judgment

### 2) Routing happens before dataset-backed answer generation

The same unrestricted assistant pass must not both:
- decide the required rung
- and then immediately answer the analytical question from data

Routing and guardrail checks happen first.

### 3) Task form is not a rung

The system must not treat:
- `predictive`
- `diagnostic`
- `associational`

as the primary epistemic categories.

Those are task forms or lower-level workflow flavors, not the main classification layer.

### 4) Unsupported presuppositions stay explicit

If the user is trying to pull a higher-rung answer out of a lower-rung setup, the system must:
- say so plainly
- reframe or clarify
- escalate only when the user explicitly wants the higher-rung study flow

### 5) Final answers are constrained by rung-specific result packages

The final answer generator may summarize the result, but it may not invent:
- unsupported mechanisms
- unsupported intervention claims
- unsupported actual-cause claims
- certainty beyond the stored assumptions and limitations

---

## Canonical V2 architecture

The V2 top-level product object is an **analysis study**.

An analysis study owns:
- the user’s analytical question
- routing/classification history
- dataset bindings
- observational analysis state where relevant
- graph and assumption state for higher-rung work
- approvals
- runs
- result packages
- final answers

This means V2 is **not** organized around:
- conversations as the primary object
- predictive-only workspaces as separate epistemic product surfaces
- generic workflow objects as the main analysis container

---

## Standardized routing contract

Use this routing contract everywhere in V2:

- `continue_chat`
- `open_rung1_analysis`
- `open_rung2_study`
- `open_rung3_study`
- `ask_clarification`
- `blocked`

Do **not** use legacy routing labels such as:
- `continue_descriptive`
- `open_predictive_analysis`
- `open_causal_study`

---

## End-to-end V2 flows

## Flow A: ordinary conceptual chat

User asks:

> What is Pearl’s ladder of causation?

System behavior:
1. classify as `ordinary_chat`
2. route to `continue_chat`
3. answer conceptually in normal chat
4. do not open any analytical workspace

## Flow B: rung-1 observational analysis

User asks:

> Forecast next month’s churn.

System behavior:
1. classify as analytical
2. classify required rung as `rung_1_observational`
3. classify task form as `predict`
4. if no guardrail issue exists, route to `open_rung1_analysis`
5. execute observational forecasting/modeling workflow
6. return a rung-1 claim label such as `OBSERVATIONAL FORECAST`

## Flow C: rung-1 observational explanation

User asks:

> Why did churn spike in March?

System behavior:
1. classify as analytical
2. default to `rung_1_observational`
3. classify task form as `explain`
4. run observational decomposition first
5. produce observational contributors or explanatory hypotheses only
6. escalate only if the user explicitly pivots to intervention or counterfactual questions

## Flow D: rung-2 intervention question

User asks:

> What happens if we cut price by 10%?

System behavior:
1. classify as analytical
2. classify required rung as `rung_2_interventional`
3. route to `open_rung2_study`
4. require intervention, outcome, unit, horizon, and assumptions
5. run identification, estimation, and refutation only after setup is explicit
6. generate the final answer from the rung-2 result package only

## Flow E: rung-3 counterfactual / actual-cause question

User asks:

> Would churn have been lower if we had not changed onboarding?

System behavior:
1. classify as analytical
2. classify required rung as `rung_3_counterfactual`
3. route to `open_rung3_study`
4. require factual case, alternative state, unit/case specificity, and structural assumptions
5. run counterfactual reasoning workflow only after setup is explicit
6. generate the final answer from the rung-3 result package only

## Flow F: unsupported causal presupposition

User asks:

> We observed churn rose after onboarding changed; what mechanism caused it?

System behavior:
1. classify as analytical
2. detect `unsupported_direct_mechanism`
3. do **not** answer the direct mechanism claim as if established
4. ask whether the user wants:
   - a careful observational explanation / hypotheses only, or
   - a higher-rung study setup
5. continue only after that clarification

---

## Implementation-ready architectural decisions

### 1) Clean-slate V2, not incremental extension

This work should be implemented as a **ground-up V2**, not as a thin extension of the old chat/predictive/causal split.

### 2) `analysis_studies` is the primary saved object

The primary workspace should list and open studies, not predictive runs or old causal-study containers.

### 3) Rung 1 is a first-class product surface

Rung-1 observational work must be treated as a coherent analysis surface that includes:
- description
- association
- forecasting
- observational explanation

### 4) Rung 2 and rung 3 share infrastructure but remain distinct

Do not collapse intervention questions and counterfactual/actual-cause questions into one undifferentiated causal bucket in routing or result labeling.

### 5) Guardrail handling is centralized

Unsupported rung jumps should be handled in a centralized helper/module used by intake, prompts, clarification logic, and result labeling.

---

## Product surfaces

## Workspace pages

Recommended V2 pages:
- `apps/web/app/(workspace)/analysis/page.tsx` -> study list / landing page
- `apps/web/app/(workspace)/analysis/studies/[studyId]/page.tsx` -> study workspace
- `apps/web/app/(workspace)/analysis/studies/[studyId]/runs/[runId]/page.tsx` -> run detail

Optional internal subviews inside the study workspace:
- `rung-1 observational analysis`
- `rung-2 study setup`
- `rung-3 study setup`

The study workspace should include:
- question summary
- routed rung and task form
- dataset binding panel
- observational analysis panel for rung 1
- graph/assumption panels for rung 2 and rung 3
- approval status
- run history
- answer history

---

## API route direction

Recommended V2 routes:
- `POST /api/analysis/intake`
- `POST /api/analysis/studies`
- `GET /api/analysis/studies`
- `GET /api/analysis/studies/[studyId]`
- `PATCH /api/analysis/studies/[studyId]`
- `POST /api/analysis/studies/[studyId]/dataset-bindings`
- `POST /api/analysis/studies/[studyId]/graphs`
- `POST /api/analysis/graphs/[graphId]/versions`
- `POST /api/analysis/graphs/[graphId]/approve`
- `POST /api/analysis/runs`
- `GET /api/analysis/runs/[runId]`

Compatibility shims may temporarily remain for old predictive/causal endpoints, but they are not the target architecture.

---

## Control-plane design

## A) Intake and routing

### Recommended files
- `apps/web/lib/analysis-routing-types.ts`
- `apps/web/lib/analysis-router.ts`
- `apps/web/lib/analysis-intake.ts`
- `apps/web/lib/analysis-studies.ts`
- `apps/web/lib/causal-presupposition-guardrail.ts`
- `apps/web/app/api/analysis/intake/route.ts`

### Intake responsibilities

`analysis-routing-types.ts`
- define analytical mode, rung, task form, guardrail, and routing enums
- define strict JSON validation
- define normalized routing contract

`analysis-router.ts`
- build classifier prompt
- classify ordinary chat vs analytical work
- classify required rung
- classify task form
- classify guardrail flag
- parse JSON strictly
- apply conservative fallback behavior

`analysis-intake.ts`
- create or resume the correct study when analytical routing requires one
- persist question and classification state
- return the routing decision and study metadata

### Recommended intake response shape

```json
{
  "decision": "open_rung2_study",
  "studyId": "...",
  "studyQuestionId": "...",
  "classification": {
    "is_analytical": true,
    "required_rung": "rung_2_interventional",
    "task_form": "advise",
    "guardrail_flag": "none",
    "reason": "The user asks what would happen if a pricing change were made.",
    "confidence": 0.96
  },
  "suggestedDatasetIds": []
}
```

### Recommended classifier schema

```json
{
  "is_analytical": true,
  "required_rung": "rung_1_observational",
  "task_form": "predict",
  "guardrail_flag": "none",
  "reason": "The user wants a forecast from observed patterns.",
  "confidence": 0.92,
  "routing_decision": "open_rung1_analysis"
}
```

### Fallback behavior

If classifier output is malformed:
- do not allow dataset-backed analysis to start
- retry once
- if it still fails, return `ask_clarification`

---

## B) Dataset binding

### Recommended files
- `apps/web/lib/study-dataset-bindings.ts`
- `apps/web/app/api/analysis/studies/[studyId]/dataset-bindings/route.ts`

### Required behavior

Before higher-rung approval or a runnable study:
- the study must have exactly one active `primary` dataset binding
- that binding must point to an exact dataset version

Rung 1 may begin with lighter-weight observational setup, but any persisted study-backed analytical run should still pin dataset version explicitly.

---

## C) Rung-1 observational analysis surface

### Recommended files
- `apps/web/components/observational-analysis-shell.tsx`
- `apps/web/lib/observational-analysis.ts`
- `apps/web/lib/observational-result-package.ts`

### Responsibilities

This surface should support:
- summaries
- comparisons
- correlations/predictors
- forecasting
- observational decomposition
- explanatory hypotheses

### Hard boundaries

This surface must not:
- produce intervention-effect claims
- produce actual-cause verdicts
- produce “root cause corroborated” labels
- treat mechanism conjectures as established

---

## D) Rung-2 and rung-3 graph / assumption authoring

### Recommended files
- `apps/web/components/analysis-study-shell.tsx`
- `apps/web/components/analysis-graph-builder.tsx`
- `apps/web/components/analysis-assumptions-panel.tsx`
- `apps/web/lib/analysis-graphs.ts`
- `apps/web/lib/analysis-graph-validator.ts`

### Requirements

The graph/assumption tooling must support:
- versioned graph state
- observed and unobserved variables
- explicit intervention / outcome pins for rung 2
- explicit factual / alternative case setup for rung 3
- missing data requirements
- approval/signoff

---

## E) Execution layer

### Recommended files
- `apps/web/lib/analysis-runs.ts`
- `apps/web/lib/analysis-result-package.ts`
- `apps/web/lib/compute-runs.ts`
- `apps/web/app/api/analysis/runs/route.ts`
- `apps/web/app/api/analysis/runs/[runId]/route.ts`

### Run creation rules

A rung-2 or rung-3 run may only be created if:
- the study question exists
- the relevant graph/assumption version exists
- the required approval exists if policy requires it
- the run is pinned to an exact primary dataset version
- the rung-specific focal fields are pinned on the run

### Execution pipeline

1. load the run
2. load the pinned dataset version(s)
3. load the exact graph/assumption version
4. map observed columns and explicit unobserved variables
5. perform identification for the requested rung
6. if identification fails, write a non-identifiable result and stop
7. if identification succeeds, run estimation / inference
8. run refutation / robustness checks where supported
9. build the result package
10. generate the final answer from that package only

---

## Final answer generation

### Result package requirements

Every rung-specific package must contain, at minimum:
- study id
- question id
- run id
- dataset version id(s)
- routed rung
- task form
- guardrail history if relevant
- identification status
- assumptions
- limitations
- next-step recommendations when blocked or non-identified

### Final answer rule

The final answer generator must not receive direct dataset access.

It should receive only:
- the question
- the study context needed for phrasing
- the rung-specific result package

### Required answer behavior

The final answer must:
- distinguish observed facts from inferred effects
- distinguish intervention findings from counterfactual findings
- cite assumptions and limitations
- say clearly when the question was not identifiable
- avoid speculative mechanism inflation

---

## Suggested implementation phases

## Phase 1: docs and architectural freeze

### Deliverable
A fully consistent rung-first doc set.

## Phase 2: schema and router foundation

### Add / rewrite
- schema enums and tables around `analysis_studies`
- routing types and intake API
- guardrail helper module

### Deliverable
A request can be classified into ordinary chat, rung 1, rung 2, or rung 3 before analysis begins.

## Phase 3: observational workspace consolidation

### Add / rewrite
- unified rung-1 surface
- migration path for predictive-specific codepaths
- observational result packaging

### Deliverable
All rung-1 work runs through one canonical surface.

## Phase 4: higher-rung study authoring

### Add
- graph/assumption authoring
- approval flow
- rung-2 and rung-3 setup panels

### Deliverable
Users can prepare explicit higher-rung studies with pinned assumptions.

## Phase 5: execution and grounded answers

### Add
- run creation
- identification / inference / refutation pipeline
- result-package generation
- grounded final answers

### Deliverable
The system can produce honest rung-specific answers without overclaiming.

---

## Testing plan

## Unit tests

### Routing
- Pearl ladder question -> `continue_chat`
- observational forecast -> `open_rung1_analysis`
- intervention effect question -> `open_rung2_study`
- actual-cause question -> `open_rung3_study`
- malformed classifier output -> safe fallback

### Guardrail
- observational pattern + mechanism request -> guardrail fires
- association + intervention presupposition -> guardrail fires
- actual-cause presupposition without counterfactual setup -> guardrail fires

### Claim labeling
- rung-1 outputs never receive higher-rung labels
- rung-1 explanation never emits `CORROBORATED ROOT-CAUSE CONJECTURE`

## Integration tests

- intake persists classification before analysis
- ordinary conceptual chat does not open an analytical workspace
- rung-1 questions route to the unified observational surface
- rung-2 questions do not fall back to rung-1 narration
- rung-3 questions do not fall back to rung-1 narration
- final answers are generated only from stored result packages

---

## Acceptance criteria

This implementation plan is ready to execute when all of the following are true:

1. the primary product object is `analysis_studies`
2. routing classifies ordinary chat vs analytical work first
3. analytical work is classified by required rung, not mixed intent buckets
4. task form is stored separately from rung
5. unsupported presuppositions are stored separately from rung and task form
6. all rung-1 work belongs to one canonical surface
7. rung-2 and rung-3 answers are generated from explicit study state and result packages
8. no final answer path can narrate a higher-rung claim from a lower-rung workflow

---

## Final implementation principle

If one rule governs the rebuild, it should be this:

> Never let the product answer a question at a higher Pearl rung than the workflow, assumptions, and stored result package actually support.
