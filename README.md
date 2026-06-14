# Semaphor Report Scheduler

AWS SAM application that powers two core capabilities for Semaphor:

1. **Scheduled Reports** - Automated PDF/CSV generation and email delivery on a recurring schedule
2. **Async Exports** - Large dataset export processing using AWS Step Functions for parallel chunk-based CSV generation
3. **Automation V2 Dispatch (optional)** - EventBridge-driven claim/start fanout for `AutomationRule` execution
4. **Insight Runner** - Lambda-backed generated-analysis Briefing execution with the same local runner harness used in development

## Architecture

```
Pipeline 1: Scheduled Reports
  EventBridge (every 60 min)
       |
  ScheduleProcessor --> ScheduleDeliveryStateMachine
       |                    |
       |                    |-- Map: GeneratePdf (one per attachment)
       |                    |-- Task: EmailSender (one send per recipient)
       |                    |-- Task: update-status (success/error)
       |                    |
       |  GET /schedules/ready   Uses Puppeteer for PDF/CSV
       |                    Stores artifacts in S3 (emails/) as private objects

Pipeline 2: Async Exports (Step Functions)
  semaphor-app (POST /api/v1/exports)
       |
  Step Functions State Machine
       |
  ProcessChunks (parallel, up to 40 concurrent)
       |--- ChunkProcessor x N (query data, generate CSV, upload to S3)
       |
  CompactAndNotify
       |--- CompactionProcessor (stream-merge chunks, gzip, upload final file)
       |
  On Error --> MarkFailed (marks export job as failed)

Pipeline 3: Automation V2 Dispatch (disabled by default)
  EventBridge (every 5 min)
       |
  AutomationDispatcher
       |--- POST /api/v1/automations/internal/claim-due (REPORT, ALERT, CACHE_REFRESH)
       |--- POST /api/v1/automations/internal/runs + /start
       |--- POST configured executor endpoints (report/alert)
       |--- POST /api/v1/automations/internal/runs/:id/fail on dispatch errors

Pipeline 4: Insight Runner
  semaphor-app
       |
       |-- POST /internal/briefing-plans  --> InsightRunnerIngressFunction
       |                                      |-- synchronous plan response
       |
       |-- POST /internal/briefing-runs   --> InsightRunnerIngressFunction
                                              |-- async Invoke
                                                  InsightRunnerWorkerFunction
                                                     |-- MCP/model analysis
                                                     |-- progress/complete/fail callbacks to semaphor-app
```

## Prerequisites

- AWS CLI configured with appropriate credentials
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) installed
- Node.js 18.x or later
- Docker (for building Lambda functions)
- Access to npm registry (public npmjs.org or your configured private mirror)
- Either:
  - AWS SES configured for email sending (see [SES-SETUP.md](SES-SETUP.md)), or
  - External provider webhook configured (for `EMAIL_PROVIDER_MODE=EXTERNAL`)

## Quick Start

### 1. Clone and Configure

```bash
git clone <repository-url>
cd report-scheduler

cp .env.example .env
```

### 2. Update Configuration

Edit `.env` with your values:

```bash
# Your Semaphor application URL
SEMAPHOR_APP_URL=https://your-semaphor-instance.com

# API key for Lambda authentication (must match LAMBDA_API_KEY in semaphor-app)
LAMBDA_API_KEY=your-api-key-here

# SES verified sender email address
SES_SENDER_EMAIL=noreply@yourdomain.com

# Optional: external provider mode
EMAIL_PROVIDER_MODE=SES
# EMAIL_PROVIDER_MODE=EXTERNAL
# EMAIL_EXTERNAL_AUTH_SECRET=replace-with-secret
# RESEND_API_KEY=re_xxx
# RESEND_SENDER_EMAIL=reports@yourdomain.com

# Optional: AI-generated Briefings through the Insight Loop runner Lambda
INSIGHT_LOOP_MODEL_PROVIDER=openai
INSIGHT_LOOP_MODEL=gpt-5.5
INSIGHT_LOOP_REASONING_EFFORT=medium
OPENAI_API_KEY=sk-...
```

### 3. Deploy to AWS

