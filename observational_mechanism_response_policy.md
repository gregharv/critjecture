# Observational Mechanism Response Policy Classifier Specification

Status: compatibility wrapper  
Date: 2026-04-23

## Note

This document is now **superseded** by [`causal_presupposition_guardrail.md`](./causal_presupposition_guardrail.md).

The older observational-mechanism policy captured one important failure mode:

> observational pattern + mechanism request + directional presupposition + no causal identification

That remains valid, but it is now treated as one case inside a broader guardrail family.

## Replacement model

Use [`causal_presupposition_guardrail.md`](./causal_presupposition_guardrail.md) as the canonical authority for:

- unsupported observational -> intervention jumps
- unsupported direct mechanism claims from observational evidence
- unsupported actual-cause / but-for presuppositions
- clarification and reframing behavior before higher-rung routing

## Compatibility note

If older code or docs still refer to `loaded_mechanism_from_observation`, interpret it as the narrower predecessor of:

- `unsupported_direct_mechanism`

That alias should be removed during the implementation pass.
