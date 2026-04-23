# Rung-First Analytical Routing Overhaul Plan

Status: proposed overhaul plan  
Date: 2026-04-23  
Owner: planning draft for repo-wide refactor  
Supersedes direction in: `analysis_routing_decision_tree.md`, `observational_mechanism_response_policy.md`, `causal_guardrail_implementation_plan.md`, `causal_v2_architecture_lock.md`, `causal_v2_db_schema_spec.md`, and `causal_v2_implementation_coordination_plan.md` where they conflict with this plan.

## 1. Decision summary

This plan adopts the following product direction:

1. **Stop using the current mixed intent taxonomy as the primary abstraction.**
   - The current labels mix task form, workflow routing, and epistemic rung.
   - `predictive` and `diagnostic` are not Pearl rungs.
   - `loaded_mechanism_from_observation` should not remain a one-off special case.

2. **Make Pearl rung the primary classifier axis.**
   - **Rung 1**: observation / association / forecasting from observed patterns / tentative contributors
   - **Rung 2**: intervention / policy / change / “what happens if we do X?”
   - **Rung 3**: counterfactual / but-for / actual-cause / responsibility for a particular outcome

3. **Make task form a separate axis.**
   - Initial task-form set: `describe`, `predict`, `explain`, `advise`, `compare`, `teach`, `critique`

4. **Generalize the observational-mechanism guardrail into a cross-rung presupposition guardrail.**
   - The system should react to unsupported rung jumps, not to the mere presence of causal vocabulary.

5. **Unify all rung-1 analytical work into one observational workspace.**
   - This replaces the current separate predictive/associational route as the canonical product surface.
   - The current predictive workspace becomes migration/legacy material, not the target architecture.

6. **Remove any rung-1 path that emits epistemically stronger language than the evidence supports.**
   - In particular, remove `CORROBORATED ROOT-CAUSE CONJECTURE` from observational/diagnostic branches.

---

## 2. Why the overhaul is needed

## Current problem

The current repo state mixes three different concepts into one classifier layer:

- **task form**: describe, predict, explain
- **routing/product surface**: stay in chat, go to predictive workspace, go to causal workspace
- **epistemic rung**: observational vs intervention vs counterfactual

That creates several problems:

1. **Conceptual muddle**
   - `predictive` is treated like an intent class even though it is usually a rung-1 task.
   - `diagnostic` is treated like a stable branch even though it can stay at rung 1, escalate to rung 2, or escalate to rung 3 depending on what is being asked.

2. **Overclaim risk**
   - The current decision tree allows a diagnostic/mechanism path to emit `CORROBORATED ROOT-CAUSE CONJECTURE` before a causal study.
   - That label is stronger than what observational evidence warrants.

3. **Internal contradiction across docs**
   - Some docs and code paths still include `open_predictive_analysis`.
   - `causal_v2_architecture_lock.md` restricts routing to `continue_descriptive`, `open_causal_study`, `ask_clarification`, or `blocked`.
   - The repo is therefore not actually frozen around one coherent abstraction.

4. **Bad failure-mode targeting**
   - The real assistant failure is not “the user mentioned causation.”
   - The failure is “the system silently accepts an unsupported rung jump and narrates it as if justified.”

## Design principle

From a critical-rationalist and Pearlian perspective, the classifier should answer:

> What is the **minimum rung required** for a non-misleading answer?

That question is cleaner than “Which broad intent bucket does this sound like?”

---

## 3. Target model

## 3.1 Primary axis: required Pearl rung

### `rung_1_observational`
Use when the request can be answered with observation, description, association, forecasting from observed patterns, or tentative observational contributors.

Examples:
- “What happened to churn in March?”
- “What correlates with churn?”
- “Forecast next month’s demand.”
- “Why did churn spike in March?” when the user is asking for observational decomposition rather than intervention effect or actual cause

### `rung_2_interventional`
Use when the request asks what happens if we set, change, choose, increase, decrease, remove, or introduce something.

Examples:
- “What happens if we cut price by 10%?”
- “How can we reduce churn?” when the user wants an intervention answer
- “What is the effect of campaign A on signups?”

### `rung_3_counterfactual`
Use when the request asks about actual cause, but-for dependence, responsibility, or a particular realized outcome under an alternative history.

Examples:
- “Would churn have been lower if we had not changed onboarding?”
- “Was the onboarding change the reason churn spiked?”
- “Would this outage have happened without the cache flush?”

