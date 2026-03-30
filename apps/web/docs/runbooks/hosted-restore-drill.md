# Hosted Restore Drill

Use this runbook for a real hosted customer cell. It is separate from the `single_org` restore-drill and release-proof flow.

## When To Run It

- before first hosted cutover for an environment
- at least quarterly per hosted environment
- after storage-layout or migration work that changes backup or restore assumptions

## Command

```bash
pnpm restore:drill:hosted -- --environment <environment-label> --operator "<operator-name>"
```

Optional flags:

- `--output-dir <dir>`
- `--backup-output-dir <dir>`
- `--notes "<sign-off-notes>"`
- `--follow-up-items "item one|item two"`

## What It Proves

- a real backup can be created from the configured hosted runtime
- that backup restores into a clean temporary target
- the restored SQLite database still passes migration validation
- the command emits JSON and Markdown evidence records for the hosted environment

## Current Hosted Recovery Expectations

- backup cadence: at least every `24` hours
- additional backup: before schema or storage-layout changes
- target RPO: `24` hours
- target RTO: `2` hours

## Minimum Sign-Off

- note the environment label used for the hosted cell
- record the operator who executed the drill
- keep the generated JSON and Markdown artifacts with the hosted environment records
- record any follow-up items before the next cutover or upgrade
