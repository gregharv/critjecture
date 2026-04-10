# Workflow Step 0 Technical Spec (Locked v1)

Status: approved for Step 1 schema work  
Date: 2026-04-09  
Sources: [`steps.md`](./steps.md), [`workflow_functions_implementation_plan.md`](./workflow_functions_implementation_plan.md)

## 1) Purpose

This document locks the highest-risk design decisions required before implementing workflow schema and runtime code.

It defines:

- workflow JSON contracts (stable enough to migrate)
- workflow version snapshot structure
- input bindings against `documents`
- validation contract model
- execution identity rules for manual and scheduled runs
- durable delivery payload snapshot model
- scheduler idempotency/window-key model
- hosted gating plan for async workers

## 2) Contract Stability Rules

All workflow JSON blobs must follow these compatibility rules:

1. Every contract has a top-level `schema_version`.
2. v1 migrations and parsers target `schema_version: 1` only.
3. Additive fields are allowed in v1 parsers (unknown keys ignored).
4. Removing or changing field meaning requires `schema_version` bump.
5. Invalid JSON or missing required fields blocks workflow activation.

## 3) Workflow Version Contract Package (v1)

A workflow version is immutable and stored as a bundle of JSON blobs in `workflow_versions`:

| Column | Contract |
| --- | --- |
| `input_contract_json` | `WorkflowInputContractV1` |
| `input_bindings_json` | `WorkflowInputBindingsV1` |
| `recipe_json` | `WorkflowRecipeV1` |
| `thresholds_json` | `WorkflowThresholdsV1` |
| `outputs_json` | `WorkflowOutputsV1` |
| `delivery_json` | `WorkflowDeliveryV1` |
| `schedule_json` | `WorkflowScheduleV1` |
| `execution_identity_json` | `WorkflowExecutionIdentityV1` |
| `provenance_json` (new in v1 schema) | `WorkflowProvenanceV1` |

Canonical API/read-model wrapper:

```json
{
  "schema_version": 1,
  "workflow_id": "wf_...",
  "version_number": 3,
  "created_by_user_id": "usr_...",
  "created_at": 1760000000000,
  "provenance": { "schema_version": 1, "source_kind": "chat_turn" },
  "contracts": {
    "input_contract": { "schema_version": 1, "inputs": [] },
    "input_bindings": { "schema_version": 1, "bindings": [] },
    "recipe": { "schema_version": 1, "steps": [] },
    "thresholds": { "schema_version": 1, "rules": [] },
    "outputs": { "schema_version": 1 },
    "delivery": { "schema_version": 1, "channels": [] },
    "schedule": { "schema_version": 1, "kind": "manual_only" },
    "execution_identity": { "schema_version": 1, "mode": "fixed_membership_user" }
  }
}
```

## 4) Input Binding Model (against `documents`)

### 4.1 `WorkflowInputContractV1`

```ts
type WorkflowInputContractV1 = {
  schema_version: 1;
  inputs: WorkflowInputSpecV1[];
};

type WorkflowInputSpecV1 = {
  input_key: string; // unique per workflow version
  label: string;
  required: boolean;
  multiplicity: "one" | "many";
  data_kind: "table" | "text_document";
  allowed_mime_types: string[];
  csv_rules?: {
    required_columns?: string[];
    min_row_count?: number;
    max_null_ratio_by_column?: Record<string, number>; // 0..1
    freshness?:
      | { kind: "max_document_age_hours"; max_age_hours: number }
      | {
          kind: "max_column_age_days";
          column: string;
          max_age_days: number;
          date_format?: "auto" | "iso8601";
        };
  };
  duplicate_policy?: {
    mode: "allow" | "warn_if_unchanged" | "block_if_unchanged";
    lookback_successful_runs: number; // 1..20
  };
};
```

### 4.2 `WorkflowInputBindingsV1`

```ts
type WorkflowInputBindingsV1 = {
  schema_version: 1;
  bindings: WorkflowInputBindingV1[];
};

type WorkflowInputBindingV1 = {
  input_key: string;
  binding:
    | {
        kind: "document_id";
        document_id: string;
        lock_to_content_sha256?: string | null;
      }
    | {
        kind: "selector";
        selector: {
          access_scope_in?: Array<"public" | "admin">;
          source_type_in?: Array<"uploaded" | "bulk_import">;
          mime_type_in?: string[];
          display_name_equals?: string;
          display_name_regex?: string;
          uploaded_by_user_id?: string;
        };
        selection: "latest_updated_at" | "latest_indexed_at" | "all_matching";
        max_documents: number;
      };
};
```

### 4.3 Binding Guardrails (locked)

1. Bindings resolve only from `documents` in the same organization.
2. Bindings require `documents.ingestion_status = 'ready'`.
3. **No filesystem paths are permitted in binding contracts.**
4. Selector rules may use metadata fields only (scope, source type, display name, mime, uploader).
5. Role/scope access checks are re-evaluated at run time before file staging.

