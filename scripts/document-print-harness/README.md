# Document print harness

Prints react-semaphor's Document print dev page (synthetic rows, no app, no
database) through the PDF worker's own Document code, records how long each
stage took, reads every PDF back, and says whether each run showed what its
case expects. Built for the
[Document PDF reliability plan](../../../semaphor-app/docs/implementation-plans/document-pdf-reliability/PLAN.md),
where it reproduced the production failure and found three defects no test
had caught.

**Use it before building any other PDF or Document test rig.** If your case
is not covered, extend this one: add a dataset, failure or variant to the page,
its expectation to `cases.mjs`, a check to `check-pdf.py`. One harness, not a
copy per task.

Use it for Document print, readiness, pagination or PDF performance work, as a
before-and-after check on a change, and to measure memory under the Lambda's
4096 MB cap. It is development tooling: it lives outside `pdf-generation/`, so
nothing here is deployed.

## How a run works

1. **Build the page.** A production build of
   `react-semaphor/document-print-dev.html` (see its
   [README](../../../react-semaphor/src/dev/document-print/README.md)), as the
   print route runs one. The page draws a real Document with the package's own
   code; a fetch shim inside it answers every API call with generated rows
   numbered `R00001` upward.
2. **Open it in Chrome.** Desktop Chrome with the worker's Lambda flags (less
   three macOS cannot start with), or with `--lambda` the production Chromium
   inside the Lambda base image. The page is served by request interception: no
   server, no port, and any request to another host is refused.
3. **Run the worker's own steps.** `worker-run.mjs` imports the worker's
   `lib/modes/document.js`, `lib/page-setup.js` and `lib/pdf-generator.js` and
   runs navigation, readiness, the capacity check before printing
   (`assertCaptureWithinCapacity` on `readDocumentDimensions`: a Document over
   the PDF page cap, 300 pages, is refused by its page count, as a download
   refuses it; the page itself refuses first, with `document_page_limit_exceeded`),
   preparation and print exactly as `generatePdf` does for a Document, with
   the worker's own deadlines. Nothing is re-implemented. `--limits lifted`
   skips the check, to measure a print it would refuse.
4. **Measure.** On the desktop: stage timings, React commits, printed slice
   mounts (per 500-row measuring step), time spent in page-text reads, a
   150 ms sample of the page's markers, and Chrome's memory. In the Lambda
   image: stage timings and the container's memory every 250 ms.
5. **Check the PDF.** `check-pdf.py` reads it back: every row id once and in
   order, a correct "Page N of M" on every page, the last column on every page
   (nothing clipped), no hidden column printed.
6. **Judge.** Each case expects either a complete PDF or a print failure code
   (`cases.mjs`), and the run is reported `PASS`, `FAIL` or `ERROR`. The exit
   code is 1 when any run failed.

## Before you start

- `npm install` in `pdf-generation/` and in `../react-semaphor`.
- The worker's generated adapters: `npm run build:pdf-shared:local` from this
  repo's root (the PDF worker's `pretest` also builds them).
- Desktop Chrome: the macOS app by default; elsewhere pass `--chrome` or set
  `CHROME_PATH`.
- For the PDF check: `python3` with `pypdf` (`pip install pypdf`). Without it
  runs still report, unchecked.
- For `--lambda`: Docker and the image
  `public.ecr.aws/lambda/nodejs:22-x86_64` (`docker pull` it yourself; the
  harness never downloads anything).

## Run it

From this repo's root:

```bash
node scripts/document-print-harness/run.mjs --suite smoke
```

| Command | What it shows |
| --- | --- |
| `--suite smoke` | The harness and the print path work: one print, one forced failure |
| `--suite prints` | Every dataset and layout variant prints complete |
| `--suite failures` | Every forced failure stops with its code (`stall` waits out the 120 s deadline) |
| `--dataset rows-10000 --cpu 4 --runs 3` | Timings on a CPU slowed four times, three runs |
| `--dataset wrapped-278 --failure stall` | The worker's deadline, with the layout stage it reached |
| `--lambda --dataset rows-10000 --runs 2` | Memory under the 4096 MB cap, a cold run then a warm one |
| `--keep-pdf` | Keeps each PDF next to its result, to open it |
| `--help` | Every option |

