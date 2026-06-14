# Briefing Grounding Smoke

This is the live local smoke harness for Briefing grounding. It uses the real
Semaphor MCP endpoint and a real project token, but keeps the model
deterministic so the signal is about MCP response shapes and runner behavior,
not model/provider variance.

Run from `semaphor-report-scheduler/insight-runner`:

```bash
npm run smoke:grounding
```

Required environment:

```bash
SEMAPHOR_MCP_URL=http://localhost:3000/api/mcp
SEMAPHOR_PROJECT_TOKEN=...
```

`SEMAPHOR_PROJECT_TOKEN` is the canonical token for local eval and smoke runs.

Optional environment:

```bash
SEMAPHOR_SMOKE_DASHBOARD_ID=...
SEMAPHOR_SMOKE_DOMAIN_ID=...
SEMAPHOR_SMOKE_DATASET_NAME=...
SEMAPHOR_SMOKE_METRIC=...
SEMAPHOR_SMOKE_DATE_FIELD=...
SEMAPHOR_SMOKE_DIMENSION=...
SEMAPHOR_MCP_TIMEOUT_MS=60000
```

You can also pass the same values as flags:

```bash
npm run smoke:grounding -- \
  --mcp http://localhost:3000/api/mcp \
  --token "$SEMAPHOR_PROJECT_TOKEN" \
  --dashboard-id dash_123
```

## What It Does

The smoke harness runs live cases through `runInsightLoop` and writes outputs
to `out/grounding-smoke/`:

- project semantic query-spec smoke, when a semantic domain/dataset/schema can
  be discovered or provided;
- dashboard source smoke, when `SEMAPHOR_SMOKE_DASHBOARD_ID` is provided.

The project smoke auto-discovers:

1. analysis context,
2. semantic domains,
3. datasets for the chosen domain,
4. dataset schema,
5. one metric and one date field,
6. then runs the runner through `semaphor_analyze`.

The dashboard smoke uses the dashboard grounding path and lets the runner's
dashboard query-seed recovery execute an authored card query when available.

## Good Run

A good run exits zero and writes `out/grounding-smoke/summary.json` with at
least one passed case. Skipped cases are allowed when the relevant source is not
configured, but all runnable cases must pass.

Start debugging with each case's `*.manifest.json`; the manifest contains
`traceDiagnostics`, which summarizes grounding mode, failure category, blocked
tool calls, analytic query count, analytic query attempts, selected
query-spec/SQL shape, validation candidates, and replay hints.

## Bad Run

A bad run exits non-zero when:

- MCP URL or token is missing,
- no smoke case can run,
- a runnable case fails,
- live MCP returns an unexpected shape,
- the runner cannot complete a query for a source expected to be queryable.

This command is intentionally not CI-safe. It depends on your local Semaphor
app, token, and project/dashboard data.
