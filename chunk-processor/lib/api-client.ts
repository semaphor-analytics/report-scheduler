/**
 * API client for communicating with semaphor-app
 */

import type {
  CardConfig,
  QueryResponse,
  ChunkStatusResponse,
} from '../types';
import type { FlatTableExportTotalsRequest } from 'react-semaphor/format-utils';

interface QueryDataParams {
  url: string;
  token: string;
  cardConfig: CardConfig;
  chunkNumber: number;
  chunkSize: number;
  tableTotalsRequest?: FlatTableExportTotalsRequest;
}

/**
 * Query data from semaphor-app for a specific chunk.
 * Uses the export token which carries all security policies (CLS/RCLS/TLS).
 */
export async function queryData(params: QueryDataParams): Promise<QueryResponse> {
  const {
    url,
    token,
    cardConfig,
    chunkNumber,
    chunkSize,
    tableTotalsRequest,
  } = params;

  const response = await fetch(`${url}/api/v1/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      ...cardConfig,
      exportMode: true,
      exportType: 'chunked',
      pagination: {
        page: chunkNumber,
        pageSize: chunkSize,
      },
      ...(tableTotalsRequest ? { tableTotalsRequest } : {}),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Query failed (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<QueryResponse>;
}

/**
 * Fetch chunk status for idempotency check.
 * Returns null only when the chunk does not exist. Availability and server
 * failures remain errors so callers cannot confuse unknown state with an
 * unfinished chunk.
 */
export async function fetchChunkStatus(
  chunkId: string,
  url: string,
  apiKey: string
): Promise<ChunkStatusResponse | null> {
  const response = await fetch(
    `${url}/api/v1/exports/internal/chunks/${chunkId}`,
    {
      headers: { 'X-API-Key': apiKey },
    }
  );

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch chunk status (${response.status}): ${errorText}`,
    );
  }
  return response.json() as Promise<ChunkStatusResponse>;
}

interface UpdateChunkParams {
  chunkId: string;
  url: string;
  apiKey: string;
  status: 'processing' | 'completed' | 'failed';
  rowCount?: number;
  s3Key?: string;
  error?: string;
}

/**
 * Update chunk status in semaphor-app.
 * Called after processing to mark chunk as completed or failed.
 */
export async function updateChunkStatus(params: UpdateChunkParams): Promise<void> {
  const { chunkId, url, apiKey, status, rowCount, s3Key, error } = params;

  const body: Record<string, unknown> = { status };
  if (rowCount !== undefined) body.rowCount = rowCount;
  if (s3Key) body.s3Key = s3Key;
  if (error) body.error = error;

  const response = await fetch(
    `${url}/api/v1/exports/internal/chunks/${chunkId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update chunk status (${response.status}): ${errorText}`);
  }
}
