# Marimo Analysis Workspace Technical Spec (Locked v1)

Status: approved for implementation  
Date: 2026-04-11  
Sources: [`README.md`](./README.md), [`overview.md`](./overview.md), [`steps.md`](./steps.md), current `apps/web` implementation

## 1) Purpose

This document locks the implementation plan for replacing Critjecture's current sandbox-script/chart/document workflow with a marimo-first analysis product.

It defines:

- the new product scope
- the landing-vs-workspace UX contract
- the notebook execution contract
- the persistence model for marimo workspaces and notebook revisions
- the API and route changes
- the files/modules to remove
- the implementation sequence for the refactor

This spec intentionally does **not** preserve backward compatibility. The user-approved end state is a **marimo-only analytics product**.

## 2) Locked Product Decisions

The following decisions are locked for v1 of this refactor.

1. **Marimo is the execution engine for all data analysis.**
   - The system no longer executes free-form one-off Python scripts as the primary analysis path.
   - All analytical Python authored by the assistant must be valid marimo notebook source.

2. **The current chat page remains the landing surface.**
   - `/chat` remains the entry point for new conversations and general non-analysis chat.

3. **The analysis experience moves to a separate two-pane workspace route.**
   - On the first analytical Python action, the app transitions from `/chat` to `/analysis/[conversationId]`.
   - The workspace route is the canonical home for notebook-backed analysis conversations.

4. **Chat history is removed from the analysis workspace.**
   - No history sidebar in the workspace.
   - No history modal in the workspace.
   - Users can return to `/chat` to browse or start other conversations.

5. **The right pane is a marimo interface with visible code and outputs.**
   - The notebook pane shows Python code, tables, charts, and notebook-rendered UI.
   - v1 uses assistant-authored notebooks; user editing inside the notebook is out of scope unless later added explicitly.

6. **The old chart pipeline is removed.**
   - No `analysisResultId` chart-ready JSON staging flow.
   - No separate PNG chart tool as a first-class analytical path.
   - Charts are rendered in marimo notebook outputs.

7. **The old PDF/document generation path is removed.**
   - The product scope becomes chat + search + marimo analysis only.
   - Separate PDF generation is cut from v1 and can be reconsidered later.

8. **Workflow-from-chat features tied to the old tool graph are removed until rebuilt on notebook provenance.**
   - Existing workflow builder integrations should be deleted or disabled during the refactor.
   - Reintroduction happens only after notebook provenance and notebook-based execution are stable.

9. **Backward compatibility is not a goal.**
   - Old tool routes, old tool contracts, old session payloads, and old workflow/chart/document artifacts may be removed.
   - Database migrations may be destructive where necessary.

## 3) End-State Product Scope

After this refactor, the product surface is:

- authenticated chat landing page
- role-aware company knowledge search
- marimo-backed analysis workspace
- audit/operations/settings surfaces that still make sense for the new flow

Removed from the main product scope:

- standalone chart-generation pipeline
- standalone PDF/document-generation pipeline
- chart-ready intermediate `analysisResultId` flow
- chat-history UI inside the analysis workspace
- old workflow-builder flow from chat turns

## 4) UX Contract

## 4.1 `/chat` landing behavior

`/chat` becomes the lightweight landing interface for:

- starting a new conversation
- browsing prior conversations
- asking non-analytical questions
- selecting a past conversation before analysis begins

The existing history sidebar can remain **only** on `/chat`.

`/chat` no longer needs to host the long-lived notebook workspace.

## 4.2 Transition into analysis mode

The assistant transitions the user into analysis mode when it first invokes the marimo analysis tool.

Trigger rule:

- if a conversation has no analysis workspace and the assistant starts analytical execution, create the workspace and redirect to `/analysis/[conversationId]`

The transition should happen as soon as the analysis workspace record exists, not after the notebook fully finishes running. The right pane may initially show a pending/running state.

## 4.3 `/analysis/[conversationId]` workspace behavior

The analysis workspace is a two-pane layout:

- **left pane:** Pi chat interface for the current conversation
- **right pane:** marimo notebook interface for the current conversation's analysis workspace

### Workspace navigation rules

The analysis workspace must not render:

- chat history sidebar
- chat history modal
- chat history collapse toggle

