# Steps Completed

## Step 1: Monorepo & "Hello World" Chat Shell

### What Was Implemented

Step 1 was implemented as a real `pnpm` monorepo with a Next.js app in `apps/web`.

- Added a root workspace setup with:
  - `package.json`
  - `pnpm-workspace.yaml`
  - `pnpm-lock.yaml`
- Added a Next.js 16 App Router app under `apps/web`.
- Added a `/chat` page that renders a working `@mariozechner/pi-web-ui` chat shell.
- Added a server-side OpenAI streaming route at `/api/stream`.
- Added `/api/chat` as an alias to the same server-side streaming handler.
- Added environment documentation in:
  - `README.md`
  - `apps/web/.env.local.example`

### Current Architecture

The current Step 1 app is intentionally minimal.

- Frontend:
  - `apps/web/app/chat/page.tsx` renders the chat shell page.
  - `apps/web/components/chat-shell.tsx` dynamically loads:
    - `@mariozechner/pi-agent-core`
    - `@mariozechner/pi-ai`
    - `@mariozechner/pi-web-ui`
  - The chat uses `agent-interface` from `pi-web-ui`, not the full `ChatPanel`.
  - The client creates an `Agent` with:
    - no tools
    - no RBAC
    - no auth UI
    - no attachments
    - no model selector
    - no thinking selector
- Backend:
  - `apps/web/app/api/stream/route.ts` performs the actual OpenAI call.
  - The backend owns model selection and API key usage.
  - The route streams SSE in the proxy-style event format expected by `pi-agent-core` `streamProxy`.

### Model and Env Behavior

- Default model: `gpt-4o-mini`
- Supported env override values for `OPENAI_MODEL` are currently:
  - `gpt-4o-mini`
  - `gpt-4o`
  - `gpt-4.1-mini`
  - `gpt-4.1`
- `OPENAI_API_KEY` must be present for live chat.
- If `OPENAI_API_KEY` is missing, the API route returns a clear JSON error.
- If `OPENAI_MODEL` is invalid, the API route returns a clear JSON error.

### UI / Theming Notes

- The app imports the upstream `@mariozechner/mini-lit` Claude theme.
- Dark mode is forced at the root HTML element.
- The shell styling in `apps/web/app/globals.css` uses custom `--shell-*` variables to avoid conflicting with `mini-lit` / `pi-web-ui` theme tokens.
- A local copy of the `pi-web-ui` stylesheet exists at `apps/web/app/pi-web-ui.css`.
  - This was generated from the published package CSS with broken `@font-face` references removed.
  - Reason: the published `pi-web-ui` CSS referenced font asset paths that do not resolve correctly in this Next.js setup.

### Important Implementation Details

- The browser does not call OpenAI directly.
- The client uses `streamProxy(...)` with:
  - `proxyUrl: ""`
  - `authToken: "local-dev"`
- This works because the actual request goes to the same-origin Next route at `/api/stream`.
- `chat-shell.tsx` initializes the minimal `AppStorage` required by `pi-web-ui` so `agent-interface` can function correctly.
- The loading overlay was implemented as a sibling of the Lit host node, not a child inside it.
  - Reason: React and Lit were previously fighting over the same DOM subtree.

### Constraints For Step 2

Step 2 should build on the current implementation rather than replacing it.

- Keep the current `pnpm` monorepo structure.
- Keep the Next.js app in `apps/web`.
- Keep the existing `/chat` route and server streaming pattern.
- Add RBAC and `search_company_knowledge` on top of the current backend route flow.
- Do not regress the current theme/token setup.
- Do not move OpenAI calls into the browser.

## Step 2: The Librarian (RBAC & Ripgrep)

### What Was Implemented

Step 2 was implemented as an RBAC-aware local knowledge search flow on top of the Step 1 streaming chat shell, with a simplified Critjecture-branded wrapper around `pi-web-ui`.

- Added mock company data at the repo root:
  - `sample_company_data/public/schedule.txt`
  - `sample_company_data/admin/profit.txt`
- Added shared role handling in `apps/web/lib/roles.ts`.
- Added the backend search implementation in `apps/web/lib/company-knowledge.ts`.
  - Uses Node.js `child_process.execFile(...)` to run `rg`
  - Resolves the repo-level `sample_company_data` directory safely
  - Restricts the search root by role before `rg` executes
- Added the server API route at `apps/web/app/api/company-knowledge/search/route.ts`.
  - Validates `query` and `role`
  - Returns cited matches plus a plain-text summary for the tool result
- Updated the frontend agent wiring in `apps/web/components/chat-shell.tsx`.
  - Registers the `search_company_knowledge` tool in the client agent
  - Executes the tool by calling the backend search route
  - Rebuilds the chat session when the selected role changes so higher-access context is not reused
- Moved the hardcoded `Intern` / `Owner` selector into the page header in `apps/web/app/chat/page.tsx`.
- Reworked the `/chat` presentation into a simpler Critjecture shell.
  - Uses the Critjecture favicon/logo SVG as both the app icon and the header mark
  - Removes the large outer framed shell so the editor remains the primary outlined control
  - Keeps most branding in app-owned wrapper CSS instead of package-internal restyling
- Replaced the earlier hand-maintained `pi-web-ui` stylesheet fork with a safer package boundary:
  - `apps/web/app/pi-web-ui.generated.css` is generated from upstream package CSS
  - `apps/web/app/pi-web-ui.css` is now a thin additive override layer
  - `apps/web/scripts/sync-pi-web-ui-css.mjs` refreshes the generated stylesheet on package upgrades

### Current Step 2 Behavior

- `Intern`
  - `search_company_knowledge` searches only `company_data/public`
  - Asking about profit should return no match in the allowed scope
- `Owner`
  - `search_company_knowledge` searches all of `company_data`
  - Asking about profit can surface `company_data/admin/profit.txt`

### Important Implementation Details

- The actual file-system search still happens on the Next.js backend, not in the browser.
- `rg` is executed without a shell to avoid shell-injection issues.
- RBAC is enforced by selecting the directory scope before running `rg`.
- The frontend keeps the existing `pi-web-ui` chat surface and server-side OpenAI streaming pattern.
- The role selector is page-owned UI, while tool execution remains inside the client agent session.
- Package upgrade risk was reduced by limiting custom `pi-web-ui` styling to a generated upstream base plus a very small override file.

## Step 3: The `uv` Python Sandbox (Polars Environment)

### What Was Implemented

