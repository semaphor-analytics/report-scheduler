/**
 * Mark Failed Lambda Handler
 *
 * Called by Step Functions when export processing fails after all retries.
 * Marks the export job as failed and creates a failure notification.
 *
 * IMPORTANT: This Lambda should NOT throw errors, as we don't want Step Functions
 * to retry it. The job has already failed - we're just recording that failure.
 */

import type { MarkFailedInput, MarkFailedResult } from './types';

const SEMAPHOR_APP_URL = process.env.SEMAPHOR_APP_URL || 'https://semaphor.cloud';
const LAMBDA_API_KEY = process.env.LAMBDA_API_KEY || '';

export async function handler(event: MarkFailedInput): Promise<MarkFailedResult> {
  const { jobId, error } = event;

  // Extract error message from Step Functions error structure
  const errorMessage = extractErrorMessage(error);

  console.log(`Marking job ${jobId} as failed: ${errorMessage}`);

  try {
    // Call the fail endpoint in semaphor-app
    // This endpoint:
    // 1. Updates job status to 'failed'
    // 2. Creates a failure notification (7-day expiry)
    const response = await fetch(
      `${SEMAPHOR_APP_URL}/api/v1/exports/internal/jobs/${jobId}/fail`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': LAMBDA_API_KEY,
        },
        body: JSON.stringify({
          error: errorMessage,
        }),
      }
    );

    if (!response.ok) {
      const responseText = await response.text();
      console.error(`Failed to mark job as failed (${response.status}): ${responseText}`);
      // Don't throw - we still return success to prevent Step Functions retry
    } else {
      console.log(`Job ${jobId} marked as failed successfully`);
    }
  } catch (err) {
    // Log the error but don't throw - we don't want Step Functions to retry
    console.error('Error calling fail endpoint:', err);
  }

  return {
    jobId,
    status: 'marked_failed',
    error: errorMessage,
  };
}

/**
 * Extract a readable error message from Step Functions error object.
 */
function extractErrorMessage(error: { Error: string; Cause: string } | undefined): string {
  if (!error) {
    return 'Unknown error occurred during export processing';
  }

  // Step Functions provides Error (type) and Cause (JSON string with details)
  const errorType = error.Error || 'Unknown';

  if (error.Cause) {
    try {
      const causeObj = JSON.parse(error.Cause);
      // Lambda errors often have an errorMessage field
      if (causeObj.errorMessage) {
        return `${errorType}: ${causeObj.errorMessage}`;
      }
      // Or it might be the full error object
      if (causeObj.message) {
        return `${errorType}: ${causeObj.message}`;
      }
      return `${errorType}: ${error.Cause}`;
    } catch {
      // Cause is not JSON, use as-is
      return `${errorType}: ${error.Cause}`;
    }
  }

  return errorType;
}
