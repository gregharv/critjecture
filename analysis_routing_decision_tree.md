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
|      |      Examples:
|      |      - "What happened?"
|      |      - "Summarize this dataset"
|      |      |
|      |      -> Run descriptive analysis
|      |      -> Allowed outputs:
|      |         counts, trends, segment comparisons
|      |      -> Claim label:
|      |         DESCRIPTIVE (Observation statement)
|      |
|      |-- B. Associational / Instrumental Predictive
|      |      Examples:
|      |      - "What is correlated with churn?"
|      |      - "Forecast next month's sales"
|      |      |
|      |      -> Run statistical / ML workflow
|      |      -> Allowed outputs:
|      |         correlations, predictive weights, forecasts
|      |      -> Forbidden:
|      |         causal wording; treating associations as universal laws
|      |      -> Claim label:
|      |         INSTRUMENTAL / HEURISTIC PREDICTION
|      |
|      |-- C. Explanation / Diagnostic
|      |      Examples:
|      |      - "Why did churn spike in March?"
|      |      |
|      |      -> Go to 2
|      |
|      |-- D. Explicit Causal Conjecture
|             Examples:
|             - "Did campaign A cause the increase in sales?"
|             - "Would churn have been lower without that change?"
|             |
|             -> Go to 5
|
|-- 2. For explanation/diagnostic questions:
|      "Can this be answered purely descriptively first?"
|      |
|      |-- Yes
|      |     -> Decompose the change to generate hypotheses:
|      |        - what changed over time?
|      |        - which segments contributed most?
|      |
|      |     -> Output:
|      |        "candidate conjectures"
|      |     -> Claim label:
|      |        UNTESTED HYPOTHESES
|      |     -> Then go to 3
|      |
|      |-- No
|            -> Go to 3
|
|-- 3. Is this a mechanism search?
|      |
|      |-- Yes
|      |     |
|      |     -> Build dependency/path analysis
|      |     -> Attempt to falsify competing pathways
|      |     -> Output:
|      |        surviving (un-falsified) pathways, severity of tests passed
|      |     -> Claim label:
|      |        CORROBORATED ROOT-CAUSE CONJECTURE
|      |     -> Then go to 4
|      |
|      |-- No
|            -> Go to 4
|
|-- 4. Does the user seek a causal/counterfactual conclusion?
|      |
|      |-- No
|      |     -> Stop here
|      |     -> Return:
|      |        un-falsified descriptive contributors
|      |     -> Include disclaimer:
|      |        "These represent observational regularities, but are
|      |         not severely tested causal claims."
|      |
|      |-- Yes
|            -> Reframe into explicit causal conjecture
|            -> Go to 5
|
|-- 5. Can the system define a testable causal setup?
|      |
|      |-- Required:
|      |     - treatment clearly defined and logically isolatable
|      |     - outcome clearly defined
|      |     - unit of analysis clear
|      |
|      |-- No
|      |     -> Block causal testing
|      |     -> Claim label:
|      |        UNFALSIFIABLE CONJECTURE
|      |
|      |-- Yes
|            -> Go to 6
|
|-- 6. Does treatment logically precede outcome?
|      |
|      |-- No / unknown
|      |     -> Block causal claim
|      |     -> Return:
|      |        "Hypothesis falsified/rejected a priori: temporal order
|      |         violates causal logic."
|      |
|      |-- Yes
|            -> Go to 7
|
|-- 7. Is the data capable of providing a severe test?
|      |
|      |-- No
|      |     Examples:
|      |     - severe selection bias
|      |     - post-treatment controls only
|      |     |
|      |     -> Do not estimate effect
|      |     -> Claim label:
|      |        SEVERE TESTING NOT POSSIBLE WITH CURRENT DATA
|      |
|      |-- Yes
|            -> Go to 8
|
|-- 8. Can assumptions be formalized as a strictly falsifiable graph?
|      |
|      |-- No
|      |     -> Return:
|      |        "A causal test requires formal structural assumptions
|      |         that expose the hypothesis to refutation."
|      |
|      |-- Yes
|            -> Go to 9
|
|-- 9. Is there a strategy to isolate the hypothesis for testing?
|      |
|      |-- Backdoor / IV / Diff-in-diff / RDD
|      |     -> run estimation strategy to isolate the theoretical effect
|      |
|      |-- None
|            -> Stop
|            -> Return:
|               "The conjecture is causal, but the effect cannot be
|                isolated for a severe test using current data."
|
|-- 10. Subject to Severe Testing (Falsification Attempts)
|       |
|       |-- placebo treatment test (attempt to find effect where none exists)
|       |-- negative controls (attempt to break the isolation strategy)
|       |-- sensitivity to hidden confounding (stress-test assumptions)
|       |
|       -> Go to 11
|
|-- 11. Compose final epistemic verdict
|        |
|        |-- If it survives all severe tests
|        |     -> Claim label:
|        |        CORROBORATED CAUSAL CONJECTURE
|        |     -> Say:
|        |        "The conjecture that X causes Y was subjected to severe
|        |         testing and remains unfalsified."
|        |
|        |-- If it fails some stress tests
|        |     -> Claim label:
|        |        WEAKLY CORROBORATED
|        |     -> Say:
|        |        "The causal conjecture survived baseline tests but was
|        |         partially falsified under stricter assumptions. It
|        |         requires theoretical reformulation."
|        |
|        |-- If placebo/negative control tests fail
|              -> Claim label:
|                 FALSIFIED CAUSAL CONJECTURE
|              -> Say:
|                 "The data decisively falsifies the causal claim. The
|                  observed effect is driven by confounding or noise."
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
- `diagnostic` -> `continue_descriptive` initially, using the diagnostic protocol in steps 2-4 and escalating to `open_causal_study` only when a causal or counterfactual conclusion is explicitly requested
- `causal` -> `open_causal_study`
- `counterfactual` -> `open_causal_study`
- `unclear` -> default to `continue_descriptive` unless the request is too underspecified to support even observational analysis

