# Briefing Grounding Evals

This is the eval harness for the runner behavior that matters to Briefings:
source grounding, MCP tool policy, analytic query execution, trace diagnostics,
and failure classification.

Run from `semaphor-report-scheduler/insight-runner`:

```bash
npm run eval:grounding
```

The command runs deterministic fixture cases through `runInsightLoop`. It does
not call a live model and does not call a live Semaphor MCP server. The evals
use fake model and MCP clients so the pass/fail signal is about runner behavior,
not provider latency or data drift.

Generated outputs are written to `out/grounding-eval/` and are ignored by git:

- `<case>.md`: the generated report or failure artifact
- `<case>.evidence.json`: evidence ledger snapshot
- `<case>.trace.json`: full runner trace
- `<case>.manifest.json`: compact artifact manifest with `traceDiagnostics`
- `summary.json`: per-case pass/fail summary

## What This Replaces

The previous `semaphor-app/scripts/briefing-eval` harness rendered frozen
`BriefingContentDocument` fixtures into HTML screenshots. That only tested
renderer chrome. It did not exercise the runner, MCP grounding, tool policy,
analytic query execution, or trace diagnostics. That harness was removed so
"Briefing eval" now points at the actual runner contract.

Renderer-only screenshots can be reintroduced later if we need a dedicated
email-client visual regression suite, but that should be named as a renderer
eval and not used as a proxy for runner correctness.

## Covered Cases

The harness currently checks:

- project-scoped Briefings with semantic domains complete through the governed
  query-spec path
- Briefing answer slots are covered by protocol-shaped slot execution results,
  not only by raw evidence ledger entries
- failed schema lookups, including the common "dimension treated as dataset"
  failure mode, do not count as answered slot coverage
- project-scoped Briefings without semantic domains fail before broad physical
  discovery
- dashboard-scoped Briefings with direct physical sources run authored
  dashboard `queryInput` through `semaphor_analyze` instead of runner-built
  SQL
- dashboard-scoped Briefings with no queryable sources fail before model-driven
  discovery

## Good Run

A good run exits zero and prints one `pass` line per case:

```text
pass project-semantic-query-spec
pass briefing-slot-query-spec-covered
pass slot-schema-failure-not-covered
pass project-without-semantic-domains
pass dashboard-physical-query-spec
pass dashboard-without-queryable-sources
```

`summary.json` should show `status: "passed"` for every case.

## Bad Run

A bad run exits non-zero, prints the failing case, and still writes the trace
and manifest files for inspection. Start with `<case>.manifest.json` because it
contains compact `traceDiagnostics`: failure category, grounding mode, blocked
tool counts, analytic query counts, analytic query attempts, selected
query-spec/SQL shape, validation candidates, and replay hints.
