Building this iteratively is the only way to keep your sanity. If you try to wire up the Lit web components, the agentic ReAct loop, the file system RBAC, and the Python sandbox all at once, you will end up with a debugging nightmare. 

Here is the step-by-step roadmap to build Critjecture, designed specifically so you can verify each layer is rock-solid before adding the next piece of complexity.

### Step 1: The "Hello World" Chat Shell
**Goal:** Establish the baseline communication between your frontend and the LLM without any tools or file system access yet.
* **Action:** 1. Initialize your Next.js project.
    2. Import the `@mariozechner/pi-web-ui` web components into a `/chat` page.
    3. Build a basic Next.js API route (`/api/chat`) that uses `@mariozechner/pi-ai` to pass messages to OpenAI and stream the response back.
* **The Test:** Open your browser, type "Hello, are you online?" into the chat box. 
* **Success Criteria:** The AI streams back a standard greeting in the UI. 

### Step 2: The Librarian (RBAC & Ripgrep)
**Goal:** Prove that the AI can search a local file system safely, and that your Role-Based Access Control physically prevents data leaks.
* **Action:** 1. Create a mock directory structure: `/company_data/public/` (put a `schedule.txt` here) and `/company_data/admin/` (put a `profit.txt` here).
    2. Build the `search_company_knowledge` tool using Node's `child_process` to run `ripgrep`.
    3. Add a hardcoded "Role" toggle in your Next.js UI state (Intern vs. Owner) and pass that role to the backend API route.
    4. Code the backend logic: If role is Intern, `ripgrep` only targets `/public/`. If Owner, it targets `/company_data/`.
* **The Test:** 1. Set role to Intern. Ask: "What is our profit?" -> *Success is the AI saying it doesn't know.*
    2. Set role to Owner. Ask: "What is our profit?" -> *Success is the AI quoting the `profit.txt` file.*

### Step 3: The Isolated Python Sandbox
**Goal:** Ensure the backend can execute Python code safely without crashing your Next.js server, independent of the AI.
* **Action:**
    1. Create the `executeSandboxedCommand` wrapper in your backend (stripping env variables, enforcing a `/tmp/workspace` directory, setting a 15-second timeout).
    2. Build the `run_data_analysis` tool in `pi-ai`, connected to this wrapper.
* **The Test:** Temporarily hardcode a prompt instruction telling the AI to use the `run_data_analysis` tool to execute `print(2 + 2)`.
* **Success Criteria:** The AI returns "4" in the chat UI, proving it can successfully write and execute arbitrary Python via your secure sandbox.

### Step 4: The Autonomous ReAct Loop
**Goal:** Prove the AI can chain tools together without human intervention.
* **Action:** 1. Put a mock CSV file (`2026_contractors.csv`) in the `/company_data/admin/` folder.
    2. Give the AI access to *both* the `search_company_knowledge` tool and the `run_data_analysis` tool simultaneously.
    3. Refine the System Prompt to explain how to use the search tool to find file paths, and the analysis tool to run Pandas scripts against those paths.
* **The Test:** Log in as Owner. Ask: "What is the average payout in our 2026 contractor ledger?"
* **Success Criteria:** You watch the UI. First, it shows a loading state for `search_company_knowledge`. Then, it shows a loading state for `run_data_analysis`. Finally, it prints the correct mathematical average. 

### Step 5: Visuals and Artifacts (The UI Handlers)
**Goal:** Expand the coding agent's capabilities to generate files, and ensure the frontend knows how to render them.
* **Action:**
    1. Add the `generate_visual_graph` tool to the backend.
    2. Update the Next.js frontend to intercept `ToolResultMessage` payloads. If the payload contains a `.png` path, render an HTML `<img src="...">` tag instead of standard markdown.
* **The Test:** Ask: "Create a bar chart of the top 3 contractor payouts from the ledger."
* **Success Criteria:** The AI writes a Matplotlib script, saves a PNG to `/tmp/workspace`, and your Next.js frontend successfully renders the image in the chat window.

### Step 6: The Boss's Dashboard (Audit Logging)
**Goal:** Build the trust layer for the business owner.
* **Action:**
    1. Set up a local SQLite database (or Postgres if you prefer).
    2. Update your `/api/chat` route to log every user prompt, their role, and the exact tool parameters executed into the database *before* calling OpenAI.
    3. Build a standard React page at `/admin/logs` that fetches and displays this table.
* **The Test:** Have an Intern ask a blocked question, have an Owner ask for a graph, then navigate to `/admin/logs`.
* **Success Criteria:** The dashboard shows a beautiful, real-time feed of exactly what happened, proving the system is fully auditable.

---

Once you hit the end of Step 6, you have a fully functional, enterprise-grade MVP ready to deploy to Railway and demo to local property managers. 

Would you like me to write the code for **Step 1** (the Next.js API route and the `pi-web-ui` integration) so you can get the chat shell running today?
