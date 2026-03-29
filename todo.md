# Search Tool TODO

This file tracks the implementation plan for a stronger retrieval pipeline.

## Goal

Build a more capable search tool that embeds documents with `nomic-ai/nomic-embed-text` and uses LanceDB as the vector store.

## Current Database Baseline

Step 11 already added the relational storage needed for future retrieval writes:

- `documents`
- `document_chunks`
- `retrieval_runs`
- `retrieval_rewrites`
- `retrieval_candidates`
- `response_citations`

These tables should now be treated as the source of truth for retrieval auditability and grounding joins. Future retrieval work should write to them directly instead of introducing a parallel ad hoc trace format.

## Persistence Rules

- SQLite owns stable `document_id` and `chunk_id` values.
- LanceDB should store vectors keyed by `document_chunks.id`.
- Retrieval is always attached to an existing `chat_turns.id`.
- Final assistant-visible grounding should attach to `assistant_messages.id` through `response_citations`.
- Do not add a generic mixed-event table for retrieval debugging unless the dedicated retrieval tables prove insufficient.

## Phase 0: Indexing Foundation

### Goal

Set up the ingestion and indexing path needed for retrieval.

### What Should Be Implemented

- chunk documents into retrieval-friendly passages
- embed documents and chunks with `nomic-ai/nomic-embed-text`
- store vectors and metadata in LanceDB
- preserve source identifiers, chunk boundaries, and document-level metadata
- support incremental re-indexing when source documents change
- upsert `documents` rows per organization and source path
- upsert `document_chunks` rows per `documents.id` and `chunk_index`
- keep chunk text in SQLite and vector embeddings in LanceDB only
- update `last_indexed_at` when an indexing pass completes successfully

### Acceptance Criteria

- documents can be ingested into LanceDB with embeddings and metadata
- indexed chunks can be traced back to their source documents
- the index can be refreshed without rebuilding everything from scratch
- LanceDB records can be joined back to SQLite through stable `document_chunks.id`

## Phase 1: Query Preparation

### Goal

Improve the incoming question before retrieval.

### What Should Be Implemented

- generate a standalone contextual rewrite of the user query
- implement HyDE to produce a hallucinated answer or pseudo-document for retrieval
- keep both the rewritten query and HyDE output available for downstream retrieval
- log intermediate query-prep artifacts for debugging and evaluation
- create one `retrieval_runs` row per retrieval pipeline execution
- persist rewrite artifacts in `retrieval_rewrites`
- mark `retrieval_runs.status` and `completed_at` correctly for success and failure paths

### Acceptance Criteria

- follow-up questions can be rewritten into standalone search queries
- HyDE output is generated consistently for retrieval-time use
- the system exposes the rewritten query and HyDE artifact for inspection
- a retrieval run can be audited from turn -> run -> rewrite artifacts

## Phase 2: Retrieval

### Goal

Retrieve a broad but high-quality candidate set.

### What Should Be Implemented

- embed the HyDE answer with `nomic-ai/nomic-embed-text`
- run BM25 over the standalone rewritten query
- run vector search using the HyDE embedding
- fuse lexical and vector rankings with Reciprocal Rank Fusion (RRF)
- return the top 50 candidate documents or chunks for reranking
- persist candidate rows in `retrieval_candidates`
- write `document_id`, `chunk_id`, `bm25_score`, `vector_score`, `rrf_score`, and `retrieval_rank`
- set `selected_for_rerank` for the candidate set forwarded to reranking

### Acceptance Criteria

- retrieval combines BM25 and vector search in one pipeline
- RRF is used to merge the ranked candidate lists
- the retrieval layer returns the top 50 candidates with scores and provenance
- candidate rows are inspectable without parsing free-form text logs

## Phase 3: Reranking and Answering

### Goal

Compress the candidate set into the highest-value evidence and answer the question.

### What Should Be Implemented

- send the top 50 retrieved candidates to a cross-encoder reranker
- select the top 5 documents or chunks after reranking
- hand the user question and top evidence to the LLM
- generate a final answer grounded in the selected documents
- preserve citations or source references in the final response
- update `retrieval_candidates` with `rerank_score`, `rerank_rank`, and `selected_for_answer`
- create `response_citations` rows linking final `assistant_messages.id` to chosen `retrieval_candidates.id`
- only create citations for final assistant-visible responses, not planner-selection assistant messages

### Acceptance Criteria

- the reranker reduces 50 candidates to the top 5 evidence items
- the final answer is generated from the reranked evidence set
- responses include source grounding that maps back to the retrieved chunks
- final answers can be audited from `chat_turns` -> `assistant_messages` -> `response_citations` -> `retrieval_candidates` -> `document_chunks`

## Evaluation Notes

- compare retrieval quality before and after contextual rewrite, HyDE, hybrid search, and reranking
- track recall at 50, reranked precision, answer grounding quality, and latency by phase
- keep the pipeline modular so each phase can be turned on or off for evaluation
- keep retrieval writes idempotent enough for repeated dev re-index and replay workflows
