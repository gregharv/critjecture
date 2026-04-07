import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { searchCompanyKnowledge } from "@/lib/company-knowledge";
import { ensureSeedState, getAuthenticatedUserByEmail } from "@/lib/users";
import { createTestAppEnvironment } from "@/tests/helpers/test-environment";

describe("company knowledge search query expansion", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let storageRoot = "";

  beforeEach(async () => {
    const environment = await createTestAppEnvironment();
    cleanup = environment.cleanup;
    storageRoot = environment.storageRoot;
    await ensureSeedState();
  });

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = null;
    }
  });

  it("uses typo-tolerant term correction against manifest/header vocabulary", async () => {
    const user = await getAuthenticatedUserByEmail("owner@example.com");

    expect(user).not.toBeNull();

    const companyDataAdminRoot = path.join(
      storageRoot,
      "organizations",
      user!.organizationSlug,
      "company_data",
      "admin",
    );
    await mkdir(companyDataAdminRoot, { recursive: true });
    await writeFile(
      path.join(companyDataAdminRoot, "raw-export-01.csv"),
      [
        "Region,Product Name,Sales",
        "West,Alpha Desk,1200.25",
        "East,Beta Chair,850.10",
      ].join("\n"),
      "utf8",
    );

    const result = await searchCompanyKnowledge(
      "top prodct by regoin sale",
      user!.organizationId,
      user!.organizationSlug,
      user!.role,
    );

    expect(result.candidateFiles.some((candidate) => candidate.file === "admin/raw-export-01.csv")).toBe(
      true,
    );
    expect(
      result.queryDiagnostics.correctedTerms.some(
        (entry) => entry.from === "prodct" && entry.to === "product",
      ),
    ).toBe(true);
    expect(
      result.queryDiagnostics.correctedTerms.some(
        (entry) => entry.from === "regoin" && entry.to === "region",
      ),
    ).toBe(true);
  });

  it("expands synonym terms using lightweight manifest metadata", async () => {
    const user = await getAuthenticatedUserByEmail("owner@example.com");

    expect(user).not.toBeNull();

    const companyDataAdminRoot = path.join(
      storageRoot,
      "organizations",
      user!.organizationSlug,
      "company_data",
      "admin",
    );
    await mkdir(companyDataAdminRoot, { recursive: true });
    await writeFile(
      path.join(companyDataAdminRoot, "extract.csv"),
      [
        "Region,Product Name,Sales",
        "Central,Gamma Phone,999.00",
      ].join("\n"),
      "utf8",
    );

    const result = await searchCompanyKnowledge(
      "revenue by area item",
      user!.organizationId,
      user!.organizationSlug,
      user!.role,
    );

    expect(result.candidateFiles.some((candidate) => candidate.file === "admin/extract.csv")).toBe(true);
    expect(result.queryDiagnostics.expandedTerms).toEqual(
      expect.arrayContaining(["revenue", "sales", "region", "product"]),
    );
    expect(result.queryDiagnostics.manifestFileCount).toBeGreaterThan(0);
  });

  it("parses CSV preview columns and rows with quoted commas and quotes", async () => {
    const user = await getAuthenticatedUserByEmail("owner@example.com");

    expect(user).not.toBeNull();

    const companyDataAdminRoot = path.join(
      storageRoot,
      "organizations",
      user!.organizationSlug,
      "company_data",
      "admin",
    );
    await mkdir(companyDataAdminRoot, { recursive: true });
    await writeFile(
      path.join(companyDataAdminRoot, "quoted-preview.csv"),
      [
        'Region,"Product, Name","Memo ""quoted"""',
        'West,"Desk, Platinum","He said ""hello"""',
      ].join("\n"),
      "utf8",
    );

    const result = await searchCompanyKnowledge(
      "desk",
      user!.organizationId,
      user!.organizationSlug,
      user!.role,
    );

    const preview = result.candidateFiles.find((candidate) => candidate.file === "admin/quoted-preview.csv")
      ?.preview;

    expect(preview?.kind).toBe("csv");
    expect(preview?.kind === "csv" ? preview.columns : []).toEqual([
      "Region",
      "Product, Name",
      'Memo "quoted"',
    ]);
    expect(preview?.kind === "csv" ? preview.rows[0] : []).toEqual([
      "West",
      "Desk, Platinum",
      'He said "hello"',
    ]);
  });
});
