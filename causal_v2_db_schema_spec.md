# Critjecture V2 Rung-First Database Schema Specification

## Purpose

This document defines the **clean-slate V2 database schema plan** for Critjecture as a **rung-first analytical product**.

The main offering is no longer best described as:
- a chat-first product with optional predictive and causal side routes, or
- a causal-first product with descriptive/predictive exceptions.

The new schema should instead reflect this product promise:

1. first decide whether a request is **ordinary chat** or **dataset-backed analysis**
2. if analytical, classify the **minimum required Pearl rung**
3. classify **task form** separately
4. classify any **unsupported causal presupposition** separately
5. route into one of:
   - ordinary chat
   - rung-1 observational analysis
   - rung-2 interventional study
   - rung-3 counterfactual study
6. make it structurally difficult to emit higher-rung claims from lower-rung workflows

---

## Non-negotiable product rule

The V2 schema must make it structurally difficult to commit epistemic overreach.

That means the schema must support and enforce the following:

- routing happens before dataset-backed answer generation
- ordinary chat remains distinct from analytical workflows
- rung-1 results cannot be silently narrated as rung-2 or rung-3 findings
- higher-rung runs cannot exist without explicit pinned inputs and assumptions
- unsupported presuppositions remain explicit and auditable
- final answers point to the exact study, run, package, and assumptions used
- if a higher-rung effect is not identifiable, that state remains durable and visible

---

## V2 design stance

## What V2 is built around

The new top-level product object is an **analysis study**.

An analysis study owns:
- the user’s analytical question
- classification history
- dataset bindings
- observational work state where relevant
- graph/assumption state where relevant
- missing data requirements
- approvals
- runs
- result packages
- grounded final answers

## What V2 is not built around

The schema is no longer centered on:
- conversations as the main product object
- predictive-only runs as the main non-causal product object
- generic workflows as the main analytical container
- assistant/tool traces as the primary analytical record

Those can remain as legacy or supporting subsystems, but they are not the V2 product core.

---

## Implementation-readiness decisions

The following decisions are resolved for implementation unless product scope changes materially.

### 1) `analysis_studies` is the canonical top-level product object

All primary V2 UI, API, and persistence flows should anchor on `analysis_studies`.

### 2) No backward compatibility is required for the primary path

Legacy chat, predictive, and causal route shapes may be archived or shimmed, but they do not constrain the V2 schema.

### 3) Routing contracts are standardized

Use only:
- `continue_chat`
- `open_rung1_analysis`
- `open_rung2_study`
- `open_rung3_study`
- `ask_clarification`
- `blocked`

### 4) Classification is factored into separate axes

Do **not** store a mixed intent bucket as the primary classification field.

Store separately:
- analytical mode
- required rung
- task form
- guardrail flag
- routing decision

### 5) `current_*` and `active_version_id` pointer columns are soft pointers in V2.0

These remain convenience cursors for fast UI loading, not the historical source of truth.

### 6) Exactly one active primary dataset binding is required before higher-rung approval and run creation

A study may have multiple candidate or auxiliary datasets, but:
- at most one binding may be the active `primary`
- one active `primary` binding is required before approval for rung-2/rung-3 studies
- one active `primary` binding is required before creating a higher-rung run

### 7) Higher-rung focal fields are pinned on runs

For auditability, runs must explicitly pin the rung-specific focal fields they depend on.

Examples:
- rung 2: intervention node/key, outcome node/key
- rung 3: factual case reference, alternative state/action, outcome node/key

### 8) All rung-1 work belongs to one canonical surface

The schema should not encode predictive/associational work as a separate top-level epistemic product line.

### 9) Claim labels must align with rung

The schema and answer-package model must not make it easy to emit a stronger claim label than the workflow supports.

---

# 1) Legacy concepts to retire or demote from the primary path

## A. Remove from the primary V2 product schema