Step 3 was implemented as a real Python analysis tool on top of the existing Step 2 chat architecture, including the isolated runtime, backend execution bridge, tool registration, and a custom UI renderer for analysis calls.

- Added a standalone `uv` project at `packages/python-sandbox`.
- Installed `polars` into the sandbox package and committed its `uv.lock`.
- Added the server-only sandbox wrapper in `apps/web/lib/python-sandbox.ts`.
  - Resolves the hardcoded interpreter path at `packages/python-sandbox/.venv/bin/python`
  - Runs Python via `execFile(...)`
  - Strips inherited environment variables
  - Forces execution inside `/tmp/workspace`
  - Returns structured stdout/stderr and raises clear execution errors
- Added the backend route at `apps/web/app/api/data-analysis/run/route.ts`.
  - Validates `code`
  - Executes the sandboxed Python command
  - Returns structured stdout/stderr plus a summary string
  - Detects the common "no stdout" case and tells the model to `print(...)` the final answer explicitly
- Updated `apps/web/components/chat-shell.tsx`.
  - Registers the new `run_data_analysis` tool
  - Keeps `search_company_knowledge` in place
  - Updates the system prompt so the model uses Python for computations and analytical tasks
  - Instructs the model to write complete Python, print final answers to stdout, and prefer a single JSON object for multi-value results
  - Removes the temporary smoke-test prompt once the tool path was working reliably
- Added a custom tool renderer in `apps/web/lib/tool-renderers.ts`.
  - Replaces the default raw JSON tool view for `run_data_analysis`
  - Shows the generated Python code in a proper code block
  - Separates stdout and stderr into distinct panels
  - Shows execution status, summary text, and sandbox metadata in a more readable card
- Updated app-owned UI styling.
  - Added analysis tool card styling in `apps/web/app/pi-web-ui.css`
  - Fixed the `/chat` shell layout in `apps/web/app/globals.css` so the frame fills the page height instead of leaving dead space below the composer

### Current Step 3 Behavior

- The browser still does not execute Python directly.
- The client tool calls a Next.js backend route, and the backend owns process spawning.
- The Python interpreter is fixed to the local sandbox package `.venv`, not the system Python.
- The sandbox writes only inside `/tmp/workspace`.
- Analytical questions can now trigger `run_data_analysis` and display:
  - the Python code sent to the sandbox
  - the captured stdout
  - any stderr output
  - a short execution summary

### Important Implementation Details

- `run_data_analysis` is intentionally generic and accepts raw Python code so Step 4 can reuse it for Polars-based CSV analysis.
- Errors from Python are returned clearly instead of being swallowed by the tool layer.
- The tool contract now depends on stdout for useful answers, so prompt quality matters: the model must `print(...)` the final result.
- The custom renderer improves readability, but it does not yet render charts or files. That remains Step 5 work.

## Step 4: The Autonomous ReAct Loop (Memory-Safe)

### What Was Implemented

Step 4 was finished as an RBAC-aware search and analysis workflow that can discover company files, disambiguate between multiple matching ledgers, stage the chosen file into the Python sandbox, and run lazy Polars analysis safely.

- Added shared company-data path resolution and authorization in `apps/web/lib/company-data.ts`.
  - Resolves the repo-level `sample_company_data` root
  - Normalizes relative file paths
  - Rejects absolute paths and path traversal
  - Enforces role-based file access before analysis
- Expanded the mock ledger data to cover ambiguous search cases:
  - `sample_company_data/admin/contractors_new.csv` for 2026
  - `sample_company_data/admin/contractors.csv` for 2025
- Added grouped company knowledge types in `apps/web/lib/company-knowledge-types.ts`.
- Reworked `apps/web/lib/company-knowledge.ts`.
  - Keeps exact phrase search as the first pass
  - Falls back to tokenized raw-content search and filename matching when the phrase search is weak or empty
  - Groups matches by file instead of returning only flat `rg` hits
  - Builds compact previews for candidate files
  - Auto-selects only when there is one clear file or a unique year-based winner
- Updated `apps/web/app/api/company-knowledge/search/route.ts`.
  - Returns candidate files, selection state, and selected file metadata
  - Emits summary text that tells the model when to proceed automatically and when to stop for user choice
- Extended the sandbox wrapper in `apps/web/lib/python-sandbox.ts`.
  - Creates a fresh per-run workspace under `/tmp/workspace/<run-id>`
  - Stages approved company files under `inputs/<same-relative-path>`
  - Returns staged file metadata to the UI
  - Rejects CSV analysis code that uses `pandas`, `pd.read_csv(...)`, or eager `pl.read_csv(...)`
  - Requires the lazy Polars pattern `pl.scan_csv(...)` plus `.collect()`
- Updated the analysis route in `apps/web/app/api/data-analysis/run/route.ts`.
  - Validates `role`
  - Accepts optional `inputFiles`
  - Returns clear 400-level errors for invalid staged inputs or invalid CSV loading patterns
- Added the UI-only `file-selection` custom message flow in:
  - `apps/web/lib/file-selection-messages.ts`
  - `apps/web/components/chat-shell.tsx`
  - `apps/web/app/pi-web-ui.css`
- The chat shell now:
  - Filters the UI-only selection message out of LLM context
  - Appends a clickable picker message when search returns multiple candidate files
  - Queues a selected file if the agent is still streaming
  - Sends a follow-up user prompt naming the selected file once the session is ready
  - Extends `run_data_analysis` so the current role and selected `inputFiles` are always sent to the backend
- Updated `apps/web/lib/tool-renderers.ts`.
  - Shows staged input files in the analysis card
  - Keeps Python code, stdout, stderr, and execution state readable
- Updated app-owned chat styling in `apps/web/app/pi-web-ui.css`.
  - Added the file picker UI
  - Fixed mobile overflow so Python sandbox/code blocks stay within the viewport and scroll internally
- Updated operator-facing docs in `README.md`.
  - Removes the stale Step 3 smoke-test note
  - Documents the new contractor ledgers, forgiving search flow, picker behavior, and Step 4 verification checks

### Current Step 4 Behavior

- `Owner`
  - Can search all of `company_data`
  - Can ask for `What is the average payout in our 2026 contractor ledger?` and have the system auto-select `admin/contractors_new.csv`
  - Can ask a broader query such as `contractor payouts` and get a picker showing both contractor CSV files before analysis runs
  - Can pass the selected file into `run_data_analysis`, where it is staged under `inputs/<same-relative-path>`
  - Must use lazy Polars for CSV analysis
