# PDF & CSV Generation Service

A serverless file generation service that converts web pages to PDFs or exports tables to CSV using AWS Lambda and Puppeteer.

## Key Features

### Two Types of PDF Generation

1. **Dashboard PDF**: Captures entire dashboard as a single continuous PDF page

   - Expands all scrollable containers
   - Preserves exact dashboard layout
   - Ideal for dashboard snapshots and visual reports

2. **Table PDF**: Paginated PDF specifically for tables
   - Automatic pagination with page breaks
   - Repeated headers on each page
   - Professional margins and formatting
   - Supports data tables, pivot tables, and aggregated tables

### CSV Export

- Extract formatted table data preserving all UI formatting
- Maintains number formats, currency symbols, dates, percentages
- Respects column visibility and ordering
- Includes subtotals and grand totals

### Additional Features

- **Password Protection**: Optional PDF encryption for both dashboard and table PDFs
  - Protects sensitive data with industry-standard encryption
  - Available for direct API calls (not scheduled reports)
  - Pass password as query parameter
- **Watermark Support**: Add diagonal watermark text across PDF pages
  - Fixed watermarks for paginated tables (repeats on each page)
  - Tiled watermarks for dashboard exports (pattern across entire page)
  - Configurable via project settings or per-export
- **Header Logo**: Add organization logo at the top of PDFs
  - Rendered from URL in the view component
  - Automatically included when enabled in project settings
- **Multiple Page Sizes**: A4, Letter, Legal, Tabloid, A3, A5
- **Orientation Support**: Portrait or Landscape

## Quick Start - Local Testing

### Install Dependencies

```bash
cd pdf-generation
npm install
```

For encrypted PDF work with the Node-based local harness, install `qpdf` on your
machine:

```bash
brew install qpdf
```

### Automated Tests

```bash
# run all automated tests
npm test

# watch mode
npm run test:watch

# targeted suites
npm run test:wide-layout
npm run test:subtotal-grouping
npm run test:path-safety
```

Manual smoke/performance scripts are kept under `scripts/manual/`:

```bash
npm run manual:test-validation
npm run manual:test-performance -- <url> <iterations>
```

### Encrypted PDFs

Password-protected PDFs use `qpdf` by default.

For local development, install `qpdf` once with `brew install qpdf`.
If `qpdf` is on your shell `PATH`, no extra environment variables are needed.
Use `PDF_ENCRYPTION_BACKEND=pdf-lib` only if you need to force the legacy fallback.

### End-to-End Local (Frontend -> semaphor-app -> Unified Export Runner)

Use this mode to test PDF and CSV export behavior from the real UI without
deploying Lambda, Step Functions, or S3.

1. The first time only, create the dedicated local-only environment file. Do
   not reuse the scheduler's general `.env`, which may point to production:

```bash
cd /Users/rohit/code/semaphor/semaphor-report-scheduler
cp .env.local-export-runner.example .env.local-export-runner
# Edit only LAMBDA_API_KEY so it matches local semaphor-app.
```

After that, startup is one command:

```bash
npm run local:export-runner
```

This one command builds the production chunk, compaction, and failure handlers
before starting the HTTP runner at `http://127.0.0.1:3002`.

For the normal edit-test loop, use:

```bash
npm run local:export-runner:watch
```

The watch command first performs the same clean worker builds. It then watches
the chunk, compaction, and failure TypeScript projects and restarts the runner
when their compiled output or PDF/runner JavaScript changes. You do not need to
stop, rebuild, or coordinate those processes yourself.

Do not edit scheduler code while a chunked export is actively running. A watch
restart interrupts that local in-memory orchestration; wait for it to finish,
or retry the export after the runner restarts. This local-only workflow does
not add production-style recovery machinery.

2. Point semaphor-app at the runner and restart the app server:

```bash
# in /Users/rohit/code/semaphor/semaphor-app/.env.local
LOCAL_EXPORT_RUNNER_URL=http://127.0.0.1:3002
```

`LOCAL_EXPORT_RUNNER_URL` takes precedence over both `PDF_FUNCTION_URL` and
`EXPORT_STATE_MACHINE_ARN`. You do not need AWS credentials or an S3 bucket for
this workflow.

3. Run the frontend and semaphor-app as usual:

- frontend: `http://localhost:5173`
- backend: `http://localhost:3000`

