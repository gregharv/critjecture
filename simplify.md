# Simplification Opportunities for Admin and Owner Views

The following areas in the Critjecture admin dashboards (specifically `/admin/operations` and `/admin/settings`) expose too much underlying infrastructure complexity for a typical SMB owner. These can be simplified without losing underlying functionality.

### 1. Operations Page: Hide "Persistence Envelope" & "Sandbox Supervisor"
**The Problem:** The Operations page displays deep technical minutiae. It shows the SQLite engine, journal mode (`WAL`), target RPO/RTO hours, storage roots, sandbox auth modes, runner types, and supervisor heartbeats. An SMB owner does not care about SQLite topologies or container reconciliations—they just want to know if the AI is working and how much it costs.
**The Fix:**
* **Hide behind an "Advanced Diagnostics" toggle:** Keep these panels for IT support or debugging, but hide them by default.
* **Simplify the Health View:** Condense "Sandbox Supervisor" and "Persistence Envelope" into a single **"System Health"** indicator (e.g., "Database: OK", "Analysis Engine: OK") so the owner gets a quick green light.

### 2. Operations Page: Abstract Raw UUIDs in "Recent Failures"
**The Problem:** The failures list prints raw internal database IDs (`requestId`, `sandboxRunId`, `runtimeToolCallId`). This looks like a developer crash log rather than an admin dashboard.
**The Fix:**
* **Abstract the errors:** Instead of printing UUIDs, show human-readable context like *"Failed to generate chart for user owner@example.com"* and hide the raw IDs in a `<details>` dropdown or a "Copy Error Details" button for support tickets.

### 3. Settings Page: Simplify Granular Data Retention Rules
**The Problem:** The Settings page asks the SMB owner to manually configure 6 different retention day counts (Alerts, Chat History, Export Artifacts, Knowledge Imports, Request Logs, Usage). Decision fatigue is a real issue here.
**The Fix:**
* **Global Preset Policies:** Replace the 6 input fields with a simple dropdown: *"Data Retention Policy: [ 30 Days | 90 Days | 1 Year | Custom ]"*.
* If they select "Custom", you can reveal the granular input fields. Otherwise, the system automatically syncs all retention values to the chosen preset.

### 4. Settings Page: Guide Intimidating "Governance" Purge Buttons
**The Problem:** The governance section has a row of scary ghost buttons ("Purge chat history", "Purge import metadata", "Delete managed files") that require setting a specific cutoff date and queuing a full export first. While this is great for compliance, it's very confusing to look at.
**The Fix:**
* **Group under a "Data Deletion" modal:** Move these buttons out of the main view and behind a single "Manage Data Deletion" button. When clicked, a modal can explain *why* an export is required first, guiding them through the compliance workflow step-by-step rather than dumping the buttons on the screen.