- `Intern`
  - Can search only `company_data/public`
  - Cannot see admin-only candidate files or previews
  - Cannot stage admin-only files into the sandbox even if the model attempts to pass the path manually

### Important Implementation Details

- Step 4 keeps the current client-side `pi-ai` tool orchestration; it does not move the ReAct loop to the server.
- RBAC for file analysis is enforced on the backend by validating and staging explicit `inputFiles`, not by trusting model-generated filesystem paths.
- Search ranking stays raw-content based. No metadata manifest or CSV profiling job was added.
- File previews are intentionally shallow: CSV header plus 3 rows, or 3 non-empty text lines.
- The clickable picker is implemented as a custom message renderer rather than a tool-card hack so the app can inject a normal user prompt after selection.
- The memory-safety rule is enforced both by prompt guidance and by backend validation for CSV-backed analysis calls.
- The sandbox still uses the fixed `packages/python-sandbox/.venv/bin/python` interpreter and a stripped environment.

## Step 5: Visuals & Documents (The UI Handlers)

### What Was Implemented

Step 5 was implemented as two new sandbox-backed file-generation tools plus a secure generated-file delivery path for the existing `/chat` UI.

- Extended the sandbox package at `packages/python-sandbox`.
  - Added `matplotlib` for PNG chart generation
  - Added `reportlab` for PDF generation
  - Updated the committed `uv.lock`
- Expanded `apps/web/lib/python-sandbox.ts`.
  - Creates `outputs/` inside every sandbox workspace
  - Scans supported generated assets after execution
  - Returns generated asset metadata to the UI
  - Exposes a strict resolver for serving only `.png` and `.pdf` assets from `outputs/`
- Added shared sandbox request parsing in `apps/web/lib/sandbox-route.ts`.
- Added backend routes:
  - `apps/web/app/api/visual-graph/run/route.ts`
  - `apps/web/app/api/document/generate/route.ts`
  - `apps/web/app/api/generated-files/[runId]/[...assetPath]/route.ts`
- Updated `apps/web/components/chat-shell.tsx`.
  - Registers `generate_visual_graph` and `generate_document`
  - Updates the system prompt so the model writes chart/document files into `outputs/`
  - Tightens the chart/document guidance so charts use matplotlib plus Polars-backed staged CSV data, while PDFs use reportlab
  - Keeps the existing search-first and picker-first behavior when company files are needed
- Reworked `apps/web/lib/tool-renderers.ts`.
  - Keeps the Step 4 Python sandbox card structure
  - Adds an in-chat PNG preview card for `generate_visual_graph`
  - Adds a PDF download action for `generate_document`
  - Handles partial error payloads safely so failed tool calls do not crash the chat UI
- Expanded `apps/web/app/pi-web-ui.css`.
  - Styles the image preview card
  - Styles the document download action
  - Keeps the layout mobile-safe
- Added Step 5 demo data:
  - `sample_company_data/admin/rent_delinquency.csv`
- Updated `README.md` with Step 5 setup and verification notes.

### Current Step 5 Behavior

- `Owner`
  - Can ask for `Create a bar chart of the top 3 contractor payouts` and receive a generated PNG preview in chat
  - Can ask for `Generate a late rent notice PDF for Unit 4B` and receive a downloadable PDF link in chat
  - Still uses search and staged `inputFiles` whenever company records are required
- `Intern`
  - Still cannot access admin-only ledgers or rent-delinquency data
  - Sees the same access-scope refusal behavior for chart and document requests that depend on admin files

### Important Implementation Details

- Step 5 keeps the current client-side `pi-ai` tool orchestration. The ReAct loop is still not moved to the server.
- Generated files are ephemeral and live only under `/tmp/workspace/<run-id>/outputs/`.
- The generated-file route validates workspace id, rejects traversal, and only serves `.png` and `.pdf` files from the sandbox outputs directory.
- The chart and document routes require exactly one primary output file of the expected type so the tool contract stays predictable for the UI.
- The visual-graph route forces the non-interactive Matplotlib `Agg` backend before executing model-generated code so PNG generation works reliably in the sandbox.
- Current graph generation reads directly from staged company data. A reasonable future improvement is to let `run_data_analysis` persist a structured output file that later graph/document tools can consume instead of recomputing from source inputs.

## Step 6: The Boss's Dashboard (Audit Logging)

### What Was Implemented

Step 6 was implemented as a local SQLite-backed audit system plus an owner-gated admin dashboard, while preserving the existing client-side `pi-ai` tool orchestration from Steps 4 and 5.

- Added a SQLite audit database. That original Step 6 path was later replaced by the shared app database path under `DATABASE_URL` or `storage/critjecture.sqlite`.
- Added a Drizzle-backed audit schema and server helpers:
  - `apps/web/lib/app-schema.ts` (current)
  - `apps/web/lib/app-db.ts` (current)
  - `apps/web/lib/audit-log.ts`
  - `apps/web/drizzle/0000_step6_audit_logging.sql`
  - `apps/web/drizzle/0001_step6_trace_events.sql`
- Added audit API routes:
  - `apps/web/app/api/audit/chat-turns/route.ts`
  - `apps/web/app/api/audit/tool-calls/start/route.ts`
  - `apps/web/app/api/audit/tool-calls/finish/route.ts`
  - `apps/web/app/api/audit/assistant-messages/route.ts`
  - `apps/web/app/api/admin/logs/route.ts`
- Updated `apps/web/components/chat-shell.tsx`.
  - Generates a stable client session id for each mounted chat session
  - Logs each real user prompt before the first proxied OpenAI stream for that request
  - Uses `beforeToolCall` and `afterToolCall` to persist exact tool args, accessed data files, and completion/error summaries
  - Captures assistant response text as a lightweight trace for each audited interaction
  - Keeps ambiguous file-picker continuation prompts attached to the original human chat turn instead of creating a second chat-turn row
- Added shared app chrome for `/chat` and `/admin/logs`:
  - `apps/web/components/workspace-shell.tsx`
  - `apps/web/components/chat-page-client.tsx`
  - `apps/web/components/admin-logs-page-client.tsx`
- Added the owner-gated audit dashboard route at `apps/web/app/admin/logs/page.tsx`.
- Reworked the dashboard interaction cards.
  - Each audited interaction is now collapsible
  - Cards are collapsed by default
  - The collapsed header shows the role, date, question, and accessed company data files
  - The expanded view separates assistant response trace from tool-call details to avoid duplicated tool information
