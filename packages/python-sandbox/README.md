## Python Sandbox

This package provides the isolated Python runtime used by the Next.js backend for Step 3.

The supported workflow is:

```bash
uv sync
```

The web app executes:

- `packages/python-sandbox/.venv/bin/python`

with:

- a stripped environment
- a fixed working directory at `/tmp/workspace`
- `polars` available for data analysis