```bash
# Deploy using the included script
# (installs dependencies, runs containerized no-cache SAM build, verifies aws-sdk packaging)
./deploy.sh

# Or deploy manually
npm ci --include=dev
cd pdf-generation && npm ci && cd ..
cd schedule-processor && npm ci && cd ..
cd email-sender && npm ci && cd ..
cd insight-runner && npm ci && cd ..
cd chunk-processor && npm ci && cd ..
cd compaction-processor && npm ci && cd ..
cd mark-failed && npm ci && cd ..
sam build --use-container --no-cached
sam deploy --guided  # First time only
```

### 4. Connect to Semaphor App

After deployment, retrieve the stack outputs:

```bash
sam list stack-outputs --stack-name semaphor-report-scheduler
```

Then configure the following environment variables in your **semaphor-app** `.env`:

| semaphor-app Variable | Value From Stack Output | Purpose |
|---|---|---|
| `LAMBDA_API_KEY` | Same value you set in step 2 | Authenticates Lambda-to-app API calls |
| `BRIEFINGS_EMAIL_SENDER_URL` | `EmailSenderFunctionUrl` output | Enables Briefing Run now email delivery through the scheduler email sender |
| `BRIEFINGS_RUNNER_URL` | `InsightRunnerIngressFunctionUrl` output | Enables AI-generated Briefing preview plans and runs through the Insight Loop runner Lambda |
| `EXPORT_STATE_MACHINE_ARN` | `ExportStateMachineArn` output | Enables async export processing |
| `S3_EXPORTS_BUCKET` | `S3BucketName` output | Allows download URL generation for completed exports |
| `AWS_ACCESS_KEY_ID` | Your AWS credentials | Required for semaphor-app to invoke Step Functions and generate S3 presigned URLs |
| `AWS_SECRET_ACCESS_KEY` | Your AWS credentials | Required for semaphor-app to invoke Step Functions and generate S3 presigned URLs |
| `AWS_REGION` | e.g. `us-east-1` | AWS region where the stack is deployed |

**Important**: The `LAMBDA_API_KEY` must be the same value in both the report scheduler `.env` and the semaphor-app `.env`. This key authenticates Lambda-to-app API calls and signed Semaphor App calls to scheduler Function URLs such as `EmailSenderFunctionUrl`.

### Local Insight Runner Development

For local Semaphor App development, you do not need Lambda. Run the same runner
code as a local HTTP service:

```bash
cd insight-runner
npm ci
npm run serve -- --provider openai --model gpt-5.5 --reasoning-effort medium
```

Then point semaphor-app at the local service:

```bash
BRIEFINGS_RUNNER_URL=http://127.0.0.1:4317
LAMBDA_API_KEY=<same shared internal key used by semaphor-app and the local runner>
```

For hosted or self-hosted SAM deployments, set `BRIEFINGS_RUNNER_URL` to the
`InsightRunnerIngressFunctionUrl` stack output instead. The Semaphor App
dispatch contract is the same in both modes:

- `POST /internal/briefing-plans` returns a synchronous preview plan.
- `POST /internal/briefing-runs` returns `202 accepted`; the worker Lambda runs
  asynchronously and reports progress/complete/fail through callbacks.

## Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `SEMAPHOR_APP_URL` | Base URL of your Semaphor application | `https://app.semaphor.com` |
| `LAMBDA_API_KEY` | API key for Lambda function authentication | `sk_lambda_abc123...` |
| `SES_SENDER_EMAIL` | Verified sender email address for reports (SES mode) | `noreply@yourdomain.com` |
| `EMAIL_PROVIDER_MODE` | Email provider mode (`SES` or `EXTERNAL`) | `SES` |
| `SES_REGION` | AWS region used by SES client | `us-east-1` |
| `EMAIL_EXTERNAL_AUTH_SECRET` | Shared secret for signed external provider requests (required when `EMAIL_PROVIDER_MODE=EXTERNAL`) | _(empty)_ |
| `RESEND_API_KEY` | API key for same-stack `ResendProviderFunction` | _(empty)_ |
| `RESEND_SENDER_EMAIL` | Sender email for same-stack Resend provider | `reports@yourdomain.com` |
| `INSIGHT_LOOP_MODEL_PROVIDER` | Model provider for generated-analysis Briefings (`openai` or `fake`) | `openai` |
| `INSIGHT_LOOP_MODEL` | Model name for generated-analysis Briefings | `gpt-5.5` |
| `INSIGHT_LOOP_REASONING_EFFORT` | Reasoning effort for generated-analysis Briefings | `medium` |
| `OPENAI_API_KEY` | OpenAI API key used by `INSIGHT_LOOP_MODEL_PROVIDER=openai` | _(empty)_ |