This preserves a separate predictive route, allows diagnostic work to start observationally, and reduces unnecessary prompting about question type.

---

## Claim label policy

All user-visible answers must carry a claim label aligned to the executed branch.

### Allowed claim labels

- `DESCRIPTIVE`
- `INSTRUMENTAL / HEURISTIC PREDICTION`
- `UNTESTED HYPOTHESES`
- `CORROBORATED ROOT-CAUSE CONJECTURE`
- `UNFALSIFIABLE CONJECTURE`
- `SEVERE TESTING NOT POSSIBLE WITH CURRENT DATA`
- `CORROBORATED CAUSAL CONJECTURE`
- `WEAKLY CORROBORATED`
- `FALSIFIED CAUSAL CONJECTURE`

### Guardrail rule

No branch may emit a stronger claim label than the workflow supports.

Examples:
- predictive output must not be labeled causal
- diagnostic decomposition must not be labeled a corroborated causal conjecture
- non-identifiable runs must not be labeled a corroborated causal conjecture

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

Forecasting may initially be implemented as a supervised tabular problem using lagged features and forecast horizons, provided the output is labeled `INSTRUMENTAL / HEURISTIC PREDICTION` and not causal.

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

If the user does not appear to want a counterfactual answer, stop at the observational or root-cause-conjecture stage and include this disclaimer:

> These represent observational regularities, but are not severely tested causal claims.

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

If any are missing, return `UNFALSIFIABLE CONJECTURE`.

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

In those cases return `SEVERE TESTING NOT POSSIBLE WITH CURRENT DATA` and recommend better data, an experiment, or a quasi-experimental design.

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

- pass / stable -> `CORROBORATED CAUSAL CONJECTURE`
- mixed / fragile -> `WEAKLY CORROBORATED`
- failed robustness -> `FALSIFIED CAUSAL CONJECTURE`

The final answer must explicitly connect its label to the robustness results and stated assumptions.

---

## Current implementation delta to close later

The current codebase does **not** yet fully match this spec.

Notable gaps to close in the implementation pass:

- reduce question-type prompting further so unclear requests default to observational analysis unless a predictive or causal ask is explicit
- ensure diagnostic "why" routing remains staged observational diagnosis with optional causal escalation
- install and capability-check CatBoost and EconML in the Python runtime(s)
- update causal estimation from linear regression / propensity weighting default paths to DoWhy + EconML DML for the default backdoor path
- add explicit temporal-order and severe-test feasibility gates before causal estimation
- add sensitivity-to-hidden-confounding and negative-control hooks where supported
- update tests, docs, and answer labels to match this decision tree exactly

---

## Implementation principle

When the tree and the user-facing prose disagree, the tree wins.

When an estimator can produce a number but the decision tree says the claim is not supported, the claim must be blocked or downgraded rather than narrated optimistically.
