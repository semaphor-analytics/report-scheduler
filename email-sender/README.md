# Email Sender Lambda

`email-sender` is the S3-triggered Lambda that sends scheduled report emails when files land under the `emails/` prefix.

## What it does

1. Receives S3 `ObjectCreated:Put` event.
2. Reads S3 object tags (`scheduleId`, `leaseOwner`, `attachmentName`, `format`, etc.).
3. Resolves recipients + message content:
   - Scheduled reports: fetches from `GET /api/v1/schedules/{id}/internal`
   - Direct emails: uses S3 tags (`email`, `subject`)
4. Chooses delivery provider based on `EMAIL_PROVIDER_MODE`:
   - `SES` (default)
   - `EXTERNAL` (signed webhook call)
5. Updates status via `POST /api/v1/schedules/update-status` for scheduled reports.

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
- Includes attachment metadata and a presigned S3 URL in payload.
- Does not download the attachment bytes in `EmailSenderFunction`; provider handles attachment fetch via `presignedUrl`.

## Recipient behavior

- `EMAIL_ENABLE_MULTI_RECIPIENTS=false` (default): sends only to first valid recipient (legacy-compatible behavior).
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
  "attachment": {
    "name": "Weekly-KPI-Report.pdf",
    "contentType": "application/pdf",
    "s3Bucket": "semaphor-reports-...",
    "s3Key": "emails/Weekly-KPI-Report.pdf",
    "presignedUrl": "https://...",
    "expiresInSeconds": 900
  },
  "metadata": {
    "scheduleId": "rule_123",
    "leaseOwner": "legacy-ready-123",
    "format": "pdf"
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

### Invoke EmailSenderFunction locally

```bash
sam local invoke EmailSenderFunction \
  -e email-sender/events/s3-event.sample.json \
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