- Tightened the dashboard refresh behavior.
  - The page fetches once on load
  - It only repolls when a recent interaction still appears active or incomplete
  - Otherwise the owner uses a manual `Refresh` button
- Updated app-owned global styling and README guidance for Step 6.

### Current Step 6 Behavior

- `Owner`
  - Can open `/admin/logs?role=owner`
  - Sees a newest-first feed of collapsible chat turn cards
  - Can scan collapsed headers for role, timestamp, question, and accessed data files
  - Can expand a card to inspect the assistant response timeline plus exact tool-call parameters and summaries
  - Only gets background refreshes while recent interactions still look active or incomplete
- `Intern`
  - Can still use `/chat`
  - Cannot view the audit feed on `/admin/logs`; the page shows an owner-only state and skips the fetch
- Ambiguous file selection
  - The original user question is logged once
  - The later selected-file continuation remains correlated to that same chat turn row

### Important Implementation Details

- Step 6 does not move tool execution to the server. Chat-turn and tool-call auditing is initiated from the client agent lifecycle because that is where tool execution actually occurs.
- The audit database is initialized lazily and applies committed SQL migrations on first use.
- Tool-call rows store the validated tool arguments as JSON text and track accessed company-data files so the dashboard can surface file access directly in the collapsed header and per-tool detail view.
- The assistant-messages section now intentionally records only assistant response text. Tool-call and tool-result detail stays in the tool section so the audit view does not duplicate the same execution information twice.
- The dashboard is an MVP UI gate based on the existing role selector, not a real authentication system.
- `better-sqlite3` is a native dependency; when `pnpm` blocks native install scripts, `pnpm approve-builds --all` is required before the audit database can load at runtime.

## Step 7: Multi-File Planning & Chat Polish

### What Was Implemented

Step 7 was implemented as a planner-backed multi-file selection flow, plus a follow-up audit correlation fix and chat overflow cleanup.

- Reworked the company-knowledge selection contract:
  - `apps/web/lib/company-knowledge-types.ts`
  - `apps/web/lib/company-knowledge.ts`
  - `apps/web/app/api/company-knowledge/search/route.ts`
- The search flow now:
  - returns `selectedFiles` instead of a single `selectedFile`
  - returns `recommendedFiles` for high-confidence ambiguous results
  - keeps true auto-selection for single-candidate or unique-year matches
  - marks broader ambiguous searches as planner-required instead of forcing immediate single-file selection
- Reworked the custom file picker in:
  - `apps/web/lib/file-selection-messages.ts`
  - `apps/web/app/pi-web-ui.css`
- The picker now:
  - supports multi-select with checkboxes
  - prechecks recommended files
  - shows which search queries contributed to each candidate
  - requires an explicit `Use Selected Files` confirmation step before analysis continues
- Updated `apps/web/components/chat-shell.tsx`.
  - Accumulates ambiguous search results across the current assistant turn
  - Consolidates them into one planner-level picker instead of emitting one picker per search
  - Blocks sandbox tools while planner selection is pending
  - Sends one synthetic continuation prompt containing the full confirmed file set so later tools can pass those exact paths in `inputFiles`
- Fixed audit chat-turn correlation in `apps/web/components/chat-shell.tsx`.
  - Synthetic picker-confirmation continuations now stay attached to the original human question
  - This prevents the audit dashboard from showing a second chat turn card for the same interaction
- Tightened app-owned chat styling in `apps/web/app/pi-web-ui.css`.
  - Markdown tables in assistant responses now scroll horizontally inside the chat message
  - Long summary text, staged file paths, and tool metadata now wrap instead of overflowing the message column

### Current Step 7 Behavior

- `Owner`
  - Can ask broad comparison or aggregation questions such as `what contractors did we use in 2025 and 2026`
  - Gets one consolidated multi-select picker when multiple files are relevant
  - Sees likely files preselected, but can adjust the file set before continuing
  - Can confirm multiple files and have the follow-up analysis run against all selected paths
  - Sees one audit card for the original question, even when the workflow pauses for file confirmation
- `Intern`
  - Still respects the earlier RBAC limits
  - Only sees planner candidates inside the allowed public search scope
- Chat layout
  - Wide assistant tables no longer push the whole chat column wider than the viewport
  - Long tool summaries and workspace/file path strings stay inside the tool card bounds

### Important Implementation Details

- Step 7 keeps the current client-side `pi-ai` orchestration model. The planner flow is implemented in the chat session layer, not as a new backend planner service.
- The multi-file picker remains a UI-only custom message that is filtered out of LLM context. Only the synthetic post-confirmation prompt is sent back into the model conversation.
- The planner state is session-local and is cleared once the pending selection is resolved.
- Sandbox tools now reject execution while planner selection is pending, which prevents the model from racing ahead with incomplete file context.
- The audit fix works by routing synthetic continuation prompts through the underlying prompt path rather than the audited wrapper, so the continuation reuses the original chat turn row.

## Step 8: Audit Timeline Ordering & Filtering

### What Was Implemented

Step 8 was implemented as an audit-log chronology update for the owner dashboard, replacing the older split assistant/tool detail view with a single merged event timeline per chat turn card.

- Updated `apps/web/components/admin-logs-page-client.tsx`.
  - Normalizes each chat turn into one combined timeline of assistant response events and tool-call events
  - Sorts those merged events by `createdAt` ascending so the expanded audit card reflects the real execution order
  - Adds a per-card filter with `All`, `Assistant`, and `Tools`
  - Keeps tool detail rendering intact for parameters, accessed files, result summaries, and errors
- Updated `apps/web/app/globals.css`.
  - Adds styles for the new timeline header, segmented filter control, and timeline item presentation
  - Keeps the existing audit card visual language while making assistant and tool entries distinguishable

### Current Step 8 Behavior

- `Owner`
  - Still sees the same newest-first collapsed chat turn feed on `/admin/logs`
  - Can expand a chat turn card and review one chronological timeline instead of separate assistant and tool sections
  - Sees `All` by default, with the option to filter to only assistant responses or only tool calls for that card
- Example session
  - Session `04c2400a-44df-400d-8f06-a5ac3fe7d6c9` now displays in the actual recorded order:
    - `search_company_knowledge`
    - the assistant file-selection response
    - `run_data_analysis`
    - the final assistant response listing the contractors
- Empty-state handling
  - Cards with only assistant entries or only tool entries still render correctly
  - Filter-specific empty messages appear when the selected filter has no matching events

### Important Implementation Details

