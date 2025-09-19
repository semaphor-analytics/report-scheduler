# Semaphor Report Scheduler

AWS SAM application for automated report generation and email delivery.

## Prerequisites

- AWS CLI configured with appropriate credentials
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) installed
- Node.js 18.x or later
- Docker (for building Lambda functions)
- AWS SES configured for email sending

## Quick Start

### 1. Clone and Configure

```bash
# Clone the repository
git clone <repository-url>
cd report-scheduler

# Create your configuration file
cp .env.example .env
```

### 2. Update Configuration

Edit `.env` with your values:

```bash
# Your Semaphor application URL
SEMAPHOR_APP_URL=https://your-semaphor-instance.com

# API key for Lambda authentication
LAMBDA_API_KEY=your-api-key-here
```

### 3. Deploy to AWS

```bash
# Deploy using the included script
./deploy.sh

# Or deploy manually
sam build --use-container
sam deploy --guided  # First time only
```

## Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `SEMAPHOR_APP_URL` | Base URL of your Semaphor application | `https://app.semaphor.com` |
| `LAMBDA_API_KEY` | API key for Lambda function authentication | `sk_lambda_abc123...` |

### AWS Resources Created

The deployment will create:
- 3 Lambda functions (Schedule Processor, PDF Generator, Email Sender)
- S3 bucket for storing generated reports
- EventBridge rule for scheduling
- IAM roles with appropriate permissions

### Email Configuration

Ensure AWS SES is configured in your region:
1. Verify your sender email domain in AWS SES
2. Move out of SES sandbox for production use
3. Configure appropriate sending limits

## Deployment Options

### First-Time Deployment

```bash
# Build and deploy with guided configuration
sam build --use-container
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

### Custom Stack Name

```bash
# Deploy with custom stack name
sam deploy --stack-name my-custom-stack
```

## Troubleshooting

### Common Issues

**Build Fails**
- Ensure Docker is running: `docker ps`
- Check Node.js version: `node --version` (should be 18.x or later)

**Deployment Fails**
- Verify AWS credentials: `aws sts get-caller-identity`
- Check IAM permissions for CloudFormation, Lambda, S3

**Functions Not Running**
- Check CloudWatch Logs: `aws logs tail /aws/lambda/your-function-name`
- Verify environment variables are set correctly

**Email Not Sending**
- Verify SES configuration in your AWS region
- Check sender email is verified in SES
- Review SES sending limits

### Logs

View Lambda logs in CloudWatch:

```bash
# Tail logs for specific function
sam logs -n ScheduleProcessorFunction --stack-name semaphor-report-scheduler --tail
```

## Updating

To update the application:

1. Pull latest changes
2. Update `.env` if needed
3. Run `./deploy.sh`

## Cleanup

To remove all resources:

```bash
# Delete the CloudFormation stack
sam delete --stack-name semaphor-report-scheduler
```

## Support

For issues or questions, please contact your administrator or refer to the [AWS SAM documentation](https://docs.aws.amazon.com/serverless-application-model/).

## License

© 2025 Semaphor Analytics. All rights reserved.