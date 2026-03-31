# File Connections

This document describes a low-friction product direction for getting customer data into Critjecture from direct uploads and external systems such as Google Drive, QuickBooks, and Salesforce.

The goal is simple:

- make it easy for owners and admins to get useful data into the app quickly
- avoid forcing customers to dump all of their company data into Critjecture
- preserve the current governed, auditable, organization-scoped knowledge model

## 1. Product Goal

Critjecture should support two primary intake paths:

- manual file upload for immediate use
- selective source sync for recurring imports

These two paths should feel like one coherent feature set inside the knowledge area, not two unrelated systems.

The main product promise is:

- upload a few files and start asking questions immediately
- connect a source when you want Critjecture to stay up to date

## 2. Product Principles

- lowest-friction first use
- least-privilege data access
- selective sync instead of whole-account ingestion
- durable imported knowledge instead of fragile live dependency chains
- clear source provenance and last-sync visibility
- public vs admin visibility set at import time
- no mandatory data-engineering setup for normal customers

## 3. Why This Should Not Be A Live-Query-First System

Critjecture already works best when customer data becomes managed organization knowledge:

- files are stored inside the organization's knowledge tree
- imports are indexed and searchable
- imported files can be staged into the analysis sandbox
- audit and governance behavior remains inside Critjecture's normal boundary

That means the default integration model should be:

1. connect an external source
2. pull only approved data
3. normalize it into managed files
4. import and index it
5. answer questions from the imported corpus

This is a better fit than relying on live third-party API calls during every chat request.

## 4. Core User Experience

The knowledge page should present two primary actions:

- `Upload files`
- `Connect a source`

### 4.1 Upload Files

This remains the fastest path.

Desired UX:

- drag and drop or choose files
- select visibility: `public` or `admin`
- confirm upload
- file appears in the knowledge library quickly
- file becomes searchable shortly after upload

This path should require almost no setup.

### 4.2 Connect A Source

This should be a guided flow, not a technical workflow.

Desired UX:

1. Choose provider
2. Authenticate with provider
3. Select exactly what to sync
4. Choose destination visibility: `public` or `admin`
5. Preview what will be imported
6. Click `Sync now`
7. Optionally enable scheduled sync after the first successful run

The first sync should be easy and opinionated. It should not expose a giant configuration surface by default.

## 5. Selective Sync Model

Customers should not be forced into all-or-nothing ingestion.

The product should support selective sync for each provider:

- Google Drive: selected folders or selected files
- QuickBooks: selected reports, ranges, and export views
- Salesforce: selected reports, objects, or filtered datasets
- generic uploads: selected files or archives

Every sync definition should include:

- provider
- connection
- selected source items
- destination scope: `public` or `admin`
- sync cadence
- last successful sync time
- last sync status

## 6. Scope And Privacy Controls

Owners will care about two different questions:

- what data is imported at all
- who inside the workspace can see it

The first version should support:

- import only selected folders, files, reports, or objects
- map imported data into `public` or `admin`
- preview before sync
- disconnect a source without deleting unrelated data
- purge imported data from one source if needed

Important product stance:

- Critjecture should never imply that the customer must mirror their full Google Drive, CRM, or accounting system into the platform
- the default should always be curated import

## 7. Generic Connector Framework

The product should support many providers through one internal connector framework.

The generic framework should define these capabilities:

- `connect`
- `refresh_auth`
- `discover`
- `preview`
- `sync`
- `schedule`
- `disable`
- `purge_imported_content`

Each provider implementation should translate its own API into the same internal sync contract.

## 8. Internal Data Flow

Recommended flow:

1. Owner creates a source connection
2. Critjecture stores provider auth metadata securely
3. Owner selects source items and a visibility scope
4. Critjecture runs a sync job
5. The connector fetches remote content
6. The connector normalizes remote content into importable files
7. Critjecture writes those files into the org's managed import pipeline
8. The normal indexing and search path takes over

This keeps uploads and synced data inside one unified knowledge system.

## 9. Normalized Output Formats

The first version should normalize synced content into the same file types the app already handles well:

- `.csv`
- `.txt`
- `.md`
- `.pdf` when the source naturally exports that way

Examples:

- Google Docs -> exported text or PDF
- Google Sheets -> CSV snapshots
- QuickBooks reports -> CSV plus Markdown sync summary
- Salesforce reports -> CSV plus Markdown description of filters and sync time

Avoid raw live-object querying as the primary user-facing model in v1.

## 10. Provenance Requirements

Every imported document from a connector should retain provenance metadata:

- provider name
- connection id
- remote item id
- remote item label
- source URL when available
- imported by sync job id
- imported at timestamp
- last synced at timestamp

This matters for trust, debugging, support, and later governance work.

## 11. Low-Friction Connector UX

The first release should bias toward presets, not open-ended configuration.

Examples:

- Google Drive: `Choose folders`
- QuickBooks: `Sync common finance reports`
- Salesforce: `Sync selected reports`
- ZIP or exports: `Upload exported files`

After a successful first sync, the UI can expose:

- `Sync again`
- `Enable weekly sync`
- `Edit selection`
- `Disconnect`

## 12. What To Avoid In V1

- requiring customers to use MCP directly
- requiring customers to run a CLI to onboard data
- account-wide default sync without explicit selection
- field-mapping screens before a customer has seen value
- live third-party querying during normal chat requests
- a giant universal connector UI that treats every provider as infinitely configurable on day one

CLI and MCP can still be useful internally for development, debugging, and one-off operator workflows, but they should not be the main customer interaction model.

## 13. Suggested Product Surface

Add a `Connections` section in the knowledge area with:

- active connections
- last sync time
- last sync status
- imported item count
- destination scope
- actions: `Sync now`, `Edit`, `Disconnect`

Keep `Upload files` visible and prominent even after connectors exist.

The default order should be:

1. Upload files
2. Connect a source
3. Review imported knowledge
4. Ask questions in chat

## 14. Recommended Rollout Order

### Phase 1

- preserve the current manual upload flow
- improve the knowledge page CTA structure
- add a product spec and internal connector interface

### Phase 2

- add `Connections` data model and sync job model
- implement one provider, ideally Google Drive
- normalize imported content into existing managed knowledge files

### Phase 3

- add one structured-business-data provider, likely QuickBooks or Salesforce
- add source-level provenance in the knowledge UI
- add scheduled sync

### Phase 4

- add source-specific filters and better review controls
- add purge and disconnect flows
- add more connectors as demand proves out

## 15. Concrete Recommendation

The product should optimize for this story:

- manual upload when a customer wants answers now
- selective sync when a customer wants Critjecture to stay current
- no expectation that the customer must hand over all company data
- one unified knowledge model underneath both flows

That gives owners and admins a low-friction starting point without weakening privacy expectations or operational clarity.
