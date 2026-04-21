# Critjecture V2 Causal-First Database Schema Specification

## Purpose

This document defines the **clean-slate V2 database schema plan** for Critjecture as a **causal-first product**.

The current chat-first and generic workflow-first data model is not the right foundation for the product we are building. The main offering is no longer “ask a question in chat and maybe save a workflow.” The main offering is:

- classify whether the request is causal before any data analysis
- force causal questions into a DAG-centered workflow
- capture explicit assumptions, missing variables, and approvals
- run identification, estimation, and refutation via PyWhy / DoWhy
- generate final answers only from the causal result package
- prevent inductive errors, especially correlation-to-causation mistakes

This schema spec therefore plans to:

1. **remove the old chat/workflow model from the primary product path**
2. **replace it with a causal-study-centered schema**
3. **make dataset versions, DAG versions, approvals, estimands, and refutations first-class durable objects**
4. **preserve only the foundational identity, org, compliance, billing, and operational controls that still make sense in V2**

---

## Non-negotiable product rule

The V2 schema must make it structurally difficult to commit inductive errors.

That means the schema must support and enforce the following:

- a causal question is classified before analysis begins
- a causal run cannot exist without a pinned dataset version
- a causal run cannot exist without a pinned DAG version
- a DAG version must preserve missing and unobserved variables explicitly
- a final causal answer must point to the exact run, identification result, estimands, assumptions, and limitations used
- if an effect is not identifiable, that state must be durable and visible; it must never be overwritten by descriptive summaries framed as causal conclusions

---

## V2 design stance

### What V2 is built around

The new top-level product object is a **causal study**.

A causal study owns:

- the user’s causal question
- the intent-classification history
- the dataset binding(s)
- the DAG and its versions
- missing data requirements
- explicit assumptions
- approval/signoff
- causal runs
- estimation/refutation outputs
- grounded final answers

### What V2 is not built around

The schema will no longer be centered on:

- generic conversations
- generic chat turns
- generic assistant messages
- raw tool call traces as the primary product record
- generic workflow definitions
- generic workflow runs
- chart-payload cache tables as the central analytic artifact

Those patterns are not the right abstraction for the causal product.

---

## Implementation-readiness decisions

The following decisions are resolved for implementation and should not be reopened unless product scope changes materially.

### 1) `causal_studies` is the canonical top-level product object

All primary V2 UI, API, and persistence flows should anchor on `causal_studies`.

### 2) No backward compatibility is required

The old chat/workflow model is legacy-only. It may be archived, but it should not constrain V2 route design, schema design, or UI design.

### 3) Routing contracts are standardized

Use only:
- `continue_descriptive`
- `open_causal_study`
- `ask_clarification`
- `blocked`

### 4) `current_*` and `active_version_id` pointer columns are **soft pointers** in V2.0

For V2.0, the following columns are indexed pointer fields, not foreign-key-enforced references:
- `datasets.active_version_id`
- `reference_documents.active_version_id`
- `causal_studies.current_question_id`
- `causal_studies.current_dag_id`
- `causal_studies.current_dag_version_id`
- `causal_studies.current_run_id`
- `causal_studies.current_answer_id`

Reason:
- this avoids circular-FK complexity in the baseline schema
- immutable source-of-truth state still lives in the versioned and run tables themselves
- the pointer fields are convenience cursors for fast UI loading, not the authoritative historical record

### 5) Exactly one active primary dataset binding is required before DAG approval and run creation

A study may have multiple candidate or auxiliary datasets, but:
- at most one binding may be the active `primary`
- one active `primary` binding is required before DAG approval
- one active `primary` binding is required before creating a `causal_run`

### 6) Treatment and outcome are pinned on both DAG versions and runs

They remain visible on `causal_dag_versions`, but `causal_runs` also pin:
- `primary_dataset_version_id`
- `treatment_node_key`
- `outcome_node_key`

This makes run-level auditability explicit and self-contained.

### 7) There is no `causal_study_versions` table in V2.0

This is an explicit decision.

V2.0 uses immutable versioning at the levels that matter most for causal correctness:
- dataset versions
- DAG versions
- run dataset bindings
- answer packages

If a future version needs immutable study-container snapshots, that can be added later without weakening causal correctness in V2.0.

### 8) Reference-document support is optional for V2.0 launch

The reference-document module is valid and designed, but it is not required to ship the first causal runner.

If implementation scope must be reduced, the causal-critical path is:
- datasets
- causal studies
- DAGs
- approvals
- runs
- answer packages

### 9) `compute_runs` must never be orphaned

Every `compute_run` must reference at least one of:
- `run_id`
- `study_id`

Additionally:
- `causal_identification`, `causal_estimation`, and `causal_refutation` compute kinds must reference `run_id`
- pre-run jobs such as `dataset_profiling` may reference `study_id` without `run_id`

---

# 1) Current V1 tables to remove or replace

## A. Remove from the primary product schema

The following V1 tables should be removed from the V2 application schema and treated as legacy-only:

- `conversations`
- `conversation_pins`
- `chat_turns`
- `tool_calls`
- `assistant_messages`
- `analysis_results`
- `workflows`
- `workflow_versions`
- `workflow_runs`
- `workflow_run_steps`
- `workflow_run_input_checks`
- `workflow_run_resolved_inputs`
- `workflow_input_requests`
- `workflow_deliveries`
- `retrieval_runs`
- `retrieval_rewrites`
- `retrieval_candidates`
- `response_citations`

## B. Replace with renamed or re-scoped V2 models

| V1 table | V2 replacement | Reason |
| --- | --- | --- |
| `data_assets` | `datasets` | make structured datasets first-class for causal analysis |
| `data_asset_versions` | `dataset_versions` | immutable pinned analysis inputs |
| `documents` | `reference_documents` | reposition docs as evidence/reference inputs, not main product core |
| `document_chunks` | `reference_document_chunks` | retrieval should support studies, not chat turns |
| `sandbox_runs` | `compute_runs` | execution becomes a general causal compute/audit primitive |
| `sandbox_generated_assets` | `run_artifacts` | artifacts should attach to runs, not only sandbox runs |

## C. Keep with focused updates

These can survive conceptually, but fields and relationships should be updated to match the causal-first model:

- `users`
- `organizations`
- `organization_memberships`
- `workspace_plans`
- `workspace_commercial_ledger`
- `data_connections`
- `request_logs`
- `usage_events`
- `rate_limit_buckets`
- `operational_alerts`
- `organization_compliance_settings`
- `governance_jobs`

---

# 2) V2 schema modules

The V2 schema is organized into these modules:

1. Identity and tenancy
2. Commercial and org policy
3. Dataset registry
4. Reference evidence and documents
5. Causal intake and study workspace
6. DAG authoring and approvals
7. Causal execution and inference results
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
  - causal_studies
    - study_questions
      - intent_classifications
    - study_messages
    - study_dataset_bindings
    - study_reference_links
    - causal_dags
      - causal_dag_versions
        - causal_dag_nodes
        - causal_dag_edges
        - causal_assumptions
        - causal_data_requirements
        - causal_approvals
    - causal_runs
      - causal_run_dataset_bindings
      - causal_identifications
      - causal_estimands
      - causal_estimates
      - causal_refutations
      - compute_runs
      - run_artifacts
      - causal_answer_packages
      - causal_answers
  - request_logs
  - usage_events
  - governance_jobs

