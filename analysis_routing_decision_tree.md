# Rung-First Analysis Routing Decision Tree Specification

Status: proposed implementation baseline  
Date: 2026-04-23  
Related documents: [`causal_presupposition_guardrail.md`](./causal_presupposition_guardrail.md), [`causal_guardrail_implementation_plan.md`](./causal_guardrail_implementation_plan.md), [`causal_v2_db_schema_spec.md`](./causal_v2_db_schema_spec.md)

## Purpose

This document replaces the older mixed intent taxonomy with a **rung-first routing model**.

The classifier should no longer treat `descriptive`, `associational`, `predictive`, `diagnostic`, `causal`, and `counterfactual` as one flat conceptual layer.

Instead, routing must answer three separate questions:

1. is this **ordinary chat** or a **dataset-backed analytical request**?
2. if analytical, what is the **minimum Pearl rung** required for a non-misleading answer?
3. what **task form** is the user asking for, and is there any **unsupported rung jump** or causal presupposition that must be challenged first?

---

## Core design rule

Classify by the **minimum rung required for a non-misleading answer**.

- Do **not** escalate just because the user used words like “cause,” “why,” or “mechanism.”
- Do escalate when the requested answer would otherwise silently convert:
  - observational pattern -> intervention effect, or
  - observational pattern -> actual-cause / but-for judgment.

---

## Canonical decision tree

```text
START
|
|-- 1. Is this ordinary chat or dataset-backed analysis?
|      |
|      |-- A. Ordinary chat
|      |      Examples:
|      |      - "What is Pearl's ladder of causation?"
|      |      - "Compare causal inference methods"
|      |      - "Explain counterfactual reasoning"
|      |      |
|      |      -> Route: continue_chat
|      |      -> No analytical workflow routing
|      |
|      |-- B. Dataset-backed analytical request
|             -> Go to 2
|
|-- 2. What is the minimum required rung?
|      |
|      |-- A. Rung 1: observational
|      |      Use when the question can be answered with:
|      |      - description of what happened
|      |      - association/correlation
|      |      - forecasting from observed patterns
|      |      - observational decomposition
|      |      - tentative contributors or hypotheses
|      |      |
|      |      Examples:
|      |      - "What happened to churn in March?"
|      |      - "What correlates with churn?"
|      |      - "Forecast next month's churn"
|      |      - "Why did churn spike in March?" (default case)
|      |      |
|      |      -> Go to 3
|      |
|      |-- B. Rung 2: interventional
|      |      Use when the question asks:
|      |      - what happens if we do/set/change X
|      |      - how to increase/decrease Y via intervention
|      |      - the effect of a policy/treatment/decision
|      |      |
|      |      Examples:
|      |      - "What happens if we cut price by 10%?"
|      |      - "How can we reduce churn?" (intervention sense)
|      |      - "What is the effect of campaign A on sales?"
|      |      |
|      |      -> Go to 4
|      |
|      |-- C. Rung 3: counterfactual / actual-cause
|             Use when the question asks:
|             - whether X was the reason for this particular outcome
|             - whether the outcome would still have happened without X
|             - but-for, responsibility, or actual-cause judgments
|             |
|             Examples:
|             - "Would churn have been lower if we had not changed onboarding?"
|             - "Was the onboarding change the reason churn spiked?"
|             - "Would this outage have happened without the cache flush?"
|             |
|             -> Go to 5
|
|-- 3. Rung 1 observational path
|      |
|      |-- 3a. Classify task form separately:
|      |      - describe
|      |      - predict
|      |      - explain
|      |      - advise
|      |      - compare
|      |      - teach
|      |      - critique
|      |
|      |-- 3b. Check presupposition guardrail
|      |      |
|      |      |-- If unsupported rung jump / direct mechanism claim is embedded
|      |      |     -> Route: ask_clarification
|      |      |     -> Challenge framing before analysis
|      |      |
|      |      |-- Otherwise
|      |            -> Route: open_rung1_analysis
|      |
|      |-- 3c. Allowed outputs
|      |      - descriptions and summaries
|      |      - associations and predictors
|      |      - forecasts
|      |      - observational decomposition
|      |      - explanatory hypotheses stated as hypotheses
|      |
|      |-- 3d. Forbidden outputs
|             - intervention-effect claims
|             - actual-cause verdicts
|             - direct mechanism claims presented as established
|
|-- 4. Rung 2 interventional path
|      |
|      |-- Required before estimation
|      |      - intervention/treatment defined
|      |      - outcome defined
|      |      - unit of analysis defined
|      |      - time horizon defined
|      |      - assumptions formalized explicitly
|      |
|      |-- If missing / not formalizable
|      |     -> Route: ask_clarification or blocked
|      |
|      |-- If formalizable
|            -> Route: open_rung2_study
|
|-- 5. Rung 3 counterfactual / actual-cause path
|      |
|      |-- Required before estimation
|      |      - factual outcome/case identified
|      |      - alternative state/action defined
|      |      - unit/case specificity explicit
|      |      - structural assumptions support counterfactual reasoning
|      |
|      |-- If missing / not formalizable
|      |     -> Route: ask_clarification or blocked
|      |
|      |-- If formalizable
|            -> Route: open_rung3_study
```

---

## Canonical classifier axes

## 1) Analytical mode

Allowed values:
- `ordinary_chat`
- `dataset_backed_analysis`

### Rule
A conceptual or educational discussion of causation does **not** become a rung-2 or rung-3 request just because it mentions causal ideas.

---

## 2) Required rung

