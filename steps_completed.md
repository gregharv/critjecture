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
