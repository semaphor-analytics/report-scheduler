# Insight Runner

Scheduler-owned runner for generated-analysis Briefings. This directory is the
active source for both local Insight Loop development and SAM Lambda deployment.

## Local Watch Mode

Use watch mode while developing the runner. It starts the same local HTTP server
as `pnpm serve`, but automatically restarts when files in this package change.

```bash
cd /Users/rohit/code/semaphor/semaphor-report-scheduler/insight-runner
pnpm serve:watch \
  --port 4317 \
  --provider openai \
  --model gpt-5.5 \
  --reasoning-effort medium \
  --verbose
```

Use the fake provider for deterministic smoke tests without OpenAI:

```bash
pnpm serve:watch \
  --port 4317 \
  --provider fake \
  --verbose
```

Watch mode uses `tsx watch src/cli.ts serve` under the hood. When a source file
changes, the local HTTP process restarts. That is useful during development, but
it can terminate an in-flight Briefing run if you save a file while the run is
still executing.

Health check:

```bash
curl http://127.0.0.1:4317/healthz
```

## Report Document Style Samples

Use these commands when iterating on the typed AI Briefing report renderer.
They do not run the full Briefing pipeline or call the model; they only render
fixed `ReportDocument` examples through the same HTML renderer used by the
runner.

Regenerate inspectable HTML files:

```bash
cd /Users/rohit/code/semaphor/semaphor-report-scheduler/insight-runner
npm run report-doc:samples
```

The files are written to:

```text
/Users/rohit/code/semaphor/semaphor-report-scheduler/insight-runner/out/report-document-samples
```

Regenerate screenshots for quick visual comparison:

```bash
npm run report-doc:screenshots
```

Screenshots are written to:

```text
/Users/rohit/code/semaphor/semaphor-report-scheduler/insight-runner/out/report-document-samples/screenshots
```

If Chrome is not installed at the default macOS path, set `CHROME_PATH` to a
Chrome or Chromium executable before running the screenshot command.

## Semaphor App Runner Environment

Set these variables in `semaphor-app`; they are what make the Briefings UI call
the Insight runner.

For local development, put them in:

```text
/Users/rohit/code/semaphor/semaphor-app/.env.local
```

or, if that is the env file your dev server uses, in:

```text
/Users/rohit/code/semaphor/semaphor-app/.env.development
```

Local runner setup:

```bash
BRIEFINGS_RUNNER_URL=http://127.0.0.1:4317
LAMBDA_API_KEY=local-briefings-callback-secret
```

For production or self-hosted deployments, put the equivalent values in the
runtime environment for the deployed `semaphor-app` process:

```bash
BRIEFINGS_RUNNER_URL=<InsightRunnerIngressFunctionUrl>
BRIEFINGS_EMAIL_SENDER_URL=<EmailSenderFunctionUrl>
LAMBDA_API_KEY=<same LambdaApiKey used for the SAM stack>
```

What these do:

- `BRIEFINGS_RUNNER_URL` tells Semaphor App where to dispatch generated-analysis
  Briefing preview runs and saved runs. Locally this is the runner HTTP server;
  in production this is the SAM `InsightRunnerIngressFunctionUrl` output.
- `BRIEFINGS_EMAIL_SENDER_URL` tells Semaphor App where to send completed
  delivery packages for email. It is needed for Briefings that send email.
- `LAMBDA_API_KEY` is the shared service-to-service secret. Semaphor App uses it
  when calling the runner and email sender, and the runner uses it when calling
  progress, complete, and fail callbacks back into Semaphor App. The same value
  must be configured in both Semaphor App and the runner/SAM stack.

Restart `semaphor-app` after changing any of these environment variables. If
`Run now` returns `BRIEFING_DISPATCH_FAILED: BRIEFINGS_RUNNER_URL is not
configured`, the app process did not start with `BRIEFINGS_RUNNER_URL` loaded.

## Runner Process Environment

This directory is the source for both runner harnesses:

- local development: `pnpm serve` / `pnpm serve:watch`
- production: the SAM-deployed `InsightRunnerIngressFunction` and
  `InsightRunnerWorkerFunction`

### Local Development

Use local development when `semaphor-app` is running on your machine and should
dispatch generated-analysis Briefing runs to a local runner process.

Set runner-local variables in:

```text
/Users/rohit/code/semaphor/semaphor-report-scheduler/insight-runner/.env.local
```

