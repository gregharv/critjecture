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
  await page.waitForURL(/\/chat$/);
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

async function seedPredictiveDataset() {
  const owner = getOwnerContext();
  const suffix = randomUUID();
  const datasetId = `e2e-predictive-dataset-${suffix}`;
  const datasetVersionId = `e2e-predictive-dataset-version-${suffix}`;
  const displayName = `E2E predictive bookings ${suffix}`;
  const organizationDir = path.join(STORAGE_ROOT, "organizations", owner.organizationSlug, "e2e-predictive-datasets");
  const datasetPath = path.join(organizationDir, `${suffix}.csv`);
  const now = Date.now();

  await mkdir(organizationDir, { recursive: true });
  await writeFile(
    datasetPath,
    [
      "event_date,discount_rate,seasonality,bookings",
      "2026-01-01,0.05,winter,100",
      "2026-01-02,0.05,winter,104",
      "2026-01-03,0.10,winter,112",
      "2026-01-04,0.10,winter,115",
      "2026-01-05,0.15,spring,123",
      "2026-01-06,0.15,spring,127",
      "2026-01-07,0.20,spring,136",
      "2026-01-08,0.20,spring,140",
    ].join("\n"),
    "utf8",
  );

  const db = getDatabase(V2_DATABASE_FILE_PATH);

  try {
    db.exec(`
      create table if not exists predictive_runs (
        id text primary key,
        organization_id text not null,
        dataset_id text not null,
        dataset_version_id text not null,
        requested_by_user_id text,
        status text not null default 'queued',
        task_kind text not null,
        claim_label text,
        target_column_name text not null,
        feature_columns_json text not null default '[]',
        summary_text text,
        model_name text,
        metadata_json text not null default '{}',
        created_at integer not null,
        started_at integer,
        completed_at integer,
        updated_at integer not null
      );

      create table if not exists predictive_results (
        id text primary key,
        run_id text not null,
        organization_id text not null,
        claim_label text not null,
        task_kind text not null,
        target_column_name text not null,
        feature_importance_json text not null default '{}',
        metrics_json text not null default '{}',
        result_json text not null default '{}',
        summary_text text not null,
        row_count integer,
        model_name text not null,
        created_at integer not null
      );
    `);

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
      `e2e-predictive-bookings-${suffix}`,
      displayName,
      "End-to-end predictive and chat sync dataset",
      "admin",
      "table",
      "day",
      "event_date",
      null,
      "active",
      datasetVersionId,
      "{}",
      owner.userId,
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
      `e2e-predictive-${suffix}`,
      now,
      `hash-${suffix}`,
      `schema-${suffix}`,
      8,
      512,
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
      `e2e-predictive-column-time-${suffix}`,
      datasetVersionId,
      owner.organizationId,
      "event_date",
      "Event date",
      0,
      "timestamp",
      "time",
      0,
      0,
      0,
      0,
      "Observed event date",
      "{}",
      now,
    );
    insertColumn.run(
      `e2e-predictive-column-discount-${suffix}`,
      datasetVersionId,
      owner.organizationId,
      "discount_rate",
      "Discount rate",
      1,
      "float",
      "numeric",
      0,
      0,
      0,
      0,
      "Applied discount rate",
      "{}",
      now,
    );
    insertColumn.run(
      `e2e-predictive-column-seasonality-${suffix}`,
      datasetVersionId,
      owner.organizationId,
      "seasonality",
      "Seasonality",
      2,
      "string",
      "categorical",
      0,
      0,
      0,
      0,
      "Seasonal period",
      "{}",
      now,
    );
    insertColumn.run(
      `e2e-predictive-column-bookings-${suffix}`,
      datasetVersionId,
      owner.organizationId,
      "bookings",
      "Bookings",
      3,
      "float",
      "numeric",
      0,
      0,
      0,
      1,
      "Observed bookings",
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
  };
}

function buildPredictiveHandoffPath(input: {
  datasetVersionId: string;
  planningNote: string;
}) {
  const params = new URLSearchParams();
  params.set("datasetVersionId", input.datasetVersionId);
  params.set("targetColumn", "bookings");
  params.append("featureColumn", "discount_rate");
  params.append("featureColumn", "seasonality");
  params.set("taskKind", "regression");
  params.set("preset", "forecast");
  params.set("timeColumn", "event_date");
  params.set("forecastHorizonValue", "14");
  params.set("forecastHorizonUnit", "days");
  params.set("planningNote", input.planningNote);
  params.set("returnToChat", "/chat");
  return `/predictive?${params.toString()}`;
}