4. Trigger exports from the existing UI.

| UI request | Local behavior |
| --- | --- |
| PDF or Fast PDF | Semaphor App sends it to the runner's existing GET/POST renderer |
| Direct CSV at or below the shared direct limit | Remains in the browser/app; no worker is necessary |
| Full-dataset CSV above the direct limit | App creates the real job and chunks, then posts the production Step Functions input to `/exports` |
| Chunk processing | The runner invokes the production chunk handler against local semaphor-app and the configured Python data service |
| Compaction and completion | The production compaction/callback handlers run; files use local storage and the normal notification/download UX |

The runner is asynchronous for chunked exports: `/exports` acknowledges the
job immediately, while progress continues through the existing app APIs. You
can start several visual exports; each has its own app job and runner execution.
The stored artifact remains the production-shaped `export.csv.gz`; the local
download endpoint streams it as `export.csv` so Finder does not depend on
macOS Archive Utility's gzip compatibility. Transient chunk failures match
production's initial attempt plus three retries, but omit production backoff
delays to keep the local feedback loop fast. An HTTP 400 query rejection is
not retryable and fails after its first attempt locally and in production.

5. Inspect the runner:

```bash
curl http://127.0.0.1:3002/health
```

Generated artifacts default to:

```bash
$TMPDIR/semaphor-pdf-local-function
```

Override the location when starting the runner:

```bash
LOCAL_EXPORT_OUTPUT_DIR=/your/path \
npm run local:export-runner
```

The same override works with `npm run local:export-runner:watch`.

The runner binds only to `127.0.0.1`. Chunked job submission requires the
shared internal API key, and local artifact links are short-lived and signed.
The runner also refuses to start unless `SEMAPHOR_APP_URL` is an HTTP loopback
URL, preventing the local harness from querying a hosted environment.

#### Scope of this local harness

This is the canonical local UI export harness. It
supports:

- URL-rendered dashboard, visual, and table PDF through `GET`;
- URL-rendered table CSV extraction through `GET`; and
- structured-data Fast PDF generation through `POST`;
- production chunk-handler query/formatting behavior;
- production compaction, completion, failure, notification, and download
  behavior; and
- local equivalents for Step Functions orchestration and S3 object storage.

It deliberately does not test AWS IAM, Lambda packaging, Step Functions service
semantics, S3 permissions, or deployed network reachability. Use production-
shaped builds and a deployed smoke test when those AWS boundaries are under
review.

Recommended local encrypted-PDF workflow:

```bash
brew install qpdf
cd /Users/rohit/code/semaphor/semaphor-report-scheduler
npm run local:export-runner
```

If `qpdf` is not on your shell `PATH`, use:

```bash
QPDF_BIN="$(which qpdf)" npm run local:export-runner
```

If you need to force the legacy fallback:

```bash
PDF_ENCRYPTION_BACKEND=pdf-lib npm run local:export-runner
```

Then in `semaphor-app`:

```bash
# /Users/rohit/code/semaphor/semaphor-app/.env.local
LOCAL_EXPORT_RUNNER_URL=http://127.0.0.1:3002
```

Restart `semaphor-app`, trigger an encrypted PDF export from the UI, and inspect
the generated file in Chrome PDF viewer and macOS Preview.

### Command Line Interface

The test script uses named flags for clarity:

```bash
node test-local.js --url <url> [options]
```

**Options**:

| Flag                  | Description                                             | Default    |
| --------------------- | ------------------------------------------------------- | ---------- |
| `--url <url>`         | URL to convert (required)                               | -          |
| `--format <type>`     | Output format: `pdf` or `csv`                           | `pdf`      |
| `--visual`            | Single visual export mode (fits chart to one page)      | -          |
| `--orientation <dir>` | PDF orientation: `portrait` or `landscape`              | `portrait` |
| `--page-size <size>`  | PDF page size: `A4`, `Letter`, `Legal`, `A3`, `Tabloid` | `A4`       |
| `--table`             | Table mode (paginated PDF)                              | -          |
| `--password <pwd>`    | PDF password protection                                 | -          |
| `--delimiter <char>`  | CSV delimiter: `comma`, `semicolon`, `tab`              | `comma`    |
| `--watermark <text>`  | Add diagonal watermark text to PDF                      | -          |
| `--header-logo <url>` | Add header logo to PDF (image URL)                      | -          |
| `--help`, `-h`        | Show help                                               | -          |