- Step 8 originally used the existing audit data model. Those concepts now live in `chat_turns`, `assistant_messages`, and `tool_calls`, each of which still stores the timestamps needed for chronology.
- The merged timeline currently includes only assistant-message rows plus tool-call rows.
- Tool timeline placement is based on tool start time (`startedAt`), while tool cards still show completion status and end time when available.
- Per-card filter state is local UI state only and resets on reload.

## Step 9: Real Authentication and Server-Enforced RBAC

### What Was Implemented

Step 9 was implemented as a real credentials-based authentication layer with server-derived authorization, replacing the older client-side role toggle as the security boundary.

- Added Auth.js-based login and session handling:
  - `apps/web/auth.ts`
  - `apps/web/app/api/auth/[...nextauth]/route.ts`
  - `apps/web/app/auth-actions.ts`
  - `apps/web/app/login/page.tsx`
  - `apps/web/components/login-form.tsx`
- Added authenticated user persistence on top of the existing SQLite/Drizzle setup:
  - `apps/web/lib/users.ts`
  - `apps/web/lib/passwords.ts`
  - `apps/web/drizzle/0002_step9_auth_and_ownership.sql`
  - `apps/web/lib/app-schema.ts`
- Added pilot user seeding from env:
  - `CRITJECTURE_OWNER_*`
  - `CRITJECTURE_INTERN_*`
  - `AUTH_SECRET`
- Added shared server auth helpers in `apps/web/lib/auth-state.ts`.
- Reworked the top-level app routing and shell:
  - `/` now redirects to `/login` when signed out and `/chat` when signed in
  - `/chat` now requires an authenticated user
  - `/admin/logs` now requires an authenticated owner
  - `apps/web/components/workspace-shell.tsx` now shows the authenticated user identity, role, and a sign-out button instead of the old role toggle
- Removed the old client-side role query plumbing:
  - deleted `apps/web/lib/role-query.ts`
  - deleted `apps/web/components/chat-page-client.tsx`
- Updated `apps/web/components/chat-shell.tsx`.
  - Keeps the current client-side `pi-ai` orchestration model
  - Still receives the authenticated role for the system prompt
  - Scopes local `pi-web-ui` IndexedDB session storage by authenticated `userId`
  - Stops sending `role` in tool and audit requests
  - Sends `chatSessionId` when creating chat-turn audit records
- Reworked protected backend routes so they derive permissions from the authenticated session instead of trusting request input:
  - `apps/web/app/api/stream/route.ts`
  - `apps/web/app/api/company-knowledge/search/route.ts`
  - `apps/web/app/api/data-analysis/run/route.ts`
  - `apps/web/app/api/visual-graph/run/route.ts`
  - `apps/web/app/api/document/generate/route.ts`
  - `apps/web/app/api/admin/logs/route.ts`
  - all audit write routes under `apps/web/app/api/audit/*`
- Added authenticated ownership tracking for sandbox output files:
  - `apps/web/lib/sandbox-runs.ts`
  - `apps/web/app/api/generated-files/[runId]/[...assetPath]/route.ts`
  - sandbox runs now record the authenticated `userId`, `runId`, tool name, and generated assets
- Expanded audit data so the dashboard can show who initiated each interaction:
  - chat turn rows now store `userId`
  - the dashboard shows user identity plus chat session id
  - audit follow-up writes verify that the referenced chat turn belongs to the authenticated user
- Updated docs and env examples:
  - `README.md`
  - `apps/web/.env.local.example`

### Current Step 9 Behavior

- Unauthenticated visitors
  - Are redirected to `/login` for protected app pages
  - Receive `401` responses from protected API routes
- `Intern`
  - Can sign in and use `/chat`
  - Still searches only `company_data/public`
  - Still cannot access admin-only company files, sandbox inputs, or the owner audit dashboard
- `Owner`
  - Can sign in and use `/chat`
  - Can access `/admin/logs`
  - Sees audit entries with the initiating authenticated user and the chat session id
- Generated assets
  - Are still served from sandbox workspaces under `/tmp/workspace/<run-id>/outputs/`
  - Can only be downloaded by the authenticated user who created that sandbox run
- Local browser chat state
  - Is now partitioned by authenticated user instead of being shared across role-toggle state

### Important Implementation Details

- Step 9 keeps the current client-side `pi-ai` tool orchestration model. It does not move the ReAct loop or tool execution orchestration fully to the server.
- Auth uses Auth.js credentials sessions with signed cookies and JWT-backed session state.
- Passwords are stored as salted `scrypt` hashes, not plaintext.
- The current implementation is intentionally pilot-first:
  - no signup flow
  - no password reset flow
  - no external identity provider
  - no user-management UI
  - no tenant model yet
- User persistence currently lives in the same SQLite/Drizzle application database area already used by the audit system.
- Backend routes no longer accept request-supplied `role` as an authorization source of truth.
- The owner audit dashboard is now protected both at the page level and at the API level.
- Step 10 still remains the place to formalize broader tenant, organization, and durable multi-user persistence foundations beyond this pilot auth layer.

## Step 10: Tenant and Data Persistence Foundations

### What Was Implemented

Step 10 was implemented as a SQLite-first tenant and storage foundation that supports local development, customer-managed hardware, and Railway deployments with attached persistent storage.

- Added a generic application persistence layer:
  - `apps/web/lib/app-db.ts`
  - `apps/web/lib/app-schema.ts`
  - `apps/web/scripts/run-db-migrations.mjs`
- Added configurable storage and path resolution:
  - `apps/web/lib/app-paths.ts`
  - new env support for `DATABASE_URL` and `CRITJECTURE_STORAGE_ROOT`
- Added tenant data model foundations:
  - `organizations`
  - `organization_memberships`
  - `organization_id` scoping on `chat_turns`
  - `organization_id` scoping on `sandbox_runs`
  - migration `apps/web/drizzle/0003_step10_tenants_and_storage.sql`
- Added default organization seeding and legacy backfill:
  - `apps/web/lib/organizations.ts`
  - `apps/web/lib/users.ts`
  - existing Step 9 users are backfilled into the default organization through memberships
  - legacy chat turns and sandbox runs are backfilled to that organization
- Reworked runtime company-data storage:
  - live company data now resolves from `<CRITJECTURE_STORAGE_ROOT>/organizations/<organization-slug>/company_data`
  - repo-root `sample_company_data/` is now bundled sample data used to seed first-run organization storage
- Reworked authenticated session shape:
  - session state now includes `organizationId`, `organizationName`, and `organizationSlug`
  - effective role is now derived from organization membership