## 5) Validation Contract Model (v1)

Validation rules are defined in `input_contract_json` per input and persisted per run in `workflow_run_input_checks`.

Persisted check report shape:

```ts
type WorkflowRunInputCheckReportV1 = {
  schema_version: 1;
  input_key: string;
  status: "pass" | "warn" | "fail";
  resolved_documents: Array<{
    document_id: string;
    display_name: string;
    mime_type: string | null;
    content_sha256: string;
    updated_at: number;
  }>;
  checks: Array<{
    code:
      | "missing_required_input"
      | "column_missing"
      | "row_count_below_minimum"
      | "freshness_sla_failed"
      | "duplicate_unchanged_input"
      | "null_ratio_exceeded";
    status: "pass" | "warn" | "fail";
    message: string;
    details?: Record<string, unknown>;
  }>;
  checked_at: number;
};
```

Run-status behavior:

- missing required inputs -> `waiting_for_input`
- present but invalid inputs -> `blocked_validation`
- all checks pass/warn-only -> execution may continue

## 6) Workflow Recipe/Outputs/Delivery/Schedule Contracts

### 6.1 `WorkflowRecipeV1`

```ts
type WorkflowRecipeV1 = {
  schema_version: 1;
  steps: WorkflowStepV1[];
};

type WorkflowStepV1 =
  | {
      step_key: string;
      kind: "analysis";
      tool: "run_data_analysis";
      input_refs: Array<{ type: "workflow_input"; input_key: string }>;
      config: {
        analysis_goal: string;
        result_key: string;
      };
    }
  | {
      step_key: string;
      kind: "chart";
      tool: "generate_visual_graph";
      input_refs: Array<{ type: "step_output"; step_key: string; output_key: string }>;
      config: {
        chart_type: "line" | "bar" | "scatter" | "area";
        title: string;
      };
    }
  | {
      step_key: string;
      kind: "document";
      tool: "generate_document";
      input_refs: Array<{ type: "step_output"; step_key: string; output_key: string }>;
      config: {
        template: "summary_v1" | "brief_v1";
        title: string;
      };
    };
```

### 6.2 `WorkflowThresholdsV1`

```ts
type WorkflowThresholdsV1 = {
  schema_version: 1;
  rules: Array<{
    rule_key: string;
    metric: { step_key: string; path: string };
    operator: "<" | "<=" | ">" | ">=" | "==" | "!=";
    target_number: number;
    severity: "info" | "warning" | "critical";
    on_breach: "include_in_summary" | "mark_run_failed";
  }>;
};
```

### 6.3 `WorkflowOutputsV1`

```ts
type WorkflowOutputsV1 = {
  schema_version: 1;
  summary_template: "standard_v1";
  include_sections?: Array<
    "input_summary" | "validation" | "kpi_changes" | "threshold_breaches" | "artifacts"
  >;
  table_outputs?: Array<{
    step_key: string;
    output_key: string;
    format: "csv" | "markdown";
  }>;
};
```

### 6.4 `WorkflowDeliveryV1`

```ts
type WorkflowDeliveryV1 = {
  schema_version: 1;
  channels: WorkflowDeliveryChannelV1[];
  retry_policy: {
    max_attempts: number; // default 3
    initial_backoff_seconds: number; // default 30
    backoff_multiplier: number; // default 2
  };
};

type WorkflowDeliveryChannelV1 =
  | { kind: "webhook"; endpoint_id: string; signing: "hmac_sha256" }
  | { kind: "chart_pack" }
  | { kind: "ranked_table"; output_key: string; format: "csv" | "markdown" }
  | { kind: "generated_document"; template: "summary_pdf_v1" }
  | { kind: "email"; enabled: boolean; recipients: string[] }; // optional/provider-gated in v1
```

### 6.5 `WorkflowScheduleV1`

```ts
type WorkflowScheduleV1 =
  | { schema_version: 1; kind: "manual_only" }
  | {
      schema_version: 1;
      kind: "recurring";
      timezone: string; // IANA TZ
      cadence:
        | { kind: "weekly"; day_of_week: 0 | 1 | 2 | 3 | 4 | 5 | 6; hour: number; minute: number }
        | { kind: "monthly"; day_of_month: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28; hour: number; minute: number };
      catch_up_policy: "enqueue_missed_windows";
    };
```

## 7) Execution Identity Model (manual + scheduled)

### 7.1 `WorkflowExecutionIdentityV1`

```ts
type WorkflowExecutionIdentityV1 = {
  schema_version: 1;
  mode: "fixed_membership_user";
  run_as_user_id: string;
  required_membership_roles: Array<"admin" | "owner">;
  require_membership_status: "active";
  on_identity_invalid: "block_run";
  recheck_at_enqueue: true;
  recheck_at_execution: true;
};
```

### 7.2 Locked runtime rules

