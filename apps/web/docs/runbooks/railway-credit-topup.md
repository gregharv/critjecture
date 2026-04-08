# Railway Workspace Credit Top-Up (Hosted Cell)

Use this runbook when you need to increase a hosted organization's pooled monthly workspace credits directly in SQLite.

This updates **Critjecture workspace credits** (`workspace_plans.monthly_included_credits`), not Railway account billing credits.

## Preconditions

- You are connected to the Railway web service shell (`railway ssh`).
- The hosted database file is at `/data/critjecture.sqlite`.
- You know the organization slug (for example: `demo`).

## 1) Open Python

```bash
python3
```

If you get stuck in a `...` continuation prompt, press `Ctrl+C` once to return to `>>>`.

## 2) Connect and inspect current plan credits

Type the following in Python, one line at a time:

```python
import sqlite3, time
conn = sqlite3.connect('/data/critjecture.sqlite')
rows = conn.execute("SELECT o.slug, wp.plan_code, wp.plan_name, wp.monthly_included_credits FROM workspace_plans wp JOIN organizations o ON o.id = wp.organization_id ORDER BY o.slug").fetchall()
print(rows)
```

Example output:

```python
[('demo', 'flat-smb', 'Flat SMB', 500)]
```

## 3) Top up credits

Example below adds `500` credits to org slug `demo`.

```python
slug = 'demo'
add = 500
org_id = conn.execute("SELECT id FROM organizations WHERE slug=?", (slug,)).fetchone()[0]
conn.execute("UPDATE workspace_plans SET monthly_included_credits = monthly_included_credits + ?, updated_at = ? WHERE organization_id = ?", (add, int(time.time()*1000), org_id))
conn.commit()
```

## 4) Verify

```python
print(conn.execute("SELECT o.slug, wp.monthly_included_credits FROM workspace_plans wp JOIN organizations o ON o.id = wp.organization_id ORDER BY o.slug").fetchall())
```

Expected for this example:

```python
[('demo', 1000)]
```

## 5) Exit

```python
exit()
```

## Notes

- No app redeploy/restart is required after this update.
- If `fetchone()` returns `None` for slug lookup, re-check the slug from step 2 output.
- This operation changes the included credit pool for the current and future billing windows until updated again.
