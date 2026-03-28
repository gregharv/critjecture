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
  - `company_data/public/schedule.txt`
  - `company_data/admin/profit.txt`
- Added shared role handling in `apps/web/lib/roles.ts`.
- Added the backend search implementation in `apps/web/lib/company-knowledge.ts`.
  - Uses Node.js `child_process.execFile(...)` to run `rg`
  - Resolves the repo-level `company_data` directory safely
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
  - Resolves the repo-level `company_data` root
  - Normalizes relative file paths
  - Rejects absolute paths and path traversal
  - Enforces role-based file access before analysis
- Expanded the mock ledger data to cover ambiguous search cases:
  - `company_data/admin/contractors_new.csv` for 2026
  - `company_data/admin/contractors.csv` for 2025
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
  - `apps/web/app/api/generated-files/[workspaceId]/[...assetPath]/route.ts`
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
  - `company_data/admin/rent_delinquency.csv`
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

- Added a SQLite audit database in `apps/web/data/audit.sqlite`.
- Added a Drizzle-backed audit schema and server helpers:
  - `apps/web/lib/audit-schema.ts`
  - `apps/web/lib/audit-db.ts`
  - `apps/web/lib/audit-log.ts`
  - `apps/web/drizzle/0000_step6_audit_logging.sql`
  - `apps/web/drizzle/0001_step6_trace_events.sql`
- Added audit API routes:
  - `apps/web/app/api/audit/prompts/route.ts`
  - `apps/web/app/api/audit/tool-calls/start/route.ts`
  - `apps/web/app/api/audit/tool-calls/finish/route.ts`
  - `apps/web/app/api/audit/trace-events/route.ts`
  - `apps/web/app/api/admin/logs/route.ts`
- Updated `apps/web/components/chat-shell.tsx`.
  - Generates a stable client session id for each mounted chat session
  - Logs each real user prompt before the first proxied OpenAI stream for that request
  - Uses `beforeToolCall` and `afterToolCall` to persist exact tool args, accessed data files, and completion/error summaries
  - Captures assistant response text as a lightweight trace for each audited interaction
  - Keeps ambiguous file-picker continuation prompts attached to the original human prompt instead of creating a second prompt log row
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
  - Sees a newest-first feed of collapsible prompt cards
  - Can scan collapsed headers for role, timestamp, question, and accessed data files
  - Can expand a card to inspect the assistant response trace plus exact tool-call parameters and summaries
  - Only gets background refreshes while recent interactions still look active or incomplete
- `Intern`
  - Can still use `/chat`
  - Cannot view the audit feed on `/admin/logs`; the page shows an owner-only state and skips the fetch
- Ambiguous file selection
  - The original prompt is logged once
  - The later selected-file continuation remains correlated to that same prompt row

### Important Implementation Details

- Step 6 does not move tool execution to the server. Prompt and tool-call auditing is initiated from the client agent lifecycle because that is where tool execution actually occurs.
- The audit database is initialized lazily and applies committed SQL migrations on first use.
- Tool-call rows store the validated tool arguments as JSON text and track accessed company-data files so the dashboard can surface file access directly in the collapsed header and per-tool detail view.
- The trace section now intentionally records only assistant response text. Tool-call and tool-result detail stays in the tool section so the audit view does not duplicate the same execution information twice.
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
- Fixed audit prompt correlation in `apps/web/components/chat-shell.tsx`.
  - Synthetic picker-confirmation continuations now stay attached to the original human prompt
  - This prevents the audit dashboard from showing a second prompt card for the same interaction
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
- The audit fix works by routing synthetic continuation prompts through the underlying prompt path rather than the audited wrapper, so the continuation reuses the original prompt log row.