### Test Visual PDF Export

```bash
# Visual export - landscape Letter (single page, chart fills page)
node test-local.js --url "http://localhost:5173/?isPdfRender=true" --visual --orientation landscape --page-size letter

# Visual export - portrait A4
node test-local.js --url "http://localhost:5173/?isPdfRender=true" --visual --page-size a4

# Visual export - landscape A4
node test-local.js --url "http://localhost:5173/?isPdfRender=true" --visual --orientation landscape
```

### Test Dashboard PDF Export

```bash
# Dashboard export (default mode - single continuous page)
node test-local.js --url "http://localhost:5173/?isPdfRender=true"

# Dashboard with password protection
node test-local.js --url "https://example.com/dashboard" --password "secret123"
```

### Test Table PDF Export (Paginated)

```bash
# Table with Letter size pages
node test-local.js --url "https://example.com/table" --table --page-size letter

# Table with A4 pages in landscape
node test-local.js --url "https://example.com/table" --table --page-size a4 --orientation landscape

# Table with password protection
node test-local.js --url "https://example.com/table" --table --password "mypassword"
```

### Test CSV Export

```bash
# Basic CSV export
node test-local.js --url "https://example.com/table" --format csv

# CSV with semicolon delimiter (for Excel in some locales)
node test-local.js --url "https://example.com/table" --format csv --delimiter semicolon

# CSV with tab delimiter
node test-local.js --url "https://example.com/table" --format csv --delimiter tab
```

### Test Watermark and Header Logo

```bash
# PDF with watermark text
node test-local.js --url "http://localhost:5173" --watermark "CONFIDENTIAL"

# Visual export with watermark
node test-local.js --url "https://example.com/visual?isPdfRender=true" --visual --watermark "DRAFT"

# Table PDF with watermark (fixed watermark repeats on each page)
node test-local.js --url "https://example.com/table?isPdfRender=true" --table --watermark "INTERNAL USE ONLY"

# PDF with header logo
node test-local.js --url "https://example.com/dashboard?isPdfRender=true" --header-logo "https://example.com/logo.png"

# Combined: watermark + header logo
node test-local.js --url "https://example.com/dashboard?isPdfRender=true" --watermark "CONFIDENTIAL" --header-logo "https://example.com/logo.png"

# Visual export with both features
node test-local.js --url "https://example.com/visual?isPdfRender=true" --visual --orientation landscape --watermark "DRAFT" --header-logo "https://cdn.example.com/company-logo.png"
```

**Watermark Notes**:

- Watermark appears as diagonal text across the page
- For paginated tables (`--table`), watermark uses fixed positioning (repeats on each page)
- For dashboard/visual exports, watermark uses tiled SVG pattern (covers entire page)
- Watermark is semi-transparent (15% opacity) to not obscure content

**Header Logo Notes**:

- Logo URL must be publicly accessible (or accessible from the rendering environment)
- Logo appears at the top of the PDF before the main content
- Maximum height is constrained to maintain document layout
- For local testing, you can use any publicly accessible image URL

**Password Protection Notes**:

- Works with dashboard, visual, and table PDFs
- Generated PDFs require password to open, print, or copy content
- Uses `qpdf` by default
- Legacy fallback: `PDF_ENCRYPTION_BACKEND=pdf-lib`

## SAM Deployment

### Prerequisites

- AWS CLI configured with appropriate credentials
- SAM CLI installed
- Docker installed (for building with container)

### Build and Deploy

```bash
# Build with container (required for Lambda layers)
sam build --use-container

# Deploy with confirmation prompts
sam deploy

# Deploy without confirmation (CI/CD friendly)
sam deploy --no-confirm-changeset

# Combined build and deploy without confirmation
sam build --use-container; sam deploy --no-confirm-changeset

# Deploy with specific stack name and region
sam deploy --stack-name pdf-generation-prod --region us-east-1
```

### Running Lambda Locally with SAM

```bash
# Run with event.json
sam local invoke GeneratePdfFunction --event event.json

# Run with inline event
echo '{"queryStringParameters":{"url":"https://example.com","format":"csv"}}' | sam local invoke GeneratePdfFunction

# Run with Docker network (if your URL is on localhost)
sam local invoke GeneratePdfFunction --event event.json --docker-network host
```

