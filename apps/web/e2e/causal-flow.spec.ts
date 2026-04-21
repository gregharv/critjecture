import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const WEB_ROOT = path.resolve(__dirname, "..");
const REPOSITORY_ROOT = path.resolve(WEB_ROOT, "..", "..");

process.env.CRITJECTURE_DEPLOYMENT_MODE ??= "single_org";
process.env.CRITJECTURE_INTERN_EMAIL ??= "intern@example.com";
process.env.CRITJECTURE_INTERN_NAME ??= "Intern User";
process.env.CRITJECTURE_INTERN_PASSWORD ??= "intern-password";
process.env.CRITJECTURE_ORGANIZATION_NAME ??= "Critjecture Test Org";
process.env.CRITJECTURE_ORGANIZATION_SLUG ??= "critjecture-test-org";
process.env.CRITJECTURE_OWNER_EMAIL ??= "owner@example.com";
process.env.CRITJECTURE_OWNER_NAME ??= "Owner User";
process.env.CRITJECTURE_OWNER_PASSWORD ??= "owner-password";
process.env.CRITJECTURE_STORAGE_ROOT ??= path.resolve(REPOSITORY_ROOT, ".playwright-storage");
process.env.AUTH_SECRET ??= "playwright-test-secret";
process.env.CRITJECTURE_LEGACY_DATABASE_URL ??= path.resolve(
  REPOSITORY_ROOT,
  ".playwright-storage",
  "critjecture.sqlite",
);
process.env.CRITJECTURE_V2_DATABASE_URL ??= path.resolve(
  REPOSITORY_ROOT,
  ".playwright-storage",
  "critjecture-v2.sqlite",
);
process.env.DATABASE_URL ??= process.env.CRITJECTURE_V2_DATABASE_URL;
process.env.OPENAI_API_KEY ??= "test-openai-key";

function resolveConfiguredPath(value: string) {
  if (value.startsWith("file:")) {
    return new URL(value).pathname;
  }

  return path.isAbsolute(value) ? value : path.resolve(WEB_ROOT, value);
}

const LEGACY_DATABASE_FILE_PATH = resolveConfiguredPath(process.env.CRITJECTURE_LEGACY_DATABASE_URL!);
const V2_DATABASE_FILE_PATH = resolveConfiguredPath(process.env.DATABASE_URL!);
const STORAGE_ROOT = resolveConfiguredPath(process.env.CRITJECTURE_STORAGE_ROOT!);

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/causal$/);
}

function getDatabase(filePath: string) {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  return db;
}

function getOwnerContext() {
  const db = getDatabase(LEGACY_DATABASE_FILE_PATH);

  try {
    const row = db
      .prepare(
        `
          select
            u.id as userId,
            o.id as organizationId,
            o.name as organizationName,
            o.slug as organizationSlug
          from users u
          inner join organization_memberships om on om.user_id = u.id
          inner join organizations o on o.id = om.organization_id
          where u.email = ?
          order by om.created_at asc
          limit 1
        `,
      )
      .get(process.env.CRITJECTURE_OWNER_EMAIL) as
      | {
          organizationId: string;
          organizationName: string;
          organizationSlug: string;
          userId: string;
        }
      | undefined;

    if (!row) {
      throw new Error("Expected owner user and organization after login.");
    }

    return row;
  } finally {
    db.close();
  }
}

