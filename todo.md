# Search Tool TODO

This file tracks the implementation plan for a stronger retrieval pipeline.

## Goal

Build a more capable search tool that embeds documents with `nomic-ai/nomic-embed-text` and uses LanceDB as the vector store.

## Phase 0: Indexing Foundation

### Goal

Set up the ingestion and indexing path needed for retrieval.

### What Should Be Implemented

- chunk documents into retrieval-friendly passages
- embed documents and chunks with `nomic-ai/nomic-embed-text`
- store vectors and metadata in LanceDB
- preserve source identifiers, chunk boundaries, and document-level metadata
- support incremental re-indexing when source documents change

### Acceptance Criteria

- documents can be ingested into LanceDB with embeddings and metadata
- indexed chunks can be traced back to their source documents
- the index can be refreshed without rebuilding everything from scratch

## Phase 1: Query Preparation

### Goal

Improve the incoming question before retrieval.

### What Should Be Implemented

- generate a standalone contextual rewrite of the user query
- implement HyDE to produce a hallucinated answer or pseudo-document for retrieval
- keep both the rewritten query and HyDE output available for downstream retrieval
- log intermediate query-prep artifacts for debugging and evaluation

### Acceptance Criteria

- follow-up questions can be rewritten into standalone search queries
- HyDE output is generated consistently for retrieval-time use
- the system exposes the rewritten query and HyDE artifact for inspection

## Phase 2: Retrieval

### Goal

Retrieve a broad but high-quality candidate set.

### What Should Be Implemented

- embed the HyDE answer with `nomic-ai/nomic-embed-text`
- run BM25 over the standalone rewritten query
- run vector search using the HyDE embedding
- fuse lexical and vector rankings with Reciprocal Rank Fusion (RRF)
- return the top 50 candidate documents or chunks for reranking

### Acceptance Criteria

- retrieval combines BM25 and vector search in one pipeline
- RRF is used to merge the ranked candidate lists
- the retrieval layer returns the top 50 candidates with scores and provenance

## Phase 3: Reranking and Answering

### Goal

Compress the candidate set into the highest-value evidence and answer the question.

### What Should Be Implemented

- send the top 50 retrieved candidates to a cross-encoder reranker
- select the top 5 documents or chunks after reranking
- hand the user question and top evidence to the LLM
- generate a final answer grounded in the selected documents
- preserve citations or source references in the final response

### Acceptance Criteria

- the reranker reduces 50 candidates to the top 5 evidence items
- the final answer is generated from the reranked evidence set
- responses include source grounding that maps back to the retrieved chunks

## Evaluation Notes

- compare retrieval quality before and after contextual rewrite, HyDE, hybrid search, and reranking
- track recall at 50, reranked precision, answer grounding quality, and latency by phase
- keep the pipeline modular so each phase can be turned on or off for evaluation