### Testing Lambda Locally with Output

```bash
# Generate PDF and save output
sam local invoke GeneratePdfFunction --event event.json > raw.log

# Extract PDF from log (for PDF format)
cat raw.log | jq -r '.body' | jq -r '.url' | xargs curl -o output.pdf

# For direct binary output (older method)
cat raw.log | jq -r '.body' | tr ',' '\n' | awk '{printf "%c", $1}' | xxd -r -p > output.pdf
```

### Sample event.json Files

#### For CSV Generation

```json
{
  "queryStringParameters": {
    "url": "https://example.com/table",
    "format": "csv",
    "delimiter": ",",
    "scheduleId": "sched_123",
    "attachmentMetadata": "{\"name\":\"Sales Report\",\"attachmentIndex\":0,\"totalAttachments\":1}"
  }
}
```

#### For Dashboard PDF (Single Page)

```json
{
  "queryStringParameters": {
    "url": "https://example.com/dashboard",
    "format": "pdf",
    "tableMode": "false",
    "pageSize": "Letter",
    "orientation": "landscape",
    "password": "optional-password",
    "scheduleId": "sched_123"
  }
}
```

#### For Table PDF (Paginated)

```json
{
  "queryStringParameters": {
    "url": "https://example.com/table",
    "format": "pdf",
    "tableMode": "true",
    "pageSize": "A4",
    "orientation": "portrait",
    "scheduleId": "sched_123",
    "reportTitle": "Monthly Sales Report"
  }
}
```

#### For PDF with Watermark and Header Logo

```json
{
  "queryStringParameters": {
    "url": "https://example.com/dashboard",
    "format": "pdf",
    "pageSize": "Letter",
    "orientation": "landscape",
    "watermarkEnabled": "true",
    "watermarkText": "CONFIDENTIAL",
    "headerLogoUrl": "https://example.com/logo.png",
    "scheduleId": "sched_123"
  }
}
```

### SAM Template Configuration

The service is configured in `template.yaml` with:

```yaml
GeneratePdfFunction:
  Type: AWS::Serverless::Function
  Properties:
    CodeUri: pdf-generation/
    Handler: app.handler
    Runtime: nodejs22.x
    MemorySize: 4096 # Required for Puppeteer
    Timeout: 300 # 5 minutes for complex pages
    Environment:
      Variables:
        S3_BUCKET_NAME: !Ref S3Bucket
        API_URL: https://semaphor.cloud
```

### Debugging SAM Deployments

```bash
# View CloudFormation stack events
sam logs -n GeneratePdfFunction --stack-name semaphor-report-scheduler --tail

# View specific execution logs
sam logs -n GeneratePdfFunction --stack-name semaphor-report-scheduler --start-time '5min ago'

# Debug deployment issues
sam deploy --debug

# Validate template before deployment
sam validate
```

## API Gateway Usage (After Deployment)

### API Endpoints

After deployment, SAM will output your API Gateway URL. Use it as follows:

#### Generate Dashboard PDF (Single Page)

```bash
# Dashboard with default settings
GET https://[api-id].execute-api.[region].amazonaws.com/Prod/generate?url=https://example.com/dashboard&format=pdf

# Dashboard with landscape orientation
GET https://[api-id].execute-api.[region].amazonaws.com/Prod/generate?url=https://example.com/dashboard&format=pdf&orientation=landscape

# Dashboard with password protection
GET https://[api-id].execute-api.[region].amazonaws.com/Prod/generate?url=https://example.com/dashboard&format=pdf&password=secret123
```

#### Generate Table PDF (Paginated)

```bash
# Table with Letter size pages
GET https://[api-id].execute-api.[region].amazonaws.com/Prod/generate?url=https://example.com/table&format=pdf&tableMode=true&pageSize=Letter

# Table with A4 pages in landscape
GET https://[api-id].execute-api.[region].amazonaws.com/Prod/generate?url=https://example.com/table&format=pdf&tableMode=true&pageSize=A4&orientation=landscape

# Table with custom title
GET https://[api-id].execute-api.[region].amazonaws.com/Prod/generate?url=https://example.com/table&format=pdf&tableMode=true&reportTitle=Q4%20Report
```

#### Generate CSV

