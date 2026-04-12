const DEFAULT_NOTEBOOK_TITLE = "Analysis Workspace";
const DEFAULT_ANALYSIS_GOAL = "Inspect the staged data and answer the user's analytical question.";

export const MARIMO_NOTEBOOK_GENERATED_WITH = "0.23.1";

function normalizeInputFiles(inputFiles: string[] | undefined) {
  return [...new Set((inputFiles ?? []).map((value) => value.trim()).filter(Boolean))];
}

function normalizeTitle(value: string | null | undefined) {
  const title = typeof value === "string" ? value.trim() : "";
  return title || DEFAULT_NOTEBOOK_TITLE;
}

function normalizeAnalysisGoal(value: string | null | undefined) {
  const goal = typeof value === "string" ? value.trim() : "";
  return goal || DEFAULT_ANALYSIS_GOAL;
}

export function buildMarimoNotebookTemplate(input?: {
  analysisGoal?: string | null;
  inputFiles?: string[];
  title?: string | null;
}) {
  const title = normalizeTitle(input?.title);
  const analysisGoal = normalizeAnalysisGoal(input?.analysisGoal);
  const inputFiles = normalizeInputFiles(input?.inputFiles);
  const titleLiteral = JSON.stringify(title);
  const analysisGoalLiteral = JSON.stringify(analysisGoal);
  const inputFilesLiteral = JSON.stringify(inputFiles, null, 4);

  return `import marimo

__generated_with = ${JSON.stringify(MARIMO_NOTEBOOK_GENERATED_WITH)}
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo
    import polars as pl
    from pathlib import Path
    return Path, mo, pl


@app.cell
def _():
    title = ${titleLiteral}
    analysis_goal = ${analysisGoalLiteral}
    input_files = ${inputFilesLiteral}
    return analysis_goal, input_files, title


@app.cell(hide_code=True)
def _(analysis_goal, input_files, mo, title):
    staged_files_markdown = "\\n".join(f"- {path}" for path in input_files) or "- None"
    mo.md(
        f"""
        # {title}

        **Analysis goal:** {analysis_goal}

        **Staged files**
        {staged_files_markdown}
        """
    )
    return


@app.cell
def _(Path, input_files):
    csv_input_paths = {
        relative_path: Path("inputs") / relative_path
        for relative_path in input_files
        if relative_path.lower().endswith(".csv")
    }
    return (csv_input_paths,)


@app.cell
def _(csv_input_paths, pl):
    csv_tables = {
        relative_path: pl.scan_csv(path, encoding="utf8-lossy").collect()
        for relative_path, path in csv_input_paths.items()
    }
    return (csv_tables,)


@app.cell(hide_code=True)
def _(csv_tables, mo):
    if not csv_tables:
        mo.md("No CSV files are currently staged for notebook analysis.")
    else:
        csv_tables
    return


if __name__ == "__main__":
    app.run()
`;
}