The workspace header should provide only:

- conversation title
- analysis status
- `Back to chats`
- `New analysis`
- optional notebook actions like `Refresh notebook` or `Open notebook in new tab`

## 4.4 Mobile behavior

On narrow screens, the workspace becomes a tabbed interface instead of true side-by-side panes:

- `Chat` tab
- `Notebook` tab

Chat history remains excluded from the workspace on mobile as well.

## 4.5 Conversation restoration behavior

When a user opens a conversation that already has a notebook workspace:

- opening from `/chat` should navigate to `/analysis/[conversationId]`
- the workspace should restore the latest notebook revision and current execution state

## 5) Route Contract

## 5.1 Keep

Keep these routes conceptually, though their internals may change:

- `/chat`
- audit/admin routes
- knowledge routes
- auth routes

## 5.2 Add

Add:

- `/analysis/[conversationId]` — analysis workspace page

Add API routes for notebook-backed analysis and notebook state:

- `POST /api/analysis/workspaces` — create workspace for a conversation
- `GET /api/analysis/workspaces/[conversationId]` — fetch workspace state
- `POST /api/analysis/workspaces/[conversationId]/run` — validate, persist, and execute a notebook revision
- `GET /api/analysis/workspaces/[conversationId]/revisions` — list revisions
- `GET /api/analysis/workspaces/[conversationId]/revisions/[revisionId]` — fetch a specific revision
- `GET /api/analysis/workspaces/[conversationId]/preview` — authenticated marimo preview bootstrap/proxy endpoint
- `POST /api/analysis/workspaces/[conversationId]/preview/restart` — restart preview if needed

## 5.3 Remove

Remove these routes entirely:

- `POST /api/data-analysis/run`
- `POST /api/visual-graph/run`
- `POST /api/document/generate`
- routes whose only purpose is serving old chart/document generated assets, if those assets are no longer produced by the new system
- `/api/workflows/from-chat-turn` unless and until rebuilt for notebook provenance

If a generic asset route is still needed for notebook exports, replace the old generated-file route with a notebook-oriented one.

## 6) Tool Contract Changes

## 6.1 New tool set

The assistant toolbelt becomes:

- `search_company_knowledge`
- `brave_search`
- `brave_grounding`
- `ask_user`
- `run_marimo_analysis`

Removed tools:

- `run_data_analysis`
- `generate_visual_graph`
- `generate_document`

## 6.2 `run_marimo_analysis` contract

The new tool must accept full marimo notebook source as the canonical analytical artifact.

### Request contract

```ts
type RunMarimoAnalysisRequest = {
  notebookSource: string;
  inputFiles?: string[];
  title?: string;
};
```

### Response contract

```ts
type RunMarimoAnalysisResponse = {
  workspaceId: string;
  revisionId: string;
  sandboxRunId: string;
  status: "running" | "completed" | "failed" | "timed_out" | "rejected";
  summary: string;
  stdout: string;
  stderr: string;
  notebookAsset: {
    path: string;
    downloadUrl: string;
  };
  htmlExportAsset?: {
    path: string;
    downloadUrl: string;
  };
  structuredResultAsset?: {
    path: string;
    downloadUrl: string;
    mimeType: string;
  };
  previewUrl: string;
  stagedFiles: Array<{
    sourcePath: string;
    stagedPath: string;
  }>;
};
```

### Execution rules

1. `notebookSource` must be a valid marimo notebook file.
2. Notebook source must use `marimo` and define an app object.
3. CSV-backed work must use Polars only.
4. Company files are available only through staged read-only inputs.
5. Notebook code may write only to `outputs/`.
6. Charts and tables are expected to render through notebook outputs, not a separate chart route.

## 6.3 Prompt contract changes

`apps/web/lib/chat-system-prompt.ts` must be rewritten so the model is told:

- analytical Python must be authored as marimo notebook source
- the notebook is the durable artifact of the conversation
- charts should be rendered in marimo outputs
- there is no separate chart or document tool
- Polars remains required for CSV-backed analysis
- search is still required before accessing internal files

## 7) Notebook Authoring Contract

## 7.1 Canonical notebook format

Each notebook is stored as a `.py` marimo notebook file.

Each notebook must contain:

- `import marimo`
- `app = marimo.App(...)`
- explicit cells for imports, file loading, transforms, outputs, and summary
- `if __name__ == "__main__": app.run()`

## 7.2 Expected cell structure

The assistant should be guided toward a standard cell pattern:

1. notebook imports and metadata
2. `import marimo as mo`
3. `import polars as pl`
4. input file declarations / helper functions
5. CSV loading via `pl.scan_csv(...).collect()`
6. transformation cells
7. result table cells
8. chart cells
9. short natural-language summary cell

The backend should not depend on exact cell count, but templates should strongly bias toward this structure.

## 7.3 Assistant ownership model

In v1:

- the assistant owns notebook generation and revisioning
- the user interacts through chat, not direct notebook editing
- code is visible in the right pane for inspection
- direct editing can be added later after notebook patching, validation, and audit concerns are solved

## 8) Execution Engine Contract

## 8.1 Authoritative execution path

All data analysis execution goes through marimo.

A single analytical run does the following:

1. create or update the conversation's notebook source
2. stage authorized company files into the isolated workspace
3. validate notebook source
4. run `marimo check` on the notebook
5. execute the notebook through marimo
6. export the notebook to HTML for durable rendered output
7. store notebook revision, logs, and assets
8. refresh or restart the interactive preview session for the right pane

## 8.2 Concrete execution commands

The default execution contract for v1 is:

1. **Validation:**
   - `marimo check notebook.py --strict`

2. **Deterministic execution + rendered artifact:**
   - `marimo export html notebook.py -o outputs/notebook.html`

3. **Optional script execution when side effects are required by the notebook contract:**
   - `python notebook.py`

`marimo export html` is the primary batch execution path because it causes the notebook to execute under marimo and produces a durable rendered artifact.

## 8.3 Interactive preview contract

The right pane preview is served by a managed marimo preview process.

Preview command shape:

- `marimo run notebook.py --port <allocated-port>`

The preview process must be:

- authenticated through Critjecture
- scoped to the current organization and authorized user
- restartable when notebook revisions change
- isolated from arbitrary network access consistent with the sandbox model

## 8.4 Supervisor architecture

Reuse the existing sandbox hardening model instead of introducing a browser-direct notebook runtime.

Implementation choice:

- extend the existing supervisor/runtime layer to support marimo notebook execution and managed marimo preview processes

This means the current sandbox/runtime stack should evolve from "run a Python snippet" to "run and serve a notebook workspace".

## 9) Persistence Model

## 9.1 New tables

Add these tables:

### `analysis_workspaces`

```ts
type AnalysisWorkspaceRow = {
  id: string;
  organizationId: string;
  userId: string;
  conversationId: string;
  title: string | null;
  status: "idle" | "running" | "completed" | "failed";
  latestRevisionId: string | null;
  latestSandboxRunId: string | null;
  createdAt: number;
  updatedAt: number;
};
```

### `analysis_notebook_revisions`

```ts
type AnalysisNotebookRevisionRow = {
  id: string;
  workspaceId: string;
  turnId: string | null;
  revisionNumber: number;
  notebookSource: string;
  notebookPath: string;
  htmlExportPath: string | null;
  structuredResultPath: string | null;
  summary: string | null;
  sandboxRunId: string | null;
  status: "running" | "completed" | "failed" | "timed_out" | "rejected";
  createdAt: number;
};
```

### `analysis_preview_sessions`

```ts
type AnalysisPreviewSessionRow = {
  id: string;
  workspaceId: string;
  revisionId: string;
  sandboxRunId: string | null;
  previewTokenHash: string | null;
  previewUrl: string | null;
  port: number | null;
  status: "starting" | "ready" | "stopped" | "failed";
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
};
```

## 9.2 Existing tables to keep

Keep if still useful:

- conversations/session records
- `chat_turns` and audit-log tables
- organization/user/membership tables
- knowledge/document tables
- operations/usage tables

## 9.3 Existing tables to remove

Remove if they only exist for the old analytical path:

- `analysis_results`
- old generated-asset records dedicated to chart/document flows if superseded
- workflow tables and builder-related tables if they are not being rebuilt immediately on top of notebook provenance

## 9.4 Asset storage layout

Persist notebook assets under organization-owned generated storage, for example:

```text
<storage-root>/organizations/<org-slug>/analysis_workspaces/<workspace-id>/
  current/notebook.py
  current/outputs/notebook.html
  revisions/<revision-number>/notebook.py
  revisions/<revision-number>/outputs/notebook.html
  revisions/<revision-number>/outputs/result.csv
  layouts/
```

If marimo layout metadata is used, persist the `layouts/` directory alongside the notebook.

## 10) Page And Component Refactor

## 10.1 Replace the monolithic chat shell with route-specific shells

Current `apps/web/components/chat-shell.tsx` is doing too much. Split it into:

- `ChatLandingShell` for `/chat`
- `AnalysisWorkspaceShell` for `/analysis/[conversationId]`
- shared lower-level conversation/agent hooks extracted into reusable modules

## 10.2 `/chat` page responsibilities

`ChatLandingShell` should own:

- conversation list/history
- new-chat creation
- light chat interaction before analysis starts
- redirection into analysis workspace once notebook execution begins

## 10.3 `/analysis/[conversationId]` responsibilities

`AnalysisWorkspaceShell` should own:

- current conversation messages
- marimo tool execution events
- workspace status
- embedded notebook preview
- notebook revision loading
- workspace-specific actions

It must not own any history UI.

## 10.4 Components to remove

Delete or fully remove from the workspace path:

- `ChatHistorySidebar`
- `ChatHistoryDialog`
- `ChatHistoryToggle`
- history-related toolbar actions inside the workspace
- workflow-builder modal and related save-from-chat actions

## 10.5 CSS refactor

Replace current chat-shell CSS assumptions with route-specific layout classes:

- `.chat-landing-shell`
- `.analysis-workspace`
- `.analysis-workspace__chat-pane`
- `.analysis-workspace__notebook-pane`
- mobile tab classes

Remove CSS dedicated only to in-workspace chat history behavior.

## 11) Backend Module Refactor

## 11.1 Add

Add modules like:

- `apps/web/lib/marimo-notebook-template.ts`
- `apps/web/lib/marimo-validation.ts`
- `apps/web/lib/marimo-workspaces.ts`
- `apps/web/lib/marimo-preview.ts`
- `apps/web/lib/marimo-runtime.ts`
- `apps/web/lib/marimo-types.ts`

## 11.2 Rewrite

Rewrite these areas around the new notebook contract:

- `apps/web/components/chat-shell.tsx`
- `apps/web/lib/chat-system-prompt.ts`
- any sandbox request parser currently built around raw script execution
- audit log summary helpers to understand workspace/revision ids
- operations usage labeling so notebook runs are counted under the new route/tool names

## 11.3 Remove

Delete or retire modules dedicated to the old path:

- `apps/web/lib/analysis-results.ts`
- chart-specific parsing/storage helpers
- document-generation helpers only used by removed features
- workflow-builder code tied to old tool-call extraction if not immediately rebuilt

## 12) Security And Access-Control Contract

## 12.1 File access

Notebook execution must continue to respect organization and role scope.

Rules remain:

- staged files are resolved server-side
- only authorized organization files are staged
- notebook code reads staged inputs only
- raw company storage is never browser-mounted directly

## 12.2 Preview access

Notebook preview access must be protected by Critjecture auth and organization checks.

Rules:

- preview URLs are not public
- preview tokens are short-lived
- owner/admin override behavior must be explicit if allowed
- users outside the organization must never reach notebook preview content

## 12.3 Auditability

Every notebook run must be auditable with:

- conversation id
- turn id
- workspace id
- revision id
- staged input files
- notebook source snapshot
- sandbox run id
- status and failure reason

## 13) Data Migration Policy

Backward compatibility is intentionally out of scope.

Migration policy:

1. remove obsolete tables and columns instead of maintaining compatibility shims
2. delete incompatible workflow/chat-tool session payloads if needed
3. archive or drop old chart/document assets
4. re-seed tool metadata and route labels under the new names
5. preserve only data that still maps cleanly to the marimo-first model

If a full reset of old workflow/chart state is simpler and safer, that is acceptable.

## 14) Features To Explicitly Remove

The implementation should remove all of the following, not leave them half-supported:

