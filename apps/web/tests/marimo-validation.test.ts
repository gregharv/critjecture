import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildMarimoNotebookTemplate } from "@/lib/marimo-notebook-template";
import {
  MarimoValidationError,
  validateMarimoNotebookSource,
} from "@/lib/marimo-validation";
import type { StagedSandboxFile } from "@/lib/python-sandbox";
import { createTestAppEnvironment } from "@/tests/helpers/test-environment";

describe("marimo notebook template and validation", () => {
  let cleanup: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = null;
    }
  });

  it("builds a valid starter notebook template", async () => {
    const env = await createTestAppEnvironment();
    cleanup = env.cleanup;
    const workspaceDir = path.join(env.rootDir, "workspace");
    const stagedFiles = await createCsvFixture(workspaceDir);
    const notebookSource = buildMarimoNotebookTemplate({
      analysisGoal: "Summarize the payout totals.",
      inputFiles: ["admin/contractors_2026.csv"],
      title: "Payout Summary",
    });

    expect(notebookSource).toContain('app = marimo.App(width="medium")');
    expect(notebookSource).toContain('Path("inputs") / relative_path');
    expect(notebookSource).toContain("pl.scan_csv(path, encoding=\"utf8-lossy\").collect()") ;
    expect(notebookSource).toContain('if __name__ == "__main__":');

    await expect(
      validateMarimoNotebookSource({
        notebookSource,
        stagedFiles,
        workspaceDir,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects notebooks that do not define marimo app structure", async () => {
    await expect(
      validateMarimoNotebookSource({
        notebookSource: "import polars as pl\nprint('hello')\n",
      }),
    ).rejects.toBeInstanceOf(MarimoValidationError);

    await expect(
      validateMarimoNotebookSource({
        notebookSource: [
          "import marimo",
          "import polars as pl",
          'app = marimo.App(width="medium")',
          "",
          "@app.cell",
          "def _():",
          "    return",
        ].join("\n"),
      }),
    ).rejects.toThrow('Notebook must end with if __name__ == "__main__": app.run().');
  });

  it("rejects pandas and eager polars CSV readers", async () => {
    await expect(
      validateMarimoNotebookSource({
        notebookSource: [
          "import marimo",
          'app = marimo.App(width="medium")',
          "",
          "@app.cell",
          "def _():",
          "    import polars as pl",
          "    import pandas as pd",
          "    frame = pd.read_csv('inputs/admin/data.csv')",
          "    return frame, pl",
          "",
          'if __name__ == "__main__":',
          "    app.run()",
        ].join("\n"),
      }),
    ).rejects.toThrow("pandas and pd.read_csv(...) are not allowed");

    await expect(
      validateMarimoNotebookSource({
        notebookSource: [
          "import marimo",
          'app = marimo.App(width="medium")',
          "",
          "@app.cell",
          "def _():",
          "    import polars as pl",
          "    frame = pl.read_csv('inputs/admin/data.csv')",
          "    return frame",
          "",
          'if __name__ == "__main__":',
          "    app.run()",
        ].join("\n"),
      }),
    ).rejects.toThrow("pl.scan_csv(...)");
  });

  it("rejects direct writes under inputs/", async () => {
    await expect(
      validateMarimoNotebookSource({
        notebookSource: [
          "import marimo",
          'app = marimo.App(width="medium")',
          "",
          "@app.cell",
          "def _():",
          "    import polars as pl",
          "    with open('inputs/admin/result.csv', 'w', encoding='utf-8') as handle:",
          "        handle.write('bad')",
          "    return (pl,)",
          "",
          'if __name__ == "__main__":',
          "    app.run()",
        ].join("\n"),
      }),
    ).rejects.toThrow("inputs/ is read-only");
  });

  it("rejects writes outside outputs/", async () => {
    await expect(
      validateMarimoNotebookSource({
        notebookSource: [
          "import marimo",
          'app = marimo.App(width="medium")',
          "",
          "@app.cell",
          "def _():",
          "    import polars as pl",
          "    from pathlib import Path",
          "    Path('reports').mkdir(parents=True, exist_ok=True)",
          "    return Path, pl",
          "",
          'if __name__ == "__main__":',
          "    app.run()",
        ].join("\n"),
      }),
    ).rejects.toThrow("only under outputs/");
  });

  it("accepts common writes inside outputs/", async () => {
    await expect(
      validateMarimoNotebookSource({
        notebookSource: [
          "import marimo",
          'app = marimo.App(width="medium")',
          "",
          "@app.cell",
          "def _():",
          "    import polars as pl",
          "    from pathlib import Path",
          "    Path('outputs').mkdir(exist_ok=True)",
          "    with open('outputs/result.txt', 'w', encoding='utf-8') as handle:",
          "        handle.write('ok')",
          "    return Path, pl",
          "",
          'if __name__ == "__main__":',
          "    app.run()",
        ].join("\n"),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects direct company_data path references", async () => {
    await expect(
      validateMarimoNotebookSource({
        notebookSource: [
          "import marimo",
          'app = marimo.App(width="medium")',
          "",
          "@app.cell",
          "def _():",
          "    import polars as pl",
          "    frame = pl.scan_csv('company_data/admin/secret.csv').collect()",
          "    return frame",
          "",
          'if __name__ == "__main__":',
          "    app.run()",
        ].join("\n"),
      }),
    ).rejects.toThrow("read staged files from inputs/");
  });
});

async function createCsvFixture(
  workspaceDir: string,
  content = "ledger_year,contractor,payout\n2026,Acme,1200\n",
): Promise<StagedSandboxFile[]> {
  const csvPath = path.join(workspaceDir, "inputs", "admin", "contractors_2026.csv");
  await mkdir(path.dirname(csvPath), { recursive: true });
  await writeFile(csvPath, content, "utf8");

  return [
    {
      sourcePath: "admin/contractors_2026.csv",
      stagedPath: "inputs/admin/contractors_2026.csv",
    },
  ];
}