- Scoped existing protected behavior to the authenticated organization:
  - company-data search
  - sandbox file staging
  - chat-turn creation and audit log listing
  - sandbox run ownership
  - generated-file retrieval
- Added deployment and recovery documentation:
  - `README.md`
  - `deployment.md`
  - `production_readiness.md`
  - `apps/web/.env.local.example`
- Added explicit migration and start scripts:
  - root `pnpm db:migrate`
  - root `pnpm start`
  - web `pnpm db:migrate`

### Current Step 10 Behavior

- Local development
  - Defaults to `./storage/critjecture.sqlite`
  - Defaults to `./storage` as the persistent storage root
  - Copies bundled sample company data into the default organization storage on first boot
- Customer-managed hardware / on-prem
  - Can point both the SQLite database and the storage root at persistent local paths
  - Uses the same app and migration flow as local development
- Railway with attached storage
  - Can point both `DATABASE_URL` and `CRITJECTURE_STORAGE_ROOT` at the mounted volume path
  - Uses the same SQLite-first runtime model as local and hardware installs
- Authenticated users
  - Now operate inside a specific organization context stored in the session
  - Still see `Owner` / `Intern` behavior, but that role now comes from organization membership
- Owners
  - See audit logs only for their current organization
- Generated assets
  - Still live in `/tmp/workspace/<run-id>/outputs/`
  - Are only retrievable by the authenticated user who created them within the same organization

### Important Implementation Details

- Step 10 keeps SQLite as the primary supported deployment path. Postgres remains a future scale-up option rather than a current requirement.
- The current implementation supports one active organization per user session. Multi-organization switching UI was not added in this step.
- The app still seeds a single default organization from env:
  - `CRITJECTURE_ORGANIZATION_NAME`
  - `CRITJECTURE_ORGANIZATION_SLUG`
- Runtime company data is no longer sourced directly from the repo root during normal operation.
- Database migrations remain forward-only SQL files and can be run explicitly with `pnpm db:migrate`.
- Sandbox workspaces remain ephemeral and are still out of durable backup scope.

## Step 11: Audit Schema Reset and RAG-Ready Database Baseline

### What Was Implemented

Step 11 was implemented as a deliberate development-only schema reset that replaced the layered Step 6/9/10 audit migration history with one clean SQLite baseline designed for future RAG work.

- Replaced the older incremental SQL migration stack in `apps/web/drizzle/` with a single baseline migration:
  - `apps/web/drizzle/0000_baseline.sql`
- Reworked the shared Drizzle schema in `apps/web/lib/app-schema.ts`.
  - Keeps the current auth, tenant, audit, and sandbox tables
  - Normalizes `chat_turns` to include:
    - `conversation_id`
    - `status`
    - `completed_at`
  - Normalizes `assistant_messages` to include:
    - `message_index`
    - `message_type`
    - `model_name`
  - Keeps `tool_calls` as the structured tool execution table
  - Adds future-RAG registry tables:
    - `documents`
    - `document_chunks`
  - Adds future retrieval/audit tables:
    - `retrieval_runs`
    - `retrieval_rewrites`
    - `retrieval_candidates`
    - `response_citations`
- Reworked the audit server helpers in `apps/web/lib/audit-log.ts`.
  - Chat turns now start in a lifecycle state and can be marked complete or failed
  - Assistant messages are stored with ordered indexes and typed semantics instead of a UI-only title string
  - Admin log projections now return turn lifecycle fields plus empty-ready retrieval and citation collections
- Added the new turn-finish API route:
  - `apps/web/app/api/audit/chat-turns/finish/route.ts`
- Updated the assistant-message audit route:
  - `apps/web/app/api/audit/assistant-messages/route.ts`
  - Validates `messageIndex`, `messageType`, and `modelName`
- Updated the chat audit wiring in `apps/web/components/chat-shell.tsx`.
  - Starts turns in `started`
  - Marks turns `completed` or `failed`
  - Records assistant outputs with message ordering and typed intent
  - Marks planner-selection assistant output separately from final responses
- Updated the owner audit UI in `apps/web/components/admin-logs-page-client.tsx`.
  - Shows turn lifecycle state
  - Shows turn completion time
  - Uses assistant message metadata instead of the old `message_title` convention
  - Is now structurally ready for future retrieval and citation display
- Removed the older backfill-first org/audit assumptions from:
  - `apps/web/lib/organizations.ts`
  - `apps/web/lib/users.ts`
  - Seeded users now get memberships directly in the clean baseline flow
- Reset the local development database and rebuilt it from the new baseline migration.

### Current Step 11 Behavior

- Local development
  - Uses a fresh baseline SQLite schema instead of replaying separate Step 6, Step 9, and Step 10 migration eras
  - Recreates `storage/critjecture.sqlite` cleanly via `pnpm db:migrate`
- Chat turns
  - Start with a lifecycle status
  - End as `completed` or `failed`
  - Retain the current `chat_session_id` while also storing a `conversation_id`
- Assistant audit rows
  - Are ordered per turn with `message_index`
  - Distinguish final responses from planner-selection assistant output
  - Store the model name used for the assistant-visible output
- Tool audit rows
  - Still store runtime tool id, arguments, accessed files, status, summaries, and errors
  - Continue to serve as the structured execution audit layer
- Future RAG support
  - The database now has stable document and chunk tables ready for indexing work later
  - The database now has retrieval and citation tables ready for contextual rewrite, HyDE, hybrid retrieval, reranking, and answer grounding later
  - The current file-system search flow remains in place; Step 11 does not yet implement the full retrieval pipeline

### Important Implementation Details

- Step 11 intentionally removed backward-compatibility work in favor of a cleaner development baseline.
- The prior migration files:
  - `0000_step6_audit_logging.sql`
  - `0001_step6_trace_events.sql`
  - `0002_step9_auth_and_ownership.sql`
  - `0003_step10_tenants_and_storage.sql`
  were replaced by `0000_baseline.sql`.
- SQLite remains the system of record for:
  - auth and tenancy
  - chat/audit records
  - future document and chunk identity
  - future retrieval and citation records
- The future vector store is still expected to live outside SQLite. Step 11 prepares the relational IDs and joins without storing vectors in the app database.
- `audit_events` was intentionally not added. Final assistant output stays in `assistant_messages`, tool execution stays in `tool_calls`, and retrieval state will live in the dedicated retrieval tables when that work is implemented.
- The local database was intentionally reset as part of this step, so older development audit data is not preserved across the new baseline.

