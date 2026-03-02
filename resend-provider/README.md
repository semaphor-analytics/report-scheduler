# Resend Provider Lambda

`resend-provider` is an external email provider endpoint for `email-sender` when `EMAIL_PROVIDER_MODE=EXTERNAL`.

It is deployed in the same SAM stack and exposes a Lambda Function URL.

## What it does

1. Accepts signed webhook payload from `email-sender`.
2. Verifies HMAC signature (`X-Semaphor-Timestamp`, `X-Semaphor-Signature`).
3. Downloads each attachment from `attachments[].presignedUrl`.
4. Sends email through Resend.
5. Returns `{ success, providerMessageId?, error? }`.

## Environment variables

- `RESEND_API_KEY` (required)
- `RESEND_SENDER_EMAIL` (recommended)
- `EMAIL_EXTERNAL_AUTH_SECRET` (required)

## Request contract

See payload sample in `events/payload.sample.json`.

## Response contract

- `200`: `{"success": true, "providerMessageId": "..."}`
- `4xx/5xx`: `{"success": false, "error": "..."}`

Authentication behavior:
- Missing `EMAIL_EXTERNAL_AUTH_SECRET`: `500` (server misconfiguration)
- Missing/invalid/expired signature headers: `401`

## Local invocation

Generate a signed Function URL event first (required because signature enforcement is always on):

```bash
EMAIL_EXTERNAL_AUTH_SECRET=replace-with-shared-secret \
node resend-provider/scripts/generate-signed-event.js \
  --out /tmp/resend-signed-event.json
```

Then invoke locally:

```bash
sam local invoke ResendProviderFunction \
  -e /tmp/resend-signed-event.json \
  --env-vars email-sender/events/env.sample.json
```

Notes:
- Default payload source is `resend-provider/events/payload.sample.json`.
- Use `--payload <path>` to sign a different payload file.

## Deployed testing

1. Deploy scheduler stack.
2. Fetch `ResendProviderFunctionUrl` output.
3. Set `EMAIL_PROVIDER_MODE=EXTERNAL` in `.env`.
4. Set `EMAIL_EXTERNAL_AUTH_SECRET` in `.env`.
5. Redeploy and trigger a report email.
