# Email Sender Lambda

`email-sender` is the report-delivery Lambda used by Step Functions to send scheduled report emails to every resolved recipient.

## What it does

1. Receives direct invocation payloads (`action: send_consolidated`,
   `action: send_consolidated_from_domain_v1`,
   `action: send_consolidated_branded_v1`,
   `action: send_consolidated_branded_v2`, or `action: update_status`) from
   Step Functions / scheduler, and signed Function URL report-email and
   sending-domain requests from Semaphor App.
2. Resolves recipients + sender context (for scheduled reports via `GET /api/v1/schedules/{id}/internal`).
3. Sends one email per recipient with the same attachment set.
4. Applies the existing email size guardrail to SES and external delivery; gzip is
   measured after decoding. Oversized files become secure download links. Admitted
   external attachments carry a signed `maxBytes` bound enforced by the receiver.
5. Chooses delivery provider based on `EMAIL_PROVIDER_MODE`:
   - `SES` (default)
   - `EXTERNAL` (signed webhook call)
6. Updates status via `POST /api/v1/schedules/update-status` when invoked with `action: update_status`.

## Provider modes

## Semaphor App Briefings Function URL

`EmailSenderFunction` also exposes a Lambda Function URL so Semaphor App can
send on-demand or scheduled Briefing email packages without embedding
provider-specific email logic in Semaphor App.

Configure the existing Lambda API key on both services:

```bash
# semaphor-report-scheduler SAM parameter / Lambda env
LAMBDA_API_KEY=<shared-internal-api-key>

# semaphor-app env
BRIEFINGS_EMAIL_SENDER_URL=<EmailSenderFunctionUrl output>
LAMBDA_API_KEY=<same-shared-internal-api-key>
```

Semaphor App calls the Function URL with:

```http
POST /
X-API-Key: <shared-internal-api-key>
Content-Type: application/json
```

```json
{
  "action": "send_consolidated",
  "recipients": ["user@example.com"],
  "subject": "Weekly KPI Report",
  "message": "Hello, please find the report attached.",
  "layout": "plain",
  "attachments": [
    {
      "attachmentName": "KPI Dashboard",
      "format": "pdf",
      "contentType": "application/pdf",
      "s3Bucket": "semaphor-reports-...",
      "s3Key": "emails/kpi-dashboard.pdf",
      "sizeBytes": 12345
    }
  ]
}
```

The Function URL supports `send_consolidated`, `send_consolidated_from_domain_v1`,
`send_consolidated_branded_v1`, `send_consolidated_branded_v2`,
`sender_domain_setup`, `sender_domain_status`, and `sender_domain_delete`.
`update_status` remains a
direct Lambda invocation path for the existing scheduled-report Step Functions
workflow. Both branded send actions require the strict version 1 `branding`
object. The unbranded custom-domain action rejects branding and requires a
validated top-level `fromAddress`. Branded v1 rejects `fromAddress`; branded v2
requires it. Both custom-domain send actions are available only in SES mode.

The SES-only domain actions use SES v2 Easy DKIM. Setup creates the exact
domain identity and returns its three CNAME records. Status inspects that exact
identity and returns `VERIFIED` only for a domain identity with DKIM `SUCCESS`
and `VerifiedForSendingStatus: true`. Delete removes the exact identity and
treats an already missing identity as successful cleanup. The actions never
query DNS or tag or list identities. Initial setup refuses an identity that
already exists; `allowExisting: true` is reserved for the app's explicit
ambiguous-setup retry.

### 1) SES mode (default)

- Env:
  - `EMAIL_PROVIDER_MODE=SES`
  - `SES_SENDER_EMAIL=<verified sender>`
  - `SES_REGION=us-east-1` (or your SES region)
- Sends multipart MIME email with attachment via `ses:SendRawEmail`.
- Creates, reads, and removes Easy DKIM identities via
  `ses:CreateEmailIdentity`, `ses:GetEmailIdentity`, and
  `ses:DeleteEmailIdentity` for authenticated domain setup, status, and
  removal actions.

### 2) External mode

- Env:
  - `EMAIL_PROVIDER_MODE=EXTERNAL`
  - `EMAIL_EXTERNAL_AUTH_SECRET=<shared secret>` (required)
- Sends signed JSON payload to external provider webhook.
- Includes attachment metadata and presigned S3 URLs in payload.
- Does not download attachment bytes in `EmailSenderFunction`; provider handles fetch via `presignedUrl`.

## Recipient behavior

- All resolved recipients receive the report.
- Each recipient is sent separately to avoid exposing recipient addresses to one another.

## `send_consolidated` result

The Lambda returns an aggregate result for the schedule run, including:

- `success` / `allSucceeded`
- `recipientCount`
- `successCount`
- `failureCount`
- `failedRecipients`
- `providerMessageIds`
- `statusMessage`

## External webhook contract

Unbranded payloads retain the version 1 object below. For branded delivery,
the sender automatically adds `contractVersion: 2`, required `fromName`, and
optional `replyTo` and `bcc`. BCC never appears in MIME headers; the provider
receives it as an envelope field. The bundled Resend provider
validates the versioned group, keeps `RESEND_SENDER_EMAIL` as the address, and
uses the customer name only as its display name.

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