### Optional Automation V2 Dispatcher Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTOMATION_DISPATCH_ENABLED` | Enables Automation V2 dispatcher execution | `false` |
| `AUTOMATION_DISPATCH_ORG_IDS` | Comma-separated org IDs to dispatch when event payload has no org IDs | _(empty)_ |
| `AUTOMATION_DISPATCH_KINDS` | Comma-separated kinds to claim (`REPORT,ALERT,CACHE_REFRESH`) | `REPORT,ALERT,CACHE_REFRESH` |
| `AUTOMATION_BATCH_SIZE` | Claim batch size per org/kind cycle | `60` |
| `AUTOMATION_LEASE_MINUTES` | Lease duration for claimed rules | `5` |
| `AUTOMATION_EXECUTOR_MODE` | Dispatch target mode: `http` or `stepfunctions` | `http` |
| `AUTOMATION_STATE_MACHINE_ARN` | State machine ARN used when `AUTOMATION_EXECUTOR_MODE=stepfunctions` | Stack-managed `AutomationStateMachine` ARN |
| `AUTOMATION_EXECUTOR_PATH` | Unified internal semaphor-app execution route used in HTTP mode and automation-executor lambda | `/api/v1/automations/internal/execute` |
| `REPORT_EXECUTOR_PATH` | Legacy fallback route override for REPORT dispatch (only used if `AUTOMATION_EXECUTOR_PATH` is unset) | _(optional)_ |
| `ALERT_EXECUTOR_PATH` | Legacy fallback route override for ALERT dispatch (only used if `AUTOMATION_EXECUTOR_PATH` is unset) | _(optional)_ |
| `CACHE_REFRESH_EXECUTOR_PATH` | Legacy fallback route override for CACHE_REFRESH dispatch (only used if `AUTOMATION_EXECUTOR_PATH` is unset) | _(optional)_ |

### Generating the Lambda API Key

The `LAMBDA_API_KEY` is a shared secret that authenticates all communication between the Lambda functions and your Semaphor application. It is not generated by the application — you create it yourself.

**Generate a secure key:**

```bash
openssl rand -hex 32
```

This produces a 64-character random string like `a1b2c3d4e5f6...`. Use this as your `LAMBDA_API_KEY`.

**The same key must be set in two places:**

1. **Report scheduler** `.env` — so Lambda functions can send it in API requests
2. **semaphor-app** `.env` — so the app can validate incoming requests

When a Lambda function calls the Semaphor app API, it sends the key in an `X-API-Key` HTTP header. The app compares it against its own `LAMBDA_API_KEY` environment variable. If they don't match, the request is rejected with a 401 error. Semaphor App uses the same `X-API-Key` value when it calls scheduler Function URLs such as the Briefings email sender.

**Protected endpoints:**
- `GET /api/v1/schedules/ready` — fetch schedules due for processing
- `GET /api/v1/schedules/[id]/internal` — get schedule details
- `POST /api/v1/schedules/update-status` — update schedule execution status
- `GET/PATCH /api/v1/exports/internal/chunks/[chunkId]` — export chunk status
- `PATCH /api/v1/exports/internal/jobs/[jobId]` — export job status
- `POST /api/v1/exports/internal/jobs/[jobId]/complete` — mark export complete
- `POST /api/v1/exports/internal/jobs/[jobId]/fail` — mark export failed
- `POST /api/v1/automations/internal/claim-due` — claim due automation rules
- `POST /api/v1/automations/internal/runs` — create run records
- `EmailSenderFunctionUrl` — accepts signed `send_consolidated` requests from Semaphor App for Briefing email delivery
- `InsightRunnerIngressFunctionUrl` — accepts signed runner plan/run requests from Semaphor App for generated-analysis Briefings
- `POST /api/v1/automations/internal/runs/[id]/start` — mark run running
- `POST /api/v1/automations/internal/runs/[id]/fail` — fail run on dispatch error

**To rotate the key:** generate a new key, update both `.env` files, redeploy the scheduler (`./deploy.sh`), and restart semaphor-app.

