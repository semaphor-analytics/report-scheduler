/**
 * Mark Failed Lambda Handler
 *
 * Called by Step Functions when export processing fails after all retries.
 * Asks semaphor-app to fail the export job; the app stores the customer
 * message and writes the failure notification in one transaction.
 *
 * It fails loudly (MX-D7): a non-2xx response or a network error throws, so
 * the `MarkExportFailed` state retries it and, once retries run out, the
 * execution ends FAILED instead of reporting success. The app still settles
 * the job at its deadline. The app-issued failure `reason`, when the worker's
 * failure output carries one, is forwarded unchanged; the app validates it.
 */

import type { MarkFailedInput, MarkFailedResult } from './types';

const SEMAPHOR_APP_URL = process.env.SEMAPHOR_APP_URL || 'https://semaphor.cloud';
const LAMBDA_API_KEY = process.env.LAMBDA_API_KEY || '';

export async function handler(event: MarkFailedInput): Promise<MarkFailedResult> {
  const { jobId, error } = event;

  // Extract error message from Step Functions error structure
  const errorMessage = extractErrorMessage(error);
  const reason = extractFailureReason(error);

  console.log(`Marking job ${jobId} as failed`, {
    errorMessage,
    reason,
    orchestrationError: error,
  });

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
        ...(reason ? { reason } : {}),
      }),
    }
  );

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    throw new Error(`Failed to mark job ${jobId} as failed (${response.status}): ${responseText.slice(0, 500)}`);
  }
  console.log(`Job ${jobId} marked as failed successfully`);

  return {
    jobId,
    status: 'marked_failed',
    error: errorMessage,
  };
}

/**
 * Extract a readable error message from Step Functions error object.
 */
function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Remove the query transport wrapper while preserving the actionable message
 * returned by semaphor-app. This parses a known JSON envelope; it does not
 * inspect or interpret SQL text.
 */
export function normalizeExportFailureMessage(message: string): string {
  const normalized = message.trim();
  // The worker's relay envelope: the app's error text and its failure reason.
  const relayed = parseJsonRecord(normalized);
  if (relayed && nonEmptyString(relayed.reason) && nonEmptyString(relayed.error))
    return nonEmptyString(relayed.error)!;
  const queryPrefix = 'Query failed (';
  const payloadSeparator = '): ';

  if (!normalized.startsWith(queryPrefix)) {
    return normalized;
  }

  const payloadStart = normalized.indexOf(payloadSeparator, queryPrefix.length);
  if (payloadStart === -1) {
    return normalized;
  }

  const payload = parseJsonRecord(
    normalized.slice(payloadStart + payloadSeparator.length),
  );
  if (!payload) {
    return normalized;
  }

  return (
    nonEmptyString(payload.error) ||
    nonEmptyString(payload.message) ||
    normalized
  );
}

export function extractErrorMessage(
  error: { Error: string; Cause: string } | undefined,
): string {
  if (!error) {
    return 'Unknown error occurred during export processing';
  }

  // Step Functions provides Error (type) and Cause (JSON string with details)
  const errorType = error.Error || 'Unknown';

  if (error.Cause) {
    const causeObj = parseJsonRecord(error.Cause);
    if (causeObj) {
      const causeMessage =
        nonEmptyString(causeObj.errorMessage) ||
        nonEmptyString(causeObj.message) ||
        nonEmptyString(causeObj.error);
      if (causeMessage) {
        return normalizeExportFailureMessage(causeMessage);
      }
    }

    return normalizeExportFailureMessage(error.Cause);
  }

  return errorType;
}

/**
 * The failure reason semaphor-app issued, carried in the worker's relay
 * envelope (`{"error": ..., "reason": ...}` as the Lambda error message).
 * Returned unchanged: the app accepts only reasons it recognizes. Never
 * derived here from a status or message.
 */
export function extractFailureReason(
  error: { Error: string; Cause: string } | undefined,
): string | undefined {
  const cause = error?.Cause ? parseJsonRecord(error.Cause) : null;
  const message = nonEmptyString(cause?.errorMessage);
  const relayed = message ? parseJsonRecord(message) : null;
  return nonEmptyString(relayed?.reason) ?? undefined;
}
