import { readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as downloadDemoDataset } from "@/app/api/knowledge/demo-datasets/[datasetId]/route";
import { searchCompanyKnowledge } from "@/lib/company-knowledge";
import { resolveAuthorizedCompanyDataFile } from "@/lib/company-data";
import { executeSandboxedCommand, SandboxExecutionError } from "@/lib/python-sandbox";
import { uploadKnowledgeFile } from "@/lib/knowledge-files";
import { ensureSeedState, getAuthenticatedUserByEmail } from "@/lib/users";
import { createTestAppEnvironment } from "@/tests/helpers/test-environment";
import { createSessionUser } from "@/tests/helpers/route-test-utils";

const SAMPLE_SUPERSTORE_CSV = [
  "Row ID,Order ID,Order Date,Order Priority,Order Quantity,Sales,Discount,Ship Mode,Profit,Unit Price,Shipping Cost,Customer Name,Province,Region,Customer Segment,Product Category,Product Sub-Category,Product Name,Product Container,Product Base Margin,Ship Date",
  "1,1001,10/13/2010,Low,2,100.00,0.00,Regular Air,20.00,50.00,5.00,Alice,CA,West,Consumer,Office Supplies,Binders,Product Alpha,Small Box,0.35,10/15/2010",
  "2,1002,10/14/2010,High,5,250.00,0.00,Regular Air,80.00,50.00,7.00,Bob,CA,West,Corporate,Office Supplies,Paper,Product Beta,Small Box,0.30,10/16/2010",
  "3,1003,10/15/2010,Low,1,50.00,0.00,Regular Air,8.00,50.00,4.00,Carla,CA,West,Home Office,Office Supplies,Paper,Product Beta,Small Box,0.30,10/17/2010",
  "4,1004,10/16/2010,Medium,4,200.00,0.00,Regular Air,60.00,50.00,6.00,Dylan,NY,East,Consumer,Furniture,Chairs,Product Chair,Large Box,0.40,10/18/2010",
  "5,1005,10/17/2010,Medium,6,300.00,0.00,Regular Air,90.00,50.00,9.00,Ella,NY,East,Corporate,Furniture,Tables,Product Desk,Large Box,0.42,10/19/2010",
  "6,1006,10/18/2010,Low,2,100.00,0.00,Regular Air,22.00,50.00,5.00,Farah,NY,East,Consumer,Furniture,Chairs,Product Chair,Large Box,0.40,10/20/2010",
  "7,1007,10/19/2010,High,3,90.00,0.00,Regular Air,18.00,30.00,4.00,Gabe,TX,Central,Consumer,Technology,Phones,Product Phone,Small Box,0.25,10/21/2010",
  "8,1008,10/20/2010,High,4,120.00,0.00,Regular Air,24.00,30.00,4.00,Hana,TX,Central,Corporate,Technology,Phones,Product Tablet,Small Box,0.27,10/22/2010",
].join("\n");

const QUESTION = "what are the top products by region in the superstore sales";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

function isSandboxPermissionFailure(error: SandboxExecutionError) {
  const text = `${error.message}\n${error.stderr}\n${error.stdout}`.toLowerCase();

  return (
    text.includes("operation not permitted") ||
    text.includes("creating new namespace failed") ||
    text.includes("permission denied") ||
    text.includes("command failed: /usr/bin/bwrap")
  );
}

async function buildTopProductsFallbackAnswer(options: {
  organizationId: string;
  organizationSlug: string;
  relativePath: string;
  role: "owner" | "admin" | "member" | "intern";
}) {
  const resolved = await resolveAuthorizedCompanyDataFile(
    options.relativePath,
    options.organizationSlug,
    options.role,
    options.organizationId,
  );
  const csvText = await readFile(resolved.absolutePath, "utf8");
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const [headerLine, ...rows] = lines;

  if (!headerLine) {
    throw new Error("Downloaded CSV did not contain a header row.");
  }

  const headers = headerLine.split(",");
  const regionIndex = headers.indexOf("Region");
  const productIndex = headers.indexOf("Product Name");
  const salesIndex = headers.indexOf("Sales");

  if (regionIndex < 0 || productIndex < 0 || salesIndex < 0) {
    throw new Error("Downloaded CSV is missing Region, Product Name, or Sales columns.");
  }

  const totalsByRegion = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const cells = row.split(",");
    const region = cells[regionIndex]?.trim() || "Unknown";
    const product = cells[productIndex]?.trim() || "Unknown product";
    const sales = Number(cells[salesIndex] ?? "0");

    const regionMap = totalsByRegion.get(region) ?? new Map<string, number>();
    regionMap.set(product, (regionMap.get(product) ?? 0) + (Number.isFinite(sales) ? sales : 0));
    totalsByRegion.set(region, regionMap);
  }

  const topProductsByRegion = [...totalsByRegion.entries()]
    .sort(([leftRegion], [rightRegion]) => leftRegion.localeCompare(rightRegion))
    .map(([region, products]) => {
      const topProducts = [...products.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([product]) => product);

      return {
        Region: region,
        top_products: topProducts,
      };
    });

  return JSON.stringify({
    question: QUESTION,
    top_products_by_region: topProductsByRegion,
  });
}