Start from:

```bash
cp /Users/rohit/code/semaphor/semaphor-report-scheduler/insight-runner/.env.example \
  /Users/rohit/code/semaphor/semaphor-report-scheduler/insight-runner/.env.local
```

Recommended local runner values:

```bash
INSIGHT_LOOP_RUNNER_HOST=127.0.0.1
INSIGHT_LOOP_RUNNER_PORT=4317
LAMBDA_API_KEY=local-briefings-callback-secret
INSIGHT_LOOP_MODEL_PROVIDER=openai
INSIGHT_LOOP_MODEL=gpt-5.5
INSIGHT_LOOP_REASONING_EFFORT=medium
OPENAI_API_KEY=...
SEMAPHOR_MCP_TIMEOUT_MS=60000
```

For direct CLI runs, also set:

```bash
SEMAPHOR_PROJECT_TOKEN=...
SEMAPHOR_MCP_URL=http://localhost:3000/api/mcp
```

`SEMAPHOR_PROJECT_TOKEN` is not required for normal Briefing UI dispatches,
because Semaphor App mints and sends a scoped runtime token in the dispatch
payload. It is only needed when you run this package directly from the command
line without Semaphor App creating the runtime payload.

### Production / SAM Deployment

Production runner variables are not read from this directory's `.env.local`.
They are injected into Lambda by the SAM stack in:

```text
/Users/rohit/code/semaphor/semaphor-report-scheduler/template.yaml
```

Set deploy-time values in:

```text
/Users/rohit/code/semaphor/semaphor-report-scheduler/.env
```

using the template:

```text
/Users/rohit/code/semaphor/semaphor-report-scheduler/.env.example
```

Required production values for AI-generated Briefings:

```bash
SEMAPHOR_APP_URL=https://your-semaphor-instance.com
LAMBDA_API_KEY=...
INSIGHT_LOOP_MODEL_PROVIDER=openai
INSIGHT_LOOP_MODEL=gpt-5.5
INSIGHT_LOOP_REASONING_EFFORT=medium
OPENAI_API_KEY=...
```

The deploy script maps these to SAM parameters:

- `SEMAPHOR_APP_URL` -> `SemaphorAppUrl`
- `LAMBDA_API_KEY` -> `LambdaApiKey`
- `INSIGHT_LOOP_MODEL_PROVIDER` -> `InsightLoopModelProvider`
- `INSIGHT_LOOP_MODEL` -> `InsightLoopModel`
- `OPENAI_API_KEY` -> `OpenAiApiKey`

After deployment, copy the SAM outputs into the Semaphor App environment shown
at the top of this README.

### Variable Reference