1. `run_data_analysis` tool
2. `generate_visual_graph` tool
3. `generate_document` tool
4. chart-ready stdout JSON storage path
5. `analysisResultId`
6. workflow-from-chat builder path
7. workspace-internal chat-history UI
8. old chart/document-oriented generated-asset UI affordances
9. old prompt instructions that tell the model to write one-off scripts or matplotlib/reportlab snippets outside marimo notebooks

## 15) Implementation Sequence

This refactor should be executed in many explicit steps.

## Step 0: Lock the spec

Deliverables:

- this document committed
- docs index updated
- implementation branch created

Exit criteria:

- the team treats this as the source of truth for the refactor

## Step 1: Add marimo runtime dependency

Tasks:

- add `marimo` to `packages/python-sandbox/pyproject.toml`
- update `uv.lock`
- verify `marimo check`, `marimo export html`, and `marimo run` work inside the sandbox environment
- document required runtime env vars and filesystem behavior

Exit criteria:

- marimo is installed in the sandbox image/runtime
- a sample notebook can execute in the isolated environment

## Step 2: Create the new notebook persistence schema

Tasks:

- add `analysis_workspaces`
- add `analysis_notebook_revisions`
- add `analysis_preview_sessions`
- add migrations under `apps/web/drizzle/`
- add types/parsers in `apps/web/lib/`

Exit criteria:

- migrations apply cleanly
- a conversation can own a workspace and notebook revisions

## Step 3: Build marimo notebook validation and templating

Tasks:

- create notebook template helpers
- create notebook validation helpers
- enforce marimo app structure
- enforce Polars-only CSV access rules
- enforce `inputs/` read-only and `outputs/` write-only contract

Exit criteria:

- invalid notebook source is rejected before execution
- valid notebook source passes automated checks

## Step 4: Build the marimo execution path

Tasks:

- add `run_marimo_analysis` backend route
- stage authorized company files
- write notebook source to workspace
- run `marimo check --strict`
- run `marimo export html`
- capture stdout/stderr/assets
- persist revision rows and status transitions

Exit criteria:

- the backend can execute a notebook revision and store its rendered artifact

## Step 5: Build preview-session management

Tasks:

- extend the supervisor/runtime layer with preview-session lifecycle support
- allocate/reuse ports safely
- generate signed/short-lived preview tokens
- add authenticated preview proxy/bootstrap routes
- restart preview sessions when a new revision becomes current

Exit criteria:

- the right pane can load a live marimo view for the current revision

## Step 6: Replace the tool contract in the chat agent

Tasks:

- remove `run_data_analysis`, `generate_visual_graph`, `generate_document`
- add `run_marimo_analysis`
- rewrite the tool schema in the chat client
- rewrite tool-result rendering for notebook results rather than chart/document assets

Exit criteria:

- the assistant can request notebook execution using only the new marimo tool

## Step 7: Rewrite the system prompt

Tasks:

- replace one-off script instructions with marimo notebook instructions
- remove chart/document tool guidance
- keep search/ask-user/web guidance that still applies
- add notebook-specific guardrails and examples

Exit criteria:

- the model consistently emits notebook-oriented analysis calls

## Step 8: Split the UI into landing and workspace routes

Tasks:

- create `/analysis/[conversationId]`
- split the current chat shell into route-specific shells
- keep history only on `/chat`
- remove history UI from the analysis workspace entirely
- add `Back to chats`

Exit criteria:

- analysis conversations render in a clean two-pane workspace with no history sidebar

## Step 9: Embed the marimo notebook pane

Tasks:

- add notebook iframe/proxy component
- show code and rendered outputs in the right pane
- handle loading/running/error/refresh states
- restore latest notebook revision on page load

Exit criteria:

- users can inspect notebook code, tables, and charts beside the chat

## Step 10: Remove obsolete chart/document pipeline code

Tasks:

- delete old routes and helpers
- delete old analysis-result storage code
- delete chart/document prompt text
- delete image review plumbing specific to old chart assets

Exit criteria:

- there is only one analytical execution path in the codebase

## Step 11: Remove workflow-builder integrations tied to old chat tooling

Tasks:

- delete `Save as workflow` from chat/workspace UI
- remove `workflow-builder-modal` if no longer usable
- remove `from-chat-turn` API path and supporting compiler code
- strip tests tied only to the old workflow builder contract