1. **Manual runs**
   - `run_as_user_id` = requesting user id.
   - `run_as_role` = requesting user membership role at run creation (`admin` or `owner`).
   - Permission and document-scope checks are done again immediately before tool execution.

2. **Scheduled runs**
   - `run_as_user_id` is sourced from `execution_identity_json.run_as_user_id`.
   - Scheduler re-checks identity on enqueue.
   - Worker re-checks identity on execution.

3. **Identity loss behavior (fail closed)**
   - If user is missing, suspended/restricted, downgraded below required role, removed from org, or loses required access, run does not proceed.
   - Run is recorded with explicit failure reason (`identity_invalid_*` code).
   - No implicit fallback to another user/owner in v1.

## 8) Delivery Payload Snapshot Model (durable)

`workflow_deliveries` stores both delivery attempts and a durable payload snapshot.

```ts
type WorkflowDeliverySnapshotV1 = {
  schema_version: 1;
  workflow: { id: string; version_id: string; name: string };
  run: {
    id: string;
    trigger_kind: "manual" | "scheduled" | "resume";
    trigger_window_key: string | null;
    status: string;
    started_at: number | null;
    completed_at: number | null;
  };
  execution_identity: { run_as_user_id: string; run_as_role: "member" | "admin" | "owner" };
  inputs: Array<{
    input_key: string;
    document_id: string;
    display_name: string;
    content_sha256: string;
    mime_type: string | null;
  }>;
  validation_summary: {
    status: "pass" | "warn" | "fail";
    failed_check_count: number;
    warning_check_count: number;
  };
  steps: Array<{
    step_key: string;
    tool: string;
    status: string;
    sandbox_run_id: string | null;
    duration_ms: number | null;
  }>;
  thresholds: Array<{
    rule_key: string;
    status: "pass" | "breach";
    severity: "info" | "warning" | "critical";
  }>;
  artifacts: Array<{
    asset_id: string;
    file_name: string;
    mime_type: string;
    byte_size: number;
    storage_path: string;
    content_sha256?: string;
  }>;
};
```

Durability requirement: run history must stay meaningful even after temporary signed URLs expire.

## 9) Scheduler Idempotency Model

### 9.1 Window key format

For scheduled runs only:

```text
trigger_window_key = scheduled:v1:<workflow_id>:<workflow_version_id>:<window_start_ms>:<window_end_ms>
```

### 9.2 Database constraints (locked)

1. Unique key for scheduled windows: `(workflow_id, trigger_kind, trigger_window_key)`
2. Scheduled runs require non-null `trigger_window_key`.
3. Manual/resume runs use `trigger_window_key = null`.

### 9.3 Tick algorithm (idempotent)

1. Select due active workflows where `next_run_at <= now`.
2. Claim each workflow with compare-and-swap (`status`/`next_run_at` guarded update).
3. Compute deterministic schedule window.
4. Insert scheduled `workflow_runs` row with `trigger_window_key`.
5. Use `ON CONFLICT DO NOTHING` for duplicate ticks.
6. Advance `next_run_at` only after claim path finishes.

Duplicate ticks and restart replay cannot create duplicate rows for the same schedule window.

## 10) Hosted Gating Plan For Async Workers

Current hosted docs explicitly scope support to the synchronous envelope. Scheduled workflows remain gated until async hardening is complete.

### 10.1 Feature flags

- `CRITJECTURE_ENABLE_WORKFLOWS` -> workflow CRUD + manual run surfaces
- `CRITJECTURE_ENABLE_WORKFLOW_SCHEDULER` -> scheduler tick + worker execution
- `CRITJECTURE_ENABLE_HOSTED_SCHEDULED_WORKFLOWS` -> hosted scheduled execution override

Default for scheduler flags: `false`.

### 10.2 Hosted enablement gate (must all pass)

1. Worker crash/restart reconciliation implemented and tested.
2. Duplicate tick idempotency proven in integration tests.
3. Bounded concurrency/backpressure controls implemented.
4. Operational alerts for repeated failures, stale waiting runs, delivery bursts.
5. Runbooks updated (`deployment`, hosted ops, release checklist).
6. Rollback playbook documented (disable flags + pause active schedules).

Until all pass, hosted scheduled execution is out of scope and remains disabled.

## 11) Provenance Contract (chat -> workflow)

```ts
type WorkflowProvenanceV1 = {
  schema_version: 1;
  source_kind: "chat_turn" | "manual_builder";
  chat_turn?: {
    conversation_id: string;
    turn_id: string;
    tool_call_ids: string[];
    sandbox_run_ids: string[];
    analysis_result_id?: string;
  };
  note?: string;
};
```

This preserves traceability without storing raw prompt replay as the workflow runtime definition.

## 12) Step 0 Exit Criteria Check

- [x] JSON contracts are stable enough to migrate.
- [x] Scheduled-run identity rules are explicit.
- [x] Input bindings use logical document references or selector rules (no filesystem paths).

This completes Step 0 and unblocks Step 1 schema + type implementation.