| Variable | Set In | Used By | Purpose |
| --- | --- | --- | --- |
| `BRIEFINGS_RUNNER_URL` | `semaphor-app` env | Semaphor App | Dispatches Briefing preview runs and saved runs to the local runner or deployed ingress Function URL. |
| `BRIEFINGS_EMAIL_SENDER_URL` | `semaphor-app` env | Semaphor App | Sends completed delivery packages through the report scheduler email sender Function URL. |
| `BRIEFINGS_ARTIFACT_STORAGE` | `semaphor-app` env | Semaphor App | Artifact backend for UI-triggered Briefing runs. Defaults to local disk outside production and S3 in production. Set `local` or `s3` explicitly when needed. |
| `BRIEFINGS_ARTIFACT_DIR` | `semaphor-app` env | Semaphor App | Local artifact root for UI-triggered Briefing runs when local storage is active. Defaults to `.briefings-artifacts` relative to the app process. |
| `S3_EXPORTS_BUCKET` | `semaphor-app` env | Semaphor App | S3 bucket for UI-triggered Briefing artifacts when `BRIEFINGS_ARTIFACT_STORAGE=s3` or production default S3 storage is active. |
| `LAMBDA_API_KEY` | both app and runner/SAM env | Semaphor App, local runner, Lambda runner | Shared service-to-service secret for dispatch and callbacks. Values must match across the calling and receiving processes. |
| `INSIGHT_LOOP_RUNNER_HOST` | `insight-runner/.env.local` | local runner | Local HTTP bind host. Defaults to `127.0.0.1`. |
| `INSIGHT_LOOP_RUNNER_PORT` | `insight-runner/.env.local` | local runner | Local HTTP port. Defaults to `4317`. |
| `INSIGHT_LOOP_MODEL_PROVIDER` | `insight-runner/.env.local` or scheduler `.env` | local runner, Lambda runner | Model provider. Use `openai` for real analysis and `fake` for deterministic smoke tests. |
| `INSIGHT_LOOP_MODEL` | `insight-runner/.env.local` or scheduler `.env` | local runner, Lambda runner | Model name used by generated-analysis Briefings. |
| `INSIGHT_LOOP_REASONING_EFFORT` | `insight-runner/.env.local` or scheduler `.env` | local runner, Lambda runner | Reasoning effort used by generated-analysis Briefings. Defaults to `medium`. |
| `OPENAI_API_KEY` | `insight-runner/.env.local` or scheduler `.env` | local runner, Lambda runner | Required when `INSIGHT_LOOP_MODEL_PROVIDER=openai`. |
| `SEMAPHOR_PROJECT_TOKEN` | `insight-runner/.env.local` | direct CLI only | Project-scoped token for direct `pnpm insight-loop run ...` commands. Not required for Semaphor App Briefing dispatch. |
| `SEMAPHOR_MCP_URL` | `insight-runner/.env.local` | direct CLI only | MCP endpoint for direct CLI runs. UI-dispatched runs use runtime context from Semaphor App. |
| `SEMAPHOR_MCP_TIMEOUT_MS` | `insight-runner/.env.local` | local runner and direct CLI | Timeout for MCP tool calls. |
| `BRIEFINGS_CALLBACK_TIMEOUT_MS` | runner env | local runner, Lambda runner | Timeout for progress, complete, and fail callbacks back to Semaphor App. Defaults to 30 seconds. |
| `INSIGHT_RUNNER_WORKER_FUNCTION_NAME` | SAM template only | ingress Lambda | Worker Lambda name invoked asynchronously for saved/preview run execution. Do not set for local development. |
| `INSIGHT_RUNNER_PLAN_TIMEOUT_MS` | SAM template only | ingress Lambda | Synchronous preview-plan timeout budget. Defaults to 15 seconds in the SAM template. |

Source-of-truth product and implementation docs live in:

- `/Users/rohit/code/semaphor/semaphor-app/docs/implementation-plans/insight-loop/PRD.md`
- `/Users/rohit/code/semaphor/semaphor-app/docs/implementation-plans/insight-loop/IMPLEMENTATION-CONTRACT.md`
- `/Users/rohit/code/semaphor/semaphor-app/docs/implementation-plans/insight-loop/BRIEFINGS-IMPLEMENTATION-CONTRACT.md`

## Usage

### Run Briefings From The Semaphor App UI

Use this flow when you want the dashboard **Create briefing** UI in
`semaphor-app` to save a Briefing and dispatch **Run now** to this local runner.

1. Add local dispatch env to `/Users/rohit/code/semaphor/semaphor-app/.env.local`:

```bash
BRIEFINGS_RUNNER_URL=http://127.0.0.1:4317
LAMBDA_API_KEY=local-briefings-callback-secret
```

`BRIEFINGS_RUNNER_URL` tells Semaphor App where to send Briefing runs.
`LAMBDA_API_KEY` authenticates both Semaphor App dispatches to the runner and
runner callbacks back to Semaphor App. Restart `semaphor-app` after changing
`.env.local`.

2. Start or restart Semaphor App:

```bash
cd /Users/rohit/code/semaphor/semaphor-app
pnpm dev
```

3. Start the local Briefings runner service:

```bash
cd /Users/rohit/code/semaphor/semaphor-report-scheduler/insight-runner
pnpm serve:watch \
  --port 4317 \
  --provider openai \
  --model gpt-5.5 \
  --reasoning-effort medium \
  --verbose
```

This accepts Semaphor App dispatches at `POST /internal/briefing-runs`, runs the
Insight Loop agent against Semaphor MCP using the runtime token from Semaphor
App, and calls the provided complete/fail callback.
With `--verbose`, the runner logs callback lifecycle events such as
`callback_started`, `callback_succeeded`, and `callback_failed`.

If you want to pass the key explicitly instead of reading `LAMBDA_API_KEY`, use:

```bash
pnpm serve:watch \
  --port 4317 \
  --api-key "$LAMBDA_API_KEY" \
  --provider openai \
  --model gpt-5.5 \
  --reasoning-effort medium \
  --verbose
```

