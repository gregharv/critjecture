## Python Sandbox

This package provides the isolated Python runtime used by the Next.js backend for analysis execution.

The supported workflow is:

```bash
uv sync
```

The web app executes tools from:

- `packages/python-sandbox/.venv/bin/python`
- `packages/python-sandbox/.venv/bin/marimo`

with:

- a stripped environment
- a fixed working directory at `/tmp/workspace`
- `polars` available for data analysis
- `marimo` available for notebook validation, execution, HTML export, and preview serving

## Marimo runtime smoke checks

The following commands are expected to work in this environment:

```bash
.venv/bin/marimo check notebook.py --strict
.venv/bin/marimo export html notebook.py -o notebook.html
.venv/bin/marimo run notebook.py --port 27123
```

For the new analysis workspace architecture:

- notebook source remains the durable artifact
- organization files must still be staged into a read-only `inputs/` directory by the app runtime
- notebook code must write generated artifacts only under `outputs/`
- marimo preview serving must stay behind Critjecture auth/proxying rather than direct public exposure