---

# 4) V2 enum catalog

These enums should be centralized in TypeScript and mirrored in SQL check constraints.

## Identity and org

### `organization_memberships.role`
- `member`
- `admin`
- `owner`

### `organization_memberships.status`
- `active`
- `restricted`
- `suspended`

## Dataset registry

### `data_connections.kind`
- `filesystem`
- `upload`
- `bulk_import`
- `google_drive`
- `google_sheets`
- `s3`
- `database`

### `data_connections.status`
- `active`
- `paused`
- `error`
- `archived`

### `datasets.access_scope`
- `public`
- `admin`

### `datasets.status`
- `active`
- `archived`
- `deprecated`

### `datasets.data_kind`
- `table`
- `spreadsheet`
- `panel`
- `event_log`

### `dataset_versions.ingestion_status`
- `pending`
- `profiling`
- `ready`
- `failed`
- `archived`

### `dataset_versions.profile_status`
- `pending`
- `ready`
- `failed`

### `dataset_version_columns.semantic_type`
- `unknown`
- `identifier`
- `time`
- `numeric`
- `categorical`
- `boolean`
- `text`
- `currency`
- `percentage`
- `treatment_candidate`
- `outcome_candidate`

## Reference evidence

### `reference_documents.kind`
- `policy`
- `research_note`
- `metric_definition`
- `data_dictionary`
- `external_evidence`
- `meeting_note`
- `other`

### `reference_documents.status`
- `active`
- `archived`

### `reference_document_versions.ingestion_status`
- `pending`
- `ready`
- `failed`

## Causal intake and studies

### `causal_studies.status`
- `draft`
- `awaiting_dataset`
- `awaiting_dag`
- `awaiting_approval`
- `ready_to_run`
- `running`
- `completed`
- `blocked`
- `archived`

### `study_questions.question_type`
- `cause_of_observed_change`
- `intervention_effect`
- `counterfactual`
- `mediation`
- `instrumental_variable`
- `selection_bias`
- `other`

### `study_questions.status`
- `open`
- `clarifying`
- `ready`
- `closed`
- `archived`

### `intent_classifications.intent_type`
- `descriptive`
- `diagnostic`
- `causal`
- `counterfactual`
- `unclear`

### `intent_classifications.routing_decision`
- `continue_descriptive`
- `open_causal_study`
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
- `dag_note`
- `approval_notice`
- `run_summary`
- `final_answer`

### `study_dataset_bindings.binding_role`
- `primary`
- `auxiliary`
- `candidate`
- `external_requirement`

## DAG modeling

### `causal_dags.status`
- `draft`
- `ready_for_approval`
- `approved`
- `superseded`
- `archived`

### `causal_dag_nodes.node_type`
- `observed_feature`
- `treatment`
- `outcome`
- `confounder`
- `mediator`
- `collider`
- `instrument`
- `selection`
- `latent`
- `external_data_needed`
- `note`

### `causal_dag_nodes.source_type`
- `dataset`
- `user`
- `system`

### `causal_dag_nodes.observed_status`
- `observed`
- `unobserved`
- `missing_external`

### `causal_assumptions.assumption_type`
- `no_unmeasured_confounding`
- `positivity`
- `consistency`
- `measurement_validity`
- `selection_ignorability`
- `instrument_validity`
- `frontdoor_sufficiency`
- `custom`

### `causal_assumptions.status`
- `asserted`
- `flagged`
- `contested`
- `accepted`

### `causal_data_requirements.status`
- `missing`
- `requested`
- `in_progress`
- `collected`
- `waived`

### `causal_approvals.approval_kind`
- `user_signoff`
- `admin_signoff`
- `compliance_signoff`

## Causal execution

### `causal_runs.status`
- `queued`
- `running`
- `identified`
- `estimated`
- `refuted`
- `completed`
- `failed`
- `not_identifiable`
- `cancelled`

### `causal_runs.runner_kind`
- `pywhy`
- `dowhy`
- `hybrid`

### `causal_identifications.method`
- `backdoor`
- `frontdoor`
- `iv`
- `mediation`
- `none`

### `causal_estimands.estimand_kind`
- `ate`
- `att`
- `atc`
- `nde`
- `nie`
- `late`
- `custom`

### `causal_refutations.status`
- `passed`
- `failed`
- `warning`
- `not_run`

### `compute_runs.compute_kind`
- `causal_identification`
- `causal_estimation`
- `causal_refutation`
- `dataset_profiling`
- `document_chunking`

### `compute_runs.status`
- `queued`
- `starting`
- `running`
- `finalizing`
- `completed`
- `failed`
- `timed_out`
- `rejected`
- `abandoned`

### `run_artifacts.artifact_kind`
- `graph_json`
- `graph_export_png`
- `estimand_report`
- `estimate_json`
- `refutation_report`
- `answer_package`
- `stdout`
- `stderr`
- `misc`

## Operations and governance

### `governance_jobs.job_type`
- `organization_export`
- `history_purge`
- `reference_delete`
- `legacy_archive_export`

### `governance_jobs.status`
- `queued`
- `running`
- `completed`
- `failed`

---

# 5) V2 table-by-table schema spec

Each table below includes purpose, core columns, key constraints, and recommended indexes.

---

## Module A: Identity and tenancy

## 5.1 `users`

### Purpose
Global user account record. Keep this thin; org-scoped permissions live in memberships.

### Core columns
- `id` text PK
- `email` text not null unique
- `name` text nullable
- `status` text not null default `active`
- `password_hash` text not null
- `created_at` integer not null
- `updated_at` integer not null

### Constraints
- unique email
- status enum check (`active`, `suspended`)

### Indexes
- `users_status_idx(status)`

### Notes
Remove direct product-role semantics from `users.role`. Role should live only in org membership for multi-org clarity.

---

## 5.2 `organizations`

### Purpose
Tenant boundary.

### Core columns
- `id` text PK
- `name` text not null
- `slug` text not null unique
- `status` text not null default `active`
- `created_at` integer not null
- `updated_at` integer not null

### Constraints
- unique slug
- status enum (`active`, `suspended`, `archived`)

### Indexes
- `organizations_slug_idx(slug)` unique
- `organizations_status_idx(status)`

---

## 5.3 `organization_memberships`

### Purpose
Org-scoped access, role, and commercial caps.

### Core columns
- `id` text PK
- `organization_id` FK -> `organizations.id`
- `user_id` FK -> `users.id`
- `role` text not null
- `status` text not null default `active`
- `monthly_credit_cap` integer nullable
- `created_at` integer not null
- `updated_at` integer not null

### Constraints
- unique (`organization_id`, `user_id`)
- role enum check
- status enum check

### Indexes
- unique `organization_memberships_org_user_idx(organization_id, user_id)`
- `organization_memberships_org_status_idx(organization_id, status)`
- `organization_memberships_user_status_idx(user_id, status)`

---