The following V1/V1.5 concepts should not be treated as canonical for the new analytical core:
- `conversations`
- `chat_turns`
- `tool_calls`
- `assistant_messages`
- predictive-only product objects as the canonical non-causal path
- mixed-intent classification enums as the canonical router output
- claim labels that let rung-1 work masquerade as higher-rung findings

## B. Replace with V2 models

| Older concept | V2 replacement | Reason |
| --- | --- | --- |
| predictive / causal split | rung-first study routing | task form and rung must be separate |
| causal study | analysis study | top-level model must cover all analytical modes |
| mixed intent bucket | factored classification axes | clearer and auditable |
| predictive run | rung-1 observational run | forecasting is a rung-1 workflow flavor |
| causal run | higher-rung analytical run | rung 2 and rung 3 remain distinct |

---

# 2) V2 schema modules

The V2 schema is organized into these modules:

1. Identity and tenancy
2. Commercial and org policy
3. Dataset registry
4. Reference evidence and documents
5. Analysis intake and study workspace
6. Graph/assumption authoring and approvals
7. Analytical execution and inference results
8. Output grounding and answer history
9. Operations, compliance, and governance

---

# 3) Canonical entity graph

The intended entity graph for V2 is:

- organization
  - memberships
  - settings
  - datasets
    - dataset_versions
      - dataset_version_columns
      - dataset_version_column_profiles
  - reference_documents
    - reference_document_versions
      - reference_document_chunks
  - analysis_studies
    - study_questions
      - analysis_classifications
    - study_messages
    - study_dataset_bindings
    - study_reference_links
    - analysis_graphs
      - analysis_graph_versions
        - analysis_graph_nodes
        - analysis_graph_edges
        - analysis_assumptions
        - analysis_data_requirements
    - study_approvals
    - analysis_runs
      - analysis_run_dataset_bindings
      - analysis_identifications
      - analysis_estimands
      - analysis_estimates
      - analysis_refutations
      - run_artifacts
    - answer_packages
      - answers
  - compliance/governance/ops modules

---

# 4) Canonical enums

## Identity and tenancy

These remain mostly unchanged from the current product and are omitted here unless analytical routing depends on them.

---

## Analysis routing and intake

### `analysis_studies.status`
- `draft`
- `awaiting_dataset`
- `awaiting_setup`
- `awaiting_approval`
- `ready_to_run`
- `running`
- `completed`
- `blocked`
- `archived`

### `study_questions.status`
- `open`
- `clarifying`
- `ready`
- `closed`
- `archived`

### `analysis_classifications.analysis_mode`
- `ordinary_chat`
- `dataset_backed_analysis`

### `analysis_classifications.required_rung`
- `rung_1_observational`
- `rung_2_interventional`
- `rung_3_counterfactual`

### `analysis_classifications.task_form`
- `describe`
- `predict`
- `explain`
- `advise`
- `compare`
- `teach`
- `critique`
- `unknown`

### `analysis_classifications.guardrail_flag`
- `none`
- `unsupported_rung_jump`
- `unsupported_direct_mechanism`
- `unsupported_actual_cause_presupposition`

### `analysis_classifications.routing_decision`
- `continue_chat`
- `open_rung1_analysis`
- `open_rung2_study`
- `open_rung3_study`
- `ask_clarification`
- `blocked`

### `study_messages.author_type`
- `user`
- `assistant`
- `system`

### `study_messages.message_kind`
- `question`
- `clarification`
- `classification_notice`
- `dataset_binding_notice`
- `analysis_note`
- `approval_notice`
- `run_summary`
- `final_answer`

### `study_dataset_bindings.binding_role`
- `primary`
- `auxiliary`
- `candidate`
- `external_requirement`

---

## Graph/assumption modeling

### `analysis_graphs.status`
- `draft`
- `ready_for_approval`
- `approved`
- `superseded`
- `archived`

### `analysis_graph_nodes.node_type`
- `observed_feature`
- `intervention`
- `outcome`
- `confounder`
- `mediator`
- `collider`
- `instrument`
- `selection`
- `latent`
- `external_data_needed`
- `factual_case_anchor`
- `alternative_state_anchor`
- `note`

