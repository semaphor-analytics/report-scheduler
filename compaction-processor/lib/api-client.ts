/**
 * API client for communicating with semaphor-app
 */

interface UpdateJobStatusParams {
  signal?: AbortSignal;
  rejectClientErrors?: boolean;
  jobId: string;
  url: string;
  apiKey: string;
  status: 'compacting';
}

/**
 * Update job status to 'compacting'.
 */
export async function updateJobStatus(params: UpdateJobStatusParams): Promise<void> {
  const { jobId, url, apiKey, status } = params;

  const response = await fetch(
    `${url}/api/v1/exports/internal/jobs/${jobId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ status }),
      signal: params.signal,
    }
  );

  if (!response.ok) {
    if (params.rejectClientErrors) await rejectExportResponse(response, `Failed to update job status (${response.status}).`);
    const errorText = await response.text();
    throw new Error(`Failed to update job status (${response.status}): ${errorText}`);
  }
}

interface CompleteJobParams {
  signal?: AbortSignal;
  rejectClientErrors?: boolean;
  jobId: string;
  url: string;
  apiKey: string;
  fileKey: string;
  fileSize: number;
  totalRows: number;
}

/**
 * Mark job as completed with final file details.
 * This also triggers notification creation.
 */
export async function completeJob(params: CompleteJobParams): Promise<void> {
  const { jobId, url, apiKey, fileKey, fileSize, totalRows } = params;

  const response = await fetch(
    `${url}/api/v1/exports/internal/jobs/${jobId}/complete`,
    {
      method: 'POST',
      signal: params.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        fileKey,
        fileSize,
        totalRows,
      }),
    }
  );

  if (!response.ok) {
    if (params.rejectClientErrors) await rejectExportResponse(response, `Failed to complete job (${response.status}).`);
    const errorText = await response.text();
    throw new Error(`Failed to complete job (${response.status}): ${errorText}`);
  }
}

export class ExportQueryRejectedError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = 'ExportQueryRejectedError';
  }
}

/** Matrix opts into the app's bounded actionable error and HTTP retry policy. */
export async function rejectExportResponse(response: Response, fallback: string): Promise<never> {
  const body: unknown = await response.json().catch(() => null);
  const detail = body && typeof body === 'object' && !Array.isArray(body) && 'error' in body ? body.error : undefined;
  const message = typeof detail === 'string' && detail.trim() && detail.length <= 4096 ? detail.trim() : fallback;
  if (response.status >= 400 && response.status < 500) throw new ExportQueryRejectedError(message);
  throw new Error(message);
}