### AWS Resources Created

The deployment creates:

| Resource | Purpose |
|----------|---------|
| **ScheduleProcessorFunction** | Fetches ready schedules every 60 minutes |
| **ScheduleDeliveryStateMachine** | Orchestrates per-schedule attachment generation and per-recipient email delivery |
| **GeneratePdfFunction** | Generates PDFs/CSVs using Puppeteer (has public Function URL) |
| **EmailSenderFunction** | Sends one report email per recipient (`SES` or `EXTERNAL` mode) and updates schedule status |
| **ResendProviderFunction** | External provider endpoint (Function URL) that sends email via Resend |
| **InsightRunnerIngressFunction** | Function URL for Briefing preview plans and async run acceptance |
| **InsightRunnerWorkerFunction** | Runs generated-analysis Briefings and calls Semaphor App progress/complete/fail callbacks |
| **ChunkProcessorFunction** | Processes individual data chunks for large exports |
| **CompactionProcessorFunction** | Merges chunks into final gzip-compressed CSV |
| **MarkFailedFunction** | Marks failed export jobs with error details |
| **AutomationDispatcherFunction** | Claims due Automation V2 rules and dispatches execution |
| **AutomationExecutorFunction** | Executes automation runs via Step Functions (used when executor mode is `stepfunctions`) |
| **AutomationStateMachine** | Step Functions state machine for Automation V2 execution with error handling |
| **ExportStateMachine** | Step Functions state machine orchestrating the export pipeline |
| **S3 Bucket** | Stores generated reports (`pdfs/`, `emails/`) and export files (`exports/`) |
| **EventBridge Rule** | Triggers schedule processing every 60 minutes |
| **AutomationDispatchRule** | Triggers Automation V2 dispatcher every 5 minutes (state parameterized; default disabled) |
| **IAM Roles** | Least-privilege roles for each function |

### Email Delivery Modes

Semaphor Report Scheduler supports two delivery modes:

1. **SES mode (default)**: `EMAIL_PROVIDER_MODE=SES`
2. **External mode**: `EMAIL_PROVIDER_MODE=EXTERNAL` (uses same-stack `ResendProviderFunctionUrl`)

In external mode, `EmailSenderFunction` posts signed payloads to your provider endpoint and includes presigned attachment URLs. `EmailSenderFunction` does not download attachment bytes in this mode.

### SES Mode Setup

AWS Simple Email Service (SES) must be configured when using SES mode:

1. **Verify sender email address** in AWS SES console
2. **Configure sender email** in `.env` file:
   ```bash
   SES_SENDER_EMAIL=noreply@yourdomain.com
   ```
3. **For production**: Request production access to remove sandbox restrictions

For detailed SES setup instructions, see [SES-SETUP.md](SES-SETUP.md)

### Quick Test: Same-Stack Resend Provider (External Mode)

1. Set `.env` values:
   ```bash
   EMAIL_PROVIDER_MODE=EXTERNAL
   EMAIL_EXTERNAL_AUTH_SECRET=replace-with-shared-secret
   RESEND_API_KEY=re_xxx
   RESEND_SENDER_EMAIL=reports@yourdomain.com
   ```
2. Deploy:
   ```bash
   ./deploy.sh
   ```
3. Smoke test by invoking the sender directly with a consolidated payload (no S3 trigger path):
   ```bash
   aws lambda invoke \
    --function-name <EmailSenderFunctionName> \
    --payload fileb://email-sender/events/direct-consolidated.sample.json \
    /tmp/email-sender-response.json
   ```
4. Watch logs:
   ```bash
   sam logs -n EmailSenderFunction --stack-name semaphor-report-scheduler --tail
   sam logs -n ResendProviderFunction --stack-name semaphor-report-scheduler --tail
   ```

## Deployment Options

### First-Time Deployment

```bash
npm ci --include=dev
cd pdf-generation && npm ci && cd ..
cd schedule-processor && npm ci && cd ..
cd email-sender && npm ci && cd ..
cd chunk-processor && npm ci && cd ..
cd compaction-processor && npm ci && cd ..
cd mark-failed && npm ci && cd ..
sam build --use-container --no-cached
sam deploy --guided
```