## 5.4 `organization_settings`

### Purpose
Org-level product policy and causal controls.

### Core columns
- `id` text PK
- `organization_id` FK -> `organizations.id`
- `causal_mode_required` integer/boolean not null default true
- `require_dag_approval` integer/boolean not null default true
- `require_admin_approval_for_signed_dags` integer/boolean not null default false
- `allow_descriptive_mode` integer/boolean not null default true
- `default_runner_kind` text not null default `pywhy`
- `default_runner_version` text nullable
- `updated_by_user_id` FK -> `users.id` nullable
- `created_at` integer not null
- `updated_at` integer not null

### Constraints
- unique `organization_id`

### Indexes
- unique `organization_settings_org_idx(organization_id)`
- `organization_settings_updated_by_idx(updated_by_user_id)`

---

## Module B: Commercial and billing

## 5.5 `workspace_plans`

### Purpose
Commercial plan state; preserve if flat-rate credit model remains.

### Core columns
- `id` text PK
- `organization_id` FK -> `organizations.id`
- `plan_code` text not null
- `plan_name` text not null
- `monthly_included_credits` integer not null
- `billing_anchor_at` integer not null
- `current_window_start_at` integer not null
- `current_window_end_at` integer not null
- `hard_cap_behavior` text not null default `block`
- `rate_card_json` text not null default `{}`
- `created_at` integer not null
- `updated_at` integer not null

### Constraints
- unique `organization_id`

### Indexes
- unique `workspace_plans_organization_id_idx(organization_id)`
- `workspace_plans_window_end_idx(current_window_end_at)`

---

## 5.6 `workspace_commercial_ledger`

### Purpose
Credit reservation and usage accounting.

### Core columns
- `id` text PK
- `organization_id` FK -> `organizations.id`
- `user_id` FK -> `users.id`
- `request_id` text not null
- `request_log_id` FK -> `request_logs.id` nullable
- `usage_class` text not null
- `credits_delta` integer not null
- `window_start_at` integer not null
- `window_end_at` integer not null
- `status` text not null default `reserved`
- `metadata_json` text not null default `{}`
- `created_at` integer not null
- `updated_at` integer not null

### Usage classes
Recommended values:
- `causal_intake`
- `causal_run`
- `causal_answer`
- `dataset_profile`
- `reference_ingest`
- `system`

### Indexes
- `workspace_commercial_ledger_request_id_idx(request_id)`
- `workspace_commercial_ledger_org_window_status_idx(organization_id, window_start_at, status)`
- `workspace_commercial_ledger_user_window_status_idx(user_id, window_start_at, status)`

---

## Module C: Dataset registry

## 5.7 `data_connections`

### Purpose
Source-system connection metadata for datasets.

### Core columns
- `id` text PK
- `organization_id` FK -> `organizations.id`
- `kind` text not null
- `display_name` text not null
- `status` text not null default `active`
- `config_json` text not null default `{}`
- `credentials_ref` text nullable
- `last_sync_at` integer nullable
- `created_at` integer not null
- `updated_at` integer not null

### Indexes
- `data_connections_org_kind_idx(organization_id, kind)`
- `data_connections_org_status_updated_at_idx(organization_id, status, updated_at)`

---

## 5.8 `datasets`

### Purpose
Logical dataset object for structured causal analysis.

### Core columns
- `id` text PK
- `organization_id` FK -> `organizations.id`
- `connection_id` FK -> `data_connections.id` nullable
- `dataset_key` text not null
- `display_name` text not null
- `description` text nullable
- `access_scope` text not null default `admin`
- `data_kind` text not null default `table`
- `grain_description` text nullable
- `time_column_name` text nullable
- `entity_id_column_name` text nullable
- `status` text not null default `active`
- `active_version_id` text nullable
- `metadata_json` text not null default `{}`
- `created_by_user_id` FK -> `users.id` nullable
- `created_at` integer not null
- `updated_at` integer not null

### Constraints
- unique (`organization_id`, `dataset_key`)
- access scope enum check
- data kind enum check

### Indexes
- unique `datasets_org_key_idx(organization_id, dataset_key)`
- `datasets_org_scope_updated_at_idx(organization_id, access_scope, updated_at)`
- `datasets_status_updated_at_idx(status, updated_at)`
- `datasets_active_version_id_idx(active_version_id)`

### Notes
This replaces `data_assets`. Use `dataset_key` rather than `asset_key`.

`active_version_id` is a **soft pointer** in V2.0, not a foreign key. The authoritative immutable history is still stored in `dataset_versions`.

---

## 5.9 `dataset_versions`

### Purpose
Immutable, pinned dataset snapshots used in causal runs.

### Core columns
- `id` text PK
- `dataset_id` FK -> `datasets.id`
- `organization_id` FK -> `organizations.id`
- `version_number` integer not null
- `source_version_token` text nullable
- `source_modified_at` integer nullable
- `content_hash` text not null
- `schema_hash` text not null
- `row_count` integer nullable
- `byte_size` integer nullable
- `materialized_path` text not null
- `ingestion_status` text not null default `pending`
- `profile_status` text not null default `pending`
- `ingestion_error` text nullable
- `profile_error` text nullable
- `indexed_at` integer nullable
- `metadata_json` text not null default `{}`
- `created_at` integer not null
- `updated_at` integer not null

### Constraints
- unique (`dataset_id`, `version_number`)

### Indexes
- unique `dataset_versions_dataset_version_idx(dataset_id, version_number)`
- `dataset_versions_dataset_created_at_idx(dataset_id, created_at)`
- `dataset_versions_org_status_updated_at_idx(organization_id, ingestion_status, updated_at)`
- `dataset_versions_content_hash_idx(dataset_id, content_hash)`

### Notes
Every causal run must reference one or more exact `dataset_versions`.

---

## 5.10 `dataset_version_columns`

### Purpose
Immutable column catalog per dataset version.

### Core columns
- `id` text PK
- `dataset_version_id` FK -> `dataset_versions.id`
- `organization_id` FK -> `organizations.id`
- `column_name` text not null
- `display_name` text not null
- `column_order` integer not null
- `physical_type` text not null
- `semantic_type` text not null default `unknown`
- `nullable` integer/boolean not null default true
- `is_indexed_candidate` integer/boolean not null default false
- `is_treatment_candidate` integer/boolean not null default false
- `is_outcome_candidate` integer/boolean not null default false
- `description` text nullable
- `metadata_json` text not null default `{}`
- `created_at` integer not null

### Constraints
- unique (`dataset_version_id`, `column_name`)
- unique (`dataset_version_id`, `column_order`)

### Indexes
- unique `dataset_version_columns_version_name_idx(dataset_version_id, column_name)`
- `dataset_version_columns_version_semantic_idx(dataset_version_id, semantic_type)`
- `dataset_version_columns_org_created_at_idx(organization_id, created_at)`

### Notes
This is how the DAG builder gets all dataset features without inspecting raw files every time.

---

## 5.11 `dataset_version_column_profiles`

### Purpose
Stores per-column profile stats for schema understanding and DAG seeding.