### `analysis_graph_nodes.source_type`
- `dataset`
- `user`
- `system`

### `analysis_graph_nodes.observed_status`
- `observed`
- `unobserved`
- `missing_external`

### `analysis_assumptions.assumption_type`
- `no_unmeasured_confounding`
- `positivity`
- `consistency`
- `measurement_validity`
- `selection_ignorability`
- `instrument_validity`
- `frontdoor_sufficiency`
- `counterfactual_consistency`
- `counterfactual_case_definition`
- `custom`

### `analysis_assumptions.status`
- `draft`
- `accepted`
- `rejected`
- `superseded`

### `study_approvals.approval_kind`
- `study_setup`
- `graph_signoff`
- `run_authorization`

---

## Execution and results

### `analysis_runs.run_kind`
- `rung_1_observational`
- `rung_2_interventional`
- `rung_3_counterfactual`

### `analysis_runs.status`
- `queued`
- `running`
- `completed`
- `failed`
- `cancelled`

### `analysis_identifications.status`
- `not_required`
- `identified`
- `not_identified`
- `blocked`

### `analysis_refutations.status`
- `pass`
- `mixed`
- `fail`
- `not_run`

### `answer_packages.claim_label`
- `CONCEPTUAL EXPLANATION`
- `COMPARATIVE EXPLANATION`
- `CRITIQUE`
- `OBSERVATIONAL DESCRIPTION`
- `OBSERVATIONAL ASSOCIATION`
- `OBSERVATIONAL FORECAST`
- `OBSERVATIONAL EXPLANATORY HYPOTHESES`
- `INTERVENTIONAL QUESTION NOT YET IDENTIFIED`
- `INTERVENTIONAL ESTIMATE`
- `INTERVENTIONAL ESTIMATE, ASSUMPTION-SENSITIVE`
- `INTERVENTIONAL CLAIM FALSIFIED`
- `COUNTERFACTUAL QUESTION NOT YET IDENTIFIED`
- `COUNTERFACTUAL ESTIMATE`
- `ACTUAL-CAUSE ASSESSMENT, ASSUMPTION-SENSITIVE`
- `COUNTERFACTUAL CLAIM FALSIFIED`

### Claim-label prohibition

The schema and app logic must not allow a rung-1 run to persist a rung-2 or rung-3 claim label.

---

# 5) Core tables

## 5.1 `analysis_studies`

### Purpose
Top-level saved object for all analytical work.

### Core columns
- `id` text PK
- `organization_id` FK -> `organizations.id`
- `title` text nullable
- `status` text not null
- `current_question_id` text nullable soft pointer
- `current_graph_id` text nullable soft pointer
- `current_graph_version_id` text nullable soft pointer
- `current_run_id` text nullable soft pointer
- `current_answer_id` text nullable soft pointer
- `created_by_user_id` FK -> `users.id` nullable
- `created_at` integer not null
- `updated_at` integer not null

### Notes
This replaces `causal_studies` as the canonical top-level object.

---

## 5.2 `study_questions`

### Purpose
Captures the analytical question(s) asked within a study.

### Core columns
- `id` text PK
- `study_id` FK -> `analysis_studies.id`
- `organization_id` FK -> `organizations.id`
- `asked_by_user_id` FK -> `users.id` nullable
- `question_text` text not null
- `status` text not null default `open`
- `proposed_focus_label` text nullable
- `metadata_json` text not null default `{}`
- `created_at` integer not null
- `updated_at` integer not null

### Notes
This table should not encode mixed-intent question types as the primary classifier output. That information belongs in `analysis_classifications`.

---

## 5.3 `analysis_classifications`

### Purpose
Stores preflight routing results. This is a control-plane table, not a convenience log.

