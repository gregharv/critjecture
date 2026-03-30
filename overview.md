# Critjecture Product Overview

Critjecture is an auditable AI data analyst for business teams. It helps people ask plain-language questions about business data, get useful answers quickly, and inspect the full trace of how those answers were produced.

The product is intentionally opinionated. It is not a general autonomous agent. It is a governed answer system built around role-aware access control, constrained tool execution, visible tool traces, and customer-controlled deployment options.

## 1. Product Position

Critjecture is designed to give organizations:

* **Fast answers to business questions** from internal files and structured data.
* **Helpful outputs** such as concise answers, summaries, charts, and generated documents when needed.
* **Visible execution traces** that show which tools ran, which files were accessed, and what the system did to produce the result.
* **Role-aware controls** over what data can be searched, what analysis can run, and what outputs can be retrieved.
* **Deployment flexibility** for cloud-hosted, customer-managed, and stricter private environments.

This is the core distinction in the product: Critjecture is not just a chat workspace with company knowledge. It is a governed system for producing business-data answers under explicit policy, execution, and audit constraints.

## 2. Core Architecture And Control Plane

* **The Monorepo Stack:** Built using `pnpm` workspaces to separate the Next.js frontend/API in `apps/web` from the Python execution environment in `packages/python-sandbox`.
* **Frontend Interface:** A Next.js web application with chat, audit, operations, settings, and knowledge-management surfaces.
* **Backend Engine:** Next.js Route Handlers powered by `@mariozechner/pi-ai` to manage the ReAct-style tool loop and model routing.
* **Role-Based Access Control:** The app enforces organization and role scope on the server. The current MVP exposes `Owner` and `Intern` roles, with different company-data access boundaries.
* **Execution Sandbox:** Python runs inside a hardened sandbox using `bubblewrap` and `prlimit` on top of the local `uv` environment. Environment variables are stripped, network access is disabled, outputs are validated, and temporary workspaces are cleaned up.
* **Auditability:** Chat turns, tool calls, accessed files, generated assets, and assistant responses are persisted for owner-visible review.
* **Recovery Tooling:** The SQLite-first runtime has scripted backup creation, clean-environment restore tooling, and repeatable recovery drills for both `single_org` and hosted deployments.
* **Deployment Flexibility:** The system is designed for `single_org` customer-managed operation as well as centrally hosted multi-organization deployments.

## 3. Tooled Answer Workflow

Instead of allowing unrestricted autonomous behavior, Critjecture uses a constrained toolbelt with predictable interfaces. That gives the system a narrow and reviewable execution path for data questions.

| Tool | Product Role | Backend | Typical Result |
| :--- | :--- | :--- | :--- |
| `search_company_knowledge` | Retrieval | `ripgrep` search over approved organization files | citations and retrieved context |
| `run_data_analysis` | Analysis | **Polars** in the Python sandbox | computed answers and summarized datasets |
| `generate_visual_graph` | Visualization | Matplotlib / Seaborn in the Python sandbox | `.png` charts |
| `generate_document` | Structured output | Python templating / document generation | `.pdf` documents |

This supports multi-step answer flows such as:

* find the relevant company records
* run a scoped analysis
* summarize the result for the user
* generate a chart or document when that makes the answer easier to act on
* persist the trace so the answer can be reviewed later

## 4. What The System Supports Right Now

The current product is for:

* **Business-data question answering** inside one organization's approved data boundary.
  * Example questions:
    * Which region has the largest revenue drop this month?
    * Which customers have the highest overdue balances?
    * What changed in support backlog volume over the last quarter?
* **Auditable, RBAC-scoped tool usage** where file lookup, sandbox execution, and generated outputs can be traced.
* **Small-to-medium analysis tasks** where the source data may be large, but the answer returned to the model stays compact.
* **Organization-scoped knowledge management** with uploaded files, saved chat history, and owner-visible audit logs.
* **SQLite-first operations** with scripted backup creation, clean restore tooling, and repeatable recovery drills for persisted runtime state.

## 5. What The System Is Not For Yet

The current MVP is not for:

* **Open-ended BI or dashboard exploration** where the model should iterate freely across large warehouse-scale data.
* **Massive plotted payloads** passed directly through the synchronous chart pipeline.
* **Long-running async jobs** such as heavy background transformations, bulk document rendering, or scheduled warehouse analytics.
* **General-purpose autonomous coding or arbitrary enterprise automation.**

The product is intentionally narrow. It is built to answer business questions quickly and transparently, not to replace every analytics or automation system in the stack.

## 6. Current Limits And Near-Term Scaling Ideas

The current chart pipeline is:

1. search the right file
2. run data analysis
3. print a compact JSON chart payload
4. store that payload temporarily as an `analysisResultId`
5. render the chart from that stored payload

This works well for summarized charts and compact derived outputs. It breaks down when the chart payload itself becomes very large.

Current limitations:

* **Stdout-bound chart payloads:** chart-ready JSON currently comes back through sandbox stdout, which has a fixed byte cap.
* **Bounded intermediate storage:** `analysisResultId` data is persisted durably in SQLite, but the system intentionally caps payload bytes and plotted point counts so synchronous rendering stays predictable.
* **Tight sandbox limits:** chart generation still runs under strict timeout, memory, process, and artifact-size limits.
* **Readability limits:** even when large point sets render successfully, the chart is often not useful without aggregation or sampling.
* **No async chart or document jobs yet:** large workloads still fail synchronously once they exceed the current request-time budget or payload caps.

Near-term scaling ideas:

* **Require aggregation, binning, or top-N reduction** before a chart can be rendered.
* **Introduce async job handling** once analysis or rendering needs to exceed the current request-time budget.

## 7. Packaging Direction

The planned commercial model is:

* **Flat monthly workspace pricing**
* **Unlimited seats**
* **Pooled monthly credits** for analysis and answer generation
* **Admin usage visibility and controls** so organizations can see who is consuming capacity and restrict heavy users when needed
* **Predictable spend** through a hard cap when the included monthly credit pool is exhausted

This is intended to make Critjecture easier to adopt for SMB teams than a seat-assignment model. The product value is team-wide governed access to business answers, not named-seat access to a generic assistant.

## 8. Supported Flat-Rate Behavior

The current workspace commercial model is:

* **One pooled workspace balance** of included monthly credits.
* **Billing-anchor reset windows** so each workspace resets on its own monthly cycle rather than on a shared calendar month.
* **Per-member monthly caps** that owners can use to limit heavy users without shutting down the whole workspace.
* **Separate operational rate limits** so burst protection remains distinct from commercial exhaustion.

What currently consumes credits:

* **Chat requests**
* **Sandbox-backed analysis**
* **Chart generation**
* **Document generation**
* **Knowledge import jobs**

What does not currently consume credits:

* **Company knowledge search**
* **Owner admin reads, logs, and health views**

When the workspace or member cap is exhausted, Critjecture blocks additional credit-consuming requests with a clear owner-visible error and leaves non-commercial operational limits as a separate control path.

## 9. Current System Summary

The current system is a constrained, auditable answer engine with:

* server-routed AI chat
* authenticated users and RBAC
* organization-scoped file search and uploads
* saved conversations and audit logs
* a hardened Python sandbox for analysis, charts, and documents
* persisted short-lived generated assets
* an analysis-first chart flow that separates schema discovery from rendering
* scripted backup creation, restore validation, and repeatable recovery drills for SQLite plus tenant storage
