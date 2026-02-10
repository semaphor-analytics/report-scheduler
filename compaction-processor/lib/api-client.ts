/**
 * API client for communicating with semaphor-app
 */

interface UpdateJobStatusParams {
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
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update job status (${response.status}): ${errorText}`);
  }
}

interface CompleteJobParams {
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
    const errorText = await response.text();
    throw new Error(`Failed to complete job (${response.status}): ${errorText}`);
  }
}
