/**
 * Types for the mark-failed Lambda
 */

export interface MarkFailedInput {
  jobId: string;
  exportToken: string;
  error: {
    Error: string;
    Cause: string;
  };
  // Other fields from the state machine input may be present
  [key: string]: unknown;
}

export interface MarkFailedResult {
  jobId: string;
  status: 'marked_failed';
  error: string;
}
