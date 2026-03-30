# Hosted Provisioning

Hosted deployments are intended for Railway or another centrally operated environment where Critjecture runs in `hosted` deployment mode.

## Model

- one deployment can contain multiple organizations
- each tenant user still operates inside one primary organization
- tenant-facing UI stays organization-scoped
- organization creation is operator-managed, not self-service
- hosted execution depends on a dedicated sandbox supervisor service configured outside the tenant UI

Hosted-mode trust boundary:

- organizations share one operator-managed deployment footprint
- tenant isolation is enforced through authenticated organization membership, role checks, and organization-scoped storage paths
- this document does not claim hard infrastructure isolation between tenants beyond those application and storage boundaries

## Provisioning Flow

1. Set `CRITJECTURE_DEPLOYMENT_MODE=hosted`.
2. Run the hosted provisioning script to create:
   - the organization row
   - organization storage roots
   - the first owner account and membership
3. Hand the owner credentials to the customer administrator.

## Operational Notes

- on-prem and local environments should continue using `single_org`
- hosted operators should back up both SQLite and the storage root
- hosted operators should manage `AUTH_SECRET`, model credentials, and sandbox supervisor credentials through platform secret storage
- destructive customer data purges should be preceded by a recent full export
- customer review for hosted mode should include `security_review.md`, `deployment.md`, and the hosted/on-prem runbooks that match the operating model
