# Analysis Routing Decision Tree Specification

Status: proposed implementation baseline  
Date: 2026-04-21  
Related documents: [`causal_guardrail_implementation_plan.md`](./causal_guardrail_implementation_plan.md), [`causal_v2_db_schema_spec.md`](./causal_v2_db_schema_spec.md), [`causal_v2_implementation_coordination_plan.md`](./causal_v2_implementation_coordination_plan.md)

## Purpose

This document freezes the intended question-routing and claim-governance behavior for the next implementation pass.

It adds two major decisions on top of the existing causal-first rebuild:

1. use the explicit decision tree below instead of the simpler descriptive-vs-causal split
2. use:
   - **CatBoost** for the associational / predictive path
   - **DoWhy + EconML DML** for the primary backdoor causal estimation path

This is a **spec-first** document. It intentionally gets ahead of the current implementation so code can be updated against a stable contract later.

---

## Canonical decision tree

```text
START
|
|-- 1. Classify the user's question
|      |
|      |-- A. Descriptive
|      |      -> Run descriptive analysis
|      |      -> Allowed outputs: counts, trends, segment comparisons, charts
|      |      -> Claim label: DESCRIPTIVE
|      |
|      |-- B. Associational / Predictive
|      |      -> Run statistical / ML workflow
|      |      -> Allowed outputs: correlations, regression coefficients,
|      |         feature importance, forecasts
|      |      -> Forbidden: causal wording unless explicitly qualified
|      |      -> Claim label: ASSOCIATIONAL or PREDICTIVE
|      |
|      |-- C. Explanation / Diagnostic
|      |      -> Go to 2
|      |
|      |-- D. Explicit Causal / Intervention
|             -> Go to 5
|
|-- 2. For explanation/diagnostic questions:
|      "Can this be answered descriptively first?"
|      |
|      |-- Yes
|      |     -> Decompose the change
|      |     -> Output: observed contributors or candidate drivers
|      |     -> Claim label: DIAGNOSTIC
|      |     -> Then go to 3
|      |
|      |-- No
|            -> Go to 3
|
|-- 3. Is this a root-cause / mechanism problem?
|      |
|      |-- Yes
|      |     -> Build dependency/path analysis
|      |     -> Output: likely root causes, affected path, confidence
|      |     -> Claim label: ROOT-CAUSE HYPOTHESIS
|      |     -> Then go to 4
|      |
|      |-- No
|            -> Go to 4
|
|-- 4. Does the user appear to want a counterfactual answer?
|      |
|      |-- No
|      |     -> Stop here
|      |     -> Return observational explanations only
|      |     -> Include disclaimer that causation is not yet proven
|      |
|      |-- Yes
|            -> Reframe into explicit causal question
|            -> Go to 5
|
|-- 5. Can the system define a causal setup?
|      |
|      |-- Required:
|      |     - treatment clearly defined
|      |     - outcome clearly defined
|      |     - unit of analysis clear
|      |     - time horizon clear
|      |
|      |-- No
|      |     -> Do not run causal inference
|      |     -> Claim label: CAUSAL QUESTION NOT YET SPECIFIED
|      |
|      |-- Yes
|            -> Go to 6
|
|-- 6. Does treatment occur before outcome?
|      |
|      |-- No / unknown
|      |     -> Block causal claim
|      |     -> Return temporal-order failure
|      |
|      |-- Yes
|            -> Go to 7
|
|-- 7. Is the data suitable for observational causal inference?
|      |
|      |-- No
|      |     -> Do not estimate causal effect
|      |     -> Recommend better data / experiment / quasi-experiment
|      |     -> Claim label: CAUSAL INFERENCE NOT SUPPORTED
|      |
|      |-- Yes
|            -> Go to 8
|
|-- 8. Can assumptions be written as a defensible causal graph?
|      |
|      |-- No
|      |     -> Do not produce causal estimate
|      |
|      |-- Yes
|            -> Go to 9
|
|-- 9. Is there an identification strategy?
|      |
|      |-- Backdoor adjustment
|      |     -> run causal estimation with confounder adjustment
|      |
|      |-- Instrumental variables
|      |     -> run IV path
|      |
|      |-- Diff-in-diff / panel / RDD / frontdoor / natural experiment
|      |     -> run design-specific workflow
|      |
|      |-- None
|      |     -> Stop with non-identifiable result
|
|-- 10. Run robustness checks
|       |
|       |-- placebo treatment test
|       |-- random common cause test
|       |-- subset stability
|       |-- sensitivity to hidden confounding
|       |-- negative controls if available
|       |
|       -> Go to 11
|
|-- 11. Compose final answer
|        |
|        |-- If stable and credible
|        |     -> Claim label: CAUSAL ESTIMATE
|        |
|        |-- If somewhat fragile
|        |     -> Claim label: TENTATIVE CAUSAL ESTIMATE
|        |
|        |-- If robustness fails
|              -> Claim label: NO DEFENSIBLE CAUSAL CONCLUSION
```