**Compare with `main`.** Make a worktree of each repo at `main`, run
`npm install` in its `pdf-generation/` (and the adapter build) or its root,
then point the runner at it:

```bash
node scripts/document-print-harness/run.mjs --worker ../scheduler-main/pdf-generation
```

```bash
node scripts/document-print-harness/run.mjs --react-semaphor ../react-semaphor-main
```

The runner adapts to an older worker (one without the single ready deadline or
the print budget).

## Reading the results

Each run prints one line, for example:

```text
PASS   wrapped-278-1 · ready 5.9 s from start · print 4.2 s (limit 174.1 s) · 280 pages · 9.4 MB · rows complete, labels ok, last column on every page · desktop RSS 2353 MB
PASS   wrapped-278-query-1 · stopped at 2.9 s: document_section_query_failed {"sectionId":"register","sectionTitle":"Register"} · layout stage laidOut · desktop RSS 985 MB
PASS   wrapped-278-query-lambda-1 · stopped at 4.8 s: document_section_query_failed {"sectionId":"register","sectionTitle":"Register"} · layout stage checking · memory peak 681 MB (own 401 MB) of 4096 MB
```

Everything is kept in `out/runs/<time>/` (git-ignored): one JSON per run, the
worker's log for it, and `summary.json` with the commits and the environment.
A run's JSON holds:

- `timings`: `launchMs`, `navigationMs`, `readyMs`, `readyFromStartMs` (the
  worker's clock starts before the browser launches);
- `layout`: the page's own layout record (stage, rows measured, total rows,
  pages);
- `readyError`: the print failure code, its facts and the described message;
- `pdf`: size, print time and the print limit the worker gave it;
- `check`: the PDF check;
- desktop only: `counters` (commits, `pageSliceMounts`, `stepMounts`,
  text-read timings, `changes`), `peakRssMb`, `peakFootprintMb` and
  `peakFootprintByKindMb` (macOS private memory, see below), `pageErrors`,
  `blockedHosts`;
- `--lambda` only: `peakMemoryMb` (the container's memory, page cache
  included), `peakAnonMb` (the processes' own), `cgroupPeakMb` (the
  container's high-water mark so far), `limitMb`, `warm`.

## What it can and cannot tell you

- **The data is synthetic.** It is one shape per dataset, not a customer's
  Document. A failure on a real Document still needs that Document.
- **The fonts are fallbacks.** The dev pages load no web font, so the report
  font (Open Sans first) falls back to Arial on a Mac and to a wider font on
  the Lambda, while production's print view loads Open Sans. Page counts of
  wrapped text can differ from production by a few percent: `wrapped-278`
  plans 300 pages on a Mac and 325 on the Lambda (PDF capacity contract
  ledger CO-02).
- **Desktop timings bracket a Lambda; they do not measure one.** A Mac's CPU is
  faster, Chrome runs several processes, and three flags are off. `--cpu 2` and
  `--cpu 4` are rough stand-ins for a slower CPU.
- **The Lambda image gives memory, not time, on Apple silicon.** The x86_64
  image runs emulated, many times slower, so on an arm64 host the runner lifts
  the time limits (`--limits lifted`) and navigates to DOMContentLoaded.
  Memory there is meaningful, but only for cases that get through: on
  2026-10-24 the 280-page case never got past the page's first load in over
  ten minutes on Apple silicon (the renderer busy, memory flat near 1 GB;
  ledger P4-07), while a forced failure stops early and works. So on an arm64
  host use `--lambda` for small and failing cases; a large case's memory needs
  an x86_64 host or a real Lambda. On an x86_64 host it runs natively with the
  worker's limits, but the CPU is still not a Lambda's. Only a real Lambda
  measures Lambda time.
- **Desktop memory is diagnostic.** `peakRssMb` is the resident memory of
  Chrome's process tree, which counts shared pages once per process. On macOS
  `peakFootprintMb` is each process's private footprint summed (the `footprint`
  tool, never its summary line, which would double the total): the closer
  stand-in for a Lambda, where everything runs in one process under one cap.
  It is still a Mac's allocator and GPU, not a Lambda's.