### Core columns
- `id` text PK
- `dataset_version_id` FK -> `dataset_versions.id`
- `column_id` FK -> `dataset_version_columns.id`
- `organization_id` FK -> `organizations.id`
- `missing_rate` real nullable
- `distinct_count` integer nullable
- `min_value_text` text nullable
- `max_value_text` text nullable
- `sample_values_json` text not null default `[]`
- `profile_json` text not null default `{}`
- `created_at` integer not null
- `updated_at` integer not null

### Constraints
- unique (`column_id`)

### Indexes
- unique `dataset_version_column_profiles_column_idx(column_id)`
- `dataset_version_column_profiles_version_idx(dataset_version_id)`

### Notes
Useful for UI hints only. This table must never be used as a substitute for causal identification.

---

## 5.12 `dataset_relationships`

### Purpose
Optional table for future multi-table joins and panel structures.

### Core columns
- `id` text PK
- `organization_id` FK -> `organizations.id`
- `from_dataset_version_id` FK -> `dataset_versions.id`
- `to_dataset_version_id` FK -> `dataset_versions.id`
- `relationship_kind` text not null
- `join_keys_json` text not null
- `is_primary_path` integer/boolean not null default false
- `metadata_json` text not null default `{}`
- `created_at` integer not null

### Relationship kinds
- `one_to_one`
- `one_to_many`
- `many_to_one`
- `many_to_many`
- `panel_link`
- `event_entity_link`

### Indexes
- `dataset_relationships_from_idx(from_dataset_version_id)`
- `dataset_relationships_to_idx(to_dataset_version_id)`
- `dataset_relationships_org_created_at_idx(organization_id, created_at)`

### Notes
Can be omitted from first implementation if V2 launches with one primary dataset per study.

---

## Module D: Reference evidence and documents

This module is **optional for V2.0 launch**. It should be included only if the first release needs document-backed evidence, metric definitions, or retrieval support inside the causal study workspace.

## 5.13 `reference_documents`

### Purpose
Stores study-supporting documents like metric definitions, policy docs, research notes, and evidence references.

### Core columns
- `id` text PK
- `organization_id` FK -> `organizations.id`
- `document_key` text not null
- `display_name` text not null
- `kind` text not null
- `status` text not null default `active`
- `access_scope` text not null default `admin`
- `active_version_id` text nullable
- `metadata_json` text not null default `{}`
- `created_by_user_id` FK -> `users.id` nullable
- `created_at` integer not null
- `updated_at` integer not null

### Constraints
- unique (`organization_id`, `document_key`)

### Indexes
- unique `reference_documents_org_key_idx(organization_id, document_key)`
- `reference_documents_org_kind_updated_at_idx(organization_id, kind, updated_at)`

### Notes
`active_version_id` is a **soft pointer** in V2.0, not a foreign key. The authoritative immutable history is stored in `reference_document_versions`.

---

## 5.14 `reference_document_versions`

### Purpose
Immutable snapshots of reference documents.

### Core columns
- `id` text PK
- `reference_document_id` FK -> `reference_documents.id`
- `organization_id` FK -> `organizations.id`
- `version_number` integer not null
- `content_hash` text not null
- `mime_type` text nullable
- `byte_size` integer nullable
- `materialized_path` text not null
- `ingestion_status` text not null default `pending`
- `ingestion_error` text nullable
- `metadata_json` text not null default `{}`
- `created_at` integer not null
- `updated_at` integer not null

### Constraints
- unique (`reference_document_id`, `version_number`)

### Indexes
- unique `reference_document_versions_doc_version_idx(reference_document_id, version_number)`
- `reference_document_versions_org_status_updated_at_idx(organization_id, ingestion_status, updated_at)`

---

## 5.15 `reference_document_chunks`

### Purpose
Text retrieval chunks linked to document versions.

### Core columns
- `id` text PK
- `reference_document_version_id` FK -> `reference_document_versions.id`
- `organization_id` FK -> `organizations.id`
- `chunk_index` integer not null
- `text_content` text not null
- `token_count` integer nullable
- `metadata_json` text not null default `{}`
- `created_at` integer not null

### Constraints
- unique (`reference_document_version_id`, `chunk_index`)

### Indexes
- unique `reference_document_chunks_version_index_idx(reference_document_version_id, chunk_index)`
- `reference_document_chunks_org_created_at_idx(organization_id, created_at)`

---

## 5.16 `study_reference_links`

### Purpose
Links evidence documents to a causal study.

### Core columns
- `id` text PK
- `study_id` FK -> `causal_studies.id`
- `organization_id` FK -> `organizations.id`
- `reference_document_version_id` FK -> `reference_document_versions.id`
- `link_reason` text nullable
- `created_by_user_id` FK -> `users.id` nullable
- `created_at` integer not null

### Constraints
- unique (`study_id`, `reference_document_version_id`)

### Indexes
- unique `study_reference_links_study_doc_idx(study_id, reference_document_version_id)`
- `study_reference_links_org_created_at_idx(organization_id, created_at)`

---

## Module E: Causal intake and study workspace

## 5.17 `causal_studies`

### Purpose
The main saved product object. Replaces conversations and workflows as the core unit.

### Core columns
- `id` text PK
- `organization_id` FK -> `organizations.id`
- `title` text not null
- `description` text nullable
- `status` text not null default `draft`
- `created_by_user_id` FK -> `users.id` nullable
- `current_question_id` text nullable
- `current_dag_id` text nullable
- `current_dag_version_id` text nullable
- `current_run_id` text nullable
- `current_answer_id` text nullable
- `metadata_json` text not null default `{}`
- `created_at` integer not null
- `updated_at` integer not null
- `archived_at` integer nullable

### Indexes
- `causal_studies_org_status_updated_at_idx(organization_id, status, updated_at)`
- `causal_studies_created_by_updated_at_idx(created_by_user_id, updated_at)`

### Notes
This is the top-level record the UI should list and open.

`current_question_id`, `current_dag_id`, `current_dag_version_id`, `current_run_id`, and `current_answer_id` are **soft pointers** in V2.0, not foreign keys.

V2.0 intentionally does **not** add a `causal_study_versions` table. Immutable causal correctness is preserved through versioned datasets, versioned DAGs, run bindings, and answer packages.

---

## 5.18 `study_questions`

### Purpose
Captures the causal question(s) asked within a study.

### Core columns
- `id` text PK
- `study_id` FK -> `causal_studies.id`
- `organization_id` FK -> `organizations.id`
- `asked_by_user_id` FK -> `users.id` nullable
- `question_text` text not null
- `question_type` text not null
- `status` text not null default `open`
- `proposed_treatment_label` text nullable
- `proposed_outcome_label` text nullable
- `metadata_json` text not null default `{}`
- `created_at` integer not null
- `updated_at` integer not null

### Indexes
- `study_questions_study_created_at_idx(study_id, created_at)`
- `study_questions_org_status_created_at_idx(organization_id, status, created_at)`

---

## 5.19 `intent_classifications`

### Purpose
Stores preflight classification results. This is a control-plane table, not a convenience log.

