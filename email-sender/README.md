# Email Sender Lambda

`email-sender` is the report-delivery Lambda used by Step Functions to send consolidated scheduled report emails.

## What it does

1. Receives direct invocation payloads (`action: send_consolidated` or `action: update_status`) from Step Functions / scheduler.
2. Resolves recipients + sender context (for scheduled reports via `GET /api/v1/schedules/{id}/internal`).
3. Sends one email with N attachments in a single message.
4. Applies SES size guardrail; if size is too large, sends one email with secure download links.
5. Chooses delivery provider based on `EMAIL_PROVIDER_MODE`:
   - `SES` (default)
   - `EXTERNAL` (signed webhook call)
6. Updates status via `POST /api/v1/schedules/update-status` when invoked with `action: update_status`.

## Provider modes

### 1) SES mode (default)

- Env:
  - `EMAIL_PROVIDER_MODE=SES`
  - `SES_SENDER_EMAIL=<verified sender>`
  - `SES_REGION=us-east-1` (or your SES region)
- Sends multipart MIME email with attachment via `ses:SendRawEmail`.

### 2) External mode

- Env:
  - `EMAIL_PROVIDER_MODE=EXTERNAL`
  - `EMAIL_EXTERNAL_AUTH_SECRET=<shared secret>` (required)
- Sends signed JSON payload to external provider webhook.
- Includes attachment metadata and presigned S3 URLs in payload.
- Does not download attachment bytes in `EmailSenderFunction`; provider handles fetch via `presignedUrl`.

## Recipient behavior

- `EMAIL_ENABLE_MULTI_RECIPIENTS=false` (default): sends only to first valid recipient.
- `EMAIL_ENABLE_MULTI_RECIPIENTS=true`: sends to all valid recipients.

## External webhook contract

### Request body

```json
{
  "from": "Acme Analytics <reports@acme.com>",
  "to": ["user@example.com"],
  "subject": "Weekly KPI Report",
  "text": "...",
  "html": "...",
  "attachments": [
    {
      "name": "Weekly-KPI-Report.pdf",
      "contentType": "application/pdf",
      "s3Bucket": "semaphor-reports-...",
      "s3Key": "emails/Weekly-KPI-Report.pdf",
      "presignedUrl": "https://...",
      "expiresInSeconds": 900
    }
  ],
  "metadata": {
    "scheduleId": "rule_123",
    "leaseOwner": "ready-lease-123",
    "formats": ["pdf"]
  }
}
```

### Signature headers

External mode always signs requests:

- `X-Semaphor-Timestamp`: unix epoch milliseconds
- `X-Semaphor-Signature`: `HMAC_SHA256(secret, timestamp + "." + rawJsonBody)` hex digest

### Expected response

- Success: `{"success": true, "providerMessageId": "..."}`
- Failure: non-2xx and/or `{"success": false, "error": "..."}`

## Local testing

### Invoke EmailSenderFunction locally (direct action payload)

```bash
sam local invoke EmailSenderFunction \
  -e email-sender/events/direct-consolidated.sample.json \
  --env-vars email-sender/events/env.sample.json
```

### Switch to EXTERNAL mode in local env

Edit `email-sender/events/env.sample.json`:

```json
{
  "EmailSenderFunction": {
    "EMAIL_PROVIDER_MODE": "EXTERNAL",
    "EMAIL_EXTERNAL_WEBHOOK_URL": "https://<resend-provider-function-url>",
    "EMAIL_EXTERNAL_AUTH_SECRET": "replace-with-shared-secret"
  }
}
```

## Troubleshooting

- `EMAIL_EXTERNAL_WEBHOOK_URL is required`: local invocation env is missing webhook URL (stack deploy auto-wires this value).
- `EMAIL_EXTERNAL_AUTH_SECRET is required`: set shared secret when using `EXTERNAL` mode.
- `Invalid signature`: verify shared secret and exact HMAC algorithm/body bytes.
- `No valid recipient emails found`: confirm schedule recipients resolve correctly.
- `Failed to update subscription status`: verify `SEMAPHOR_APP_URL` + `LAMBDA_API_KEY`.
