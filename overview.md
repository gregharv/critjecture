## The Critjecture AI Blueprint

Here is the consolidated strategy for your MVP. By splitting the agent's capabilities into specific, predictable tools, you are building a highly reliable digital employee ready to pitch to local property management firms around.

### 1. Core Architecture & Security

* **Frontend Interface:** A Next.js web application. The chat window uses `@mariozechner/pi-web-ui` (Lit components) for streaming AI responses, while the rest of the app uses standard React components for the login, RBAC controls, and Audit Logs.
* **Backend Engine:** Next.js Route Handlers powered by `@mariozechner/pi-ai` to manage the ReAct agent loop and OpenAI routing. Everything is built to be deployed seamlessly on Railway.
* **Role-Based Access Control (RBAC):** Security is enforced strictly at the file-system level. An "Intern" role triggers searches only in public directories, while an "Owner" role searches the entire system.
* **The Execution Sandbox:** Python scripts run in a restricted Node.js `child_process`. The environment variables are stripped to protect your API keys, and the process only has read-access to the company knowledge base and write-access to an ephemeral temporary folder.

### 2. The Specialized Toolbelt

Instead of one unpredictable coding agent, the AI orchestrates four strictly defined tools. This gives your Next.js frontend exact, predictable data contracts so it knows exactly what UI components to render.

| Tool Name | The Persona | Under the Hood | Frontend UI Expectation |
| :--- | :--- | :--- | :--- |
| `search_company_knowledge` | The Librarian | Uses `ripgrep` for lightning-fast, role-restricted lexical search over company files. | Renders markdown text and source citation badges (e.g., Green for Public, Red for Admin). |
| `run_data_analysis` | The Accountant | Writes and executes Pandas scripts in the sandbox to crunch numbers from CSV ledgers. | Renders standard conversational text (e.g., "The average maintenance cost was $450."). |
| `generate_visual_graph` | The Analyst | Uses Matplotlib/Seaborn to plot trends based on secure data and saves it to the scratchpad. | Receives a file path ending in `.png` and renders a polished Image Card component. |
| `generate_document` | The Administrator | Ingests variables into Python templating libraries to create specific company notices. | Receives a `.pdf` file path and renders a clickable **[Download Document]** button. |

### 3. The Autonomous Workflow (The ReAct Loop)

When a business owner asks a complex question (e.g., *"Draft a late notice for the tenant who owes the most rent"*), the AI autonomously chains these tools together. It first calls the Librarian tool to find the highest balance in the ledger and grab the tenant's name. It then calls the Administrator tool, passing those exact parameters into the Python script to generate the final PDF without human intervention.

