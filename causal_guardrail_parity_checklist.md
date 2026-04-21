# Causal Guardrail Plan Parity Checklist

This checklist tracks the remaining implementation items needed to align the codebase with `causal_guardrail_implementation_plan.md`.

## Status key
- [x] implemented
- [~] partially implemented
- [ ] not implemented

## Guardrail-critical core
- [x] causal intake runs before dataset analysis
- [x] causal studies are the top-level V2 object
- [x] exact primary dataset version pinning before DAG approval and run creation
- [x] explicit observed / unobserved / missing-external DAG variables
- [x] DAG approval flow with sign-off text
- [x] run-level pinning on dataset version, DAG version, treatment, outcome
- [x] identification / estimation / refutation persistence
- [x] honest `not_identifiable` storage and UI behavior
- [x] causal answer packages
- [x] grounded final answers generated from stored packages only

## Remaining parity items
1. [x] make `/causal` the default authenticated landing surface
2. [x] add intervention-question treatment / outcome suggestion prefill into study workspace
3. [x] add DAG draft autosave behavior
4. [x] add recommended study routes parity:
   - [x] `POST /api/causal/studies`
   - [x] `PATCH /api/causal/studies/[studyId]`
5. [x] broaden execution parity toward the plan’s narrow initial estimator/refutation set
   - [x] backdoor propensity-score adjustment for supported binary treatments
   - [x] random common cause refutation
   - [x] subset robustness refutation
6. [~] dedicated causal runner posture for PyWhy / DoWhy
   - [x] environment validation completed
   - [x] dedicated runner path and selection support completed
   - [x] DoWhy execution path implemented when a dedicated runner is configured
7. [x] add non-identifiable end-to-end UI coverage

## Notes
- The checked local Python environments still do not currently include DoWhy / PyWhy, so the default observed runtime remains the honest `hybrid` path unless a dedicated runner is configured.
- Dedicated runner selection and DoWhy execution code paths are implemented, but they are not exercised by the current local environment because DoWhy is not installed there.
- Schema authority still wins where it conflicts with wording in the guardrail plan.