test("owner can complete the predictive workspace to chat sync flow", async ({ page }) => {
  test.setTimeout(120_000);

  await login(page, "owner@example.com", "owner-password");

  const seededDataset = await seedPredictiveDataset();
  const planningNote = `Forecast weekly bookings for review ${randomUUID()}`;
  const predictivePath = buildPredictiveHandoffPath({
    datasetVersionId: seededDataset.datasetVersionId,
    planningNote,
  });

  await page.goto(predictivePath);
  await expect(page.getByRole("heading", { name: "Associational and predictive analysis" })).toBeVisible();
  await expect(page.getByText("Prefilled from chat planning")).toBeVisible();
  await expect(page.getByText(`Suggested target: bookings`)).toBeVisible();
  await expect(page.getByText(`Suggested features: discount_rate, seasonality`)).toBeVisible();
  await expect(page.getByText(`Planning note:`)).toBeVisible();
  await expect(page.getByLabel("Dataset version")).toHaveValue(seededDataset.datasetVersionId);
  await expect(page.getByLabel("Analysis preset")).toHaveValue("forecast");
  await expect(page.getByLabel("Task kind")).toHaveValue("regression");
  await expect(page.getByLabel("Target column")).toHaveValue("bookings");
  await expect(page.getByLabel("Time column")).toHaveValue("event_date");
  await expect(page.getByLabel("Forecast horizon")).toHaveValue("14");
  await expect(page.getByLabel(/Discount rate/)).toBeChecked();
  await expect(page.getByLabel(/Seasonality/)).toBeChecked();

  await page.getByRole("link", { name: "Send workspace-ready update to chat" }).click();
  await page.waitForURL(/\/chat(?:\?|$)/);
  await expect(page.getByText("Predictive workspace sync")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".crit-sync__title").getByText("Workspace ready")).toBeVisible();
  await expect(page.getByText("Your predictive setup is ready in the workspace with target bookings, task regression, horizon 14 days.").first()).toBeVisible();
  await expect(page.getByText("Run the predictive analysis if the setup is ready").first()).toBeVisible();
  await expect(page.getByText("Business modeling setup").first()).toBeVisible();

  await page.route("**/api/predictive/run", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        claimLabel: "INSTRUMENTAL / HEURISTIC PREDICTION",
        datasetVersionId: seededDataset.datasetVersionId,
        featureColumns: ["discount_rate", "seasonality"],
        featureImportance: {
          discount_rate: 0.74,
          seasonality: 0.26,
        },
        forecastConfig: {
          horizonUnit: "days",
          horizonValue: 14,
          timeColumnName: "event_date",
        },
        id: `predictive-run-${randomUUID()}`,
        metrics: {
          mape: 0.112,
          rmse: 21.4,
        },
        modelName: "catboost_regressor",
        preset: "forecast",
        rowCount: 120,
        summary: "Bookings are most sensitive to discounting and seasonal demand.",
        targetColumn: "bookings",
        taskKind: "regression",
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto(predictivePath);
  await expect(page.getByRole("heading", { name: "Associational and predictive analysis" })).toBeVisible();
  await page.getByRole("button", { name: "Run predictive analysis" }).click();

  await expect(page.getByText("Bookings are most sensitive to discounting and seasonal demand.").first()).toBeVisible();
  await expect(page.getByText("mape: 0.1120").first()).toBeVisible();
  await expect(page.getByText("rmse: 21.4000").first()).toBeVisible();

  await page.getByRole("link", { name: "Return to chat with this run update" }).click();
  await page.waitForURL(/\/chat(?:\?|$)/);
  await expect(page.getByText("Predictive workspace sync")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".crit-sync__title").getByText("Run completed")).toBeVisible();
  await expect(page.getByText("Your predictive run for bookings has completed.").first()).toBeVisible();
  await expect(page.getByText("Metric highlights: mape: 0.1120; rmse: 21.4000.").first()).toBeVisible();
  await expect(page.getByText("forecast quality looks useful for planning").first()).toBeVisible();
  await expect(page.getByText("not as a causal conclusion").first()).toBeVisible();
});
