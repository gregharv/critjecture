# Step 10 Test Checklist

## Fresh Local Bootstrap

1. If you want a true first-boot test, move `storage/` aside or delete it.
2. Run `pnpm db:migrate`.
3. Run `pnpm dev`.
4. Confirm `storage/critjecture.sqlite` exists.
5. Confirm `storage/organizations/critjecture-demo/company_data` exists.
6. Confirm that org `company_data` directory was seeded from repo-root `sample_company_data/`.

## Core App Flow

1. Log in as the seeded owner.
2. Confirm the shell header shows the organization name.
3. Ask for profit or contractor data and confirm search plus analysis still work.
4. Generate a chart or PDF and confirm the asset still renders or downloads.
5. Open `/admin/logs` and confirm audit entries still appear.

## Persistence Checks

1. Stop the app.
2. Start it again.
3. Confirm login still works.
4. Confirm audit logs still exist after restart.
5. Confirm org data still exists after restart.

## Storage-Root Behavior

1. Edit a file under `storage/organizations/critjecture-demo/company_data`.
2. Ask a question that should surface the edited content.
3. Confirm the app reflects the change.
4. This proves runtime company data is coming from persistent storage, not directly from repo-root `sample_company_data/`.

## Repo Sample Data Check

1. Confirm the repo-root `sample_company_data/` is just bundled sample input.
2. Confirm the app continues using the already-seeded org copy under `storage/organizations/.../company_data`.

## Alternate Storage Path Test

1. Set `CRITJECTURE_STORAGE_ROOT` to another absolute directory.
2. Set `DATABASE_URL` to a SQLite file inside that directory.
3. Run `pnpm db:migrate`.
4. Run `pnpm dev`.
5. Confirm the app uses that alternate storage path.
6. Restart the app and confirm data still persists there.

## Current Limitation

- Step 10 only supports one active organization in the product UI.
- The data model is org-scoped now, but there is not yet a multi-org switching flow to test end to end.
