# Future Steps

This file tracks the next implementation milestones after the work already captured in `steps_completed.md`.

## Step 18: Test Coverage and Release Readiness

### Goal

Create enough automated verification to ship changes with confidence.

### What Should Be Implemented

- route-level tests for search, sandbox, generated files, and audit APIs
- RBAC regression tests
- sandbox validation tests
- integration tests for the planner and audit correlation flows
- end-to-end tests for core chat journeys
- a release checklist for production deployments

### Acceptance Criteria

- critical auth, RBAC, sandbox, and audit flows are covered automatically
- major regressions are catchable before release
- a repeatable release confidence process exists

## Step 19: Admin Operations and Compliance Controls

### Goal

Add the operational and governance capabilities expected by real customer deployments.

### What Should Be Implemented

- user and organization administration
- role assignment and membership management
- retention and deletion controls
- export capabilities for audits and customer data
- deployment, security, and operations documentation for customer review

### Acceptance Criteria

- admins can manage users and permissions without code changes
- data lifecycle actions are deliberate and traceable
- customers can review the operational posture of the product

## Roadmap Notes

- Chat history and file uploads are important future capabilities, but they should follow authentication and persistence foundations.
- Step 17 now provides the first durable async knowledge-import layer:
  - job-backed bulk uploads
  - background ingestion
  - readiness-gated search and sandbox access
  - partial-failure and retry handling
- Embedding and vectorization should be treated as a later stage on top of durable bulk ingestion rather than bundled into the first bulk-import release.
- Step 16 now provides the first local-first operational layer:
  - structured request logging
  - health checks
  - owner-facing operations summaries
  - rate limits and rolling budget controls
- The order above reflects dependency order and production risk, not just feature desirability.
- A small on-prem pilot may be able to adopt parts of this roadmap more gradually than a multi-tenant cloud rollout.
