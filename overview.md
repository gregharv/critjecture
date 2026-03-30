## The Critjecture AI Blueprint

Here is the consolidated strategy for the current MVP. By splitting the agent's capabilities into specific, predictable tools, Critjecture is becoming a narrow, auditable property-management assistant rather than a general autonomous agent.

### 1. Core Architecture & Security

* **The Monorepo Stack:** Built using `pnpm` workspaces to cleanly separate the Next.js frontend/API (`apps/web`) from the Python execution environment (`packages/python-sandbox`).
* **Frontend Interface:** A Next.js web application. The chat window uses `@mariozechner/pi-web-ui` (Lit components) for streaming AI responses, while the rest of the app uses standard React components for the login, RBAC controls, and Audit Logs.
* **Backend Engine:** Next.js Route Handlers powered by `@mariozechner/pi-ai` to manage the ReAct agent loop and OpenAI routing.
* **Dual Deployment Strategy:** Architected to be deployed either as a Cloud SaaS hosted seamlessly on Railway, or as a secure On-Premise "Mini-Server" (e.g., a Beelink Mini-PC) physically installed in a client's office for absolute data privacy.
* **Role-Based Access Control (RBAC):** Security is enforced strictly at the file-system level. An "Intern" role triggers searches only in public directories, while an "Owner" role searches the entire system.
* **The Execution Sandbox:** Python scripts now run in a hardened Linux namespace sandbox using `bubblewrap` and `prlimit` on top of the local **`uv` virtual environment**. Environment variables are stripped, network access is disabled, generated files are validated, and temporary workspaces are cleaned after each run.
* **Recovery Tooling:** The SQLite-first runtime now has scripted backup creation, clean-environment restore tooling, and repeatable recovery drills for both `single_org` and hosted Railway-style deployments.

### 2. The Specialized Toolbelt

Instead of one unpredictable coding agent, the AI orchestrates four strictly defined tools. This gives your Next.js frontend exact, predictable data contracts so it knows exactly what UI components to render.

| Tool | Persona | Backend | Frontend |
| :--- | :--- | :--- | :--- |
| `search_company_knowledge` | The Librarian | `ripgrep` search over company files. | Markdown plus citation badges. |
| `run_data_analysis` | The Accountant | **Polars** in the `uv` sandbox. | Standard conversational text. |
| `generate_visual_graph` | The Analyst | Matplotlib/Seaborn chart generation. | `.png` image card. |
| `generate_document` | The Administrator | Python templated notice generation. | `.pdf` download button. |

### 3. The Autonomous Workflow (The ReAct Loop)

When a business owner asks a complex question (e.g., *"Draft a late notice for the tenant who owes the most rent"*), the AI autonomously chains these tools together. It first calls the Librarian tool to find the highest balance in the ledger and grab the tenant's name. It then calls the Administrator tool, passing those exact parameters into the Python script to generate the final PDF without human intervention.

### 4. What The System Supports Right Now

The current product is for:

* **Narrow operational workflows** inside a property-management office:
  * answering questions about internal records
  * summarizing ledgers
  * generating simple charts
  * drafting simple notices and PDFs
* **Auditable, RBAC-scoped tool usage** where every file lookup, sandbox run, and generated file can be traced.
* **Small-to-medium analysis tasks** where the source data may be large, but the final result sent back to the model is compact:
  * one computed answer
  * a short JSON object
  * a summarized chart payload
* **Tenant-scoped knowledge management** with uploaded files, saved chat history, and owner-visible audit logs.
* **SQLite-first operations** with scripted backup creation, clean restore tooling, and repeatable recovery drills for persisted runtime state.

### 5. What The System Is Not For Yet

The current MVP is not for:

* **Open-ended BI or dashboard workloads** where the model should freely explore very large tables and iterate indefinitely.
* **Hundreds of thousands of plotted points** passed directly through the current chart pipeline.
  * The current flow works well when analysis reduces large source data into a small chart-ready summary.
  * It does not scale well if the model tries to emit or render massive `x`/`y` arrays directly.
* **Durable multi-instance intermediate analysis storage.**
  * The current `analysisResultId` chart flow uses an in-memory same-process store.
* **Long-running async jobs** such as bulk heavy transformations, background chart rendering, or warehouse-style analytics.
* **General-purpose autonomous coding or arbitrary enterprise automation.**
  * The product is intentionally tool-constrained and workflow-specific.

### 6. Current Limitations and Near-Term Scaling Ideas

The current chart pipeline is:

1. search the right file
2. run data analysis
3. print a compact JSON chart payload
4. store that payload temporarily as an `analysisResultId`
5. render the chart from that stored payload

This is a good fit for summarized charts. It will break down if the chart payload itself becomes very large.

Current limitations:

* **Stdout-bound chart payloads:** chart-ready JSON currently comes back through sandbox stdout, which has a fixed byte cap.
* **In-memory intermediate storage:** `analysisResultId` data is stored in-process, so it is not a durable or horizontally scalable intermediate store.
* **Tight sandbox limits:** chart generation still runs under strict timeout, memory, process, and artifact-size limits.
* **Matplotlib readability limits:** even if huge point sets render successfully, the result is often visually useless without aggregation or sampling.
* **Code-string embedding:** the current graph route serializes structured chart data back into Python source, which is fine for small summaries but inefficient for very large payloads.

Near-term scaling ideas:

* **Require aggregation, binning, or top-N reduction** before a chart can be rendered.
* **Add explicit point-count caps** for chart-ready payloads.
* **Move intermediate analysis results into durable storage** instead of an in-memory map.
* **Let the graph renderer read stored structured data directly** instead of embedding large JSON blobs into Python source.
* **Introduce async job handling** once charts or analysis need to exceed the current request-time sandbox budget.

### 7. Current System Summary

The current system is a constrained operational assistant with:

* server-routed OpenAI chat
* authenticated users and RBAC
* tenant-scoped file search and uploads
* saved conversations and audit logs
* a hardened Python sandbox for analysis, charts, and documents
* persisted short-lived generated assets
* an analysis-first chart flow that reduces column-guessing failures by separating schema discovery from rendering
* scripted backup creation, restore validation, and repeatable recovery drills for SQLite plus tenant storage