---

## Standardized intent taxonomy

The classifier should support these intent types:

- `descriptive`
- `associational`
- `predictive`
- `diagnostic`
- `causal`
- `counterfactual`
- `unclear`

### Interpretation rules

- `descriptive` means observational summarization with no modeling claim beyond what happened.
- `associational` means correlational or explanatory-pattern analysis that does not imply intervention effects.
- `predictive` means supervised learning or forecasting focused on prediction quality rather than causal interpretation.
- `diagnostic` means explanation of an observed change or underperformance using observational decomposition and possible escalation.
- `causal` means an explicit intervention or effect question.
- `counterfactual` means a what-if or but-for question that must enter the causal workflow.

---

## Standardized routing contract

Use this routing contract in the next implementation pass:

- `continue_descriptive`
- `open_predictive_analysis`
- `open_causal_study`
- `ask_clarification`
- `blocked`

### Routing policy

- `descriptive` -> `continue_descriptive`
- `associational` -> `open_predictive_analysis`
- `predictive` -> `open_predictive_analysis`
- `diagnostic` -> `continue_descriptive` initially, using the diagnostic protocol in steps 2-4 and escalating to `open_causal_study` only when a counterfactual answer is requested or required
- `causal` -> `open_causal_study`
- `counterfactual` -> `open_causal_study`
- `unclear` -> `ask_clarification`

This preserves a separate predictive route, while allowing diagnostic work to start observationally and escalate into causal mode only when warranted.

---

## Claim label policy

All user-visible answers must carry a claim label aligned to the executed branch.

### Allowed claim labels

- `DESCRIPTIVE`
- `ASSOCIATIONAL`
- `PREDICTIVE`
- `DIAGNOSTIC`
- `ROOT-CAUSE HYPOTHESIS`
- `CAUSAL QUESTION NOT YET SPECIFIED`
- `CAUSAL INFERENCE NOT SUPPORTED`
- `CAUSAL ESTIMATE`
- `TENTATIVE CAUSAL ESTIMATE`
- `NO DEFENSIBLE CAUSAL CONCLUSION`

### Guardrail rule

No branch may emit a stronger claim label than the workflow supports.

Examples:
- predictive output must not be labeled causal
- diagnostic decomposition must not be labeled causal
- non-identifiable runs must not be labeled causal estimate

---

## Descriptive branch requirements

The descriptive branch may output:

- counts
- time trends
- segment comparisons
- charts
- anomaly summaries

It must not output:

- intervention claims
- causal mechanisms presented as proven
- counterfactual language

---

## Associational / predictive branch requirements

### Modeling standard

Use **CatBoost** as the primary modeling engine for the prediction path.

First implementation target:
- `CatBoostClassifier` for classification
- `CatBoostRegressor` for regression and direct prediction tasks

Forecasting may initially be implemented as a supervised tabular problem using lagged features and forecast horizons, provided the output is labeled `PREDICTIVE` and not causal.

### Allowed outputs

- correlations
- regression summaries
- feature importance
- predictive rankings
- calibrated probabilities
- forecasts
- model quality metrics