## Step 12: Server-Backed Chat History

### What Was Implemented

Step 12 was implemented as a server-backed conversation history layer for the existing `pi-web-ui` chat shell, plus follow-up audit-log presentation improvements for sandbox tool code.

- Added a dedicated conversations persistence layer on top of the Step 11 baseline:
  - `apps/web/drizzle/0001_step12_conversations.sql`
  - `apps/web/lib/app-schema.ts`
  - adds a `conversations` table with:
    - `id`
    - `organization_id`
    - `user_id`
    - `user_role`
    - `title`
    - `preview_text`
    - `message_count`
    - `usage_json`
    - `session_data_json`
    - `created_at`
    - `updated_at`
- Added server-side conversation helpers:
  - `apps/web/lib/conversations.ts`
  - `apps/web/lib/conversation-types.ts`
  - stores full `@mariozechner/pi-web-ui` session snapshots server-side
  - derives conversation metadata server-side from the saved session state
  - scopes conversation access to the authenticated user and organization
  - prevents a lower-access role from loading a conversation saved under a higher-access role
- Added authenticated conversation APIs:
  - `apps/web/app/api/conversations/route.ts`
  - `apps/web/app/api/conversations/[conversationId]/route.ts`
  - supports:
    - listing saved conversations
    - loading one saved conversation
    - saving or updating one conversation snapshot
- Updated the chat audit creation flow to separate durable conversation identity from browser session identity:
  - `apps/web/app/api/audit/chat-turns/route.ts`
  - `apps/web/lib/audit-log.ts`
  - `conversation_id` now records the persistent conversation id
  - `chat_session_id` remains the mounted browser chat session id used for audit correlation
- Refactored the chat shell to use server-backed history:
  - `apps/web/components/chat-shell.tsx`
  - restores a saved conversation from `?conversation=<id>`
  - creates a new draft conversation when no conversation id is present
  - autosaves full chat state back to the server as the conversation evolves
  - opens a history modal to load prior saved conversations
  - adds a `New chat` action that resets to a fresh draft without deleting prior history
  - continues using the existing `agent-interface` and `pi-web-ui` session shape for forward compatibility with upstream updates
- Updated the shared app styling for the history toolbar and modal:
  - `apps/web/app/globals.css`
- Improved audit-log tool rendering for sandbox calls:
  - `apps/web/components/admin-logs-page-client.tsx`
  - audit log cards now extract Python `code` from sandbox tool parameters for:
    - `run_data_analysis`
    - `generate_visual_graph`
    - `generate_document`
  - renders Python source separately from the remaining JSON parameters
  - keeps the rest of the parameters visible as `Other Parameters`
- Fixed the mobile audit-log layout for the new code blocks:
  - `apps/web/app/globals.css`
  - tool metadata stacks cleanly on narrow screens
  - code blocks stay within the card width and scroll sideways when needed
  - the disclosure marker no longer renders incorrectly in mobile audit cards

### Current Step 12 Behavior

- Chat history
  - a signed-in user can reload `/chat` and recover a saved conversation by URL
  - a signed-in user can open the history modal and resume prior saved conversations
  - conversation history is available across refreshes, browsers, and devices for the same account
  - a new conversation draft is not saved until the chat has real content
- Conversation persistence
  - full `pi-web-ui` session state is stored server-side per conversation
  - conversation metadata is derived from the stored messages, including:
    - title
    - preview text
    - message count
    - usage totals
  - conversations are private to the authenticated user within the current organization
- Audit correlation
  - each chat turn now keeps:
    - a durable `conversation_id`
    - a per-mounted-session `chat_session_id`
  - audit entries remain attached to the correct persistent conversation even when a conversation is resumed later
- Audit log presentation
  - sandbox tool calls show Python code as a dedicated code block instead of only raw JSON
  - long code lines remain readable on mobile via horizontal scrolling within the code block

### Important Implementation Details

- Step 12 chose full `pi-web-ui` session snapshots as the durable history source instead of reconstructing history solely from audit rows.
- The app still uses IndexedDB locally for `pi-web-ui` settings, provider keys, and other client-side stores; server-backed persistence was added specifically for conversations.
- No conversation deletion flow was added in this step.
- History remains per-user rather than shared organization-wide.
- The remaining roadmap in `steps.md` now starts at Step 13.

## Step 13: File Uploads and Knowledge Ingestion

### What Was Implemented

Step 13 was implemented as a tenant-scoped knowledge library with authenticated uploads, synchronous text ingestion, SQLite metadata, and search integration for uploaded files.

- Added a Step 13 document metadata migration:
  - `apps/web/drizzle/0002_step13_knowledge_uploads.sql`
- Extended the shared document schema in `apps/web/lib/app-schema.ts`.
  - `documents` now stores:
    - `display_name`
    - `access_scope`
    - `ingestion_status`
    - `ingestion_error`
    - `uploaded_by_user_id`
- Added shared knowledge types and server helpers:
  - `apps/web/lib/knowledge-types.ts`
  - `apps/web/lib/knowledge-files.ts`
- Added authenticated knowledge APIs:
  - `apps/web/app/api/knowledge/files/route.ts`
  - supports:
    - listing uploaded files for the current organization
    - filtering by scope and ingestion status
    - uploading `.csv`, `.txt`, `.md`, and `.pdf` files
- Implemented upload validation and ingestion behavior:
  - enforces a 10 MiB file limit
  - validates extension and MIME compatibility
  - stores uploads under tenant-owned `company_data/{public|admin}/uploads/YYYY/MM/...`
  - extracts UTF-8 text from `.csv`, `.txt`, and `.md`
  - extracts PDF text with local `pdftotext`
  - writes overlapping text chunks into `document_chunks`
  - marks failed ingestions without deleting the uploaded file
- Integrated uploaded files into search:
  - `apps/web/lib/company-knowledge.ts`
  - existing filesystem `rg` search now continues to cover uploaded text files
  - indexed uploaded PDFs are merged into the existing candidate-file search flow
- Added a dedicated knowledge UI:
  - `apps/web/app/knowledge/page.tsx`
  - `apps/web/components/knowledge-page-client.tsx`
  - `apps/web/components/workspace-shell.tsx`
  - `apps/web/app/globals.css`
  - adds:
    - a new `/knowledge` route
    - upload controls
    - owner scope selection
    - uploaded-file table with status, uploader, timestamps, and indexing errors
- Updated docs and roadmap files:
  - `README.md`
  - `steps.md`

### Current Step 13 Behavior