### Core columns
- `id` text PK
- `study_question_id` FK -> `study_questions.id`
- `organization_id` FK -> `organizations.id`
- `classifier_model_name` text not null
- `classifier_prompt_version` text not null
- `raw_output_json` text not null
- `analysis_mode` text not null
- `required_rung` text nullable
- `task_form` text not null
- `guardrail_flag` text not null
- `confidence` real not null
- `reason_text` text not null
- `routing_decision` text not null
- `created_at` integer not null

### Constraints
- preserve all attempts; do not update in place
- `required_rung` may be null only when `analysis_mode = 'ordinary_chat'`
- `continue_chat` is valid only for `analysis_mode = 'ordinary_chat'`
- higher-rung routes require non-null `required_rung`

### Notes
This table replaces the mixed `intent_type` approach.

---

## 5.4 `study_messages`

### Purpose
Structured study-specific message history for user, system, and assistant notices.

### Core columns
- `id` text PK
- `study_id` FK -> `analysis_studies.id`
- `organization_id` FK -> `organizations.id`
- `author_type` text not null
- `author_user_id` FK -> `users.id` nullable
- `message_kind` text not null
- `content_text` text not null
- `metadata_json` text not null default `{}`
- `created_at` integer not null

---

## 5.5 `study_dataset_bindings`

### Purpose
Declares which datasets a study is allowed to use and in what role.

### Core columns
- `id` text PK
- `study_id` FK -> `analysis_studies.id`
- `organization_id` FK -> `organizations.id`
- `dataset_id` FK -> `datasets.id`
- `dataset_version_id` FK -> `dataset_versions.id` nullable
- `binding_role` text not null
- `is_active` integer/boolean not null default true
- `binding_note` text nullable
- `created_by_user_id` FK -> `users.id` nullable
- `created_at` integer not null
- `updated_at` integer not null

### Constraints
- unique (`study_id`, `dataset_id`, `binding_role`)
- partial unique index recommended on `study_id` where `binding_role = 'primary'` and `is_active = 1`

### Notes
Exactly one active `primary` binding is required before higher-rung approval and run creation.

---

## 5.6 `analysis_graphs`

### Purpose
Logical graph/structure container for higher-rung analytical setup.

### Core columns
- `id` text PK
- `study_id` FK -> `analysis_studies.id`
- `organization_id` FK -> `organizations.id`
- `status` text not null
- `current_version_id` text nullable soft pointer
- `created_by_user_id` FK -> `users.id` nullable
- `created_at` integer not null
- `updated_at` integer not null

### Notes
Rung 1 does not require graph authoring by default, but the same study can still own graph state for escalation to rung 2 or rung 3.

---

## 5.7 `analysis_graph_versions`

### Purpose
Immutable saved graph/assumption versions.

### Core columns
- `id` text PK
- `graph_id` FK -> `analysis_graphs.id`
- `study_id` FK -> `analysis_studies.id`
- `organization_id` FK -> `organizations.id`
- `required_rung` text not null
- `graph_json` text not null
- `intervention_node_key` text nullable
- `outcome_node_key` text nullable
- `factual_case_node_key` text nullable
- `alternative_state_node_key` text nullable
- `created_by_user_id` FK -> `users.id` nullable
- `created_at` integer not null

### Constraints
- rung-2 graph versions require `intervention_node_key` and `outcome_node_key`
- rung-3 graph versions require `factual_case_node_key`, `alternative_state_node_key`, and `outcome_node_key`

---

## 5.8 `analysis_graph_nodes`

### Purpose
Normalized node persistence for auditability and querying.

### Core columns
- `id` text PK
- `graph_version_id` FK -> `analysis_graph_versions.id`
- `node_key` text not null
- `node_label` text not null
- `node_type` text not null
- `source_type` text not null
- `dataset_version_column_id` FK -> `dataset_version_columns.id` nullable
- `observed_status` text not null
- `metadata_json` text not null default `{}`

---

## 5.9 `analysis_graph_edges`

### Purpose
Normalized directed edges for graph versions.

