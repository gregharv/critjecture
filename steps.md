Here is the updated, definitive roadmap. This version completely integrates the `pnpm` monorepo structure, the lightning-fast `uv` Python environment, and the memory-safe `polars` implementation. 

You can copy and paste this entire block directly into your coding agent (like Cursor or the `pi.dev` CLI) to guide it through the build process.

***

### Step 1: The Monorepo & "Hello World" Chat Shell
**Goal:** Establish the `pnpm` workspace, scaffold the frontend, and verify baseline LLM communication without tools.
* **Action:** 1. Initialize a `pnpm` workspace at the root.
    2. Scaffold a Next.js App Router project inside `apps/web`.
    3. Import the `@mariozechner/pi-web-ui` Lit components into a `/chat` page layout.
    4. Build a basic Next.js API route (`/api/chat`) that uses `@mariozechner/pi-ai` to pass messages to OpenAI and stream the response back.
* **The Test:** Run `pnpm dev`. Open the browser, type "Hello, are you online?" into the chat box. 
* **Success Criteria:** The AI streams back a standard greeting in the Next.js UI. 

### Step 2: The Librarian (RBAC & Ripgrep)
**Goal:** Prove the AI can search a local file system safely, and that Role-Based Access Control physically prevents data leaks.
* **Action:** 1. Create a mock directory at the workspace root: `/company_data/public/` (put a `schedule.txt` here) and `/company_data/admin/` (put a `profit.txt` here).
    2. Build the `search_company_knowledge` tool in the Next.js backend using Node's `child_process` to run `ripgrep`.
    3. Add a hardcoded "Role" toggle in the Next.js UI state (Intern vs. Owner) and pass it to the API route.
    4. Implement backend logic: If role is Intern, `ripgrep` only targets `/public/`. If Owner, it targets `/company_data/`.
* **The Test:** 1. Set role to Intern. Ask: "What is our profit?" -> *Success: AI refuses/finds nothing.*
    2. Set role to Owner. Ask: "What is our profit?" -> *Success: AI quotes the `profit.txt` file.*

### Step 3: The `uv` Python Sandbox (Polars Environment)
**Goal:** Establish the isolated Python environment and ensure the Next.js backend can execute scripts safely using the local virtual environment.
* **Action:**
    1. Create `packages/python-sandbox`. Run `uv init` and `uv add polars`.
    2. Create the `executeSandboxedCommand` wrapper in Next.js. **Crucial:** Hardcode the executable path to point directly to `../../packages/python-sandbox/.venv/bin/python` (stripping environment variables and enforcing a `/tmp/workspace` directory).
    3. Build the `run_data_analysis` tool in `pi-ai`, connected to this wrapper.
* **The Test:** Temporarily hardcode a prompt telling the AI to use `run_data_analysis` to execute `import polars as pl; print(2 + 2)`.
* **Success Criteria:** The AI returns "4" in the chat UI, proving the Node-to-Python bridge works and the `uv` environment is active.

### Step 4: The Autonomous ReAct Loop (Memory-Safe)
**Goal:** Prove the AI can chain tools together to analyze data without crashing the server's RAM.
* **Action:** 1. Put a mock CSV file (`2026_contractors.csv`) in the `/company_data/admin/` folder.
    2. Give the AI access to *both* the `search_company_knowledge` and `run_data_analysis` tools.
    3. **Update the System Prompt:** Explicitly instruct the AI that it MUST use `polars` LazyFrames (`pl.scan_csv()`) and `.collect()` to prevent memory exhaustion, forbidding eager `pd.read_csv()` loading.
* **The Test:** Log in as Owner. Ask: "What is the average payout in our 2026 contractor ledger?"
* **Success Criteria:** You watch the UI. First, it loads `search_company_knowledge`. Then, it loads `run_data_analysis`. Finally, it prints the correct mathematical average without spiking system memory. 

### Step 5: Visuals & Documents (The UI Handlers)
**Goal:** Expand the coding agent's capabilities to generate files (Graphs and PDFs), and ensure the Next.js frontend renders them beautifully.
* **Action:**
    1. Run `uv add matplotlib reportlab` in the sandbox package.
    2. Add the `generate_visual_graph` and `generate_document` tools to the backend schema.
    3. Update the Next.js frontend to intercept `ToolResultMessage` payloads. If the payload contains a `.png` path, render an Image Card. If it contains a `.pdf` path, render a **[Download Document]** button.
* **The Test:** Ask: "Create a bar chart of the top 3 contractor payouts" AND "Generate a late rent notice PDF for Unit 4B."
* **Success Criteria:** The AI writes the scripts, saves the files to `/tmp/workspace`, and your Next.js frontend successfully renders the visual image and the clickable download button in the chat.

### Step 6: The Boss's Dashboard (Audit Logging)
**Goal:** Build the trust layer for the business owner.
* **Action:**
    1. Set up a local SQLite database using Prisma or Drizzle in the `apps/web` folder.
    2. Update your `/api/chat` route to log every user prompt, their role, and the exact tool parameters executed into the database *before* calling OpenAI.
    3. Build a standard React page at `/admin/logs` that fetches and displays this table.
* **The Test:** Have an Intern ask a blocked question, have an Owner ask for a graph, then navigate to `/admin/logs`.
* **Success Criteria:** The dashboard shows a real-time feed of exactly what happened, proving the system is fully auditable.

