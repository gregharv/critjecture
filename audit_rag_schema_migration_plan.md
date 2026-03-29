# Audit and RAG Schema Migration Plan

This file describes the next migration path from the current audit schema to a clearer model that supports both operational audit logging and a stronger RAG pipeline.

## Goal

Separate four concerns that are currently easy to blur together:

- the user request being answered
- the assistant response shown to the user
- structured tool execution
- retrieval and grounding internals

The target model should support compliance and operational audit needs without making retrieval debugging depend on one generic trace table.

## Current State

Current audit-related tables:

- `chat_turns`
- `tool_calls`
- `assistant_messages`
- `sandbox_runs`

Current issues:

- retrieval stages do not have dedicated storage
- `assistant_messages` currently stores only final assistant-visible text, which is good for the owner UI but not enough for retrieval debugging
- `chat_turns` is now the correct parent name, but it still does not hold retrieval-stage lifecycle data
- some future retrieval artifacts would still be hard to audit without dedicated tables

## Target State

Target parent-child split:

- `chat_turns`
  - one row per user request and assistant answer cycle
- `assistant_messages`
  - final assistant-visible responses
- `tool_calls`
  - structured runtime tool execution
- `retrieval_runs`
  - one retrieval pipeline execution per turn
- `retrieval_rewrites`
  - contextual rewrite and HyDE artifacts
- `retrieval_candidates`
  - retrieval and reranking candidates with scores and ranks
- `response_citations`
  - links from final assistant responses to evidence
- optional `audit_events`
  - low-level mixed timeline entries only if still needed for debugging

## Naming Conventions

Use these conventions consistently:

- prefer product nouns over implementation slang
- prefer `chat_turns` as the parent interaction row
- prefer `assistant_messages` for final assistant text only
- prefer `runtime_` prefixes where ids come from agent or tool runtime state
- prefer `started_at` and `completed_at` when a row has lifecycle stages
- keep `*_json` only for opaque structured payloads
- avoid generic names like `role`, `trace`, `content`, and `session_id` when the narrower meaning is known

## Recommended Table Definitions

### `chat_turns`

Suggested columns:

- `id`
- `conversation_id`
- `chat_session_id`
- `organization_id`
- `user_id`
- `user_role`
- `user_prompt_text`
- `status`
- `created_at`
- `completed_at`

Notes:

- this extends the current parent interaction model
- `status` can distinguish active, completed, and failed turns

### `assistant_messages`

Suggested columns:

- `id`
- `turn_id`
- `message_index`
- `message_type`
- `message_text`
- `model_name`
- `created_at`

Notes:

- use this for final or user-visible assistant output
- do not mix tool events into this table

### `tool_calls`

Suggested columns:

- `id`
- `turn_id`
- `runtime_tool_call_id`
- `tool_name`
- `tool_parameters_json`
- `accessed_files_json`
- `status`
- `result_summary`
- `error_message`
- `started_at`
- `completed_at`

Notes:

- this extends the current `tool_calls` model
- keep the row primary key separate from the runtime tool-call id

### `retrieval_runs`

Suggested columns:

- `id`
- `turn_id`
- `pipeline_version`
- `standalone_query`
- `hyde_document`
- `embedding_model`
- `rerank_model`
- `created_at`

Notes:

- one turn may later support more than one retrieval pass
- this is the parent for retrieval-specific child rows

### `retrieval_rewrites`

Suggested columns:

- `id`
- `retrieval_run_id`
- `rewrite_type`
- `input_text`
- `output_text`
- `created_at`

Expected `rewrite_type` values:

- `contextual-rewrite`
- `hyde`

### `retrieval_candidates`

Suggested columns:

- `id`
- `retrieval_run_id`
- `document_id`
- `chunk_id`
- `bm25_score`
- `vector_score`
- `rrf_score`
- `rerank_score`
- `retrieval_rank`
- `rerank_rank`
- `selected_for_rerank`
- `selected_for_answer`

Notes:

- this is the key table for hybrid retrieval explainability
- it should support both top-50 candidate analysis and top-5 answer grounding

### `response_citations`

Suggested columns:

- `id`
- `assistant_message_id`
- `retrieval_candidate_id`
- `citation_index`

Notes:

- this creates an explicit grounding link between answer text and evidence

### Optional `audit_events`

Suggested columns:

- `id`
- `turn_id`
- `event_type`
- `title`
- `content`
- `created_at`

Notes:

- keep this only for truly miscellaneous timeline events
- do not use it as the main store for final responses or tool-call records

## Migration Strategy

### Phase 1: Extend `chat_turns`

Goal:

Keep the existing audit parent row while adding the fields needed for richer turn lifecycle tracking.

What should be implemented:

- add fields such as `conversation_id`, `status`, and `completed_at`
- preserve current `chat_turns` ids
- update read paths and admin UI projections as needed

Acceptance criteria:

- each turn can represent both the initial user request and its completion state
- the admin audit view still renders correctly during the transition

### Phase 2: Extend `assistant_messages`

Goal:

Keep assistant-visible output explicit while adding structure needed for richer answer auditing.

What should be implemented:

- add fields such as `message_index`, `message_type`, and `model_name`
- preserve current `assistant_messages` ids and `turn_id` linkage
- keep final assistant output separate from tool and retrieval events

Acceptance criteria:

- final assistant responses remain directly queryable
- richer answer metadata is available without introducing a generic trace table

### Phase 3: Extend `tool_calls`

Goal:

Keep tool execution audit structured and retrieval-aware.

What should be implemented:

- preserve the current `tool_calls` shape
- add any missing retrieval-adjacent metadata only if it belongs to tool execution
- keep the runtime id and row id distinction explicit
- preserve completion and error semantics

Acceptance criteria:

- it is obvious which id is the database row id and which id comes from the runtime
- tool lifecycle timestamps are semantically correct

### Phase 4: Add Retrieval-Specific Tables

Goal:

Support RAG debugging and evaluation without hiding retrieval state in free text.

What should be implemented:

- create `retrieval_runs`
- create `retrieval_rewrites`
- create `retrieval_candidates`
- persist contextual rewrite and HyDE artifacts
- persist BM25, vector, RRF, and rerank data for candidate chunks

Acceptance criteria:

- a single turn can be audited from input query through retrieval candidate generation
- retrieval quality can be inspected without parsing generic text blobs

### Phase 5: Add Grounding Links

Goal:

Make answer evidence explicit.

What should be implemented:

- create `response_citations`
- store citations from final assistant messages to selected retrieval candidates
- surface citations in the admin UI or evaluation tooling

Acceptance criteria:

- final assistant answers can be traced to concrete retrieved evidence
- citation rows support downstream quality review

### Phase 6: Add Optional Debug/Event Tables Only If Needed

Goal:

Add lower-level event storage only if the product genuinely needs it.

What should be implemented:

- create `audit_events` only if there is a real need for mixed debug timelines
- keep final responses in `assistant_messages`
- keep tool execution in `tool_calls`
- update docs, admin views, and evaluation queries if this table is introduced

Acceptance criteria:

- there is no duplicate write path for the same semantic data
- the optional debug stream does not become the primary store for audit or retrieval state