You'll be prompted for:
- Stack name (default: `semaphor-report-scheduler`)
- AWS Region (default: `us-east-1`)
- Parameter values
- Confirmation to deploy

### Update Deployment

```bash
# After initial deployment, simply run
./deploy.sh
```

### Enable Automation V2 Dispatch

Automation V2 is disabled by default. To enable it, pass the `AutomationDispatchRuleState` parameter:

```bash
sam deploy \
    --parameter-overrides \
    AutomationDispatchRuleState=ENABLED \
    SemaphorAppUrl=$SEMAPHOR_APP_URL \
    LambdaApiKey=$LAMBDA_API_KEY \
    SesSenderEmail=$SES_SENDER_EMAIL \
    EmailProviderMode=$EMAIL_PROVIDER_MODE \
    SesRegion=$SES_REGION \
    EmailExternalAuthSecret=$EMAIL_EXTERNAL_AUTH_SECRET \
    ResendApiKey=$RESEND_API_KEY \
    ResendSenderEmail=$RESEND_SENDER_EMAIL \
    --no-confirm-changeset
```

You must also ensure `AUTOMATION_DISPATCH_ENABLED` is set to `true` in the function environment and that org IDs are configured (via `AUTOMATION_DISPATCH_ORG_IDS` env var or EventBridge event payload).

### Custom Stack Name

```bash
sam deploy --stack-name my-custom-stack
```

## CloudFormation Outputs

After deployment, these outputs are available:

| Output | Description |
|--------|-------------|
| `GeneratePdfFunctionUrl` | Lambda Function URL for PDF generation |
| `GeneratePdfFunctionArn` | ARN of Generate PDF function |
| `S3BucketName` | Name of the S3 bucket |
| `S3BucketArn` | ARN of the S3 bucket |
| `EmailSenderFunctionArn` | ARN of Email Sender function |
| `EmailSenderFunctionUrl` | Function URL for signed Briefing email delivery requests |
| `ResendProviderFunctionUrl` | Function URL for same-stack Resend provider |
| `ResendProviderFunctionArn` | ARN of same-stack Resend provider |
| `ScheduleProcessorFunctionArn` | ARN of Schedule Processor function |
| `ScheduleDeliveryStateMachineArn` | ARN of Scheduled Report Delivery state machine |
| `AutomationDispatcherFunctionArn` | ARN of Automation V2 Dispatcher function |
| `AutomationExecutorFunctionArn` | ARN of Automation V2 Executor function |
| `AutomationStateMachineArn` | ARN of Automation V2 State Machine |
| `ExportStateMachineArn` | ARN of the Export State Machine (needed by semaphor-app) |
| `ChunkProcessorFunctionArn` | ARN of the Chunk Processor function |
| `CompactionProcessorFunctionArn` | ARN of the Compaction Processor function |
| `MarkFailedFunctionArn` | ARN of the Mark Failed function |

View outputs:

```bash
sam list stack-outputs --stack-name semaphor-report-scheduler
```

## Troubleshooting

### Common Issues

**Build Fails**
- Ensure Docker is running: `docker ps`
- Check Node.js version: `node --version` (should be 18.x or later)
- If you see `Cannot find esbuild`, run:
  - `NPM_CONFIG_OMIT= npm ci --include=dev`
  - `export PATH="$(pwd)/node_modules/.bin:$PATH"`
  - `esbuild --version`
  - `sam build --use-container --no-cached`
- If `npm config get omit` prints `dev`, clear it for the build shell or use `NPM_CONFIG_OMIT=` inline as above.
- If `./deploy.sh` fails with missing `.aws-sam/build/GeneratePdfFunction/node_modules/aws-sdk/package.json`, verify npm registry access and rerun.

**GeneratePdfFunction Error: `Cannot find package 'aws-sdk' imported from /var/task/app.js`**
- This means the deployed Lambda artifact is missing function dependencies.
- Run this recovery sequence from repo root:
  ```bash
  rm -rf .aws-sam
  npm ci --include=dev
  cd pdf-generation && npm ci && cd ..
  cd schedule-processor && npm ci && cd ..
  cd email-sender && npm ci && cd ..
  cd chunk-processor && npm ci && cd ..
  cd compaction-processor && npm ci && cd ..
  cd mark-failed && npm ci && cd ..
  sam build --use-container --no-cached --debug
  test -f .aws-sam/build/GeneratePdfFunction/node_modules/aws-sdk/package.json && echo "aws-sdk present" || echo "aws-sdk missing"
  sam deploy --no-confirm-changeset
  ```