- `Intern`
  - can upload only public-scope files
  - can list only public uploaded files
  - can search and stage only public uploads
- `Owner`
  - can upload to either public or admin scope
  - can list uploaded files across both scopes
  - can search uploaded admin PDFs and other uploaded admin text files
- Knowledge ingestion
  - uploaded text files are stored durably inside the current tenant's `company_data`
  - uploaded PDFs are searchable only when they contain extractable text
  - failed ingestions remain visible in the knowledge library with the recorded error
- Sandbox access
  - uploaded files continue to flow through the existing `inputFiles` path
  - backend authorization still blocks unauthorized file staging by relative path

### Important Implementation Details

- Step 13 keeps the existing `search_company_knowledge` tool contract. No new chat tool was added for uploads.
- Uploaded text files are searchable via the existing filesystem `rg` path because they now live inside tenant `company_data`.
- Uploaded PDFs use the existing `documents` and `document_chunks` tables as the searchable indexed path.
- PDF ingestion currently depends on the local `pdftotext` binary and does not perform OCR.
- The new knowledge library is the primary admin-visible upload surface for this step; uploads were not added to the audit timeline.
- The remaining roadmap in `steps.md` now starts at Step 16.

## Step 14: Sandbox Hardening and Execution Controls

### What Was Implemented

Step 14 was implemented as a Linux namespace sandbox hardening pass with stricter execution controls, persisted short-lived generated assets, stronger cleanup guarantees, and tighter audit correlation.

- Added shared sandbox policy defaults in:
  - `apps/web/lib/sandbox-policy.ts`
  - centralizes:
    - timeout
    - CPU limit
    - memory limit
    - process limit
    - stdout/stderr capture limit
    - artifact size limit
    - artifact TTL
    - per-user and global concurrency caps
- Expanded the shared app schema and migration set:
  - `apps/web/drizzle/0003_step14_sandbox_hardening.sql`
  - `apps/web/lib/app-schema.ts`
  - adds:
    - richer `sandbox_runs` lifecycle fields
    - `tool_calls.sandbox_run_id`
    - normalized `sandbox_generated_assets`
- Reworked sandbox execution in:
  - `apps/web/lib/python-sandbox.ts`
  - now:
    - admits runs through a tracked `sandbox_runs` lifecycle
    - rejects excess concurrency with recorded sandbox rows
    - executes Python through Linux `bubblewrap`
    - applies `prlimit` CPU, memory, process, file-size, and timeout controls
    - keeps sandbox network access disabled
    - validates generated file signatures and exact output locations
    - deletes `/tmp/workspace/<run-id>` in `finally`
- Replaced ephemeral generated-file serving with persisted short-lived artifacts:
  - `apps/web/lib/sandbox-runs.ts`
  - `apps/web/app/api/generated-files/[runId]/[...assetPath]/route.ts`
  - `apps/web/lib/app-paths.ts`
  - accepted PNG/PDF outputs are copied into tenant storage under `generated_assets/<run-id>/...`
  - generated files are served from persisted storage and expire after the configured TTL
- Tightened tool and audit correlation:
  - sandbox tool routes now return `sandboxRunId`, runner, and enforced limits
  - audit tool completion accepts and stores `sandboxRunId`
  - owner audit logs now show sandbox lifecycle metadata and generated-asset expiry details
- Updated operator and decision docs:
  - `README.md`
  - `deployment.md`
  - `sandbox.md`
  - `steps.md`

### Current Step 14 Behavior

- Sandbox execution
  - runs through `bubblewrap` on Linux
  - uses no normal network access
  - enforces CPU, memory, process, stdout/stderr, and output-size limits
  - rejects new work when the per-user or global concurrency cap is already reached
- Cleanup and lifecycle
  - every admitted run receives a durable `sandbox_runs` row
  - stale `running` rows are reconciled as abandoned
  - temporary sandbox workspaces are removed after completion or failure
- Generated files
  - `run_data_analysis` may not persist generated files
  - `generate_visual_graph` must write exactly `outputs/chart.png`
  - `generate_document` must write exactly `outputs/notice.pdf`
  - accepted files are copied into tenant storage and expire after the configured TTL
- Auditability
  - audit tool calls now carry `sandboxRunId`
  - owner audit logs can inspect runner, limits, cleanup state, failure reason, and generated asset expiry

### Important Implementation Details

- Step 14 intentionally chose Linux `bubblewrap` hardening instead of keeping the old plain child-process path.
- The app still uses synchronous HTTP tool calls; Step 14 does not add a background queue or external sandbox worker.
- Generated-file access no longer depends on `/tmp/workspace/<run-id>` still existing.
- `sandbox.md` is the long-lived decision record for sandbox defaults and future tuning.
- The remaining roadmap in `steps.md` now starts at Step 16.

## Step 15: Product Boundaries, Chart-Flow Limits, and Current-State Summary

### What Was Implemented

Step 15 was implemented as a documentation pass to make the current product boundaries explicit and to record what the MVP is designed for, what it is not designed for yet, and how the recent chart-flow changes behave.

- Updated `overview.md` to reflect the actual current architecture rather than the earlier blueprint language.
- Added a clear product-positioning summary covering:
  - what Critjecture is for right now
  - what it is not for yet
  - current chart and sandbox scaling limitations
  - near-term ideas for scaling the chart flow safely
- Documented the current chart workflow after the recent fix:
  - search for the right file
  - run data analysis first
  - emit compact JSON chart data
  - store a temporary `analysisResultId`
  - render the chart from that structured result
- Recorded the practical limitation that the current chart flow is suitable for summarized chart payloads, not huge raw plotted datasets.
- Updated roadmap numbering in `steps.md` so future steps remain sequential after adding this summary step.

### Current Step 15 Behavior

- The repo now has an explicit written statement of current product intent instead of leaving that intent implicit in the code or prior chat history.
- Engineers can see that the current MVP is optimized for:
  - narrow property-management workflows
  - small-to-medium summarized analyses
  - auditable, RBAC-scoped tool calls
- Engineers can also see that the current MVP is not yet meant for:
  - massive plotted point sets
  - durable multi-instance intermediate analysis storage
  - warehouse-style or async large-scale data processing

### Important Implementation Details

- This step is documentation-only.
- The new summary reflects the implementation state reached through Steps 1-14, including:
  - authentication
  - tenant-scoped knowledge ingestion
  - server-backed chat history
  - sandbox hardening
  - analysis-first chart generation
- The remaining roadmap in `steps.md` now starts at Step 16.