Allowed values:
- `rung_1_observational`
- `rung_2_interventional`
- `rung_3_counterfactual`

### Interpretation rules

#### `rung_1_observational`
Use for:
- what happened
- what is associated with what
- what predicts what from observed patterns
- observational decomposition of changes
- tentative contributors and hypotheses

#### `rung_2_interventional`
Use for:
- what happens if we change X
- what is the effect of doing X
- how to change Y through an action or policy

#### `rung_3_counterfactual`
Use for:
- would Y still have happened without X
- was X the reason for this particular realized outcome
- actual-cause and but-for questions

---

## 3) Task form

Allowed values:
- `describe`
- `predict`
- `explain`
- `advise`
- `compare`
- `teach`
- `critique`
- `unknown`

### Rule
Task form is **not** a rung.

Examples:
- forecasting is usually `predict` at rung 1
- diagnostics are usually `explain` at rung 1 by default
- “how should we change pricing?” may be `advise` at rung 2
- “what is Pearl's ladder?” is `teach` in ordinary chat

---

## 4) Guardrail flag

Allowed values:
- `none`
- `unsupported_rung_jump`
- `unsupported_direct_mechanism`
- `unsupported_actual_cause_presupposition`

### Rule
The guardrail should fire when the user’s framing would tempt the system to answer a higher-rung question using lower-rung evidence.

Examples:
- observed pattern + “what mechanism caused it?” + no causal identification
- association + “what happens if we change X?” asked as if already established
- observed outcome + “was X the reason?” without counterfactual setup

---

## Standardized routing contract

Use this routing contract in the next implementation pass:

- `continue_chat`
- `open_rung1_analysis`
- `open_rung2_study`
- `open_rung3_study`
- `ask_clarification`
- `blocked`

### Routing policy

- ordinary conceptual/explanatory chat -> `continue_chat`
- `rung_1_observational` without guardrail problem -> `open_rung1_analysis`
- `rung_2_interventional` -> `open_rung2_study`
- `rung_3_counterfactual` -> `open_rung3_study`
- unresolved ambiguity -> `ask_clarification`
- non-formalizable or policy-blocked request -> `blocked`

---

## Claim-label policy

All user-visible answers must carry a claim label aligned to the rung actually used.

## Allowed claim labels

### Ordinary chat
- `CONCEPTUAL EXPLANATION`
- `COMPARATIVE EXPLANATION`
- `CRITIQUE`

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

## Guardrail rule

No branch may emit a claim label from a higher rung than the workflow supports.

Examples:
- rung-1 forecasting must not be labeled causal
- rung-1 diagnostic decomposition must not be labeled root-cause corroboration
- non-identified rung-2 or rung-3 runs must not be narrated as established effects

---

## Rung 1 observational branch requirements

The rung-1 branch may output:
- summaries
- counts and trends
- segment comparisons
- correlations and predictors
- supervised forecasts from observed patterns
- observational decomposition of changes
- tentative explanatory hypotheses

It must not output:
- intervention-effect claims
- actual-cause verdicts
- direct mechanism claims presented as established
- policy recommendations narrated as proven effects

### Communication rule

Rung-1 answers must clearly state that they are observational unless the user is in an ordinary conceptual chat mode.

---

## Rung 2 branch requirements

Before estimation, the system must make explicit:
- intervention/treatment
- outcome
- unit of analysis
- time horizon / analysis window
- assumptions or graph structure needed for identification

If these are missing, the system should clarify or block rather than silently downgrading the question to rung 1.

---

## Rung 3 branch requirements

Before estimation, the system must make explicit:
- the factual case or realized outcome being explained
- the alternative action/state
- the unit/case identity
- the structural assumptions supporting counterfactual reasoning

If these are missing, the system should clarify or block rather than substituting a looser “why” narrative.

---

## Canonical examples

- “What is Pearl’s ladder of causation?”
  - mode: ordinary chat
  - route: `continue_chat`

- “What correlates with churn?”
  - mode: analytical
  - rung: `rung_1_observational`
  - route: `open_rung1_analysis`

- “Forecast next month’s sales.”
  - mode: analytical
  - rung: `rung_1_observational`
  - task form: `predict`
  - route: `open_rung1_analysis`

- “Why did churn spike in March?”
  - default rung: `rung_1_observational`
  - task form: `explain`
  - route: `open_rung1_analysis`

- “What happens if we cut price by 10%?”
  - rung: `rung_2_interventional`
  - route: `open_rung2_study`

- “Would churn have been lower if we had not changed onboarding?”
  - rung: `rung_3_counterfactual`
  - route: `open_rung3_study`

- “We observed churn rose after onboarding changed; what mechanism caused it?”
  - rung need: not yet safely answerable at rung 1 as phrased
  - guardrail: `unsupported_direct_mechanism`
  - route: `ask_clarification`

---

## Current implementation delta to close later

The current codebase does **not** yet match this spec.

Notable gaps:
- mixed intent enums are still present in code and schema
- the current code still includes predictive-specific routing and workspace logic
- the current docs and code still use causal-first naming in places where the new architecture is rung-first and study-neutral
- the old observational mechanism policy is too narrow and should be replaced by a generalized presupposition guardrail
- some current prompts still tell the assistant to think in descriptive/diagnostic/predictive buckets first

---

## Implementation principle

When the user wording and the required rung disagree, the required rung wins.

When a lower-rung workflow can produce a plausible story but not a warranted higher-rung answer, the system must challenge or reframe the question instead of narrating the higher-rung claim optimistically.