4. Health check the runner:

```bash
curl http://127.0.0.1:4317/healthz
```

5. Use the UI:

- Open a dashboard in `semaphor-app`.
- Click **Create briefing**.
- Save the Briefing.
- Click **Run now**.
- Watch the runner terminal for verbose progress and callback status.

If **Run now** returns
`BRIEFING_DISPATCH_FAILED: BRIEFINGS_RUNNER_URL is not configured`, the
`semaphor-app` process did not start with `BRIEFINGS_RUNNER_URL` loaded.

For deterministic UI smoke testing without OpenAI, start the runner with
`--provider fake`. For real analysis, use `--provider openai` and ensure
`OPENAI_API_KEY` is available in the runner environment.

Optional callback timeout:

```bash
BRIEFINGS_CALLBACK_TIMEOUT_MS=30000
```

The default is 30 seconds. This bounds the complete/fail callback back into
Semaphor App so a local run does not appear to hang silently after
`artifact_rendered`.

### Where Local Briefing Traces Are Stored

There are two local trace locations, depending on how the run was started.

Runs started from the Semaphor App UI are stored by `semaphor-app`, because the
runner sends the completed payload back to the app callback and the app persists
the artifacts. In local development, unless `BRIEFINGS_ARTIFACT_STORAGE=s3` is
set, those files are written under:

```text
/Users/rohit/code/semaphor/semaphor-app/.briefings-artifacts
```

The app-stored trace path shape is:

```text
/Users/rohit/code/semaphor/semaphor-app/.briefings-artifacts/briefings/{orgId}/{projectId}/{briefingId}/{runId}/package/trace-json.json
```

The same run directory usually also contains `body-markdown.md`,
`evidence-json.json`, and, for callback-backed runs, top-level artifacts such as
`markdown.md`, `html.html`, `evidence.json`, and `callback.json`.

To find the newest app/UI traces:

```bash
find /Users/rohit/code/semaphor/semaphor-app/.briefings-artifacts \
  -type f -name 'trace-json.json' -print0 \
  | xargs -0 stat -f '%m %Sm %N' \
  | sort -nr | head -20
```

If `BRIEFINGS_ARTIFACT_STORAGE=s3` is set, app/UI artifacts go to
`S3_EXPORTS_BUCKET` instead of local disk using the same key shape:

```text
briefings/{orgId}/{projectId}/{briefingId}/{runId}/package/trace-json.json
```

Runs started directly from this package, including `pnpm insight-loop run`,
grounding evals, grounding smokes, and LLM smokes, are runner filesystem
outputs. They are written under:

```text
/Users/rohit/code/semaphor/semaphor-report-scheduler/insight-runner/out
```

Typical direct-run trace names are `*.trace.json`, with sibling
`*.manifest.json`, `*.evidence.json`, and Markdown artifacts. To find the newest
runner-side traces:

```bash
find /Users/rohit/code/semaphor/semaphor-report-scheduler/insight-runner/out \
  -type f -name '*.trace.json' -print0 \
  | xargs -0 stat -f '%m %Sm %N' \
  | sort -nr | head -20
```

Quick rule: if you clicked **Run now** in the Semaphor App UI, start in
`semaphor-app/.briefings-artifacts`; if you ran a runner command or smoke test,
start in `insight-runner/out`.

### Briefing Trace Replay

The canonical troubleshooting entry point lives in `semaphor-app`. Use these
commands from `/Users/rohit/code/semaphor/semaphor-app` instead of hand-rolling
runner commands:

```bash
npm run briefing:local:check
npm run briefing:trace:latest
npm run briefing:replay:latest
npm run briefing:replay -- --trace /absolute/path/to/trace-json.json
```

The app-level replay wrapper defaults to `http://localhost:3000/api/mcp` so it
validates local app code. Pass `--mcp <url>` only when intentionally checking
another MCP endpoint.

Replay outputs are still written by this runner package under:

```text
/Users/rohit/code/semaphor/semaphor-report-scheduler/insight-runner/out/llm-smoke/summary.json
/Users/rohit/code/semaphor/semaphor-report-scheduler/insight-runner/out/llm-smoke/*.trace.json
/Users/rohit/code/semaphor/semaphor-report-scheduler/insight-runner/out/llm-smoke/*.evidence.json
/Users/rohit/code/semaphor/semaphor-report-scheduler/insight-runner/out/llm-smoke/*.manifest.json
```

