# Polars Guardrails

This file tracks the prompt guidance and lightweight validation rules used for Python sandbox tasks that operate on staged CSV files with Polars.

The goal is to keep these guardrails easy to tune per deployment and per model family.

## Why This Exists

Different LLMs handle Polars very differently.

- stronger code-capable models often need only light nudging
- weaker or more pandas-biased models often need explicit Polars reminders
- some deployments may need stricter validation before execution

This file is the place to adjust that strategy over time.

## Current Prompt Cheat Sheet

The active system prompt includes these Polars-specific reminders:

- use `pl.scan_csv(...)` and a final `.collect()`
- never use pandas, `pd.read_csv(...)`, or `pl.read_csv(...)`
- use `DataFrame.group_by(...)`, not `groupby(...)`
- use `df.sort("column", descending=True)`, not `reverse=True` or `"desc"`
- use exact CSV headers in `pl.col(...)`
- convert plotted columns with `.to_list()` before passing them to matplotlib

Current prompt source:

- `apps/web/components/chat-shell.tsx`

## Current Lightweight Validations

The sandbox preflight currently does three kinds of checks in:

- `apps/web/lib/python-sandbox.ts`

### 1. Python Syntax Preflight

Before execution, the sandbox runs a cheap `compile(...)` check with the configured Python interpreter.

Purpose:

- catch syntax errors before the full sandbox run
- give a clearer validation-style failure instead of a later runtime crash

### 2. Polars Heuristic Checks

For CSV-backed analysis code, the sandbox rejects known bad patterns:

- pandas imports
- `pd.read_csv(...)`
- `pl.read_csv(...)`
- missing `pl.scan_csv(...)`
- missing `.collect()`
- `.groupby(...)`
- `.sort(..., reverse=True)`
- `.sort(..., "desc")` and similar string direction forms
- `.rows` used as a property instead of `rows()`

These are intentionally lightweight string-pattern checks, not a full Python parser or LSP.

### 3. CSV Header Validation

For staged CSV inputs, the sandbox:

- reads the header line from each staged CSV
- extracts `pl.col("...")` references from the generated code
- rejects unknown column names before execution

This is meant to catch mistakes like:

- using `year` when the file actually contains `ledger_year`
- inventing column names that are not present in the staged inputs

## Tuning Strategy By Model

### Stronger Models

Recommended profile:

- keep the cheat sheet short
- keep syntax preflight on
- keep heuristic validation on
- keep CSV header validation on

Reason:

- strong models usually recover well with concise guidance
- the validators still catch expensive avoidable mistakes

### More Pandas-Biased Models

Recommended profile:

- expand the prompt cheat sheet with one or two concrete Polars examples
- keep all current validations on
- consider adding more common Polars API reminders if failures cluster

Examples worth adding if needed:

- `df.group_by("contractor_name").agg(pl.col("payout").sum())`
- `df.sort("payout", descending=True)`
- `df["contractor_name"].to_list()`

### Mixed Deployment Environments

If different deployments use different LLMs:

- keep one shared validation layer in code
- tune prompt verbosity per deployment or model configuration
- prefer adding small, explicit API reminders over large documentation dumps

## Design Principles

- prefer cheap validation over heavyweight tooling
- fail early on known bad patterns
- keep the prompt small enough to remain portable across models
- keep model-specific behavior configurable through prompt tuning, not hard-coded branching, unless a deployment proves it is necessary

## Possible Future Additions

- model-specific prompt profiles
- separate cheat-sheet levels: minimal, standard, strict
- additional Polars pattern checks based on observed failures
- lightweight AST-based Python linting if the current regex checks stop being sufficient
- richer schema-aware validation when multiple staged CSVs are used together
