# Print to PDF Lambda - AWS SAM Application

This AWS SAM application provides automated PDF/CSV generation and email delivery for Semaphor dashboards. It processes scheduled reports, generates PDFs/CSVs from dashboards, and sends them via email.

## Architecture Overview

The application consists of three Lambda functions:

1. **ScheduleProcessorFunction** - Fetches ready schedules and triggers PDF generation (runs every 60 minutes)
2. **GeneratePdfFunction** - Generates PDFs/CSVs from dashboard URLs using Puppeteer
3. **EmailSenderFunction** - Sends emails with generated attachments via AWS SES

## Prerequisites

- AWS CLI configured with appropriate credentials
- AWS SAM CLI installed
- Node.js 18.x
- An AWS account with permissions to create Lambda functions, S3 buckets, and IAM roles

## Setup

### 1. Clone the repository

```bash
git clone <repository-url>
cd semaphor-report-scheduler
```

### 2. Create environment configuration

Create a `.env` file in the project root with your configuration:

```bash
# Semaphor Application Configuration
SEMAPHOR_APP_URL=https://your-semaphor-instance.com
LAMBDA_API_KEY=your-api-key-here
```

**Important:** The `.env` file is already added to `.gitignore` to prevent committing sensitive data.

### 3. Install dependencies (if needed for local development)

```bash
cd schedule-processor && npm install && cd ..
cd pdf-generation && npm install && cd ..
cd email-sender && npm install && cd ..
```

## Deployment

### Quick Deploy

Use the provided deployment script:

```bash
./deploy.sh
```

This script will:
1. Load environment variables from `.env`
2. Build the SAM application
3. Deploy with parameter overrides
4. Skip confirmation prompts for CI/CD environments

### Manual Deploy

Alternatively, deploy manually:

```bash
# Load environment variables
source .env

# Build the application
sam build

# Deploy with parameters
sam deploy \
    --parameter-overrides \
    SemaphorAppUrl=$SEMAPHOR_APP_URL \
    LambdaApiKey=$LAMBDA_API_KEY \
    --no-confirm-changeset
```

### First-Time Deployment

For first-time deployment with guided setup:

```bash
# Load environment variables
source .env

# Build and deploy with guided setup
sam build
sam deploy --guided \
    --parameter-overrides \
    SemaphorAppUrl=$SEMAPHOR_APP_URL \
    LambdaApiKey=$LAMBDA_API_KEY
```

## Configuration

### Environment Variables

The application uses the following environment variables (configured via `.env`):

| Variable | Description | Required |
|----------|-------------|----------|
| `SEMAPHOR_APP_URL` | Base URL for Semaphor application | Yes |
| `LAMBDA_API_KEY` | API key for Lambda authentication | Yes |

### CloudFormation Parameters

The SAM template accepts these parameters:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `SemaphorAppUrl` | Base URL for Semaphor application | https://semaphor.cloud |
| `LambdaApiKey` | API key for Lambda authentication | (no default - must be provided) |
| `S3BucketName` | S3 bucket name for PDFs | semaphor-pdf-generation-bucket |

### Changing Schedule Frequency

To modify how often schedules are processed, edit the `ScheduleRule` in `template.yaml`:

```yaml
ScheduleRule:
  Properties:
    ScheduleExpression: rate(60 minutes)  # Change this value
```

## CloudFormation Outputs

After deployment, the stack provides these outputs:

- `GeneratePdfFunctionUrl` - Lambda Function URL for PDF generation
- `GeneratePdfFunctionArn` - ARN of Generate PDF function
- `S3BucketName` - Name of S3 bucket for storing PDFs
- `EmailSenderFunctionArn` - ARN of Email Sender function
- `ScheduleProcessorFunctionArn` - ARN of Schedule Processor function

View outputs:

```bash
sam list stack-outputs --stack-name semaphor-report-scheduler
```

## Testing

### Validate Template

```bash
sam validate
```

### View Logs

```bash
# Schedule Processor logs
sam logs -n ScheduleProcessorFunction --stack-name semaphor-report-scheduler --tail

# PDF Generator logs
sam logs -n GeneratePdfFunction --stack-name semaphor-report-scheduler --tail

# Email Sender logs
sam logs -n EmailSenderFunction --stack-name semaphor-report-scheduler --tail
```

## Security Considerations

1. **API Key Security**: The `LAMBDA_API_KEY` is stored in `.env` and never committed to version control
2. **Parameter Protection**: The template uses `NoEcho: true` for the API key parameter to prevent it from appearing in CloudFormation logs
3. **S3 Bucket**:
   - Versioning enabled
   - 30-day lifecycle policy for automatic cleanup
   - Public access blocked
4. **IAM Roles**: Lambda functions use least-privilege IAM roles

## Troubleshooting

### Common Issues

1. **Deployment fails with "Parameter validation failed"**
   - Ensure your `.env` file exists and contains both required variables
   - Check that you're sourcing the `.env` file before deployment

2. **Lambda function fails with "Missing environment variable"**
   - Verify that the deployment completed successfully
   - Check CloudFormation stack parameters in AWS Console

3. **Emails not being sent**
   - Verify AWS SES is configured and email addresses are verified
   - Check EmailSenderFunction logs for errors
   - Ensure files are uploaded to the correct S3 prefix (`emails/`)

4. **PDF shows error page instead of dashboard content**
   - This occurs when the JWT token in the dashboard URL contains incorrect API endpoints
   - Check the JWT token payload - it should NOT contain localhost URLs
   - **Incorrect token** (will fail in Lambda):
     ```json
     {
       "apiServiceUrl": "http://localhost:3000/api",
       "dataServiceUrl": "http://localhost"
     }
     ```
   - **Correct token** (will work in Lambda):
     ```json
     {
       "apiServiceUrl": "https://semaphor.cloud/api",
       "dataServiceUrl": "https://semaphor.cloud"
     }
     ```
   - The Lambda function cannot reach localhost endpoints from AWS
   - Ensure the backend generates JWT tokens with production API URLs when creating dashboard links for scheduled reports

## File Structure

```
semaphor-report-scheduler/
├── .env                     # Environment variables (not in git)
├── .gitignore              # Git ignore file
├── README.md               # This file
├── CLAUDE.md               # AI assistant guide
├── deploy.sh               # Deployment script
├── template.yaml           # SAM/CloudFormation template
├── samconfig.toml          # SAM configuration
├── schedule-processor/
│   └── app.js             # Schedule processing Lambda
├── pdf-generation/
│   ├── app.js             # PDF generation Lambda
│   └── lib/
│       ├── pdf-generator.js
│       ├── csv-extractor.js
│       └── dashboard-helpers.js
└── email-sender/
    └── app.js             # Email sending Lambda
```

## Contributing

1. Never commit the `.env` file or API keys
2. Test template changes with `sam validate` before deployment
3. Update this README when adding new features or changing configuration

## License

[Your License Here]