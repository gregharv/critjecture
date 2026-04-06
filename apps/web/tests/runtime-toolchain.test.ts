import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getKnowledgeSearchToolchainHealth, getPdfIngestionToolchainHealth } from "@/lib/runtime-toolchain";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import { searchCompanyKnowledge } from "@/lib/company-knowledge";
import { createTestAppEnvironment, resetTestAppState } from "@/tests/helpers/test-environment";

describe("runtime toolchain compatibility", () => {
  const originalPath = process.env.PATH;

  afterEach(async () => {
    if (typeof originalPath === "undefined") {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }

    await resetTestAppState();
  });

  it("reports a fallback search backend when ripgrep is unavailable", async () => {
    process.env.PATH = "";

    await expect(getKnowledgeSearchToolchainHealth()).resolves.toMatchObject({
      backend: "node_fallback",
      available: true,
      ripgrepAvailable: false,
    });

    await expect(getPdfIngestionToolchainHealth()).resolves.toMatchObject({
      available: false,
    });
  });

  it("still searches company knowledge when ripgrep is unavailable", async () => {
    const organizationSlug = "critjecture-test-org";
    const environment = await createTestAppEnvironment({ organizationSlug });
    process.env.PATH = "";

    try {
      const companyDataRoot = path.join(
        environment.storageRoot,
        "organizations",
        organizationSlug,
        "company_data",
        "admin",
      );
      await mkdir(companyDataRoot, { recursive: true });
      await writeFile(
        path.join(companyDataRoot, "contractors.csv"),
        "contractors\nAcme Contracting,1200\nNorthwind Builders,2200\n",
        "utf8",
      );

      const user = await getAuthenticatedUserByEmail("owner@example.com");

      expect(user).not.toBeNull();

      const result = await searchCompanyKnowledge(
        "contractors",
        user!.organizationId,
        user!.organizationSlug,
        user!.role,
      );

      expect(result.candidateFiles.some((candidate) => candidate.file.includes("contractors"))).toBe(
        true,
      );
    } finally {
      await environment.cleanup();
    }
  });
});