## 3.2 Secondary axis: task form

Task form should be classified independently of rung.

Initial canonical values:
- `describe`
- `predict`
- `explain`
- `advise`
- `compare`
- `teach`
- `critique`

Examples:
- “What is Pearl’s ladder of causation?” -> task form `teach`, no analytical routing
- “Compare causal inference methods” -> task form `compare`, no analytical routing
- “Forecast demand next month” -> task form `predict`, rung 1
- “Why did refunds rise?” -> task form `explain`, default rung 1 unless the wording requires a higher rung
- “How should we reduce refunds?” -> task form `advise`, likely rung 2

## 3.3 Guardrail axis: causal-presupposition flag

Replace `loaded_mechanism_from_observation` with a generalized guardrail flag.

Recommended canonical flag family:
- `none`
- `unsupported_rung_jump`
- `unsupported_direct_mechanism`
- `unsupported_actual_cause_presupposition`

### Trigger principle
The flag should fire when the user’s framing would cause the model to answer a higher-rung question using lower-rung evidence.

### Canonical examples
- observational pattern -> asks for direct mechanism -> no causal identification
- observational association -> asks what would happen if we intervene
- observed outcome -> asks whether X was the actual cause in this particular case

### Required behavior
When the flag fires, the system should:
1. challenge or reframe the presupposition
2. offer a safer lower-rung answer when possible
3. escalate to rung 2 or rung 3 workflow only if the user explicitly wants that higher-rung question answered and the workflow can support it

---

## 4. New routing model

## 4.1 Separate ordinary chat from analytical workflow routing

Before applying rung routing, the system should first ask:

> Is this a normal informational/conceptual chat request, or a dataset-backed analytical request?

### Ordinary chat examples
These should stay in normal chat with no special analytical routing:
- “What is Pearl’s ladder of causation?”
- “Explain causal inference to me.”
- “Compare causal discovery and causal estimation.”

### Analytical workflow examples
These should enter the rung-first router:
- “What correlates with churn in our data?”
- “What happens if we change price?”
- “Would churn have been lower if we had not changed onboarding?”

## 4.2 Canonical routing decisions

Recommended new routing contract:

- `continue_chat`
- `open_rung1_analysis`
- `open_rung2_study`
- `open_rung3_study`
- `ask_clarification`
- `blocked`

### Notes
- `open_predictive_analysis` is removed.
- `continue_descriptive` is removed as the canonical umbrella term because it is too narrow for all rung-1 work.
- If the team wants to keep chat as the UI shell for rung-1 initially, `open_rung1_analysis` can temporarily resolve to `/chat` plus a structured observational-analysis mode. The routing contract should still be renamed now.

## 4.3 Default interpretation rules

- If the question can be safely answered at rung 1, **stay at rung 1**.
- Do not promote to rung 2 or rung 3 just because the user used words like “cause,” “why,” or “mechanism.”
- Promote only when the semantics of the requested answer require intervention or counterfactual reasoning.
- “Why did X happen?” defaults to rung-1 observational explanation unless it explicitly asks for intervention effect or actual-cause judgment.

---

## 5. Claim-label overhaul

## 5.1 Remove epistemically inflated observational labels

Remove or deprecate:
- `CORROBORATED ROOT-CAUSE CONJECTURE`

This label should not appear on rung-1 outputs.

## 5.2 Proposed claim-label family

### Rung 1
- `OBSERVATIONAL DESCRIPTION`
- `OBSERVATIONAL ASSOCIATION`
- `OBSERVATIONAL FORECAST`
- `OBSERVATIONAL EXPLANATORY HYPOTHESES`

### Rung 2
- `INTERVENTIONAL QUESTION NOT YET IDENTIFIED`
- `INTERVENTIONAL ESTIMATE`
- `INTERVENTIONAL ESTIMATE, ASSUMPTION-SENSITIVE`
- `INTERVENTIONAL CLAIM FALSIFIED`

### Rung 3
- `COUNTERFACTUAL QUESTION NOT YET IDENTIFIED`
- `COUNTERFACTUAL ESTIMATE`
- `ACTUAL-CAUSE ASSESSMENT, ASSUMPTION-SENSITIVE`
- `COUNTERFACTUAL CLAIM FALSIFIED`

## 5.3 Claim-label rule

No answer may carry a claim label from a higher rung than the workflow actually executed.

---

## 6. Product-surface target state

