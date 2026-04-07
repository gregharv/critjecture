import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureSeedState, getAuthenticatedUserByEmail } from "@/lib/users";
import { createTestAppEnvironment } from "@/tests/helpers/test-environment";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  getModel: vi.fn(() => ({ provider: "openai" })),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  complete: mocks.complete,
  getModel: mocks.getModel,
}));

import { searchCompanyKnowledge } from "@/lib/company-knowledge";

describe("company knowledge AI fallback query rewrite", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let previousRewriteEnv: string | undefined;
  let storageRoot = "";

  beforeEach(async () => {
    const environment = await createTestAppEnvironment();
    cleanup = environment.cleanup;
    storageRoot = environment.storageRoot;
    await ensureSeedState();

    previousRewriteEnv = process.env.CRITJECTURE_ENABLE_AI_SEARCH_QUERY_REWRITE;
    process.env.CRITJECTURE_ENABLE_AI_SEARCH_QUERY_REWRITE = "true";

    mocks.complete.mockResolvedValue({
      content: [{ type: "text", text: '{"terms":["warehouse"]}' }],
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();

    if (typeof previousRewriteEnv === "undefined") {
      delete process.env.CRITJECTURE_ENABLE_AI_SEARCH_QUERY_REWRITE;
    } else {
      process.env.CRITJECTURE_ENABLE_AI_SEARCH_QUERY_REWRITE = previousRewriteEnv;
    }

    if (cleanup) {
      await cleanup();
      cleanup = null;
    }
  });

  it("uses AI-suggested terms when deterministic search confidence is low", async () => {
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
      path.join(companyDataAdminRoot, "inventory_extract.csv"),
      [
        "Warehouse,On Hand",
        "North Hub,42",
      ].join("\n"),
      "utf8",
    );

    const result = await searchCompanyKnowledge(
      "depot throughput",
      user!.organizationId,
      user!.organizationSlug,
      user!.role,
    );

    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(result.queryDiagnostics.aiRewriteApplied).toBe(true);
    expect(result.queryDiagnostics.aiSuggestedTerms).toContain("warehouse");
    expect(
      result.candidateFiles.some((candidate) => candidate.file === "admin/inventory_extract.csv"),
    ).toBe(true);
  });
});