### Core columns
- `id` text PK
- `graph_version_id` FK -> `analysis_graph_versions.id`
- `from_node_key` text not null
- `to_node_key` text not null
- `metadata_json` text not null default `{}`

---

## 5.10 `analysis_assumptions`

### Purpose
Stores explicit assumptions tied to a graph version.

### Core columns
- `id` text PK
- `graph_version_id` FK -> `analysis_graph_versions.id`
- `assumption_type` text not null
- `status` text not null
- `assumption_text` text not null
- `created_by_user_id` FK -> `users.id` nullable
- `created_at` integer not null

---

## 5.11 `analysis_data_requirements`

### Purpose
Tracks missing external data or unresolved setup requirements.

### Core columns
- `id` text PK
- `study_id` FK -> `analysis_studies.id`
- `graph_version_id` FK -> `analysis_graph_versions.id` nullable
- `requirement_text` text not null
- `status` text not null default `open`
- `created_at` integer not null
- `updated_at` integer not null

---

## 5.12 `study_approvals`

### Purpose
Persist sign-off on higher-rung setup and assumptions.

### Core columns
- `id` text PK
- `study_id` FK -> `analysis_studies.id`
- `graph_version_id` FK -> `analysis_graph_versions.id` nullable
- `approval_kind` text not null
- `approved_by_user_id` FK -> `users.id` nullable
- `approval_text` text not null
- `created_at` integer not null

---

## 5.13 `analysis_runs`

### Purpose
Top-level run record for study-backed analytical execution.

### Core columns
- `id` text PK
- `study_id` FK -> `analysis_studies.id`
- `study_question_id` FK -> `study_questions.id`
- `organization_id` FK -> `organizations.id`
- `run_kind` text not null
- `status` text not null
- `primary_dataset_version_id` FK -> `dataset_versions.id` nullable
- `graph_version_id` FK -> `analysis_graph_versions.id` nullable
- `intervention_node_key` text nullable
- `outcome_node_key` text nullable
- `factual_case_node_key` text nullable
- `alternative_state_node_key` text nullable
- `requested_by_user_id` FK -> `users.id` nullable
- `created_at` integer not null
- `updated_at` integer not null

### Constraints
- rung-1 runs may omit graph fields
- rung-2 runs require `primary_dataset_version_id`, `graph_version_id`, `intervention_node_key`, and `outcome_node_key`
- rung-3 runs require `primary_dataset_version_id`, `graph_version_id`, `factual_case_node_key`, `alternative_state_node_key`, and `outcome_node_key`

---

## 5.14 `analysis_run_dataset_bindings`

### Purpose
Pins all dataset versions used by a run.

### Core columns
- `id` text PK
- `run_id` FK -> `analysis_runs.id`
- `dataset_id` FK -> `datasets.id`
- `dataset_version_id` FK -> `dataset_versions.id`
- `binding_role` text not null
- `created_at` integer not null

---

## 5.15 `analysis_identifications`

### Purpose
Stores whether the requested higher-rung quantity was identified.

### Core columns
- `id` text PK
- `run_id` FK -> `analysis_runs.id`
- `status` text not null
- `method_name` text nullable
- `details_json` text not null default `{}`
- `created_at` integer not null

### Notes
For rung-1 runs, `status = 'not_required'` is allowed and expected.

---

## 5.16 `analysis_estimands`

### Purpose
Stores formal estimands when identification succeeds.

### Core columns
- `id` text PK
- `run_id` FK -> `analysis_runs.id`
- `identification_id` FK -> `analysis_identifications.id`
- `estimand_text` text not null
- `metadata_json` text not null default `{}`
- `created_at` integer not null

---

## 5.17 `analysis_estimates`

### Purpose
Stores estimates or observational result summaries, depending on run kind.

### Core columns
- `id` text PK
- `run_id` FK -> `analysis_runs.id`
- `estimand_id` FK -> `analysis_estimands.id` nullable
- `result_json` text not null
- `metadata_json` text not null default `{}`
- `created_at` integer not null