## 6.1 Rung 1 observational workspace

Unify the current descriptive, associational, predictive, and observational-diagnostic work into a single product surface.

This workspace should support:
- summary and description
- correlation / association analysis
- forecasting and prediction
- observational decomposition of changes
- tentative contributor analysis

But it must not:
- imply intervention effects
- imply actual-cause verdicts
- narrate mechanism as established from pattern evidence alone

## 6.2 Rung 2 study workspace

This is the current causal-study concept narrowed to intervention questions.

Required setup:
- intervention/treatment
- outcome
- unit of analysis
- time horizon
- identification assumptions / graph

## 6.3 Rung 3 study workspace

Counterfactual and actual-cause questions should not just be another label inside the current causal bucket.

They need explicit support for:
- factual outcome reference
- alternative action/state definition
- unit/case specificity
- structural assumptions that support counterfactual reasoning

This may share infrastructure with rung 2, but it should be explicitly modeled as a separate rung in routing, UX copy, and answer packaging.

---

## 7. Documentation changes required

## 7.1 Replace the current routing spec

### Rewrite
- `analysis_routing_decision_tree.md`

### Replace with
A rung-first decision tree that:
- first separates ordinary chat from analytical workflow
- classifies required rung
- classifies task form separately
- evaluates causal-presupposition flags
- routes to rung 1 / rung 2 / rung 3 or clarification

### Explicitly remove
- mixed intent taxonomy as the primary conceptual layer
- observational diagnostic path emitting `CORROBORATED ROOT-CAUSE CONJECTURE`
- `open_predictive_analysis` as a canonical route

## 7.2 Replace the mechanism policy spec

### Rewrite
- `observational_mechanism_response_policy.md`

### Replace with
A broader spec, e.g.:
- `causal_presupposition_guardrail.md`

### Scope
The new spec should cover:
- direct-mechanism-from-observation
- observational-to-intervention jumps
- observational-to-actual-cause jumps
- safe reframe and clarification policy

## 7.3 Rewrite the causal rebuild plan as an analytical-rung rebuild plan

### Rewrite
- `causal_guardrail_implementation_plan.md`

### Change focus
From:
- causal-first rebuild with descriptive/predictive side branches

To:
- rung-first analytical architecture with:
  - ordinary chat
  - rung-1 observational analysis
  - rung-2 interventional study
  - rung-3 counterfactual study

## 7.4 Rewrite the architecture lock

### Rewrite
- `causal_v2_architecture_lock.md`

### New lock should freeze
- rung-first classification
- ordinary-chat vs analytical-work separation
- routing contract with rung 1 / rung 2 / rung 3
- predictive workspace retirement path
- generalized presupposition guardrail

## 7.5 Rewrite the schema spec sections that encode mixed taxonomy

### Rewrite
- `causal_v2_db_schema_spec.md`

### Specific schema changes to describe
- replace `intent_type` enum with separate fields for rung, task form, and guardrail flag
- replace routing enum with rung-first routing decisions
- decide whether `question_type` becomes a rung-specific subtype field
- document how rung 2 and rung 3 differ at the study/run/package layer

## 7.6 Rewrite the coordination plan

### Rewrite
- `causal_v2_implementation_coordination_plan.md`

### New sequencing goal
Coordinate a repo-wide transition from mixed-intent routing to rung-first routing, including workspace consolidation.

## 7.7 Refresh product-facing summaries

### Update for consistency
- `README.md`
- `overview.md`
- any later milestone/history docs that describe the old routing model

---

## 8. Codebase changes required

## 8.1 Routing and classifier layer

### Replace or heavily refactor
- `apps/web/lib/causal-intent-types.ts`
- `apps/web/lib/causal-intent.ts`
- `apps/web/lib/causal-intake.ts`
- `apps/web/lib/analytical-clarification.ts`
- `apps/web/lib/observational-mechanism-response-policy.ts`

### Direction
Introduce new domain types, ideally under neutral names such as:
- `analysis-routing-types.ts`
- `analysis-router.ts`
- `analysis-intake.ts`
- `causal-presupposition-guardrail.ts`

### New classifier output shape
Recommended draft:

```json
{
  "is_analytical": true,
  "required_rung": "rung_1_observational",
  "task_form": "predict",
  "guardrail_flag": "none",
  "reason": "The user wants a forecast from observed patterns.",
  "confidence": 0.93,
  "routing_decision": "open_rung1_analysis"
}
```