### Core columns
- `id` text PK
- `study_question_id` FK -> `study_questions.id`
- `organization_id` FK -> `organizations.id`
- `classifier_model_name` text not null
- `classifier_prompt_version` text not null
- `raw_output_json` text not null
- `is_causal` integer/boolean not null
- `intent_type` text not null
- `confidence` real not null
- `reason_text` text not null
- `routing_decision` text not null
- `created_at` integer not null

### Constraints
- at least one classification per study question
- preserve all attempts; do not update in place

### Indexes
- `intent_classifications_question_created_at_idx(study_question_id, created_at)`
- `intent_classifications_org_created_at_idx(organization_id, created_at)`
- `intent_classifications_routing_decision_idx(routing_decision, created_at)`

### Notes
If `is_causal = true`, the normal descriptive analysis path must not start.

---

## 5.20 `study_messages`

### Purpose
Structured study-specific message history for user, system, and assistant notices.

### Core columns
- `id` text PK
- `study_id` FK -> `causal_studies.id`
- `organization_id` FK -> `organizations.id`
- `author_type` text not null
- `author_user_id` FK -> `users.id` nullable
- `message_kind` text not null
- `content_text` text not null
- `metadata_json` text not null default `{}`
- `created_at` integer not null

### Indexes
- `study_messages_study_created_at_idx(study_id, created_at)`
- `study_messages_org_created_at_idx(organization_id, created_at)`

### Notes
This replaces chat history in the causal product, but it is intentionally subordinate to the study itself.

---

## 5.21 `study_dataset_bindings`

### Purpose
Declares which datasets a study is allowed to use and in what role.

### Core columns
- `id` text PK
- `study_id` FK -> `causal_studies.id`
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

### Indexes
- unique `study_dataset_bindings_study_dataset_role_idx(study_id, dataset_id, binding_role)`
- partial unique `study_dataset_bindings_one_active_primary_idx(study_id)` where `binding_role = 'primary'` and `is_active = 1`
- `study_dataset_bindings_active_idx(study_id, is_active)`
- `study_dataset_bindings_dataset_version_idx(dataset_version_id)`

### Notes
A study may have multiple candidate or auxiliary datasets, but V2.0 requires exactly one active `primary` binding before DAG approval and before creating a `causal_run`.

---

## Module F: DAG authoring and approvals

## 5.22 `causal_dags`

### Purpose
Logical DAG object attached to a study.

### Core columns
- `id` text PK
- `study_id` FK -> `causal_studies.id`
- `organization_id` FK -> `organizations.id`
- `title` text not null
- `description` text nullable
- `status` text not null default `draft`
- `current_version_id` text nullable
- `created_by_user_id` FK -> `users.id` nullable
- `created_at` integer not null
- `updated_at` integer not null

### Indexes
- `causal_dags_study_status_updated_at_idx(study_id, status, updated_at)`
- `causal_dags_org_updated_at_idx(organization_id, updated_at)`

---

## 5.23 `causal_dag_versions`

### Purpose
Immutable DAG snapshots. This is the exact graph used by causal runs.

### Core columns
- `id` text PK
- `dag_id` FK -> `causal_dags.id`
- `study_id` FK -> `causal_studies.id`
- `organization_id` FK -> `organizations.id`
- `version_number` integer not null
- `primary_dataset_version_id` FK -> `dataset_versions.id` nullable
- `graph_json` text not null
- `validation_json` text not null default `{}`
- `layout_json` text not null default `{}`
- `treatment_node_key` text nullable
- `outcome_node_key` text nullable
- `created_by_user_id` FK -> `users.id` nullable
- `created_at` integer not null

### Constraints
- unique (`dag_id`, `version_number`)

### Indexes
- unique `causal_dag_versions_dag_version_idx(dag_id, version_number)`
- `causal_dag_versions_study_created_at_idx(study_id, created_at)`
- `causal_dag_versions_dataset_version_idx(primary_dataset_version_id)`

### Notes
Store `graph_json` for exact ReactFlow reproduction, even though nodes/edges are also normalized below.

---

## 5.24 `causal_dag_nodes`

### Purpose
Normalized nodes for querying and validation.

### Core columns
- `id` text PK
- `dag_version_id` FK -> `causal_dag_versions.id`
- `study_id` FK -> `causal_studies.id`
- `organization_id` FK -> `organizations.id`
- `node_key` text not null
- `label` text not null
- `node_type` text not null
- `source_type` text not null
- `observed_status` text not null
- `dataset_version_id` FK -> `dataset_versions.id` nullable
- `dataset_column_id` FK -> `dataset_version_columns.id` nullable
- `description` text nullable
- `assumption_note` text nullable
- `position_x` real nullable
- `position_y` real nullable
- `metadata_json` text not null default `{}`
- `created_at` integer not null

### Constraints
- unique (`dag_version_id`, `node_key`)
- if `source_type = dataset`, `dataset_column_id` should be non-null
- if `observed_status != observed`, `dataset_column_id` may be null and must never be auto-filled later without a new version

### Indexes
- unique `causal_dag_nodes_version_key_idx(dag_version_id, node_key)`
- `causal_dag_nodes_version_type_idx(dag_version_id, node_type)`
- `causal_dag_nodes_column_idx(dataset_column_id)`

### Anti-inductive safeguard
A node that represents a missing confounder must be stored explicitly as `observed_status = missing_external` or `unobserved`; it must never be silently downgraded into a note.

---

## 5.25 `causal_dag_edges`

### Purpose
Normalized directed edges.

### Core columns
- `id` text PK
- `dag_version_id` FK -> `causal_dag_versions.id`
- `study_id` FK -> `causal_studies.id`
- `organization_id` FK -> `organizations.id`
- `edge_key` text not null
- `source_node_id` FK -> `causal_dag_nodes.id`
- `target_node_id` FK -> `causal_dag_nodes.id`
- `relationship_label` text not null default `causes`
- `note` text nullable
- `created_at` integer not null

### Constraints
- unique (`dag_version_id`, `edge_key`)
- unique (`dag_version_id`, `source_node_id`, `target_node_id`)

### Indexes
- unique `causal_dag_edges_version_edge_key_idx(dag_version_id, edge_key)`
- unique `causal_dag_edges_version_source_target_idx(dag_version_id, source_node_id, target_node_id)`
- `causal_dag_edges_source_idx(source_node_id)`
- `causal_dag_edges_target_idx(target_node_id)`

### Notes
Acyclicity is validated in the application layer, then recorded in `validation_json`.

---

## 5.26 `causal_assumptions`

### Purpose
Durable assumption records independent of graph note text.

### Core columns
- `id` text PK
- `dag_version_id` FK -> `causal_dag_versions.id`
- `study_id` FK -> `causal_studies.id`
- `organization_id` FK -> `organizations.id`
- `assumption_type` text not null
- `description` text not null
- `status` text not null default `asserted`
- `related_node_id` FK -> `causal_dag_nodes.id` nullable
- `related_edge_id` FK -> `causal_dag_edges.id` nullable
- `created_by_user_id` FK -> `users.id` nullable
- `created_at` integer not null
- `updated_at` integer not null

### Indexes
- `causal_assumptions_dag_version_idx(dag_version_id)`
- `causal_assumptions_status_idx(status, created_at)`
- `causal_assumptions_related_node_idx(related_node_id)`