```bash
# Basic CSV export
GET https://[api-id].execute-api.[region].amazonaws.com/Prod/generate?url=https://example.com/table&format=csv

# CSV with custom delimiter
GET https://[api-id].execute-api.[region].amazonaws.com/Prod/generate?url=https://example.com/table&format=csv&delimiter=;
```

### Query Parameters

- `url` (required): The webpage URL to convert
- `format` (optional): `"pdf"` (default) or `"csv"`
- `tableMode` (optional): `"true"` for paginated PDF mode
- `pageSize` (optional): Page size for PDFs (A4, Letter, Legal, etc.)
- `orientation` (optional): `"portrait"` (default) or `"landscape"`
- `delimiter` (optional): CSV delimiter (`,` default, `;` or `\t`)
- `password` (optional): Password for PDF encryption
- `watermarkEnabled` (optional): `"true"` to enable watermark
- `watermarkText` (optional): Text to display as watermark (e.g., "CONFIDENTIAL")
- `headerLogoUrl` (optional): URL to logo image for header
- `scheduleId` (optional): Schedule ID for tracking
- `attachmentMetadata` (optional): JSON with attachment details

## How It Works

### PDF Generation - Two Distinct Approaches

#### 1. Dashboard PDF Generation

The dashboard PDF generator:

1. Navigates to the dashboard URL using Puppeteer
2. Waits for all content to load (charts, tables, visualizations)
3. Expands all scrollable containers to show full content
4. Captures the entire dashboard as a single continuous PDF page
5. Preserves exact layout and styling as seen on screen

**Use Case**: Executive reports, dashboard snapshots, visual presentations

#### 2. Table PDF Generation

The table PDF generator:

1. Navigates to the table URL using Puppeteer
2. Detects table type (data table, pivot table, or aggregated table)
3. Extracts table data including headers and rows
4. Paginates content based on page size (A4, Letter, etc.)
5. Repeats headers on each page for readability
6. Applies professional margins and formatting

**Use Case**: Data exports, printable reports, formal documentation

### CSV Generation Approach

The CSV generator uses Puppeteer to:

1. Navigate to the table URL
2. Extract already-formatted text from the DOM
3. Preserve all frontend formatting (currency, dates, percentages)
4. Respect column visibility and ordering
5. Include subtotals and grand totals where applicable

**Key Benefit**: No complex formatting logic needed - the frontend has already applied all formatting!

## Project Structure

```
pdf-generation/
├── app.js                       # Lambda handler
├── test-local.js               # Local testing script
├── pdf-encrypt.js              # PDF encryption utilities
├── event.json                  # Sample event for SAM local testing
├── lib/
│   ├── pdf-generator.js        # PDF generation orchestrator
│   ├── pdf-from-data-generator.js  # Fast path PDF from POST data
│   ├── csv-extractor.js        # CSV extraction using Puppeteer
│   ├── browser.js              # Browser management
│   ├── page-setup.js           # Page navigation and setup
│   ├── content-loader.js       # Content scrolling and loading
│   ├── content-stability.js    # Wait for content to load
│   ├── dashboard-helpers.js    # Dashboard utilities
│   ├── pdf-merger.js          # PDF merging for multi-sheet
│   ├── watermark-utils.js      # Watermark and header logo utilities
│   └── modes/
│       ├── dashboard.js        # Dashboard PDF mode
│       ├── table.js            # Table PDF mode (paginated)
│       ├── data-table.js       # Data table PDF handling
│       ├── data-table-paginator.js  # Data table pagination
│       ├── pivot-table.js      # Pivot table PDF handling
│       ├── pivot-table-paginator.js # Pivot table pagination
│       ├── aggregate-table.js  # Aggregate table PDF handling
│       └── csv-table.js        # CSV extraction from tables
└── output/                     # Local test output directory (git-ignored)
```

## Environment Variables

For Lambda deployment (configured in template.yaml):