The underlying runner command is `npm run smoke:llm`, but it is an
implementation detail. It prints runner events by default because live LLM runs
must be observable while they execute.

Read replay failures in this order:

- `diagnostics.policy.blockedToolCalls`: model emitted placeholders,
  duplicates, or unsafe tool calls.
- `diagnostics.analytics.lastFailedAttempt`: query-spec/schema/output-contract
  failure; fix the app analytics kernel or MCP adapter, not runner prose.
- `answerCoverage.executionResults`: typed slot coverage, missing fields, and
  whether a grounded partial should render.
- Markdown artifact: presentation quality only after the governed result and
  answer coverage are correct.

Run the deterministic gate before and after fixes:

```bash
cd /Users/rohit/code/semaphor/semaphor-app
npm run eval:analytics-contract
```

Use `npm run eval:analytics-contract -- --level live` from `semaphor-app` only
when credentials are configured and you intentionally want hosted/local live
smokes. Prefer `SEMAPHOR_MCP_URL=http://localhost:3000/api/mcp` while validating
local code; otherwise failures may come from deployed `semaphor.cloud` schema
drift instead of your working tree.

### Direct Local Runner Command

Use this command when you want to run the agent directly from this repo without
the Semaphor App Briefings UI. It executes the weekly revenue example with
OpenAI, localhost Semaphor MCP, verbose progress logs, and local
Markdown/HTML/PDF outputs under `out/`:

```bash
pnpm insight-loop run examples/weekly-revenue.md \
  --provider openai \
  --model gpt-5.5 \
  --reasoning-effort medium \
  --max-tool-calls 8 \
  --verbose \
  --out out \
  --pdf \
  --delivery dry-run
```

For direct CLI runs, this repo's `.env.local` should include:

```bash
SEMAPHOR_PROJECT_TOKEN="..."
SEMAPHOR_MCP_URL=http://localhost:3000/api/mcp
SEMAPHOR_MCP_TIMEOUT_MS=60000
OPENAI_API_KEY="..."
```

Local MCP calls default to a 60 second timeout; override with
`SEMAPHOR_MCP_TIMEOUT_MS` or `--mcp-timeout-ms` if a local server needs a
different bound.

## Install And Verify

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

## Fake-Client Skeleton Run

Use this for deterministic local testing without Semaphor, OpenAI, or a
database:

```bash
pnpm insight-loop run examples/weekly-revenue.md \
  --mcp http://localhost:3000/api/mcp \
  --fake \
  --out runs/weekly-revenue.md
```

This writes:

- `runs/weekly-revenue.md`
- `runs/weekly-revenue.evidence.json`
- `runs/weekly-revenue.trace.json`

## Instruction Files

Insight Loop instruction files are intentionally freeform Markdown. The runner
does not require exact headings such as `Goal`, `Questions`, or `Output`.
Those headings are useful authoring guidance only.

The deterministic loader only:

- reads and preserves the raw Markdown
- extracts a best-effort title from the first `#` heading
- keeps freeform text for model context
- performs basic safety/actionability checks

Customer intent is normalized by the configured model before planning. That
normalization infers the objective, questions, business context, requested
breakdowns, time context, output preference, guardrails, delivery intent, and
ambiguities from the full Markdown.

## Real Localhost MCP Connectivity

Start `semaphor-app` locally, then provide a Semaphor project token:

```bash
export SEMAPHOR_PROJECT_TOKEN="..."
```

Or create a local ignored env file:

```bash
cp .env.example .env.local
```

Then edit `.env.local`:

```bash
SEMAPHOR_PROJECT_TOKEN="..."
SEMAPHOR_MCP_URL=http://localhost:3000/api/mcp
SEMAPHOR_MCP_TIMEOUT_MS=60000
INSIGHT_LOOP_RUNNER_HOST=127.0.0.1
INSIGHT_LOOP_RUNNER_PORT=4317
LAMBDA_API_KEY=
INSIGHT_LOOP_MODEL_PROVIDER=fake
INSIGHT_LOOP_MODEL=gpt-5.5
INSIGHT_LOOP_REASONING_EFFORT=medium
OPENAI_API_KEY=
```

Check MCP connectivity:

```bash
pnpm insight-loop context examples/weekly-revenue.md \
  --mcp http://localhost:3000/api/mcp
```

