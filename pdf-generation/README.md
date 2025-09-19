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
- **Multiple Page Sizes**: A4, Letter, Legal, Tabloid, A3, A5
- **Orientation Support**: Portrait or Landscape

## Quick Start - Local Testing

### Install Dependencies

```bash
cd pdf-generation
npm install
```

### Test CSV Generation

```bash
# Basic CSV export
node test-local.js "https://example.com/table" csv

# CSV with semicolon delimiter (for Excel in some locales)
node test-local.js "https://example.com/table" csv "" "" "" ";"

# CSV with tab delimiter
node test-local.js "https://example.com/table" csv "" "" "" tab
```

### Test PDF Generation

#### Dashboard PDF (Single Page)

```bash
# Basic dashboard export (default)
node test-local.js "https://example.com/dashboard"

# Dashboard with password protection
node test-local.js "https://example.com/dashboard" pdf "mypassword"

# Explicitly specify dashboard mode
node test-local.js "https://example.com/dashboard" pdf "" dashboard

# Dashboard with password and explicit mode
node test-local.js "https://example.com/dashboard" pdf "secret123" dashboard
```

#### Table PDF (Paginated)

```bash
# Table with Letter size pages
node test-local.js "https://example.com/table" pdf "" table Letter

# Table with A4 pages
node test-local.js "https://example.com/table" pdf "" table A4

# Table with password protection
node test-local.js "https://example.com/table" pdf "mypassword" table A4

# Table with password and Letter size
node test-local.js "https://example.com/table" pdf "secret123" table Letter

# Note: Orientation is controlled via query params in Lambda, not test-local
```

**Password Protection Notes**:

- Works with both dashboard and table PDFs
- Password is the 3rd argument for test-local.js
- Use empty string "" to skip password when specifying later arguments
- Generated PDFs require password to open, print, or copy content

### Command Line Arguments

```
node test-local.js <url> [format] [password] [mode] [pageSize] [delimiter]
```

**Argument Positions**:

- **1st argument - url** (required): The webpage URL to convert
- **2nd argument - format** (optional): `"pdf"` (default) or `"csv"`
- **3rd argument - password** (optional): Password for PDF encryption (PDF only, use `""` to skip)
- **4th argument - mode** (optional): `"table"` for paginated PDF, `"dashboard"` (default) for single page (PDF only)
- **5th argument - pageSize** (optional): Page size for PDF: `A4` (default), `Letter`, `Legal`, `Tabloid`, `A3`, `A5`
- **6th argument - delimiter** (optional): CSV delimiter: `","` (default), `";"` or `"tab"` (CSV only)

**Important**: Arguments are positional! If you want to specify a later argument, you must provide all earlier arguments (use `""` for ones you want to skip).

**Examples with Positional Arguments**:

```bash
# 1st arg only - URL (defaults to PDF)
node test-local.js http://localhost:5173

# 1st & 2nd args - URL and format
node test-local.js https://example.com/table csv

# 1st, 2nd & 3rd args - URL, format, and password
node test-local.js https://example.com/dashboard pdf "secret123"

# Skip 3rd arg to specify 4th - URL, format, no password, mode
node test-local.js http://localhost:5173 pdf "" table
node test-local.js http://localhost:5173 csv "" table

# All PDF args - URL, format, password, mode, pageSize
node test-local.js https://example.com/table pdf "secret" table Letter

# Skip password to set delimiter for CSV - URL, format, skip, skip, skip, delimiter
node test-local.js https://example.com/table csv "" "" "" ";"
```

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

### SAM Template Configuration

The service is configured in `template.yaml` with:

```yaml
GeneratePdfFunction:
  Type: AWS::Serverless::Function
  Properties:
    CodeUri: pdf-generation/
    Handler: app.handler
    Runtime: nodejs18.x
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
│   ├── csv-extractor.js        # CSV extraction using Puppeteer
│   ├── browser.js              # Browser management
│   ├── page-setup.js           # Page navigation and setup
│   ├── content-loader.js       # Content scrolling and loading
│   ├── content-stability.js    # Wait for content to load
│   ├── dashboard-helpers.js    # Dashboard utilities
│   ├── pdf-merger.js          # PDF merging for multi-sheet
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
node test-local.js "https://example.com/table" csv

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
node test-local.js "https://semaphor.cloud/view/dashboard/[dashboard-id]/visual/[visual-id]?token=[token]" csv

# Test dashboard PDF (single page)
node test-local.js "https://semaphor.cloud/view/dashboard/[dashboard-id]?token=[token]" pdf

# Test table PDF with pagination
node test-local.js "https://semaphor.cloud/view/dashboard/[dashboard-id]/visual/[visual-id]?token=[token]" pdf "" table Letter

# Test with password protection
node test-local.js "https://semaphor.cloud/view/dashboard/[dashboard-id]?token=[token]" pdf "mypassword"
```

### Test Invocation Examples

#### Quick Test Commands

```bash
# 1. Install dependencies first
cd /Users/rohit/code/semaphor/semaphor-report-scheduler/pdf-generation
npm install

# 2. Test CSV generation with a real table URL
node test-local.js "YOUR_TABLE_URL_WITH_TOKEN" csv

# 3. Test PDF generation for a dashboard
node test-local.js "YOUR_DASHBOARD_URL_WITH_TOKEN" pdf

# 4. Test paginated table PDF
node test-local.js "YOUR_TABLE_URL_WITH_TOKEN" pdf "" table A4

# 5. Check the output
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
node test-local.js

# This will display:
# 📖 Usage:
#   node test-local.js <url> [format] [password] [mode] [pageSize] [delimiter]
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
node test-local.js "https://example.com/dashboard" pdf "mySecretPassword"

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
