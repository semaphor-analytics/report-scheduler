# AWS Simple Email Service (SES) Setup Guide

This guide provides comprehensive instructions for setting up AWS SES to enable email sending capabilities for the Semaphor Report Scheduler.

## Prerequisites

- AWS Account with appropriate IAM permissions
- Access to AWS Management Console or AWS CLI
- Domain ownership (for custom sender email addresses)

## Step 1: Access AWS SES Console

1. Log in to the [AWS Management Console](https://console.aws.amazon.com/)
2. Navigate to **Simple Email Service (SES)** or search for "SES" in the services search bar
3. Select your preferred AWS region (must match your Lambda deployment region)

## Step 2: Verify Your Sender Email Address

### Option A: Verify Individual Email Address (Quick Start)

1. In the SES console, go to **Configuration** → **Verified identities**
2. Click **Create identity**
3. Choose **Email address**
4. Enter your sender email (e.g., `noreply@yourdomain.com`)
5. Click **Create identity**
6. Check the email inbox and click the verification link
7. Verification status will update to "Verified" in the console

### Option B: Verify Entire Domain (Recommended for Production)

1. In the SES console, go to **Configuration** → **Verified identities**
2. Click **Create identity**
3. Choose **Domain**
4. Enter your domain (e.g., `yourdomain.com`)
5. Choose **Easy DKIM** and configure DKIM signing
6. Click **Create identity**
7. Add the provided DNS records to your domain:
   - **MX record** for email receiving (optional)
   - **TXT record** for domain verification
   - **CNAME records** for DKIM authentication
8. Wait for DNS propagation (usually 15-72 hours)
9. Domain status will update to "Verified" once DNS records are confirmed

## Step 3: Configure SES for Production Use

### Remove Sandbox Restrictions

By default, new SES accounts are in "sandbox mode" with these limitations:

- Can only send to verified email addresses
- Limited to 200 emails per day
- Maximum send rate of 1 email per second

To remove sandbox restrictions:

1. Go to **Account dashboard** in SES console
2. Click **Request production access**
3. Fill out the request form:
   - **Mail Type**: Choose "Transactional"
   - **Website URL**: Your Semaphor application URL
   - **Use Case Description**:
     ```
     Automated report distribution system that sends scheduled
     business intelligence reports (PDF/CSV) to authorized users
     of our self-hosted analytics platform.
     ```
   - **Additional Information**: Describe your email sending practices
   - **Acknowledgments**: Check all required boxes
4. Submit the request
5. AWS typically responds within 24-48 hours

### Monitor Your Sending Reputation

1. Enable **Reputation Dashboard**:

   - Go to **Reputation dashboard**
   - Click **Enable** to start tracking

2. Set up **SNS Notifications** for bounces and complaints:
   - Go to **Configuration** → **Verified identities**
   - Select your verified domain/email
   - Under **Notifications**, configure SNS topics for:
     - Bounces
     - Complaints
     - Deliveries (optional)

## Step 4: Configure Sending Limits

Once in production, monitor and adjust your sending limits:

1. View current limits in **Account dashboard**
2. Gradual limit increases happen automatically based on good sending practices
3. For immediate increases, submit a support case

## Step 5: Update Application Configuration

After verifying your sender email/domain, update your application:

1. Copy `.env.example` to `.env`
2. Update the `SES_SENDER_EMAIL` variable:

   ```bash
   # For simple email address
   SES_SENDER_EMAIL=noreply@yourdomain.com

   # For email with display name
   SES_SENDER_EMAIL="Your Company Name <noreply@yourdomain.com>"
   ```

3. Deploy the application:
   ```bash
   ./deploy.sh
   ```

## Step 6: Test Email Sending

### Using SES Simulator (Sandbox Mode)

Test with SES simulator addresses without leaving sandbox:

- Success: `success@simulator.amazonses.com`
- Bounce: `bounce@simulator.amazonses.com`
- Complaint: `complaint@simulator.amazonses.com`
- Suppression List: `suppressionlist@simulator.amazonses.com`

### Testing Your Configuration

1. Trigger a test email through your application
2. Check CloudWatch Logs for the EmailSenderFunction
3. Monitor SES console for sending statistics

## Troubleshooting

### Common Issues and Solutions

| Issue                                                 | Solution                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| **"Email address not verified"**                      | Verify sender email in SES console                                         |
| **"Message rejected: Email address is not verified"** | Account is in sandbox mode - verify recipient or request production access |
| **"Could not connect to SMTP host"**                  | Check Lambda function's VPC/security group settings                        |
| **"Maximum sending rate exceeded"**                   | Implement exponential backoff or request limit increase                    |
| **No emails received**                                | Check spam folder; verify DNS records; check SES suppression list          |

### Checking Email Status

1. **SES Console**:

   - Go to **Monitoring** → **Sending statistics**
   - View sends, bounces, complaints, and deliveries

2. **CloudWatch Logs**:

   ```bash
   aws logs tail /aws/lambda/semaphor-report-scheduler-EmailSenderFunction --follow
   ```

3. **SES Event Publishing**:
   - Configure event publishing to track email events
   - Send events to CloudWatch, SNS, or Kinesis

### DNS Troubleshooting

Verify DNS records are properly configured:

```bash
# Check domain verification TXT record
dig TXT _amazonses.yourdomain.com

# Check DKIM CNAME records
dig CNAME [selector]._domainkey.yourdomain.com

# Check MX record (if configured)
dig MX yourdomain.com
```

## Best Practices

1. **Use Domain Verification** instead of individual email verification for production
2. **Enable DKIM** signing for better deliverability
3. **Set up SPF** records to prevent spoofing
4. **Monitor metrics** regularly (bounce rate < 5%, complaint rate < 0.1%)
5. **Implement retry logic** with exponential backoff for transient failures
6. **Use configuration sets** to track email sending events
7. **Maintain suppression lists** to respect user preferences
8. **Include unsubscribe links** in email templates (if applicable)

## Regional Considerations

### Available SES Regions

SES is available in these AWS regions:

- US East (N. Virginia) - `us-east-1`
- US West (Oregon) - `us-west-2`
- EU (Ireland) - `eu-west-1`
- EU (Frankfurt) - `eu-central-1`
- Asia Pacific (Singapore) - `ap-southeast-1`
- Asia Pacific (Sydney) - `ap-southeast-2`
- And others...

### Important Notes

- Email verification is **region-specific**
- Lambda function and SES should be in the **same region** for optimal performance
- The Lambda function's SES client is configured for `us-east-1` by default

To change the SES region, update the SES client initialization in `email-sender/app.js`:

```javascript
const ses = new AWS.SES({ region: 'your-preferred-region' });
```

## Support and Resources

- [AWS SES Documentation](https://docs.aws.amazon.com/ses/)
- [SES Best Practices](https://docs.aws.amazon.com/ses/latest/dg/best-practices.html)

For application-specific issues, contact your system administrator or refer to the main [README.md](README.md).
