# Observational Mechanism Response Policy Classifier Specification

Status: proposed implementation baseline  
Date: 2026-04-22

## Purpose

This spec defines how chat should respond when a user tries to extract a direct mechanism or root-cause story from observational evidence alone.

The goal is to avoid two failure modes:

1. treating correlation as if it already proves a mechanism
2. generating long lists of speculative pathways when the safer answer is a short epistemic correction

This policy is intentionally **generic**. It should apply across infrastructure, marketing, healthcare, operations, finance, and other domains without adding domain-specific prompt examples.

---

## Canonical question shape

Trigger this policy when the request has all of the following characteristics:

1. **observational evidence cue**  
   The user cites a pattern, association, or correlation in data.
2. **mechanism or explanation cue**  
   The user asks why the pattern happens or what mechanism/pathway explains it.
3. **directional presupposition cue**  
   The wording assumes or strongly implies that one observed variable directly forces the other.
4. **no causal identification cue**  
   The message does not include a causal design, intervention analysis, or identified causal result.

This is the canonical pattern:

> observational pattern + mechanism request + causal presupposition - causal identification

---

## Classifier output

The classifier should emit one of these values:

- `none`
- `loaded_mechanism_from_observation`

### `loaded_mechanism_from_observation`

Return this when the request asks for a direct mechanism from correlation or observational pattern evidence without causal identification.

This label is not a causal verdict. It is a **response-policy trigger**.

---

## Detection signals

### 1. Observational pattern cues

Examples of signals:

- correlation
- associated with
- related to
- relationship between
- statistically significant
- robust pattern
- we found / observed / identified
- as X drops, Y rises

### 2. Mechanism cues

Examples of signals:

- why
- explain
- explanation
- mechanism
- pathway
- root cause
- what drives
- how does
- through what process

### 3. Directional presupposition cues

Examples of signals:

- forces
- makes
- causes
- drives
- direct mechanism
- physical pathway
- by which
- what specific mechanism causes
- assuming the telemetry/data is accurate, what pathway forces...

### 4. Causal identification cues

If these are present, do **not** trigger this policy by default:

- experiment
- randomized / randomization
- natural experiment
- instrumental variable
- diff-in-diff
- regression discontinuity
- identified causal effect
- causal study / causal workspace result
- counterfactual estimate

---

## Routing behavior

If the classifier returns `loaded_mechanism_from_observation`:

1. **ask clarification first** if the user has not yet said whether they want:
   - a concise observational conclusion, or
   - a brainstormed list of conjectural mechanisms, or
   - a causal answer requiring causal workflow
2. default toward **challenging the direct-causation framing** rather than accepting it
3. do **not** open with a long mechanism catalog

---

## Clarification goal

The clarification should separate these intents:

- **concise observational conclusion**
- **hypothesis brainstorming**
- **causal testing / counterfactual answer**

Canonical clarification shape:

> Do you want to first challenge the direct-causation framing and check for a shared driver or confounding explanation, or do you only want conjectural mechanism hypotheses?

---

## Response policy modes

After clarification, use one of these modes.

### Mode A: `concise_observational_conclusion`

Use this when the user indicates that the pattern itself is enough, wants a concise answer, or rejects speculative hypothesis listing.

#### Required answer structure

1. confirm the pattern **if supported by data**
2. state that the observational pattern alone does **not** establish a direct mechanism
3. prefer a short common-cause explanation:
   - shared driver
   - synchronized demand
   - omitted context
   - confounding
4. stop there unless the user asks for more

#### Style rules

- maximum about 4 to 6 sentences
- no long bullet dump
- no speculative pathway catalog
- no domain-specific mechanism inflation from correlation alone

### Mode B: `hypothesis_brainstorm`

Use this only if the user explicitly asks for possible mechanisms anyway.

#### Required answer structure

1. say the mechanisms are conjectural
2. keep the list short
3. avoid presenting any pathway as established fact
4. remind the user that correlation alone does not identify the mechanism

### Mode C: `challenge_direct_framing`

Use this when the user explicitly asks to pressure-test the framing or mentions shared drivers/confounding.

#### Required answer structure

1. confirm that the observed pattern could be real
2. say the direct causal story is not established
3. emphasize shared-driver/confounding explanations first
4. optionally name one or two broad classes of alternative explanation

---

## Follow-up reply interpretation

When the system previously asked the loaded-mechanism clarification question, short follow-up replies should be interpreted into one of the policy modes.

Examples:

- "just look at the correlation" -> `concise_observational_conclusion`
- "there is a pattern" -> `concise_observational_conclusion`
- "brainstorm mechanisms anyway" -> `hypothesis_brainstorm`
- "check for shared drivers first" -> `challenge_direct_framing`

This lets the system avoid repeating the clarification and prevents generic prompt bloat.

---

## Non-goals

This policy does **not**:

- prove that no mechanism exists
- replace the causal workspace
- forbid mechanism brainstorming when the user explicitly requests conjectures
- classify all why-questions as overreach

It only governs a narrow but common failure mode:

> inferring a direct mechanism from observational pattern evidence alone

---

## Implementation note

This policy should live in a centralized classifier/helper module rather than being expanded into the chat system prompt with many concrete examples.