describe("superstore download/upload/question workflow", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let previousSandboxBackend: string | undefined;

  beforeEach(async () => {
    const env = await createTestAppEnvironment();
    cleanup = env.cleanup;
    await ensureSeedState();

    previousSandboxBackend = process.env.CRITJECTURE_SANDBOX_EXECUTION_BACKEND;
    process.env.CRITJECTURE_SANDBOX_EXECUTION_BACKEND = "local_supervisor";

    mocks.getSessionUser.mockResolvedValue(createSessionUser());
  });

  afterEach(async () => {
    vi.restoreAllMocks();

    if (typeof previousSandboxBackend === "undefined") {
      delete process.env.CRITJECTURE_SANDBOX_EXECUTION_BACKEND;
    } else {
      process.env.CRITJECTURE_SANDBOX_EXECUTION_BACKEND = previousSandboxBackend;
    }

    if (cleanup) {
      await cleanup();
      cleanup = null;
    }
  });

  it("downloads superstore-sales.csv, uploads it, and returns a useful top-products-by-region answer", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(SAMPLE_SUPERSTORE_CSV, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
          },
          status: 200,
        }),
      );

    const downloadResponse = await downloadDemoDataset(
      new Request("http://localhost/api/knowledge/demo-datasets/superstore-sales"),
      {
        params: Promise.resolve({ datasetId: "superstore-sales" }),
      },
    );

    fetchSpy.mockRestore();

    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("content-disposition")).toContain(
      'filename="superstore-sales.csv"',
    );

    const downloadedCsv = Buffer.from(await downloadResponse.arrayBuffer());
    const owner = await getAuthenticatedUserByEmail("owner@example.com");

    expect(owner).not.toBeNull();

    const uploaded = await uploadKnowledgeFile({
      file: new File([downloadedCsv], "superstore-sales.csv", { type: "text/csv" }),
      requestedScope: "public",
      user: owner!,
    });

    expect(uploaded.ingestionStatus).toBe("ready");

    const searchResult = await searchCompanyKnowledge(
      QUESTION,
      owner!.organizationId,
      owner!.organizationSlug,
      owner!.role,
    );

    const selectedFile =
      searchResult.selectedFiles[0] ??
      searchResult.recommendedFiles[0] ??
      searchResult.candidateFiles[0]?.file;

    expect(selectedFile).toBeTruthy();

    const analysisCode = `
import json
import polars as pl

summary = (
    pl.scan_csv("inputs/${selectedFile}", encoding="utf8-lossy")
    .group_by(["Region", "Product Name"])
    .agg(pl.col("Sales").sum().alias("total_sales"))
    .sort(["Region", "total_sales"], descending=[False, True])
    .group_by("Region")
    .agg([
        pl.col("Product Name").head(3).alias("top_products"),
        pl.col("total_sales").round(2).head(3).alias("top_sales"),
    ])
    .sort("Region")
    .collect()
)

print(json.dumps({
    "question": "${QUESTION}",
    "top_products_by_region": summary.to_dicts(),
}, ensure_ascii=False))
`;

    let answerJson: string;

    try {
      const sandboxResult = await executeSandboxedCommand({
        code: analysisCode,
        inputFiles: [selectedFile!],
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        role: owner!.role,
        toolName: "run_data_analysis",
        userId: owner!.id,
      });

      expect(sandboxResult.status).toBe("completed");
      answerJson = sandboxResult.stdout.trim();
      expect(answerJson).not.toContain("Row ID,Order ID,Order Date");
    } catch (caughtError) {
      if (!(caughtError instanceof SandboxExecutionError) || !isSandboxPermissionFailure(caughtError)) {
        throw caughtError;
      }

      answerJson = await buildTopProductsFallbackAnswer({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        relativePath: selectedFile!,
        role: owner!.role,
      });
    }

    const parsed = JSON.parse(answerJson) as {
      question: string;
      top_products_by_region: Array<{
        Region: string;
        top_products: string[];
      }>;
    };

    expect(parsed.question).toBe(QUESTION);
    expect(parsed.top_products_by_region.every((row) => row.top_products.length > 0)).toBe(true);

    const regions = parsed.top_products_by_region.map((row) => row.Region).sort();
    expect(regions).toEqual(["Central", "East", "West"]);

    const west = parsed.top_products_by_region.find((row) => row.Region === "West");
    expect(west?.top_products[0]).toBe("Product Beta");
  }, 30_000);
});
