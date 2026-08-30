#!/bin/bash

set -euo pipefail

# Install dependencies deterministically for every deploy to avoid stale/missing
# function-level artifacts in self-hosted environments.
install_dependencies() {
  echo "Installing root dependencies (including dev tools)..."
  NPM_CONFIG_OMIT= npm ci --include=dev

  echo "Building the structured Fast PDF policy adapter..."
  npm run build:pdf-export-policy

  echo "Installing pdf-generation dependencies..."
  (cd pdf-generation && npm ci)

  echo "Installing schedule-processor dependencies..."
  (cd schedule-processor && npm ci)

  echo "Installing email-sender dependencies..."
  (cd email-sender && npm ci)

  echo "Installing insight-runner dependencies..."
  (cd insight-runner && npm ci)

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

resolve_stack_name() {
  if [ -n "${SAM_STACK_NAME:-}" ]; then
    echo "$SAM_STACK_NAME"
    return
  fi

  if [ -n "${STACK_NAME:-}" ]; then
    echo "$STACK_NAME"
    return
  fi

  if [ -f samconfig.toml ]; then
    awk -F= '
      /^[[:space:]]*stack_name[[:space:]]*=/ {
        value = $2
        gsub(/[ "]/, "", value)
        print value
        exit
      }
    ' samconfig.toml
  fi
}

print_stack_outputs() {
  local stack_name
  stack_name="$(resolve_stack_name)"

  if [ -z "$stack_name" ]; then
    echo "Deployment complete, but stack outputs were not printed because the stack name could not be resolved."
    echo "Run: sam list stack-outputs --stack-name <your-stack-name>"
    return
  fi

  echo "Deployment complete. Stack outputs for ${stack_name}:"
  if ! sam list stack-outputs --stack-name "$stack_name"; then
    echo "Warning: unable to print stack outputs."
    echo "Run manually: sam list stack-outputs --stack-name ${stack_name}"
  fi
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

ARTIFACT_SDK_PATHS=(
  ".aws-sam/build/GeneratePdfFunction/node_modules/@aws-sdk/client-s3/package.json"
  ".aws-sam/build/GeneratePdfFunction/node_modules/@aws-sdk/s3-request-presigner/package.json"
)
for artifact_sdk_path in "${ARTIFACT_SDK_PATHS[@]}"; do
  if [ ! -f "$artifact_sdk_path" ]; then
    echo "Error: missing an AWS SDK v3 package in GeneratePdfFunction build artifact:"
    echo "  $artifact_sdk_path"
    echo "This usually indicates npm registry/network issues or incomplete dependency install in the build environment."
    echo "Verify internet/private registry access, then rerun ./deploy.sh."
    exit 1
  fi
done

# Build parameter overrides, only including optional values when provided.
PARAMETER_OVERRIDES=(
  "SemaphorAppUrl=${SEMAPHOR_APP_URL}"
  "LambdaApiKey=${LAMBDA_API_KEY}"
  "SesSenderEmail=${SES_SENDER_EMAIL}"
  "EmailProviderMode=${EMAIL_PROVIDER_MODE:-SES}"
  "SesRegion=${SES_REGION:-us-east-1}"
  "PdfEncryptionBackend=${PDF_ENCRYPTION_BACKEND:-qpdf}"
  "AutomationDispatchRuleState=ENABLED"
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

if [ -n "${INSIGHT_LOOP_MODEL_PROVIDER:-}" ]; then
  PARAMETER_OVERRIDES+=("InsightLoopModelProvider=${INSIGHT_LOOP_MODEL_PROVIDER}")
fi

if [ -n "${INSIGHT_LOOP_MODEL:-}" ]; then
  PARAMETER_OVERRIDES+=("InsightLoopModel=${INSIGHT_LOOP_MODEL}")
fi

if [ -n "${INSIGHT_LOOP_REASONING_EFFORT:-}" ]; then
  PARAMETER_OVERRIDES+=("InsightLoopReasoningEffort=${INSIGHT_LOOP_REASONING_EFFORT}")
fi

if [ -n "${OPENAI_API_KEY:-}" ]; then
  PARAMETER_OVERRIDES+=("OpenAiApiKey=${OPENAI_API_KEY}")
fi

# Deploy with parameter overrides from environment variables
echo "Deploying with environment variables..."
sam deploy \
  --parameter-overrides "${PARAMETER_OVERRIDES[@]}" \
  --no-confirm-changeset

print_stack_outputs
