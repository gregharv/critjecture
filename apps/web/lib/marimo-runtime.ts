const NOTEBOOK_FILE_NAME = "notebook.py";
const HTML_EXPORT_PATH = "outputs/notebook.html";

export function getMarimoNotebookFileName() {
  return NOTEBOOK_FILE_NAME;
}

export function getMarimoHtmlExportPath() {
  return HTML_EXPORT_PATH;
}

export function buildMarimoSandboxDriverCode() {
  return [
    "import subprocess",
    "import sys",
    "from pathlib import Path",
    "",
    `notebook_path = Path(${JSON.stringify(NOTEBOOK_FILE_NAME)})`,
    `html_output_path = Path(${JSON.stringify(HTML_EXPORT_PATH)})`,
    'html_output_path.parent.mkdir(parents=True, exist_ok=True)',
    "",
    "check = subprocess.run(",
    '    [sys.executable, "-m", "marimo", "check", str(notebook_path), "--strict"],',
    "    capture_output=True,",
    "    text=True,",
    ")",
    "if check.stdout.strip():",
    "    print(check.stdout.strip())",
    "if check.returncode != 0:",
    "    if check.stderr.strip():",
    "        print(check.stderr.strip(), file=sys.stderr)",
    "    raise SystemExit(check.returncode)",
    'print(f"Validated {notebook_path}")',
    "",
    "exported = subprocess.run(",
    '    [sys.executable, "-m", "marimo", "export", "html", str(notebook_path), "-o", str(html_output_path)],',
    "    capture_output=True,",
    "    text=True,",
    ")",
    "if exported.stdout.strip():",
    "    print(exported.stdout.strip())",
    "if exported.returncode != 0:",
    "    if exported.stderr.strip():",
    "        print(exported.stderr.strip(), file=sys.stderr)",
    "    raise SystemExit(exported.returncode)",
    'print(f"Exported {html_output_path}")',
  ].join("\n");
}