- `S3_BUCKET_NAME`: S3 bucket for storing generated files
- `API_URL`: Base API URL (default: https://semaphor.cloud)

## SAM Development Workflow

### 1. Make Code Changes

```bash
# Edit your code
vim lib/csv-extractor.js
```

### 2. Test Locally

```bash
# Test with test-local.js
node test-local.js --url "https://example.com/table" --format csv

# Test with SAM local
sam local invoke GeneratePdfFunction --event event.json
```

### 3. Build and Deploy

```bash
# Build
sam build --use-container

# Deploy to dev
sam deploy --config-env dev

# Deploy to prod
sam deploy --config-env prod --no-confirm-changeset
```

### 4. Monitor

```bash
# View logs
sam logs -n GeneratePdfFunction --stack-name semaphor-report-scheduler --tail

# View metrics in CloudWatch
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=semaphor-report-scheduler-GeneratePdfFunction-XXX \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 3600 \
  --statistics Average
```

## CSV Features

### Supported Table Types

- **Data Tables**: Standard tables with rows and columns
- **Pivot Tables**: Multi-level headers with aggregations
- **Aggregated Tables**: Tables with subtotals and grand totals

### Formatting Preservation

The CSV export preserves:

- Number formatting (1,234.56)
- Currency symbols ($1,234.56)
- Percentages (12.5%)
- Date formatting (Jan 1, 2024)
- Custom formats applied in the UI

### Column Management

- Respects hidden columns (not exported)
- Maintains column ordering from UI
- Preserves column widths proportions

## PDF Features

### Dashboard Mode

- Single continuous page
- Expands all scrollable content
- Maintains exact screen layout
- Ideal for dashboards and reports

### Table Mode

- Standard page sizes (A4, Letter, Legal, etc.)
- Automatic page breaks
- Repeated headers on each page
- Subtotal preservation across pages
- Professional margins and formatting

### Watermark

Watermarks add semi-transparent diagonal text across PDF pages for document classification or branding.

**Two rendering approaches**:

1. **Fixed Watermark** (for paginated tables):

   - Uses CSS `position: fixed` which repeats on each printed page
   - Centered diagonal text at 45° angle
   - Ideal for multi-page table exports

2. **Tiled Watermark** (for dashboards/visuals):
   - Uses SVG pattern as CSS background-image
   - Creates a repeating pattern across the entire document
   - Ideal for single continuous page exports

**Styling**:

- Font size: 80px (fixed) or 60px (tiled)
- Color: Semi-transparent gray (15% opacity)
- Rotation: 45 degrees counter-clockwise
- Does not interfere with content readability

### Header Logo

Adds organization branding to the top of PDF exports.

**How it works**:

- Logo URL is passed as a query parameter (`headerLogoUrl`)
- The React view component (`visual-view.tsx`, `view-container.tsx`) renders the logo
- Puppeteer captures the rendered page including the logo
- Maximum height is constrained to 40px to maintain document layout

**Integration with Project Settings**:

- When PDF export preferences are enabled in project settings, the logo URL is automatically included
- For scheduled reports, the logo URL is fetched from the project's organization
- Logo source can be configured to use the organization's uploaded logo

## Troubleshooting

### Common Issues

1. **Empty CSV/PDF**:

   - Check if the page requires authentication
   - Verify the URL is accessible
   - Check for CORS issues

2. **Missing Content**:

   - Increase wait times in `page-setup.js`
   - Check if content loads dynamically

3. **Formatting Issues**:

   - Ensure table has proper HTML structure
   - Check for `<thead>` and `<tbody>` tags
   - Verify CSS visibility settings

4. **Lambda Timeout**:

   - Increase timeout in SAM template
   - Consider reducing page complexity

5. **SAM Build Failures**:
   - Ensure Docker is running
   - Check Node.js version compatibility
   - Clear SAM build cache: `rm -rf .aws-sam/`

### Debug Mode

Enable debug logging in local testing:

```javascript
const options = {
  debug: true,
  debugScreenshot: true,
};
```

### SAM Debugging

```bash
# Validate template syntax
sam validate

# Run with debug output
sam local invoke GeneratePdfFunction --event event.json --debug

# Check Lambda container logs
docker logs $(docker ps -lq)
```

## Testing with Real URLs

### Local Testing with test-local.js

You can test with any Semaphor dashboard URL that includes a token:

```bash
# Test CSV export from a table
node test-local.js --url "https://semaphor.cloud/view/dashboard/[dashboard-id]/visual/[visual-id]?token=[token]" --format csv

# Test dashboard PDF (single page)
node test-local.js --url "https://semaphor.cloud/view/dashboard/[dashboard-id]?token=[token]"

# Test visual PDF export (single chart, landscape)
node test-local.js --url "https://semaphor.cloud/view/dashboard/[dashboard-id]/visual/[visual-id]?token=[token]&isPdfRender=true" --visual --orientation landscape

# Test table PDF with pagination
node test-local.js --url "https://semaphor.cloud/view/dashboard/[dashboard-id]/visual/[visual-id]?token=[token]" --table --page-size letter

# Test with password protection
node test-local.js --url "https://semaphor.cloud/view/dashboard/[dashboard-id]?token=[token]" --password "mypassword"
```

### Test Invocation Examples

#### Quick Test Commands

```bash
# 1. Install dependencies first
cd /Users/rohit/code/semaphor/semaphor-report-scheduler/pdf-generation
npm install

# 2. Test CSV generation with a real table URL
node test-local.js --url "YOUR_TABLE_URL_WITH_TOKEN" --format csv

# 3. Test PDF generation for a dashboard
node test-local.js --url "YOUR_DASHBOARD_URL_WITH_TOKEN"

# 4. Test paginated table PDF
node test-local.js --url "YOUR_TABLE_URL_WITH_TOKEN" --table --page-size a4

# 5. Test visual export (chart fits to one page)
node test-local.js --url "YOUR_VISUAL_URL?isPdfRender=true" --visual --orientation landscape

# 6. Check the output
ls -la output/
# Files will be named: test-output-{timestamp}.csv or test-output-{timestamp}.pdf
```

#### SAM Local Testing

```bash
# 1. Create event.json with your test parameters
cat > event.json << 'EOF'
{
  "queryStringParameters": {
    "url": "https://semaphor.cloud/view/dashboard/YOUR_DASHBOARD_ID?token=YOUR_TOKEN",
    "format": "csv"
  }
}
EOF

# 2. Run the Lambda locally
sam local invoke GeneratePdfFunction --event event.json

# 3. For debugging, save output to file
sam local invoke GeneratePdfFunction --event event.json > output.log 2>&1
```

#### Direct Node.js Test

```bash
# Run the test script without arguments to see usage
node test-local.js --help
```

## Advanced SAM Configuration

### Using Parameter Overrides

```bash
# Deploy with custom parameters
sam deploy \
  --parameter-overrides \
    MemorySize=8192 \
    Timeout=600 \
    S3BucketName=my-custom-bucket
```

### Multi-Environment Deployment

Create `samconfig.toml`:

```toml
[dev]
[dev.deploy]
[dev.deploy.parameters]
stack_name = "pdf-generation-dev"
s3_bucket = "sam-deployments-dev"
region = "us-east-1"
confirm_changeset = true
capabilities = "CAPABILITY_IAM"

[prod]
[prod.deploy]
[prod.deploy.parameters]
stack_name = "pdf-generation-prod"
s3_bucket = "sam-deployments-prod"
region = "us-east-1"
confirm_changeset = false
capabilities = "CAPABILITY_IAM"
```

Then deploy to specific environments:

```bash
sam deploy --config-env dev
sam deploy --config-env prod
```

## Performance Considerations

- CSV extraction is faster than PDF generation
- Table mode PDFs take longer due to pagination
- Large tables may require increased Lambda memory
- Consider implementing streaming for very large datasets
- Lambda cold starts can be mitigated with provisioned concurrency

## Security Notes

### Password Protection for PDFs

Password protection is available for direct PDF generation (not scheduled reports):

```bash
# Local testing with password
node test-local.js --url "https://example.com/dashboard" --format pdf --password "mySecretPassword"

# API call with password
GET https://api.example.com/generate?url=https://example.com&format=pdf&password=mySecretPassword
```

**How it works**:

1. PDF is generated normally using Puppeteer
2. The resulting PDF buffer is encrypted using `pdf-lib-with-encrypt`
3. User must enter password to view the PDF
4. Uses 128-bit AES encryption (industry standard)

**Important Notes**:

- Password is passed as plain text in URL (use HTTPS!)
- Not available for scheduled reports (security best practice)
- Password protects viewing, printing, and copying
- Cannot be removed without the password

### Other Security Features

- URLs are validated before processing
- S3 uploads use private ACLs
- Temporary tokens have 10-minute expiry for scheduled reports
- API Gateway can be secured with API keys or AWS IAM

## Support

For issues or questions, please refer to the main Semaphor documentation or contact the development team.