- If the check prints `aws-sdk missing`, treat it as a build environment issue (registry access/network/private mirror config).

**Deployment Fails**
- Verify AWS credentials: `aws sts get-caller-identity`
- Check IAM permissions for CloudFormation, Lambda, S3, Step Functions, States

**Scheduled Reports Not Running**
- Check CloudWatch Logs: `sam logs -n ScheduleProcessorFunction --stack-name semaphor-report-scheduler --tail`
- Verify `SEMAPHOR_APP_URL` and `LAMBDA_API_KEY` are correct

**Automation V2 Dispatcher Not Running**
- Check CloudWatch Logs: `sam logs -n AutomationDispatcherFunction --stack-name semaphor-report-scheduler --tail`
- Confirm `AutomationDispatchRuleState` is `ENABLED` in stack parameters
- Confirm `AUTOMATION_DISPATCH_ENABLED=true` in the function environment
- Ensure `AUTOMATION_DISPATCH_ORG_IDS` or event payload org IDs are provided

**Email Not Sending**
- If `EMAIL_PROVIDER_MODE=SES`:
  - Verify SES configuration in your AWS region
  - Check sender email is verified in SES
  - Review SES sending limits
- If `EMAIL_PROVIDER_MODE=EXTERNAL`:
  - Verify `EMAIL_EXTERNAL_AUTH_SECRET` is set in both sender and provider environments
  - Check `ResendProviderFunction` logs
- Check logs: `sam logs -n EmailSenderFunction --stack-name semaphor-report-scheduler --tail`

**Exports Not Processing**
- Verify `EXPORT_STATE_MACHINE_ARN` is set in semaphor-app
- Verify `S3_EXPORTS_BUCKET` is set in semaphor-app
- Verify AWS credentials are configured in semaphor-app
- Check Step Functions execution history in AWS console
- Check logs:
  ```bash
  sam logs -n ChunkProcessorFunction --stack-name semaphor-report-scheduler --tail
  sam logs -n CompactionProcessorFunction --stack-name semaphor-report-scheduler --tail
  sam logs -n MarkFailedFunction --stack-name semaphor-report-scheduler --tail

  # Automation V2
  sam logs -n AutomationDispatcherFunction --stack-name semaphor-report-scheduler --tail
  sam logs -n AutomationExecutorFunction --stack-name semaphor-report-scheduler --tail
  ```

### Logs

View Lambda logs in CloudWatch:

```bash
# Scheduled reports
sam logs -n ScheduleProcessorFunction --stack-name semaphor-report-scheduler --tail
sam logs -n GeneratePdfFunction --stack-name semaphor-report-scheduler --tail
sam logs -n EmailSenderFunction --stack-name semaphor-report-scheduler --tail
sam logs -n ResendProviderFunction --stack-name semaphor-report-scheduler --tail

# Async exports
sam logs -n ChunkProcessorFunction --stack-name semaphor-report-scheduler --tail
sam logs -n CompactionProcessorFunction --stack-name semaphor-report-scheduler --tail
sam logs -n MarkFailedFunction --stack-name semaphor-report-scheduler --tail

# Automation V2
sam logs -n AutomationDispatcherFunction --stack-name semaphor-report-scheduler --tail
sam logs -n AutomationExecutorFunction --stack-name semaphor-report-scheduler --tail
```

## Updating

To update the application:

1. Pull latest changes
2. Update `.env` if needed
3. Run `./deploy.sh`

## Cleanup

To remove all resources:

```bash
# Empty the S3 bucket first (required before stack deletion)
aws s3 rm s3://$(aws cloudformation describe-stacks --stack-name semaphor-report-scheduler --query 'Stacks[0].Outputs[?OutputKey==`S3BucketName`].OutputValue' --output text) --recursive

# Delete the CloudFormation stack
sam delete --stack-name semaphor-report-scheduler
```

## Support

For issues or questions, please contact your administrator or refer to the [AWS SAM documentation](https://docs.aws.amazon.com/serverless-application-model/).

## License

All rights reserved.