---

## 5.27 `causal_data_requirements`

### Purpose
Tracks missing or external data the user may need to go obtain.

### Core columns
- `id` text PK
- `dag_version_id` FK -> `causal_dag_versions.id`
- `study_id` FK -> `causal_studies.id`
- `organization_id` FK -> `organizations.id`
- `related_node_id` FK -> `causal_dag_nodes.id` nullable
- `variable_label` text not null
- `status` text not null default `missing`
- `importance_rank` integer nullable
- `reason_needed` text not null
- `suggested_source` text nullable
- `created_by_user_id` FK -> `users.id` nullable
- `created_at` integer not null
- `updated_at` integer not null

### Indexes
- `causal_data_requirements_dag_status_idx(dag_version_id, status)`
- `causal_data_requirements_study_status_idx(study_id, status)`

### Notes
This table is the durable counterpart to “extra nodes to help the user keep track of data they still need to go get.”

---

## 5.28 `causal_approvals`

### Purpose
Stores explicit signoff on DAG assumptions.

### Core columns
- `id` text PK
- `dag_version_id` FK -> `causal_dag_versions.id`
- `study_id` FK -> `causal_studies.id`
- `organization_id` FK -> `organizations.id`
- `approved_by_user_id` FK -> `users.id`
- `approval_kind` text not null
- `approval_text` text not null
- `approval_hash` text nullable
- `created_at` integer not null

### Indexes
- `causal_approvals_dag_created_at_idx(dag_version_id, created_at)`
- `causal_approvals_study_created_at_idx(study_id, created_at)`
- `causal_approvals_approved_by_idx(approved_by_user_id, created_at)`

### Notes
If org policy requires approval, a causal run must reference one approval record for the exact DAG version used.

---

## Module G: Causal execution and inference results

## 5.29 `causal_runs`

### Purpose
Top-level record for a causal inference execution.

### Core columns
- `id` text PK
- `study_id` FK -> `causal_studies.id`
- `organization_id` FK -> `organizations.id`
- `study_question_id` FK -> `study_questions.id`
- `dag_version_id` FK -> `causal_dag_versions.id`
- `primary_dataset_version_id` FK -> `dataset_versions.id`
- `approval_id` FK -> `causal_approvals.id` nullable
- `treatment_node_key` text not null
- `outcome_node_key` text not null
- `status` text not null default `queued`
- `runner_kind` text not null default `pywhy`
- `runner_version` text nullable
- `requested_by_user_id` FK -> `users.id` nullable
- `failure_reason` text nullable
- `metadata_json` text not null default `{}`
- `started_at` integer nullable
- `completed_at` integer nullable
- `created_at` integer not null
- `updated_at` integer not null

### Constraints
- cannot run without `dag_version_id`
- cannot run without `primary_dataset_version_id`
- cannot run without `treatment_node_key` and `outcome_node_key`
- if org requires approval, `approval_id` must be non-null

### Indexes
- `causal_runs_study_created_at_idx(study_id, created_at)`
- `causal_runs_org_status_created_at_idx(organization_id, status, created_at)`
- `causal_runs_dag_version_idx(dag_version_id)`
- `causal_runs_primary_dataset_version_idx(primary_dataset_version_id)`
- `causal_runs_requested_by_idx(requested_by_user_id, created_at)`

### Notes
The run record intentionally repeats the primary dataset version, treatment node key, and outcome node key so an auditor can inspect the causal target without re-deriving it from DAG JSON.

---

## 5.30 `causal_run_dataset_bindings`

### Purpose
Pins the exact dataset versions used by a causal run.

### Core columns
- `id` text PK
- `run_id` FK -> `causal_runs.id`
- `organization_id` FK -> `organizations.id`
- `dataset_id` FK -> `datasets.id`
- `dataset_version_id` FK -> `dataset_versions.id`
- `binding_role` text not null
- `created_at` integer not null

### Constraints
- unique (`run_id`, `dataset_version_id`, `binding_role`)

### Indexes
- unique `causal_run_dataset_bindings_run_dataset_role_idx(run_id, dataset_version_id, binding_role)`
- `causal_run_dataset_bindings_dataset_version_idx(dataset_version_id)`

### Notes
Do not rely on current active dataset version at execution time. Pin it here.

---

## 5.31 `causal_identifications`

### Purpose
Stores the identification step output.

### Core columns
- `id` text PK
- `run_id` FK -> `causal_runs.id`
- `organization_id` FK -> `organizations.id`
- `identified` integer/boolean not null
- `method` text not null
- `estimand_expression` text nullable
- `adjustment_set_json` text not null default `[]`
- `blocking_reasons_json` text not null default `[]`
- `identification_json` text not null default `{}`
- `created_at` integer not null

### Constraints
- unique (`run_id`)

### Indexes
- unique `causal_identifications_run_idx(run_id)`
- `causal_identifications_identified_idx(identified, created_at)`

### Anti-inductive safeguard
If `identified = false`, the run must be eligible for `not_identifiable` status and the final answer must not imply a causal estimate exists.

---

## 5.32 `causal_estimands`

### Purpose
Durable estimand records identified for a run.

### Core columns
- `id` text PK
- `run_id` FK -> `causal_runs.id`
- `organization_id` FK -> `organizations.id`
- `estimand_kind` text not null
- `estimand_label` text not null
- `estimand_expression` text not null
- `identification_assumptions_json` text not null default `[]`
- `created_at` integer not null

### Indexes
- `causal_estimands_run_idx(run_id)`
- `causal_estimands_kind_idx(estimand_kind, created_at)`

---

## 5.33 `causal_estimates`

### Purpose
Stores estimated effect values for identified estimands.

### Core columns
- `id` text PK
- `run_id` FK -> `causal_runs.id`
- `estimand_id` FK -> `causal_estimands.id`
- `organization_id` FK -> `organizations.id`
- `estimator_name` text not null
- `estimator_config_json` text not null default `{}`
- `effect_name` text not null
- `estimate_value` real nullable
- `std_error` real nullable
- `confidence_interval_low` real nullable
- `confidence_interval_high` real nullable
- `p_value` real nullable
- `estimate_json` text not null default `{}`
- `created_at` integer not null

### Indexes
- `causal_estimates_run_idx(run_id)`
- `causal_estimates_estimand_idx(estimand_id)`
- `causal_estimates_estimator_idx(estimator_name, created_at)`

### Notes
Store the raw machine-readable estimate payload in `estimate_json` even if scalar columns are populated.

---

## 5.34 `causal_refutations`

### Purpose
Stores robustness and refutation results.

### Core columns
- `id` text PK
- `run_id` FK -> `causal_runs.id`
- `organization_id` FK -> `organizations.id`
- `refuter_name` text not null
- `status` text not null
- `summary_text` text not null
- `result_json` text not null default `{}`
- `created_at` integer not null

### Constraints
- unique (`run_id`, `refuter_name`)

### Indexes
- unique `causal_refutations_run_refuter_idx(run_id, refuter_name)`
- `causal_refutations_status_idx(status, created_at)`

---

