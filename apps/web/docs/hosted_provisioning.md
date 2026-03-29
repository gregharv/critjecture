# Hosted Provisioning

Hosted deployments are intended for Railway or another centrally operated environment where Critjecture runs in `hosted` deployment mode.

## Model

- one deployment can contain multiple organizations
- each tenant user still operates inside one primary organization
- tenant-facing UI stays organization-scoped
- organization creation is operator-managed, not self-service

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
- destructive customer data purges should be preceded by a recent full export