- **The app is not exercised.** The export dialog, scheduled deliveries and
  Briefing attachments need a non-production app. Never point anything at the
  app on `localhost:3000`: it reads the production database.
- **Keep the browser in front.** Opened by hand in a browser tab that is in
  the background, the page's measuring walk can stall (animation frames are
  throttled). The runner's headless Chrome is unaffected.

## Reference results, 2026-10-24

What the Document PDF reliability plan measured with this page, so a later run
has something to compare against (ledger P4-04 to P4-10). Since 2026-10-26 a
word wider than its cell breaks inside the cell in print (PDF capacity
contract ledger P0-03), so the measuring layer and the pages use the same
column widths: `wrapped-278` now plans 300 pages on desktop and
`kpi-and-table` 152. `rows-7500` (about 290 pages, near the PDF page cap)
printed in 14 s at 3.8 GB private memory on desktop. The `long-words` variant
puts an unbreakable reference in some notes; `diagnose-page-overflow.mjs`
compares an overflowing page's rows and columns with the measuring layer's. Desktop is Chrome
155 on Apple silicon; x2 and x4 are `--cpu 2` and `--cpu 4`.

| Case | Ready | Print | PDF | Private memory |
| --- | --- | --- | --- | --- |
| `wrapped-278` (280 pages), x1 | 3 to 5 s | 3 to 4 s | 9.8 MB | 1.3 GB (renderer 1.0 GB) |
| `wrapped-278`, x4 | 8 to 10 s | 9 to 14 s | 9.8 MB | |
| `rows-10000` (385 pages), x1 | 9 s | 19 to 21 s | 41 MB | 4.3 to 4.7 GB (renderer 3.6 GB) |
| `rows-10000`, x2 | 17 s | 34 s | 41 MB | |
| `rows-10000`, x4 | 32 to 58 s | 69 to 82 s | 41 MB | |

- The 10,000-row print times above ran with the size guard skipped (the
  harness did not run it then). Those 385 pages are now over the PDF page cap
  (PDF capacity contract PC-D3): the page refuses them before any page mounts
  (`document_page_limit_exceeded`, about 5 s, 1 GB), and `prints` expects it.
- At x4 the 10,000-row print overran the old fixed 60 s print limit every
  time; the worker now gives the print what readiness left of its 120 s
  deadline plus 60 s (`documentPrintTimeoutMs`), and it completes.
- Memory climbs during the print, not the layout: about 2.4 GB at ready, 4.7 GB
  just before the 10,000-row PDF is done. That is the open risk on a 4096 MB
  Lambda, unmeasured there as of this date.
- Every forced failure stops with its code in 0.5 to 2.7 s; `stall` ends at
  the 120 s deadline with its layout stage.
- Before the plan's changes the same page remounted every printed slice on
  each 500-row measuring step (1,113 mounts for 279 pages, 6,237 for 385) and
  missed the deadline at x4: the production failure (ledger P0-03, P0-04).

## Measuring on a real Lambda

`aws.mjs` prints on a real Lambda set up as the production PDF worker is
(`GeneratePdfFunction`: Node 22, x86_64, 6144 MB, 300 s, 2048 MB of `/tmp`, its
qpdf layer). It covers every PDF mechanism, not only Documents: the structured
fast path, a Table card's rendered path, Documents and the all-sheets PDF,
plain and encrypted. It was built for the
[PDF capacity contract](../../../semaphor-app/docs/implementation-plans/pdf-capacity-contract/PLAN.md),
whose ledger (Phase 0) holds the measurements so far.