## 5.35 `compute_runs`

### Purpose
Execution envelope for Python or other compute steps. Replaces `sandbox_runs` as a more general primitive.

### Core columns
- `id` text PK
- `organization_id` FK -> `organizations.id` nullable
- `study_id` FK -> `causal_studies.id` nullable
- `run_id` FK -> `causal_runs.id` nullable
- `compute_kind` text not null
- `status` text not null default `queued`
- `backend` text not null
- `runner` text not null
- `failure_reason` text nullable
- `timeout_ms` integer not null default 0
- `cpu_limit_seconds` integer not null default 0
- `memory_limit_bytes` integer not null default 0
- `max_processes` integer not null default 0
- `stdout_max_bytes` integer not null default 0
- `artifact_max_bytes` integer not null default 0
- `code_text` text not null default ``
- `input_manifest_json` text not null default `[]`
- `stdout_text` text nullable
- `stderr_text` text nullable
- `lease_expires_at` integer nullable
- `last_heartbeat_at` integer nullable
- `cleanup_status` text not null default `pending`
- `metadata_json` text not null default `{}`
- `created_at` integer not null
- `started_at` integer nullable
- `completed_at` integer nullable

### Constraints
- at least one of `run_id` or `study_id` must be non-null
- if `compute_kind` is `causal_identification`, `causal_estimation`, or `causal_refutation`, then `run_id` must be non-null

### Indexes
- `compute_runs_run_id_idx(run_id)`
- `compute_runs_study_id_idx(study_id)`
- `compute_runs_org_status_created_at_idx(organization_id, status, created_at)`
- `compute_runs_status_lease_expires_at_idx(status, lease_expires_at)`

### Notes
This table can still be backed by the existing sandbox supervisor, but the domain model should no longer be phrased as “chat sandbox run.”

`compute_runs` must never be orphaned. They must attach to either a study-level pre-run task or a specific causal run.

---

## 5.36 `run_artifacts`

### Purpose
Generic persisted artifacts attached to a causal run or compute run.

### Core columns
- `id` text PK
- `organization_id` FK -> `organizations.id`
- `study_id` FK -> `causal_studies.id` nullable
- `run_id` FK -> `causal_runs.id` nullable
- `compute_run_id` FK -> `compute_runs.id` nullable
- `artifact_kind` text not null
- `storage_path` text not null
- `file_name` text not null
- `mime_type` text not null
- `byte_size` integer not null
- `content_hash` text nullable
- `metadata_json` text not null default `{}`
- `created_at` integer not null
- `expires_at` integer nullable

### Indexes
- `run_artifacts_run_idx(run_id)`
- `run_artifacts_compute_run_idx(compute_run_id)`
- `run_artifacts_kind_created_at_idx(artifact_kind, created_at)`
- `run_artifacts_expires_at_idx(expires_at)`

---

## Module H: Output grounding and answer history

## 5.37 `causal_answer_packages`

### Purpose
Structured, machine-readable package given to the final LLM answer step.

### Core columns
- `id` text PK
- `run_id` FK -> `causal_runs.id`
- `study_id` FK -> `causal_studies.id`
- `organization_id` FK -> `organizations.id`
- `package_json` text not null
- `package_hash` text not null
- `created_at` integer not null

### Constraints
- unique (`run_id`)

### Indexes
- unique `causal_answer_packages_run_idx(run_id)`
- `causal_answer_packages_study_created_at_idx(study_id, created_at)`

### Anti-inductive safeguard
The final causal answer should be generated from this package, not from direct freeform re-analysis of the dataset.

---

## 5.38 `causal_answers`

### Purpose
User-facing grounded answer history.

### Core columns
- `id` text PK
- `run_id` FK -> `causal_runs.id`
- `study_id` FK -> `causal_studies.id`
- `organization_id` FK -> `organizations.id`
- `answer_package_id` FK -> `causal_answer_packages.id`
- `model_name` text not null
- `prompt_version` text not null
- `answer_text` text not null
- `answer_format` text not null default `markdown`
- `created_at` integer not null

### Indexes
- `causal_answers_run_idx(run_id)`
- `causal_answers_study_created_at_idx(study_id, created_at)`

### Notes
If you later support answer revisions, preserve them as multiple rows rather than overwriting.

---

## Module I: Operations, compliance, and governance

## 5.39 `request_logs`

### Purpose
Route-level audit and observability. Keep, but re-anchor to study/run IDs instead of turn/workflow IDs.

### Core columns
- `id` text PK
- `request_id` text not null unique
- `route_key` text not null
- `route_group` text not null
- `method` text not null
- `organization_id` FK -> `organizations.id` nullable
- `user_id` FK -> `users.id` nullable
- `study_id` FK -> `causal_studies.id` nullable
- `study_question_id` FK -> `study_questions.id` nullable
- `causal_run_id` FK -> `causal_runs.id` nullable
- `compute_run_id` FK -> `compute_runs.id` nullable
- `status_code` integer not null
- `outcome` text not null
- `error_code` text nullable
- `model_name` text nullable
- `duration_ms` integer not null
- `metadata_json` text not null default `{}`
- `started_at` integer not null
- `completed_at` integer not null

### Indexes
- `request_logs_route_group_started_at_idx(route_group, started_at)`
- `request_logs_organization_id_started_at_idx(organization_id, started_at)`
- `request_logs_user_id_started_at_idx(user_id, started_at)`
- `request_logs_study_id_started_at_idx(study_id, started_at)`
- `request_logs_causal_run_id_started_at_idx(causal_run_id, started_at)`

---

## 5.40 `usage_events`

### Purpose
Metering and operational usage accounting.

### Core columns
- `id` text PK
- `request_log_id` FK -> `request_logs.id` nullable
- `route_key` text not null
- `route_group` text not null
- `event_type` text not null
- `usage_class` text not null
- `organization_id` FK -> `organizations.id` nullable
- `user_id` FK -> `users.id` nullable
- `study_id` FK -> `causal_studies.id` nullable
- `causal_run_id` FK -> `causal_runs.id` nullable
- `subject_name` text nullable
- `status` text not null
- `quantity` integer not null default 0
- `input_tokens` integer not null default 0
- `output_tokens` integer not null default 0
- `total_tokens` integer not null default 0
- `cost_usd` real not null default 0
- `commercial_credits` integer not null default 0
- `duration_ms` integer nullable
- `metadata_json` text not null default `{}`
- `created_at` integer not null

### Recommended usage classes
- `causal_intake`
- `causal_classification`
- `dataset_profile`
- `dag_authoring`
- `causal_run`
- `causal_answer`
- `reference_ingest`
- `system`

### Indexes
- `usage_events_route_group_created_at_idx(route_group, created_at)`
- `usage_events_organization_id_created_at_idx(organization_id, created_at)`
- `usage_events_study_id_created_at_idx(study_id, created_at)`
- `usage_events_causal_run_id_created_at_idx(causal_run_id, created_at)`

---

## 5.41 `rate_limit_buckets`

### Purpose
Operational rate limiting.