The runner loads `.env` and `.env.local` by default. Prefer env files over
passing `--token`, because package-manager command banners can echo CLI
arguments. To use a different local env file:

```bash
pnpm insight-loop context examples/weekly-revenue.md \
  --env-file .env.customer-a
```

Start the dev workbench:

```bash
pnpm insight-loop dev examples/weekly-revenue.md \
  --mcp http://localhost:3000/api/mcp
```

Useful dev commands:

```txt
/help
/context
/domains
/datasets <domainId>
/schema <datasetName|datasetId|datasetLabel> [domainId]
/connections
/sql <connectionId> <sql>
/tools
/tool <name> <jsonArgs>
/last
/run
/evidence
/artifact
/save [artifact.md|runs]
/reload
/reset
/exit
```

After `/datasets <domainId>`, `/schema` remembers the current domain and can
resolve either the dataset `name`, `id`, or `label` returned by the dataset
list. Passing `domainId` explicitly still works.

`/run` uses the fake model by default. Set `INSIGHT_LOOP_MODEL_PROVIDER=openai`
or pass `--provider openai` to run the OpenAI Agents SDK adapter.

## Direct MCP Smoke Commands

These commands avoid JSON quoting for common workbench tasks:

```bash
pnpm insight-loop domains examples/weekly-revenue.md
pnpm insight-loop datasets examples/weekly-revenue.md <domainId>
pnpm insight-loop schema examples/weekly-revenue.md <datasetName> <domainId>
pnpm insight-loop connections examples/weekly-revenue.md
pnpm insight-loop sql examples/weekly-revenue.md <connectionId> "select 1 as smoke_test limit 1"
```

The SQL command accepts only read-only `SELECT` or `WITH` statements with an
explicit `LIMIT`.

## MCP Observations

- `semaphor_analyze` remains the primary Milestone 4 productization target
  because its schema still exposes internal `cardConfig` and `cardDataSource`
  concepts.
- `semaphor_get_dataset_schema` requires `datasetName` plus `domainId`, while
  `semaphor_list_datasets` returns both dataset `id` and `name`. The workbench
  now resolves name/id/label locally, but the MCP contract should become more
  forgiving for external clients.
- Real MCP tool calls should be run sequentially for smoke validation. Parallel
  CLI invocations can make transport/server timing harder to interpret during
  local development.

## OpenAI Model Run

Milestone 3 can opt into the OpenAI Agents SDK while keeping fake clients for
tests:

```bash
INSIGHT_LOOP_MODEL_PROVIDER=openai pnpm insight-loop run examples/weekly-revenue.md \
  --out runs/openai-weekly-revenue.md
```

Equivalent CLI flags:

```bash
pnpm insight-loop run examples/weekly-revenue.md \
  --provider openai \
  --model gpt-5.5 \
  --reasoning-effort medium \
  --max-tool-calls 6 \
  --out runs/openai-weekly-revenue.md
```

Automated tests use the fake model and fake MCP clients. Real OpenAI runs are
manual validation only.

## PDF And Delivery Dry Run

Use `--pdf` to render a local PDF derivative next to the Markdown artifact.
Markdown remains the canonical artifact; HTML and PDF are rendered outputs for
local review and future delivery.

```bash
pnpm insight-loop run examples/weekly-revenue.md \
  --fake \
  --out runs \
  --pdf
```

Use `--delivery dry-run` to write a delivery preview without sending Slack or
email. When delivery dry-run is enabled, the runner also writes a PDF so the
preview can reference the intended attachment.

```bash
pnpm insight-loop run examples/weekly-revenue.md \
  --fake \
  --out runs \
  --pdf \
  --delivery dry-run
```

This can write:

- `runs/<timestamp>-weekly-revenue.md`
- `runs/<timestamp>-weekly-revenue.html`
- `runs/<timestamp>-weekly-revenue.pdf`
- `runs/<timestamp>-weekly-revenue.evidence.json`
- `runs/<timestamp>-weekly-revenue.trace.json`
- `runs/<timestamp>-weekly-revenue.delivery.json`
- `runs/<timestamp>-weekly-revenue.manifest.json`

