# Causal Presupposition Guardrail Specification

Status: proposed implementation baseline  
Date: 2026-04-23  
Related documents: [`analysis_routing_decision_tree.md`](./analysis_routing_decision_tree.md), [`causal_guardrail_implementation_plan.md`](./causal_guardrail_implementation_plan.md)

## Purpose

This spec defines how Critjecture should respond when a user’s framing tries to smuggle in a higher-rung conclusion than the available evidence or workflow supports.

This replaces the narrower idea of a one-off `loaded_mechanism_from_observation` policy.

The goal is to avoid three common failures:

1. treating observational patterns as if they already identify intervention effects
2. treating observational patterns as if they already identify direct mechanisms
3. treating an observed outcome as if the system can already answer an actual-cause or but-for question

---

## Core rule

The guardrail should fire when the user’s question would tempt the system to answer a **higher-rung question using lower-rung support**.

The trigger is not “the user mentioned causation.”

The trigger is:
- unsupported rung jump,
- unsupported direct-mechanism story,
- or unsupported actual-cause presupposition.

---

## Classifier output

The classifier should emit one of these values:

- `none`
- `unsupported_rung_jump`
- `unsupported_direct_mechanism`
- `unsupported_actual_cause_presupposition`

### `none`
No special presupposition problem detected.

### `unsupported_rung_jump`
The request moves from observational evidence to an intervention or counterfactual answer without the setup needed to support that jump.

Examples:
- “X is associated with churn, so what happens if we increase X?”
- “These patterns predict churn, so which lever should we change to reduce it?”

### `unsupported_direct_mechanism`
The request asks for a mechanism or pathway as if an observational pattern already establishes direct causation.

Examples:
- “We observed churn rose after onboarding changed; what mechanism caused it?”
- “As response time rises, CSAT falls; what pathway forces that?”

### `unsupported_actual_cause_presupposition`
The request asks whether X was the reason for a particular realized outcome without the case-specific counterfactual setup needed to answer that question.

Examples:
- “Was the onboarding change the reason churn spiked in March?”
- “Was the cache flush why this outage happened?”

---

## Detection signals

## 1) Observational evidence cues

Examples:
- correlation
- associated with
- related to
- relationship between
- statistically significant
- pattern in the data
- we observed / found / identified
- as X rises, Y falls

## 2) Intervention cues

Examples:
- what happens if we do X
- if we change / increase / decrease / remove X
- effect of X on Y
- how can we increase / reduce / improve Y

## 3) Mechanism cues

Examples:
- why
- explain
- mechanism
- pathway
- root cause
- what drives
- through what process

## 4) Actual-cause / counterfactual cues

Examples:
- was X the reason
- would Y still have happened without X
- but for X
- if we had not done X
- would this have happened anyway

## 5) Causal identification cues

If these are present, do **not** trigger the guardrail by default just because causal language appears:
- experiment
- randomized / randomization
- natural experiment
- instrumental variable
- diff-in-diff
- regression discontinuity
- identified causal effect
- causal study / rung-2 study / rung-3 study result
- counterfactual estimate

---

## Routing behavior

If the classifier returns anything other than `none`:

1. **do not answer the presupposed higher-rung question directly**
2. **challenge or reframe the presupposition first**
3. offer one of these next steps:
   - a safer rung-1 observational answer
   - a clarification that distinguishes rung 1 vs rung 2 vs rung 3
   - escalation into the appropriate higher-rung study workflow

### Default routing guidance

- unsupported mechanism framing from observational evidence -> `ask_clarification`
- unsupported intervention jump from observational evidence -> `ask_clarification`
- unsupported actual-cause question without counterfactual setup -> `ask_clarification`
- non-formalizable or policy-blocked higher-rung request -> `blocked`

---

## Clarification goal

The clarification should separate the user’s real goal into one of these buckets:

- **rung-1 observational answer**
- **conjectural hypotheses only**
- **rung-2 intervention answer**
- **rung-3 counterfactual / actual-cause answer**

### Canonical clarification shapes

#### For unsupported mechanism framing
> Do you want a careful observational explanation with possible hypotheses only, or do you want to set this up as a higher-rung intervention/counterfactual study rather than assuming the mechanism is already established?

#### For unsupported intervention jump
> Do you want an observational read on what is associated with the outcome, or do you want to open an intervention study about what would happen if you changed this variable?

#### For unsupported actual-cause framing
> Do you want an observational explanation of what was happening around this outcome, or do you want to frame this as a counterfactual question about whether the outcome would still have happened without that factor?

---

## Response policy modes

After clarification, use one of these modes.

## Mode A: `safe_rung1_answer`

Use this when the user wants the lower-rung answer or when the guardrail should correct the framing first.

### Required answer structure
1. confirm the observational pattern only if supported
2. state that this does **not** by itself establish the higher-rung claim
3. provide the safest lower-rung answer available
4. stop unless the user explicitly asks to escalate

### Examples
- association instead of intervention effect
- hypotheses instead of direct mechanism claim
- observational contributors instead of actual-cause verdict

---

## Mode B: `hypothesis_brainstorm`

Use only if the user explicitly wants conjectures anyway.

### Required answer structure
1. state that the list is conjectural
2. keep it short
3. do not present any item as established fact
4. remind the user that a higher-rung claim is not identified yet

---

## Mode C: `escalate_to_rung2`

Use when the user explicitly wants an intervention answer.

### Required answer structure
1. explain that the requested answer is a rung-2 question
2. state what must be defined to study it
3. route into the rung-2 study flow

---

## Mode D: `escalate_to_rung3`

Use when the user explicitly wants an actual-cause or counterfactual answer.

### Required answer structure
1. explain that the requested answer is a rung-3 question
2. state what factual case and alternative state must be defined
3. route into the rung-3 study flow

---

## Non-goals

This guardrail does **not**:
- forbid discussion of causation as a concept
- forbid hypothesis generation when clearly labeled as conjectural
- claim that no mechanism exists
- replace higher-rung study workflows
- classify every “why” question as unsafe

It only governs a specific failure mode:

> answering a higher-rung question as if it were already justified by lower-rung evidence

---

## Implementation note

This policy should live in a centralized classifier/helper module and should be used by:
- intake routing
- clarification generation
- chat prompt policy
- rung-1 answer-labeling logic

It should not be implemented as a long pile of one-off prompt examples.
