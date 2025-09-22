#!/bin/bash

# Load environment variables from .env file
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "Error: .env file not found!"
    exit 1
fi

# Build the SAM application
echo "Building SAM application..."
sam build

# Deploy with parameter overrides from environment variables
echo "Deploying with environment variables..."
sam deploy \
    --parameter-overrides \
    SemaphorAppUrl="${SEMAPHOR_APP_URL}" \
    LambdaApiKey="${LAMBDA_API_KEY}" \
    SesSenderEmail="${SES_SENDER_EMAIL}" \
    --no-confirm-changeset

echo "Deployment complete!"