**Use it** for any change that can move a PDF's memory, time or limits: the
worker's memory or disk, a row or page limit, a print path, Chrome flags,
encryption, a large-print layout. It is the only way to measure Lambda time,
and the only way to measure large cases' memory from Apple silicon. Use the
desktop and Lambda-image runs above first for correctness; come here for
numbers that decide something.

**Before you deploy, ask Rohit.** The stack, `semaphor-pdf-capacity-measure`
in `us-east-1`, is separate from production but lives in the production
account. It holds one function (`aws/template.yaml`) and has no Function URL,
bucket, app URL, API key or other secret. Each case makes its own synthetic
rows and serves the dev pages from inside the function; Chrome resolves only
their host. Every SAM command runs from `aws/` with `aws/samconfig.toml`, so
the repository root's `samconfig.toml` (the production stack) is never read;
the only production call is a read of the production stack's resource list,
for its qpdf layer version (never the function's configuration, which carries
its environment).

**Deploy it to measure, delete it when done.** Idle, it costs nothing worth
counting: Lambda bills per invocation, and the code in SAM's bucket and the
log group cost under a cent a month. But a deployed function runs whatever
was last built, so a copy left standing invites measuring stale code. Build
and deploy right before you measure, then `delete`, which removes the stack
and the function's log group. When production's `GeneratePdfFunction` changes
size, runtime or layer, change `aws/template.yaml` with it.

```bash
node scripts/document-print-harness/aws.mjs build
```

```bash
node scripts/document-print-harness/aws.mjs smoke
```

```bash
node scripts/document-print-harness/aws.mjs deploy
```

```bash
node scripts/document-print-harness/aws.mjs run --suite capacity
```

```bash
node scripts/document-print-harness/aws.mjs delete
```

| Command | What it does |
| --- | --- |
| `build` | Builds the dev pages, the worker's adapters from the local react-semaphor, and copies the worker with its installed production packages (nothing downloaded) into `out/aws/function`. The copy's row limit is lifted so a table past it is measured; the repository's worker is unchanged. `--lift-page-cap` also lifts the dev pages' page cap, to measure a Document past it. |
| `smoke` | Runs two small cases in the local Lambda image: proves the function boots. Emulated on Apple silicon, so its numbers are not used. |
| `deploy` | `sam deploy` of the measurement stack (Docker not needed: the function is already built). Run it again after a `build` to measure changed code. |
| `run` | Invokes each case: `--cold` runs on a new sandbox each (it changes one variable on the measurement function), then `--warm` runs. One line per run, a heartbeat every 10 s, everything in `out/aws-runs/<time>/results.json`. |
| `memory <MB>` | Sets the measurement function's memory, to find where a case fits; `deploy` restores the template's size. |
| `delete` | `sam delete` of the measurement stack, then its function's log group. |

The cases and suites are in `capacity.mjs`:

| Suite | What it runs |
| --- | --- |
| `smoke` | A small fast-path table and a small rendered card table. |
| `capacity` | Phase 0's envelope: the fast path (narrow rows to 10,000, wide rows at 1,000), the rendered card path at 5,000 and 10,000 rows, Documents of 280 and 385 pages and of 5,000 to 10,000 short rows, the all-sheets PDF plain and encrypted. |
| `page-cap` | The page cap: a 4,000-row card prints; 1,000 wide rows and a 385-page Document are refused. |
| `documents` | Wrapped and mixed Documents and the all-sheets PDF. |
| `document-rows` | A Document's memory between 5,000 and 6,000 short rows. |
| `memory` | The cases that failed or ran close at 4096 MB, for `memory <MB>` runs. |