The Markdown artifact includes a `Queries Run` section that summarizes query
evidence. Evidence entries for query-bearing MCP calls include the query path,
selected domain/dataset/connection, row-limit metadata, bounded result samples,
canonical analytics intent metadata returned by `semaphor_analyze` when
available, and SQL returned by Semaphor MCP when available. Evidence output must not
include project tokens, bearer tokens, connection credentials, delivery provider
secrets, or unbounded raw result payloads. Trace output is intentionally
full-fidelity for V1 debugging and quality improvement: every Semaphor MCP
tool call event includes the tool request, full tool response, duration, and
the evidence entry derived from that response so an improvement agent can
replay the run and evaluate agent behavior against the data it actually saw.
Trace output still must not include the raw runtime token.

The manifest records the run id, title, status, model metadata, MCP URL, query
path, delivery plan, output file paths, and file sizes. This is the local shape
to evolve into a future `semaphor-app` callback payload.

When a query tool fails, the evidence ledger adds compact recovery hints where
possible. For example, an invalid `semaphor_analyze` metric includes the
invalid field and a recommended next step to retry with exact fields from the
schema summary or switch to bounded read-only SQL. Dataset schema evidence also
includes a concise `schemaSummary` with metric, date, dimension, and calculated
field candidates so the planner does not need to infer from raw schema JSON.

## Productized Briefings Service Mode

`pnpm insight-loop serve` is the local service mode used by Semaphor App's
productized Briefings backend. It accepts the Semaphor App runner payload,
validates it, writes the Briefing instruction to a temporary Markdown file,
runs the existing `runInsightLoop(...)` runtime, and calls the provided
complete/fail callback URL with the provided callback auth header.

The service does not claim schedules, read Semaphor Postgres, send Slack/email,
store productized artifacts directly, or run a separate agent loop. Semaphor App
remains the control plane for run records, callbacks, artifact persistence, and
authorization.

Callback results are intentionally bounded and inspectable:

- successful callbacks include a Markdown or HTML report artifact
- failed callbacks include a terminal failure reason and failure Markdown
- evidence includes query/tool provenance, SQL when returned by MCP, row limits,
  truncation signals, result samples, and limitations
- evidence and limits are redacted before callback delivery
- trace is sent in a versioned `BRIEFING_RUN_TRACE` envelope with the decoded
  token payload and without the raw runtime token

## Report Composition And Theme Hooks

The runner builds a structured `ReportPlan` before rendering Markdown, HTML, or
PDF. That plan is the future customization seam:

- business blocks: findings, KPI summaries, comparison charts, and driver/result
  tables
- appendix blocks: evidence entries, query summaries, and SQL
- delivery blocks: normalized delivery intent for dry-run previews

The current implementation derives business blocks from Semaphor evidence, then
lets the configured model compose the presentation by selecting existing block
IDs and optional business-language section titles. The model cannot alter raw
values, rows, SQL, or evidence; the runner appends the evidence/query/SQL
appendix automatically. This lets customer instructions such as "show the main
movement as a chart and the top drivers as a table" affect report shape without
changing delivery code or weakening provenance.

HTML/PDF rendering also accepts a report theme hook with brand name, logo URL,
colors, typography, page sizing, and chart palette. Local defaults are used for
now; customer-managed templates and embedded UI controls are intentionally left
for a later productized artifact phase.

## Driver Analysis Smoke Run

Use this when you want to validate the end-to-end agent loop against localhost
MCP, including semantic discovery, schema inspection, `semaphor_analyze`, and
positive/negative driver output. This command reads `SEMAPHOR_PROJECT_TOKEN`,
`SEMAPHOR_MCP_URL`, and `OPENAI_API_KEY` from `.env.local`.

For browser review, prefer one stable output directory so all generated files
live under the same tree and can be removed together:

```bash
pnpm insight-loop run examples/weekly-revenue.md \
  --provider openai \
  --model gpt-5.5 \
  --reasoning-effort medium \
  --max-tool-calls 8 \
  --out out \
  --pdf \
  --delivery dry-run \
  --verbose
```

`--out out` creates timestamped files, for example:

- `out/20260504-125627-777-weekly-revenue.md`
- `out/20260504-125627-777-weekly-revenue.html`
- `out/20260504-125627-777-weekly-revenue.pdf`
- `out/20260504-125627-777-weekly-revenue.evidence.json`
- `out/20260504-125627-777-weekly-revenue.trace.json`
- `out/20260504-125627-777-weekly-revenue.delivery.json`
- `out/20260504-125627-777-weekly-revenue.manifest.json`

Remove the whole local review tree when it gets noisy:

```bash
rm -rf out
```
