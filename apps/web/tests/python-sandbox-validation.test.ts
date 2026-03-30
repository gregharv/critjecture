import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  normalizeGeneratedAssetRelativePath,
  normalizeInlineWorkspaceRelativePath,
  SandboxValidationError,
  stageInlineWorkspaceFiles,
  validateCsvAnalysisCode,
  type StagedSandboxFile,
} from "@/lib/python-sandbox";
import { createTestAppEnvironment } from "@/tests/helpers/test-environment";

describe("python sandbox CSV validation", () => {
  let cleanup: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = null;
    }
  });

  it("rejects path traversal for generated assets", () => {
    expect(() => normalizeGeneratedAssetRelativePath("../secret.txt")).toThrow(
      "Generated asset path must stay inside the sandbox outputs directory.",
    );
  });

  it("rejects path traversal for inline workspace files", () => {
    expect(() => normalizeInlineWorkspaceRelativePath("../chart_payload.json")).toThrow(
      "Inline workspace file path must stay inside the sandbox workspace.",
    );
  });

  it("stages inline workspace files into the local sandbox workspace", async () => {
    const env = await createTestAppEnvironment();
    cleanup = env.cleanup;
    const workspaceDir = path.join(env.rootDir, "workspace");

    await stageInlineWorkspaceFiles(
      [
        {
          content: "{\"x\":[\"Acme\"],\"y\":[1200]}",
          relativePath: "chart_payload.json",
        },
        {
          content: "nested",
          relativePath: "fixtures/example.txt",
        },
      ],
      workspaceDir,
    );

    await expect(readFile(path.join(workspaceDir, "chart_payload.json"), "utf8")).resolves.toBe(
      "{\"x\":[\"Acme\"],\"y\":[1200]}",
    );
    await expect(readFile(path.join(workspaceDir, "fixtures", "example.txt"), "utf8")).resolves.toBe(
      "nested",
    );
  });

  it("rejects pandas and eager CSV readers", async () => {
    const env = await createTestAppEnvironment();
    cleanup = env.cleanup;
    const workspaceDir = path.join(env.rootDir, "workspace");
    const stagedFiles = await createCsvFixture(workspaceDir);

    await expect(
      validateCsvAnalysisCode("import pandas as pd\nprint(pd.read_csv('inputs/data.csv'))", stagedFiles, workspaceDir),
    ).rejects.toBeInstanceOf(SandboxValidationError);

    await expect(
      validateCsvAnalysisCode("import polars as pl\nprint(pl.read_csv('inputs/data.csv'))", stagedFiles, workspaceDir),
    ).rejects.toThrow("CSV analysis must use pl.scan_csv(...).");
  });

  it("rejects unknown CSV columns and common Polars mistakes", async () => {
    const env = await createTestAppEnvironment();
    cleanup = env.cleanup;
    const workspaceDir = path.join(env.rootDir, "workspace");
    const stagedFiles = await createCsvFixture(workspaceDir);

    await expect(
      validateCsvAnalysisCode(
        "import polars as pl\nframe = pl.scan_csv('inputs/admin/contractors_2026.csv').groupby('ledger_year').collect()\nprint(frame)",
        stagedFiles,
        workspaceDir,
      ),
    ).rejects.toThrow("Polars uses group_by(...), not groupby(...).");

    await expect(
      validateCsvAnalysisCode(
        "import polars as pl\nframe = pl.scan_csv('inputs/admin/contractors_2026.csv').select(pl.col('missing')).collect()\nprint(frame)",
        stagedFiles,
        workspaceDir,
      ),
    ).rejects.toThrow("CSV analysis referenced unknown column(s): missing.");
  });

  it("accepts valid lazy Polars CSV analysis", async () => {
    const env = await createTestAppEnvironment();
    cleanup = env.cleanup;
    const workspaceDir = path.join(env.rootDir, "workspace");
    const stagedFiles = await createCsvFixture(workspaceDir);

    await expect(
      validateCsvAnalysisCode(
        [
          "import polars as pl",
          "frame = pl.scan_csv('inputs/admin/contractors_2026.csv')\\",
          "  .group_by('ledger_year')\\",
          "  .agg(pl.col('payout').sum().alias('total_payout'))\\",
          "  .collect()",
          "print(frame)",
        ].join("\n"),
        stagedFiles,
        workspaceDir,
      ),
    ).resolves.toBeUndefined();
  });
});

async function createCsvFixture(workspaceDir: string): Promise<StagedSandboxFile[]> {
  const csvPath = path.join(workspaceDir, "inputs", "admin", "contractors_2026.csv");
  await mkdir(path.dirname(csvPath), { recursive: true });
  await writeFile(csvPath, "ledger_year,contractor,payout\n2026,Acme,1200\n", "utf8");

  return [
    {
      sourcePath: "admin/contractors_2026.csv",
      stagedPath: "inputs/admin/contractors_2026.csv",
    },
  ];
}