Exit criteria:

- no broken or misleading workflow affordances remain

## Step 12: Update audit, operations, and usage tracking

Tasks:

- add workspace/revision ids to audit records
- update usage event names and route labels
- ensure failures in marimo preview/execution are observable
- update admin logs copy from old tool names to new notebook concepts

Exit criteria:

- privileged users can inspect notebook-backed analytical runs coherently

## Step 13: Rewrite tests around the new flow

Tasks:

- remove tests for deleted tool routes
- add notebook execution tests
- add preview-auth tests
- add route transition tests from `/chat` to `/analysis/[conversationId]`
- add tests that history is absent in the workspace
- add tests that prior analysis conversations reopen in workspace mode

Exit criteria:

- test suite reflects only the new product model

## Step 14: Rewrite product and ops docs

Tasks:

- update `README.md`
- update `overview.md`
- update deployment and runbook docs where the old analytical pipeline is described
- document marimo runtime requirements and failure modes

Exit criteria:

- product docs no longer describe removed chart/document/script flows

## Step 15: Remove dead code and finalize naming

Tasks:

- remove unused types, helpers, CSS, and tests
- rename modules/routes so the codebase reflects notebook/workspace terminology
- ensure no stale references to `analysisResultId`, `generate_visual_graph`, or `generate_document` remain

Exit criteria:

- repository language matches the marimo-first architecture

## 16) File-Level Change List

The following files are expected to change heavily or be replaced:

### Major rewrites

- `apps/web/components/chat-shell.tsx`
- `apps/web/app/globals.css`
- `apps/web/lib/chat-system-prompt.ts`
- `apps/web/lib/python-sandbox.ts`
- `packages/sandbox-supervisor/server.mjs`
- `apps/web/lib/sandbox-tool-types.ts`
- `apps/web/lib/operations.ts` and related route metadata where tool names are tracked

### New files/directories

- `apps/web/app/analysis/[conversationId]/page.tsx`
- `apps/web/components/analysis-workspace-shell.tsx`
- `apps/web/components/chat-landing-shell.tsx`
- `apps/web/components/marimo-preview-pane.tsx`
- `apps/web/lib/marimo-*`
- new API routes under `apps/web/app/api/analysis/workspaces/`

### Files likely removed

- `apps/web/components/chat-history-toggle.tsx`
- `apps/web/components/workflow-builder-modal.tsx`
- `apps/web/app/api/data-analysis/run/route.ts`
- `apps/web/app/api/visual-graph/run/route.ts`
- `apps/web/app/api/document/generate/route.ts`
- `apps/web/lib/analysis-results.ts`
- old workflow-from-chat builder code if not rebuilt immediately

## 17) Acceptance Criteria

The refactor is complete when all of the following are true:

1. `/chat` remains the landing page.
2. First analytical notebook execution moves the user into `/analysis/[conversationId]`.
3. The analysis workspace has exactly two panes on desktop: chat and notebook.
4. Chat history is not visible anywhere inside the analysis workspace.
5. The assistant writes marimo notebook code for all data analysis.
6. The backend executes notebook revisions through marimo, not the legacy one-off script path.
7. Charts and tables render through notebook outputs, not a separate chart pipeline.
8. Old chart/document/workflow-builder codepaths are removed, not merely hidden.
9. Audit logs and operations surfaces still reflect analytical work with the new notebook vocabulary.
10. Docs and tests reflect the marimo-first product model.

## 18) Explicit Non-Goals For This Refactor

These are intentionally not part of v1 unless added later:

- notebook co-editing by multiple users
- arbitrary direct notebook editing in the browser
- preserving compatibility with old chart/document/workflow artifacts
- rebuilding the workflow product before notebook provenance stabilizes
- maintaining duplicate script-based and notebook-based analytical engines in parallel

## 19) Recommended First Implementation Slice

The first coding slice after this spec should be:

1. add marimo runtime dependency
2. create workspace/revision schema
3. implement notebook execution route
4. create `/analysis/[conversationId]` shell with no history UI
5. replace the old analysis tool with `run_marimo_analysis`

That slice creates the backbone of the new system before deleting the old chart/document/workflow code.
