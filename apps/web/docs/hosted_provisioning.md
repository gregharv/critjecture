# Hosted Provisioning

Hosted deployments are intended for Railway or another centrally operated environment where Critjecture runs in `hosted` deployment mode.

Within the documented dedicated-customer-cell envelope, `hosted` is now treated as production-ready.

## Model

- one hosted deployment cell contains exactly one customer organization
- each tenant user operates only inside that bound organization
- tenant-facing UI stays organization-scoped
- organization creation is operator-managed, not self-service
- hosted execution depends on a dedicated sandbox supervisor service configured outside the tenant UI
- the hosted app and hosted supervisor must both be bound to the same `CRITJECTURE_HOSTED_ORGANIZATION_SLUG`

Hosted-mode trust boundary:

- each customer gets a dedicated operator-managed app, SQLite, storage, and sandbox-supervisor footprint
- tenant isolation is enforced both by dedicated deployment placement and by authenticated organization membership, role checks, and organization-scoped storage paths
- this document does not describe a shared multi-tenant cell; adding a denser shared-cell model would be future work and would require a separate review
- the current supported persistence envelope is one writable app instance plus one SQLite file in `WAL` mode per hosted cell

## Provisioning Flow

1. Set `CRITJECTURE_DEPLOYMENT_MODE=hosted`.
2. Set `CRITJECTURE_HOSTED_ORGANIZATION_SLUG` for the one organization this hosted cell will serve.
3. Run the hosted provisioning script to create:
   - the organization row
   - organization storage roots
   - the first owner account and membership
4. Confirm `/api/health` reports the hosted deployment binding and sandbox supervisor as healthy.
5. Hand the owner credentials to the customer administrator.
6. After first access, have the customer administrator create any additional admins or members through `/admin/settings`.

Provisioning guardrails:

- the provisioning script refuses to create a second organization in `hosted`
- the provisioning script refuses organization slugs that do not match `CRITJECTURE_HOSTED_ORGANIZATION_SLUG`
- hosted supervisor credentials should use signed requests with:
  - `CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID`
  - `CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET`

## Operational Notes

- on-prem and local environments should continue using `single_org`
- hosted operators should back up both SQLite and the storage root at least every `24` hours and before schema or storage-layout changes
- hosted operators should run `pnpm restore:drill:hosted -- --environment <label> --operator "<name>"` before first cutover and at least quarterly per hosted environment
- hosted operators should run `pnpm release:proof:hosted` before first cutover and for later production-changing hosted upgrades
- hosted operators should treat the current recovery objectives as `24`-hour RPO and `2`-hour RTO
- hosted operators should manage `AUTH_SECRET`, model credentials, and sandbox supervisor credentials through platform secret storage
- hosted operators should record named ownership for the hosted app cell, the hosted supervisor deployment, credential rotation, alerts, and incident response
- destructive customer data purges should be preceded by a recent full export
- customer review for hosted mode should include `security_review.md`, `deployment.md`, `hosted_launch.md`, and the hosted runbooks that match the operating model
