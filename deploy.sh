#!/bin/bash

set -euo pipefail

# Load environment variables from .env file
if [ ! -f .env ]; then
  echo "Error: .env file not found!"
  exit 1
fi
set -a
source .env
set +a

# Ensure esbuild is available on PATH (installed as project devDependency)
export PATH="$(pwd)/node_modules/.bin:$PATH"

# Build the SAM application
echo "Building SAM application..."
sam build

# Build parameter overrides, only including optional values when provided.
PARAMETER_OVERRIDES=(
  "SemaphorAppUrl=${SEMAPHOR_APP_URL}"
  "LambdaApiKey=${LAMBDA_API_KEY}"
  "SesSenderEmail=${SES_SENDER_EMAIL}"
  "EmailProviderMode=${EMAIL_PROVIDER_MODE:-SES}"
  "EmailEnableMultiRecipients=${EMAIL_ENABLE_MULTI_RECIPIENTS:-false}"
  "SesRegion=${SES_REGION:-us-east-1}"
)

if [ -n "${EMAIL_EXTERNAL_AUTH_SECRET:-}" ]; then
  PARAMETER_OVERRIDES+=("EmailExternalAuthSecret=${EMAIL_EXTERNAL_AUTH_SECRET}")
fi

if [ -n "${RESEND_API_KEY:-}" ]; then
  PARAMETER_OVERRIDES+=("ResendApiKey=${RESEND_API_KEY}")
fi

if [ -n "${RESEND_SENDER_EMAIL:-}" ]; then
  PARAMETER_OVERRIDES+=("ResendSenderEmail=${RESEND_SENDER_EMAIL}")
fi

# Deploy with parameter overrides from environment variables
echo "Deploying with environment variables..."
sam deploy \
  --parameter-overrides "${PARAMETER_OVERRIDES[@]}" \
  --no-confirm-changeset

echo "Deployment complete!"
