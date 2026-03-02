#!/bin/bash

set -euo pipefail

# Install dependencies deterministically for every deploy to avoid stale/missing
# function-level artifacts in self-hosted environments.
install_dependencies() {
  echo "Installing root dependencies (including dev tools)..."
  NPM_CONFIG_OMIT= npm ci --include=dev

  echo "Installing pdf-generation dependencies..."
  (cd pdf-generation && npm ci)

  echo "Installing schedule-processor dependencies..."
  (cd schedule-processor && npm ci)

  echo "Installing email-sender dependencies..."
  (cd email-sender && npm ci)

  echo "Installing chunk-processor dependencies..."
  (cd chunk-processor && npm ci)

  echo "Installing compaction-processor dependencies..."
  (cd compaction-processor && npm ci)

  echo "Installing mark-failed dependencies..."
  (cd mark-failed && npm ci)
}

ensure_esbuild() {
  if command -v esbuild >/dev/null 2>&1; then
    echo "Using esbuild at: $(command -v esbuild)"
    esbuild --version
    return
  fi

  echo "Error: esbuild is not available on PATH."
  echo "SAM NodejsNpmEsbuildBuilder requires host esbuild for TypeScript lambdas."
  echo "Expected binary path: $(pwd)/node_modules/.bin/esbuild"
  echo "Try:"
  echo "  NPM_CONFIG_OMIT= npm ci --include=dev"
  echo "  export PATH=\"$(pwd)/node_modules/.bin:\$PATH\""
  echo "  esbuild --version"
  exit 1
}

# Load environment variables from .env file
if [ ! -f .env ]; then
  echo "Error: .env file not found!"
  exit 1
fi
set -a
source .env
set +a

install_dependencies

# Ensure esbuild is available on PATH (installed as project devDependency)
export PATH="$(pwd)/node_modules/.bin:$PATH"
ensure_esbuild

# Build the SAM application
echo "Building SAM application..."
sam build --use-container --no-cached

ARTIFACT_SDK_PATH=".aws-sam/build/GeneratePdfFunction/node_modules/aws-sdk/package.json"
if [ ! -f "$ARTIFACT_SDK_PATH" ]; then
  echo "Error: missing aws-sdk in GeneratePdfFunction build artifact:"
  echo "  $ARTIFACT_SDK_PATH"
  echo "This usually indicates npm registry/network issues or incomplete dependency install in the build environment."
  echo "Verify internet/private registry access, then rerun ./deploy.sh."
  exit 1
fi

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