### Notes
This table may hold:
- rung-1 observational summaries/forecasts
- rung-2 effect estimates
- rung-3 counterfactual estimates

But the claim label must still be enforced by run kind and answer-package rules.

---

## 5.18 `analysis_refutations`

### Purpose
Stores robustness and refutation results where applicable.

### Core columns
- `id` text PK
- `run_id` FK -> `analysis_runs.id`
- `status` text not null
- `refutation_kind` text not null
- `details_json` text not null default `{}`
- `created_at` integer not null

---

## 5.19 `answer_packages`

### Purpose
Stores the grounded package from which final answers must be generated.

### Core columns
- `id` text PK
- `study_id` FK -> `analysis_studies.id`
- `study_question_id` FK -> `study_questions.id`
- `run_id` FK -> `analysis_runs.id` nullable
- `required_rung` text nullable
- `task_form` text not null
- `guardrail_flag` text not null
- `claim_label` text not null
- `package_json` text not null
- `created_at` integer not null

### Constraints
- if `required_rung = 'rung_1_observational'`, `claim_label` must be one of the rung-1 labels
- if `required_rung = 'rung_2_interventional'`, `claim_label` must be one of the rung-2 labels
- if `required_rung = 'rung_3_counterfactual'`, `claim_label` must be one of the rung-3 labels
- if `required_rung` is null, only ordinary-chat labels are allowed

---

## 5.20 `answers`

### Purpose
User-visible grounded answer history.

### Core columns
- `id` text PK
- `study_id` FK -> `analysis_studies.id`
- `study_question_id` FK -> `study_questions.id`
- `answer_package_id` FK -> `answer_packages.id`
- `content_text` text not null
- `created_at` integer not null

---

# 6) Operational notes

## Dataset registry, reference documents, compute runs, artifacts, billing, compliance, and governance

These modules largely carry forward existing V2-ready work, but they must be renamed or reconnected to the new analytical core where needed.

Key rule:
- no supporting operational module should reintroduce the old mixed intent taxonomy into the primary study/run path.

---

# 7) Pointer strategy

The following may remain soft pointers in V2.0:
- `datasets.active_version_id`
- `reference_documents.active_version_id`
- `analysis_studies.current_question_id`
- `analysis_studies.current_graph_id`
- `analysis_studies.current_graph_version_id`
- `analysis_studies.current_run_id`
- `analysis_studies.current_answer_id`

Reason:
- immutable truth still lives in versioned and run-level tables
- soft pointers reduce circular-FK complexity
- UI loading remains fast

---

# 8) Migration posture

## Phase 1 documentation posture

The docs are now locked to:
- `analysis_studies` instead of `causal_studies`
- factored routing axes instead of mixed intent buckets
- one rung-1 observational surface instead of a predictive-first split

## Implementation posture

Code and SQL may temporarily need compatibility adapters while the repo transitions, but the schema target state is the rung-first model described here.

---

# 9) Acceptance criteria for the V2 schema rewrite

The V2 DB rewrite is ready when:

1. the primary product entity is `analysis_studies`
2. no new primary product path depends on conversations, predictive-only containers, or old causal-study naming
3. all analytical questions are classified with separate fields for mode, rung, task form, and guardrail
4. all higher-rung runs reference exact dataset versions and explicit higher-rung setup fields
5. approvals are stored for the exact graph/setup version used
6. unsupported presuppositions remain explicit and queryable
7. answer packages enforce claim-label compatibility with rung
8. the old mixed intent taxonomy is archived, not active

---

# 10) Final recommendation

Do not treat this as a minor schema patch.

This should be a **true V2 schema reset** where the database itself reflects the product’s strongest promise:

> Critjecture classifies analytical questions by the minimum Pearl rung required for a non-misleading answer, stores task form and presupposition risk separately, and refuses to let lower-rung workflows masquerade as higher-rung knowledge.