### Forbidden outputs

- causal language without explicit qualification
- claims that changing a feature will change the outcome
- policy recommendations framed as intervention effects

### Communication rule

Associational answers must clearly say they describe patterns or predictors, not causes.

---

## Diagnostic branch requirements

Diagnostic questions should start with observational decomposition when possible.

### Required first-pass checks

- what changed over time?
- which segments contributed most?
- which metrics moved together?
- were there operational anomalies?

### Root-cause / mechanism mode

If the problem is mechanistic or dependency-driven, the system should produce:

- likely upstream changes
- propagated path or dependency chain
- confidence level
- explicit uncertainty

### Stop condition

If the user does not appear to want a counterfactual answer, stop at the observational or root-cause-hypothesis stage and include this disclaimer:

> These explain the pattern observationally, but do not yet prove causation.

### Escalation condition

If the user asks for a but-for, effect-size, intervention, or attribution answer, the system must reframe the request into an explicit causal question and enter the causal workflow.

---

## Causal branch requirements

### Required setup before estimation

Do not run causal estimation until all of the following are explicit:

- treatment
- outcome
- unit of analysis
- time horizon / analysis window

If any are missing, return `CAUSAL QUESTION NOT YET SPECIFIED`.

### Temporal-order rule

Do not support a causal claim unless treatment precedes outcome or temporal ordering is otherwise defendable from the data design.

### Observational-suitability rule

Block or downgrade causal inference when any of these conditions hold:

- no pre-treatment covariates
- strong unresolved selection bias
- post-treatment controls only
- too little data
- treatment is nearly deterministic
- overlap / positivity is implausible

In those cases return `CAUSAL INFERENCE NOT SUPPORTED` and recommend better data, an experiment, or a quasi-experimental design.

### Graph requirement

A causal estimate requires a defensible DAG or equivalent causal structure with explicit assumptions.

### Identification rule

If no identification strategy is available, return a non-identifiable answer and do not substitute an observational result.

---

## Causal estimation standard

### Primary stack

Use:
- **DoWhy** for graph-aware causal orchestration, identification, and refutation
- **EconML DML** for the primary backdoor estimation path

### Default backdoor policy

For backdoor-adjustable questions, the default estimation path should be:

1. define the causal model in DoWhy
2. identify the estimand in DoWhy
3. estimate the effect using an EconML DML estimator through the DoWhy-compatible estimation path
4. store the estimator configuration and assumptions in the result package

### Additional identification paths

The following paths may be added as explicit workflows rather than automatic estimator switching:

- IV
- diff-in-diff
- panel methods
- RDD
- frontdoor
- natural experiments

---

## Robustness standard

Run, where available and defensible:

- placebo treatment test
- random common cause test
- subset stability
- sensitivity to hidden confounding
- negative controls when available

### Final causal conclusion rule

- pass / stable -> `CAUSAL ESTIMATE`
- mixed / fragile -> `TENTATIVE CAUSAL ESTIMATE`
- failed robustness -> `NO DEFENSIBLE CAUSAL CONCLUSION`

The final answer must explicitly connect its label to the robustness results and stated assumptions.

---

## Current implementation delta to close later

The current codebase does **not** yet fully match this spec.

Notable gaps to close in the implementation pass:

- add `associational` and `predictive` as first-class intent types
- add `open_predictive_analysis` as a first-class routing decision
- change diagnostic "why" routing from immediate causal opening to staged observational diagnosis with optional causal escalation
- install and capability-check CatBoost and EconML in the Python runtime(s)
- update causal estimation from linear regression / propensity weighting default paths to DoWhy + EconML DML for the default backdoor path
- add explicit temporal-order and data-suitability gates before causal estimation
- add sensitivity-to-hidden-confounding and negative-control hooks where supported
- update tests, docs, and answer labels to match this decision tree exactly

---

## Implementation principle

When the tree and the user-facing prose disagree, the tree wins.

When an estimator can produce a number but the decision tree says the claim is not supported, the claim must be blocked or downgraded rather than narrated optimistically.