async function seedCausalDataset() {
  const owner = getOwnerContext();
  const suffix = randomUUID();
  const datasetId = `e2e-dataset-${suffix}`;
  const datasetVersionId = `e2e-dataset-version-${suffix}`;
  const displayName = `E2E conversions ${suffix}`;
  const organizationDir = path.join(STORAGE_ROOT, "organizations", owner.organizationSlug, "e2e-datasets");
  const datasetPath = path.join(organizationDir, `${suffix}.csv`);
  const now = Date.now();

  await mkdir(organizationDir, { recursive: true });
  await writeFile(
    datasetPath,
    [
      "discount_rate,conversion_rate,seasonality",
      "0,10,1",
      "1,12,1",
      "2,14,2",
      "3,16,2",
      "4,18,3",
      "5,20,3",
    ].join("\n"),
    "utf8",
  );

  const db = getDatabase(V2_DATABASE_FILE_PATH);

  try {
    db.prepare(
      `
        insert into organizations (id, name, slug, status, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?)
        on conflict(id) do update set name=excluded.name, slug=excluded.slug, status=excluded.status, updated_at=excluded.updated_at
      `,
    ).run(
      owner.organizationId,
      owner.organizationName,
      owner.organizationSlug,
      "active",
      now,
      now,
    );

    db.prepare(
      `
        insert into datasets (
          id, organization_id, connection_id, dataset_key, display_name, description,
          access_scope, data_kind, grain_description, time_column_name, entity_id_column_name,
          status, active_version_id, metadata_json, created_by_user_id, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      datasetId,
      owner.organizationId,
      null,
      `e2e-conversions-${suffix}`,
      displayName,
      "End-to-end causal flow dataset",
      "admin",
      "table",
      "user-day",
      "event_date",
      "user_id",
      "active",
      datasetVersionId,
      "{}",
      null,
      now,
      now,
    );

    db.prepare(
      `
        insert into dataset_versions (
          id, dataset_id, organization_id, version_number, source_version_token,
          source_modified_at, content_hash, schema_hash, row_count, byte_size,
          materialized_path, ingestion_status, profile_status, ingestion_error,
          profile_error, indexed_at, metadata_json, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      datasetVersionId,
      datasetId,
      owner.organizationId,
      1,
      `e2e-${suffix}`,
      now,
      `hash-${suffix}`,
      `schema-${suffix}`,
      6,
      256,
      datasetPath,
      "ready",
      "ready",
      null,
      null,
      now,
      "{}",
      now,
      now,
    );

    const insertColumn = db.prepare(
      `
        insert into dataset_version_columns (
          id, dataset_version_id, organization_id, column_name, display_name, column_order,
          physical_type, semantic_type, nullable, is_indexed_candidate, is_treatment_candidate,
          is_outcome_candidate, description, metadata_json, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    insertColumn.run(
      `e2e-column-treatment-${suffix}`,
      datasetVersionId,
      owner.organizationId,
      "discount_rate",
      "Discount rate",
      0,
      "float",
      "treatment_candidate",
      0,
      0,
      1,
      0,
      "Applied discount rate",
      "{}",
      now,
    );
    insertColumn.run(
      `e2e-column-outcome-${suffix}`,
      datasetVersionId,
      owner.organizationId,
      "conversion_rate",
      "Conversion rate",
      1,
      "float",
      "outcome_candidate",
      0,
      0,
      0,
      1,
      "Observed conversion rate",
      "{}",
      now,
    );
    insertColumn.run(
      `e2e-column-seasonality-${suffix}`,
      datasetVersionId,
      owner.organizationId,
      "seasonality",
      "Seasonality",
      2,
      "float",
      "numeric",
      0,
      0,
      0,
      0,
      "Observed seasonality",
      "{}",
      now,
    );
  } finally {
    db.close();
  }

  return {
    datasetId,
    datasetVersionId,
    displayName,
    suffix,
  };
}

test("owner can complete the full causal flow end-to-end", async ({ page }) => {
  test.setTimeout(120_000);

  await login(page, "owner@example.com", "owner-password");
  await page.goto("/causal");
  await expect(page.getByRole("heading", { name: "Causal studies" })).toBeVisible();

  const seededDataset = await seedCausalDataset();
  const question = `Why did conversion shift ${seededDataset.suffix}?`;
  const assumptionText = `No hidden demand shock explains ${seededDataset.suffix}.`;

  await page.reload();
  await page.getByLabel("Question").fill(question);
  await page.getByRole("button", { name: "Run causal intake" }).click();

  const studyLink = page.getByRole("link", { name: question });
  await expect(studyLink).toBeVisible();
  await studyLink.click();

  await expect(page).toHaveURL(/\/causal\/studies\//);
  await expect(page.getByRole("heading", { name: question })).toBeVisible();

  await page.getByLabel("Dataset", { exact: true }).selectOption(seededDataset.datasetId);
  await page.getByLabel("Exact dataset version").selectOption(seededDataset.datasetVersionId);
  await page.getByRole("button", { name: "Pin primary dataset" }).click();

  await expect(page.getByText("DAG approval: ready")).toBeVisible();
  await page.getByRole("button", { name: "Seed from dataset" }).click();

  const edgesSection = page
    .locator(".causal-editor-section")
    .filter({ has: page.getByRole("heading", { name: "Edges" }) });
  await edgesSection.locator(".causal-inline-form .causal-select").nth(0).selectOption("discount_rate");
  await edgesSection.locator(".causal-inline-form .causal-select").nth(1).selectOption("conversion_rate");
  await edgesSection.getByPlaceholder("causes").fill("causes");
  await edgesSection.getByRole("button", { name: "Add edge" }).click();

  const assumptionsSection = page
    .locator(".causal-editor-section")
    .filter({ has: page.getByRole("heading", { name: "Assumptions" }) });
  await assumptionsSection.getByPlaceholder("Describe the assumption").fill(assumptionText);
  await assumptionsSection.getByRole("button", { name: "Add assumption" }).click();
  await expect(page.getByText(assumptionText)).toBeVisible();

  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByText(/Current version v1/)).toBeVisible();

  await page.getByRole("button", { name: "Approve current DAG version" }).click();
  await expect(page.getByText(/user_signoff/)).toBeVisible();

  const runsSection = page.locator(".causal-card").filter({
    has: page.getByRole("heading", { name: "Causal runs" }),
  });
  await runsSection.getByRole("button", { name: "Create causal run" }).click();
  await expect(runsSection.locator(".causal-study-list__status").getByText("completed", { exact: true }).first()).toBeVisible({ timeout: 90_000 });

  const runLink = runsSection.getByRole("link").first();
  await expect(runLink).toBeVisible();
  await runLink.click();

  await expect(page).toHaveURL(/\/causal\/studies\/.*\/runs\//);
  await expect(page.getByRole("heading", { name: question })).toBeVisible();
  await expect(page.getByText("placebo_treatment_test")).toBeVisible();
  await expect(page.getByText("backdoor_linear_regression")).toBeVisible();

  await page.getByRole("button", { name: "Generate grounded answer" }).click();
  await expect(page.getByText("stored causal answer package only")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(assumptionText)).toBeVisible();
  await expect(page.getByText("Grounded causal answer")).toBeVisible();

  await page.getByRole("link", { name: /Back to study workspace/ }).click();
  const answersSection = page.locator(".causal-card").filter({
    has: page.getByRole("heading", { name: "Answer history" }),
  });
  await expect(answersSection.locator(".causal-card__meta").getByText(/stored/)).toBeVisible();
  await expect(answersSection.getByRole("link")).toHaveCount(1);
});

test("owner sees an honest not-identifiable causal flow end-to-end", async ({ page }) => {
  test.setTimeout(120_000);

  await login(page, "owner@example.com", "owner-password");
  await page.goto("/causal");
  await expect(page.getByRole("heading", { name: "Causal studies" })).toBeVisible();

  const seededDataset = await seedCausalDataset();
  const question = `Why did conversion fall after market demand shifted ${seededDataset.suffix}?`;

  await page.reload();
  await page.getByLabel("Question").fill(question);
  await page.getByRole("button", { name: "Run causal intake" }).click();

  const studyLink = page
    .getByRole("link", { name: /Why did conversion fall after market demand shifted/ })
    .first();
  await expect(studyLink).toBeVisible();
  await studyLink.click();

  await page.getByLabel("Dataset", { exact: true }).selectOption(seededDataset.datasetId);
  await page.getByLabel("Exact dataset version").selectOption(seededDataset.datasetVersionId);
  await page.getByRole("button", { name: "Pin primary dataset" }).click();
  await expect(page.getByText("DAG approval: ready")).toBeVisible();
  await page.getByRole("button", { name: "Seed from dataset" }).click();

  const nodeSection = page
    .locator(".causal-editor-section")
    .filter({ has: page.getByRole("heading", { name: "Nodes" }) });
  await nodeSection.getByPlaceholder("missing_confounder").fill("market_demand");
  await nodeSection.getByPlaceholder("Missing confounder").fill("Market demand");
  await nodeSection.getByRole("button", { name: "Add node" }).click();
  await expect(page.locator('input[value="Market demand"]')).toBeVisible();

  const edgesSection = page
    .locator(".causal-editor-section")
    .filter({ has: page.getByRole("heading", { name: "Edges" }) });
  await edgesSection.locator(".causal-inline-form .causal-select").nth(0).selectOption("discount_rate");
  await edgesSection.locator(".causal-inline-form .causal-select").nth(1).selectOption("conversion_rate");
  await edgesSection.getByPlaceholder("causes").fill("causes");
  await edgesSection.getByRole("button", { name: "Add edge" }).click();
  await edgesSection.locator(".causal-inline-form .causal-select").nth(0).selectOption("market_demand");
  await edgesSection.locator(".causal-inline-form .causal-select").nth(1).selectOption("discount_rate");
  await edgesSection.getByRole("button", { name: "Add edge" }).click();
  await edgesSection.locator(".causal-inline-form .causal-select").nth(0).selectOption("market_demand");
  await edgesSection.locator(".causal-inline-form .causal-select").nth(1).selectOption("conversion_rate");
  await edgesSection.getByRole("button", { name: "Add edge" }).click();

  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByText(/Current version v1/)).toBeVisible();
  await page.getByRole("button", { name: "Approve current DAG version" }).click();
  await expect(page.getByText(/user_signoff/)).toBeVisible();

  const runsSection = page.locator(".causal-card").filter({
    has: page.getByRole("heading", { name: "Causal runs" }),
  });
  await runsSection.getByRole("button", { name: "Create causal run" }).click();
  await expect(runsSection.locator(".causal-study-list__status").getByText("not_identifiable", { exact: true }).first()).toBeVisible({ timeout: 90_000 });

  await runsSection.getByRole("link").first().click();
  await page.getByRole("button", { name: "Generate grounded answer" }).click();
  await expect(page.getByText("not identified")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Market demand is unobserved")).toBeVisible();
});
