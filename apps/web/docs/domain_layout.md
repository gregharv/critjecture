# Domain Layout

Use this note when deciding how public hostnames should map to Critjecture environments.

## Recommended Public Layout

Use separate hostnames for each customer workspace and for the reusable demo:

- `critjecture.com` for the marketing or product site
- `<company>.critjecture.com` for each real customer workspace login
- `demo.critjecture.com` for the demo workspace login

Examples:

- `acme.critjecture.com`
- `northwind-health.critjecture.com`
- `demo.critjecture.com`

Do not use `critjecture.com/<company>` or any path-based customer routing as the primary hosted customer entry point.

## Why Separate Hostnames

Critjecture `hosted` mode is designed as one bound organization per deployment cell.

That means:

- one hosted cell for each customer environment
- one separate hosted cell for the reusable demo environment
- one organization slug bound to each cell
- one SQLite database and one persistent storage root per cell

This makes `<company>.critjecture.com` the right fit for customer environments because each customer gets a dedicated runtime boundary, and `demo.critjecture.com` remains isolated as its own fake-data workspace.

## Railway Mapping

Recommended mapping:

- `<company>.critjecture.com` -> Railway custom domain on that customer's hosted app service
- `demo.critjecture.com` -> Railway custom domain on the separate demo hosted app service

Keep these environments separate:

- Railway project
- persistent volume
- hosted organization slug
- sandbox supervisor endpoint
- secrets
- restore-drill and release-proof records

Do not place both the demo org and the customer-facing app in one hosted Railway cell.

## Cloudflare DNS

Use Cloudflare DNS to point each hostname at the CNAME target Railway gives you for that service.

Typical shape:

- `<company>` -> `CNAME` -> `<customer-app-service>.up.railway.app`
- `demo` -> `CNAME` -> `<demo-app-service>.up.railway.app`

Operational guidance:

- add the custom domain in Railway first
- copy the Railway-provided CNAME target into Cloudflare
- wait for Railway domain verification before treating the hostname as live
- use Cloudflare SSL/TLS mode `Full (strict)` once Railway has issued the custom-domain certificate

If `critjecture.com` is hosted elsewhere, keep that apex record separate from the customer and demo hostnames.

## Login Experience

Use the normal login flow on each customer's own hostname.

Recommended UX:

- `<company>.critjecture.com/login` is that customer's sign-in page
- `demo.critjecture.com/login` is the demo sign-in page with demo-only credentials
- `critjecture.com` may include customer sign-in links and a plain `View demo` link to `https://demo.critjecture.com/login`

Do not route all customers through one shared login hostname in the current hosted model.

Reasons:

- it pushes a shared-app mental model onto a one-org-per-cell deployment design
- it weakens the hosted-environment separation the product currently documents
- it makes audit, access, and support stories less clear

## Demo Guardrails

For the demo environment:

- use fake but plausible business data only
- keep the `owner` account for the operator only
- create separate `admin` or `member` demo accounts for viewers
- rotate or suspend temporary demo credentials after the demo window

## Suggested Next Step

If you want a clean public structure now, ship:

- `critjecture.com` as the public site
- `<company>.critjecture.com` for each real customer
- `demo.critjecture.com` as the dedicated reusable demo

That matches the current hosted deployment model without adding path-based routing or special-case login behavior.
