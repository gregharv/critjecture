## The Critjecture AI Blueprint

Here is the consolidated strategy for your MVP. By splitting the agent's capabilities into specific, predictable tools, you are building a highly reliable digital employee ready to pitch to local property management firms around the Middleburg and Orange Park areas.

### 1. Core Architecture & Security

* **The Monorepo Stack:** Built using `pnpm` workspaces to cleanly separate the Next.js frontend/API (`apps/web`) from the Python execution environment (`packages/python-sandbox`).
* **Frontend Interface:** A Next.js web application. The chat window uses `@mariozechner/pi-web-ui` (Lit components) for streaming AI responses, while the rest of the app uses standard React components for the login, RBAC controls, and Audit Logs.
* **Backend Engine:** Next.js Route Handlers powered by `@mariozechner/pi-ai` to manage the ReAct agent loop and OpenAI routing. 
* **Dual Deployment Strategy:** Architected to be deployed either as a Cloud SaaS hosted seamlessly on Railway, or as a secure On-Premise "Mini-Server" (e.g., a Beelink Mini-PC) physically installed in a client's office for absolute data privacy.
* **Role-Based Access Control (RBAC):** Security is enforced strictly at the file-system level. An "Intern" role triggers searches only in public directories, while an "Owner" role searches the entire system.
* **The Execution Sandbox:** Python scripts run in a restricted Node.js `child_process` utilizing a lightning-fast **`uv` virtual environment**. Environment variables are stripped to protect API keys, and the process only has read-access to the company knowledge base and write-access to an ephemeral temporary `/tmp/` folder.

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