Each line gives `Max Memory Used` from the invocation's REPORT line (the
authoritative peak), the init time on a cold run, the duration, pages, bytes,
and for the fast path the request size against its 2.5 MiB cap. A navigation
that times out is reported as a failure, never as a print. To add a case, add
it to `CAPACITY_CASES` (a dataset of the Document or card print dev page, or a
fast-path request) and to a suite.

## Compare with production (read-only)

To see how real Document PDFs behave, before or after a release, read the PDF
worker's Lambda logs with CloudWatch Logs Insights. Read only: run queries,
change nothing, and copy numbers, never log messages (they can hold customer
text). Log group: `/aws/lambda/semaphor-report-scheduler-GeneratePdfFunction-y0N8a0UrXnw4`
(`us-east-1`). This query gives, per Document invocation, the print time, PDF
size and peak memory; add a final `stats` line for percentiles:

```text
parse @message /\t(?<rid>[0-9a-f-]{36})\t(INFO|WARN|ERROR)\t(?<msg>.*)/
| parse @message /REPORT RequestId: (?<rrid>[0-9a-f-]{36}).*Max Memory Used: (?<maxMem>\d+) MB/
| parse msg /PDF generation: (?<pdfMs>\d+)ms/
| parse msg /PDF Buffer Size: (?<bytes>\d+)/
| fields coalesce(rid, rrid) as id, strcontains(msg, "Document mode - using CSS page size") as isDoc
| filter ispresent(id)
| stats max(isDoc) as doc, max(pdfMs) as pdf_ms, max(bytes) as pdf_bytes, max(maxMem) as max_mem_mb by id
| filter doc = 1
```

Baseline for the 30 days to 2026-10-24, before the plan's release (ledger
P4-03): 816 Document invocations, 608 printed; print time p50 0.33 s, p95
4.7 s; PDF p50 184 KB, max 5.5 MB; peak memory p50 802 MB, p95 1,192 MB. 99
failed readiness as "blocking section errors" and 14 as "still showed loading
content", the two failures the plan removes. After a release, a new worker logs
`document_print_timed_out` and the other print failure codes instead.

## Extending it

- **A new data shape, failure or layout variant:** add it to
  `react-semaphor/src/dev/document-print/__fixtures__/document-print-fixtures.ts`
  (its README says how),
  then its expected rows (`DATASET_ROWS`) or code (`FAILURE_CODES`,
  `VARIANT_CODES`) to `cases.mjs`. The runner compares each print with the
  page's own row count, so a fixture change that `cases.mjs` misses fails
  loudly.
- **A new check on the PDF:** add it to `check-pdf.py` and to `ok` there.
- **A new set of cases:** add a suite to `SUITES` in `cases.mjs`.
- **A new measurement in the page:** add it to `instrumentation()` in
  `desktop.mjs`.

## Files

| File | Job |
| --- | --- |
| `run.mjs` | The command: options, preflight, page build, runs, checks, verdicts |
| `cases.mjs` | Datasets, failures, variants, suites and what each must show |
| `worker-run.mjs` | One print through the worker's own Document steps (desktop and Lambda) |
| `desktop.mjs` | A desktop Chrome run with the page's counters |
| `lambda-entry.mjs` | Runs inside the Lambda image: the worker's own launch, memory sampling |
| `serve-page.mjs` | Serves the built page by request interception |
| `page.vite.config.mjs` | The production build of the dev page |
| `check-pdf.py` | Reads a PDF back and checks it |
| `capacity.mjs` | The real-Lambda measurement's cases and the fast-path request they send |
| `aws.mjs` | The real-Lambda measurement: build, smoke, deploy, run, delete |
| `aws/handler.mjs` | The measurement function: one case per invocation, through the worker's own code |
| `diagnose-page-overflow.mjs` | On an overflowing page: its rows, columns and fonts against the measuring layer's |
| `aws/template.yaml`, `aws/samconfig.toml` | The measurement stack, with its own SAM settings |

For a quick look at a real URL instead, `pdf-generation/test-local.js` prints
one page through the worker.