## 8.2 Prompt and chat policy layer

### Rewrite
- `apps/web/lib/chat-system-prompt.ts`

### Required changes
- stop instructing the model to classify into descriptive/diagnostic/predictive first
- stop telling chat that predictive work belongs to a separate canonical workspace
- update answer labels for rung-first outputs
- add rule that merely discussing causation conceptually does not trigger analytical routing
- add rule that unsupported rung jumps trigger reframing, not agreement

## 8.3 Schema and migrations

### Rewrite
- `apps/web/lib/app-schema.ts`
- `apps/web/drizzle-v2/0000_causal_v2_baseline.sql`
- any follow-on migration files

### Required schema direction
Replace mixed-intent fields such as:
- `intent_type`
- `routing_decision` values that include `open_predictive_analysis`

With fields such as:
- `required_rung`
- `task_form`
- `guardrail_flag`
- `routing_decision`

Potential draft enums:
- `required_rung`: `rung_1_observational`, `rung_2_interventional`, `rung_3_counterfactual`
- `task_form`: `describe`, `predict`, `explain`, `advise`, `compare`, `teach`, `critique`, `unknown`
- `guardrail_flag`: `none`, `unsupported_rung_jump`, `unsupported_direct_mechanism`, `unsupported_actual_cause_presupposition`
- `routing_decision`: `continue_chat`, `open_rung1_analysis`, `open_rung2_study`, `open_rung3_study`, `ask_clarification`, `blocked`

## 8.4 Workspace/UI consolidation

### Affected UI and routing files
- `apps/web/components/causal-studies-page-client.tsx`
- `apps/web/components/chat-shell.tsx`
- `apps/web/components/predictive-workspace-page-client.tsx`
- `apps/web/components/predictive-run-page-client.tsx`
- `apps/web/app/(workspace)/predictive/page.tsx`
- `apps/web/app/(workspace)/predictive/runs/[runId]/page.tsx`

### Required changes
- create a canonical rung-1 observational workspace or structured rung-1 chat mode
- stop presenting predictive as a separate epistemic class
- either migrate predictive pages into an observational workspace or mark them legacy and hidden from primary nav

## 8.5 Predictive-specific library cleanup

### Affected files
- `apps/web/lib/predictive-analysis.ts`
- `apps/web/lib/predictive-chat.ts`
- `apps/web/lib/predictive-handoff.ts`
- `apps/web/lib/predictive-planning-messages.ts`
- `apps/web/lib/predictive-workspace-status-messages.ts`
- `apps/web/lib/predictive-result-package.ts`
- related `/api/predictive/*` routes

### Direction
- retain forecasting and supervised modeling capabilities
- move them under the rung-1 observational surface
- rename product language from “predictive workspace” to “observational analysis” or equivalent
- keep the old predictive endpoints only as temporary compatibility shims if needed

---

## 9. Data-model transition strategy

## 9.1 Key persistence change

Current persistence encodes a mixed taxonomy directly in schema and code.

The new persistence model should encode:
- whether the request is ordinary chat or analytical
- required rung
- task form
- guardrail flag
- routing decision

## 9.2 Recommended new classification record shape

Suggested conceptual fields:
- `is_analytical`
- `required_rung`
- `task_form`
- `guardrail_flag`
- `routing_decision`
- `reason`
- `confidence`

## 9.3 Study model note

The repo currently centers V2 on `causal_studies`.

This plan does **not** require immediate renaming of every study table before implementation starts, but it does require one of these choices during Phase 0:

### Option A: keep table names temporarily
- keep `causal_studies` as the storage name for rung 2 and rung 3 only
- introduce a separate rung-1 product surface without forcing a storage rename immediately

### Option B: neutralize names in V2 now
- rename the top-level study model to something like `analysis_studies` or `inference_studies`
- reserve rung-specific subtypes inside that broader model

### Recommendation
Because this overhaul already includes routing, schema, and workspace changes, the cleaner end state is **Option B**, but the team can stage it if implementation risk is too high.

---

## 10. Implementation phases

## Phase 0: refreeze architecture around the rung-first model

### Deliverables
- approve this overhaul direction
- decide whether to rename `causal_studies` now or in a follow-up phase
- freeze canonical enum names
- freeze the rung-first routing contract
- freeze the predictive-workspace retirement path