### Core columns
- `id` text PK
- `route_group` text not null
- `scope_type` text not null
- `scope_id` text not null
- `bucket_start_at` integer not null
- `bucket_width_seconds` integer not null
- `request_count` integer not null default 0
- `updated_at` integer not null

### Constraints
- unique (`route_group`, `scope_type`, `scope_id`, `bucket_start_at`, `bucket_width_seconds`)

### Indexes
- unique `rate_limit_buckets_scope_bucket_idx(...)`
- `rate_limit_buckets_updated_at_idx(updated_at)`

---

## 5.42 `operational_alerts`

### Purpose
Operational and policy alerting.

### Core columns
- `id` text PK
- `dedupe_key` text not null unique
- `alert_type` text not null
- `severity` text not null
- `status` text not null
- `organization_id` FK -> `organizations.id` nullable
- `study_id` FK -> `causal_studies.id` nullable
- `causal_run_id` FK -> `causal_runs.id` nullable
- `user_id` FK -> `users.id` nullable
- `title` text not null
- `message` text not null
- `metadata_json` text not null default `{}`
- `occurrence_count` integer not null default 1
- `first_seen_at` integer not null
- `last_seen_at` integer not null
- `resolved_at` integer nullable

### Indexes
- `operational_alerts_status_last_seen_at_idx(status, last_seen_at)`
- `operational_alerts_organization_id_last_seen_at_idx(organization_id, last_seen_at)`
- `operational_alerts_causal_run_id_last_seen_at_idx(causal_run_id, last_seen_at)`

---

## 5.43 `organization_compliance_settings`

### Purpose
Retention and compliance policy.

### Core columns
- `id` text PK
- `organization_id` FK -> `organizations.id`
- `request_log_retention_days` integer nullable
- `usage_retention_days` integer nullable
- `study_history_retention_days` integer nullable
- `reference_retention_days` integer nullable
- `run_artifact_retention_days` integer not null default 7
- `legacy_archive_retention_days` integer nullable
- `updated_by_user_id` FK -> `users.id` nullable
- `created_at` integer not null
- `updated_at` integer not null

### Constraints
- unique `organization_id`

### Indexes
- unique `organization_compliance_settings_org_idx(organization_id)`
- `organization_compliance_settings_updated_by_idx(updated_by_user_id)`

---

## 5.44 `governance_jobs`

### Purpose
Async retention/export/governance work.

### Core columns
- `id` text PK
- `organization_id` FK -> `organizations.id`
- `requested_by_user_id` FK -> `users.id` nullable
- `job_type` text not null
- `status` text not null
- `trigger_request_id` text nullable
- `target_label` text not null
- `cutoff_timestamp` integer nullable
- `artifact_storage_path` text nullable
- `artifact_file_name` text nullable
- `artifact_byte_size` integer nullable
- `metadata_json` text not null default `{}`
- `result_json` text not null default `{}`
- `error_message` text nullable
- `created_at` integer not null
- `started_at` integer nullable
- `completed_at` integer nullable
- `updated_at` integer not null

### Indexes
- `governance_jobs_org_created_at_idx(organization_id, created_at)`
- `governance_jobs_status_updated_at_idx(status, updated_at)`
- `governance_jobs_type_completed_at_idx(job_type, completed_at)`

---

# 6) Schema invariants that must be enforced

Some invariants should be enforced in SQL; others must be enforced in the application and recorded durably.

## SQL-enforced where practical

- unique org slug
- unique membership per org/user
- unique dataset key per org
- unique dataset version number per dataset
- unique column name per dataset version
- unique DAG version number per DAG
- unique node key per DAG version
- unique edge pair per DAG version
- unique approval rows only by identity and timestamp, not overwrite
- unique identification row per run
- unique answer package per run

## Application-enforced but persisted as validated state

- DAG must be acyclic before approval
- DAG approval requires one treatment and at least one outcome in V2.0
- causal run must not start unless required approval exists
- causal run must not start unless at least one dataset version is pinned
- final answer must not be generated if identification says effect is not identifiable and no estimate exists
- missing external variables must remain explicit and visible in the DAG/data-requirement layer

---

# 7) Removal plan for the old chat/workflow model

## A. Remove old tables from `apps/web/lib/app-schema.ts`

Delete the V1 tables listed in Section 1A from the canonical schema file.

## B. Stop writing new data to legacy chat/workflow tables

No V2 route should write to:
- conversations
- chat turns
- tool calls
- workflow records
- analysis result cache tables

## C. Archive legacy DB state separately

Recommended approach:

- export legacy chat/workflow tables to a separate archive SQLite DB or compressed JSON bundle
- keep that archive read-only
- do not carry legacy tables into the active V2 database

## D. Build new UI around `causal_studies`

The main sidebar/list surface should show studies, not conversations or workflows.

---

# 8) Recommended migration posture

Because this is a clean-slate rewrite, the recommended DB migration posture is:

## Phase 1: new baseline

Create a new baseline migration, for example:
- `apps/web/drizzle/0000_causal_v2_baseline.sql`

And rewrite:
- `apps/web/lib/app-schema.ts`

from scratch around the V2 tables above.

## Phase 2: backfill only foundational data

Migrate only:
- `users`
- `organizations`
- `organization_memberships`
- `workspace_plans`
- `workspace_commercial_ledger` if needed
- `data_connections`
- `data_assets` -> `datasets`
- `data_asset_versions` -> `dataset_versions`
- existing schema metadata -> `dataset_version_columns`
- `documents` -> `reference_documents` only if the optional reference-evidence module is enabled

## Phase 3: do not backfill product-history tables

Do **not** migrate into V2:
- conversations
- chat turns
- tool calls
- assistant messages
- workflow definitions/runs
- analysis result caches

These belong in legacy archive only.

---

# 9) Suggested implementation order

## Step 1
Finalize the V2 entity map and enum catalog.

## Step 2
Rewrite `apps/web/lib/app-schema.ts` around this spec.

## Step 3
Create a single new baseline migration rather than trying to incrementally patch the old schema.

## Step 4
Write backfill/import scripts only for orgs, users, memberships, dataset registry, and reference docs.

## Step 5
Update all routes and UI to use `causal_studies` as the top-level object.

## Step 6
Delete or quarantine V1 chat/workflow codepaths.

---

# 10) Acceptance criteria for the V2 schema rewrite

The V2 DB rewrite is ready when:

1. the primary product entity is `causal_studies`
2. no new product path depends on `conversations` or `workflows`
3. all causal runs reference exact `dataset_versions`
4. all causal runs reference exact `causal_dag_versions`
5. approvals are stored for the exact DAG version used
6. missing/unobserved variables remain explicit in the DB
7. estimands, estimates, and refutations are persisted as first-class records
8. final answers point to a `causal_answer_package`
9. the old chat/workflow model is archived, not active
10. the schema makes descriptive analysis and causal inference structurally distinct

---

# 11) Final recommendation

Do not treat this as a minor schema extension.

This should be a **true V2 schema reset** where the database itself reflects the product’s strongest promise:

> Critjecture does not guess why something happened from patterns alone. It requires explicit causal structure, explicit assumptions, explicit approval, and explicit identification before it will produce a causal answer.

That promise should be visible directly in the schema.