### Exit criteria
- no remaining docs claim that predictive is a first-class epistemic route
- no remaining docs allow rung-1 mechanism work to emit root-cause corroboration labels

## Phase 1: docs-first replacement

### Tasks
- rewrite the routing decision tree
- replace the mechanism-response policy with the generalized guardrail spec
- update the implementation plan, schema spec, coordination plan, and architecture lock
- refresh `README.md` and `overview.md`

### Exit criteria
- all canonical docs describe the same rung-first architecture

## Phase 2: schema and type refactor

### Tasks
- replace mixed intent enums in schema and TypeScript
- add new rung/task/guardrail fields
- update migrations and DB constraints
- update server-side parser and validation logic

### Exit criteria
- the codebase compiles against the new classifier contract
- no canonical enum still depends on `open_predictive_analysis`

## Phase 3: router and guardrail implementation

### Tasks
- implement analytical-vs-chat gate
- implement rung-first router
- implement generalized presupposition guardrail
- update clarification logic
- update prompt instructions

### Exit criteria
- sample requests route correctly:
  - Pearl ladder question -> `continue_chat`
  - correlates/predicts -> `open_rung1_analysis`
  - intervention question -> `open_rung2_study`
  - counterfactual question -> `open_rung3_study`
  - loaded observational mechanism question -> guardrail/reframe path

## Phase 4: workspace consolidation

### Tasks
- build or rename the rung-1 observational workspace
- migrate forecasting/predictive tooling under rung 1
- remove predictive workspace from primary navigation
- update handoff and status messaging

### Exit criteria
- all rung-1 tasks share one canonical product surface

## Phase 5: rung-2 and rung-3 split hardening

### Tasks
- make rung 2 and rung 3 explicit in routing, UI copy, and answer packaging
- ensure rung 3 has actual-cause / counterfactual-specific data and assumption requirements
- update run detail pages and answer generators

### Exit criteria
- the system no longer treats all higher-rung work as one undifferentiated “causal” bucket

## Phase 6: cleanup and legacy retirement

### Tasks
- archive or remove obsolete predictive-only code paths
- archive obsolete mixed-taxonomy docs
- update milestone and completion notes
- add regression tests to prevent taxonomy drift from returning

### Exit criteria
- no primary product path depends on the old mixed taxonomy

---

## 11. Test plan

## 11.1 Classification tests

Add or rewrite tests for at least these prompts:

- “What is Pearl’s ladder of causation?” -> ordinary chat, no analytical routing
- “What correlates with churn?” -> rung 1, task form `describe` or `explain`
- “Forecast next month’s churn.” -> rung 1, task form `predict`
- “Why did churn spike in March?” -> rung 1 by default
- “What happens if we cut price by 10%?” -> rung 2
- “Would churn have been lower if we had not changed onboarding?” -> rung 3
- “We observed churn rose after onboarding changed; what mechanism caused it?” -> guardrail fires before accepting direct causal framing

## 11.2 Claim-label tests

Verify:
- rung-1 outputs never emit intervention or counterfactual labels
- observational explanation outputs never emit `CORROBORATED ROOT-CAUSE CONJECTURE`
- rung-2 and rung-3 answers explicitly distinguish assumptions from findings

## 11.3 UI/route tests

Verify:
- no canonical route points to a predictive-only workspace for rung-1 work
- predictive legacy paths, if retained temporarily, redirect or clearly declare compatibility mode
- chat explanations about causal concepts stay in ordinary chat

## 11.4 Migration tests

Verify:
- legacy records with old intent enums are either migrated or read through compatibility adapters
- audit history remains interpretable after enum changes

---

## 12. Immediate execution checklist

1. **Approve the rung-first plan as the new architectural direction.**
2. **Resolve the study-model naming choice in Phase 0** (`causal_studies` now vs later rename).
3. **Rewrite canonical docs before implementation resumes.**
4. **Change schema/type enums next so the code cannot drift back to the old model.**
5. **Implement the new router and guardrail before more workspace UX work lands.**
6. **Consolidate predictive into rung 1 before adding more predictive-specific product surface.**
7. **Remove `CORROBORATED ROOT-CAUSE CONJECTURE` from all rung-1 answer paths.**

---

## 13. Final implementation principle

If one sentence governs this overhaul, it should be:

> Critjecture should classify questions by the minimum Pearl rung required for a non-misleading answer, then classify task form separately, and only trigger guardrails when the user’s framing tries to smuggle in an unsupported higher-rung claim.
