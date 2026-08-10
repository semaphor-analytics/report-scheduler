/**
 * S3 client utilities for chunk uploads.
 */

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { FlatTableExportTotalsByColumnId } from 'react-semaphor/format-utils';
import {
  parseRawTemporalChunkClassificationEvidence,
  type RawTemporalChunkClassificationEvidence,
} from 'react-semaphor/format-utils';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
});

const BUCKET_NAME = process.env.S3_BUCKET || '';

interface UploadChunkParams {
  jobId: string;
  chunkNumber: number;
  content: string;
}

/**
 * Upload a chunk CSV file to S3.
 * Path: exports/{jobId}/deltas/{chunkNumber:03d}.csv
 */
export async function uploadChunk(params: UploadChunkParams): Promise<string> {
  const { jobId, chunkNumber, content } = params;

  // Pad chunk number to 3 digits (001, 002, etc.)
  const paddedNumber = String(chunkNumber).padStart(3, '0');
  const s3Key = `exports/${jobId}/deltas/${paddedNumber}.csv`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: content,
      ContentType: 'text/csv',
    }),
  );

  return s3Key;
}

export function getTableTotalsMetadataKey(jobId: string): string {
  return `exports/${jobId}/deltas/001.totals.json`;
}

export async function uploadTableTotalsMetadata(params: {
  jobId: string;
  totalsByColumnId: FlatTableExportTotalsByColumnId;
}): Promise<string> {
  const s3Key = getTableTotalsMetadataKey(params.jobId);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: JSON.stringify(params.totalsByColumnId),
      ContentType: 'application/json',
    }),
  );
  return s3Key;
}

export async function fetchTableTotalsMetadata(
  jobId: string,
): Promise<unknown> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: getTableTotalsMetadataKey(jobId),
    }),
  );
  if (!response.Body) {
    throw new Error(`No table totals metadata found for export ${jobId}`);
  }
  return JSON.parse(await response.Body.transformToString());
}

export function getRawTemporalClassificationKey(
  jobId: string,
  chunkNumber: number,
): string {
  const paddedNumber = String(chunkNumber).padStart(3, '0');
  return `exports/${jobId}/deltas/${paddedNumber}.raw-temporal.json`;
}

export async function uploadRawTemporalClassification(params: {
  jobId: string;
  chunkNumber: number;
  evidence: RawTemporalChunkClassificationEvidence;
}): Promise<string> {
  const evidence = parseRawTemporalChunkClassificationEvidence(
    params.evidence,
  );
  const s3Key = getRawTemporalClassificationKey(
    params.jobId,
    params.chunkNumber,
  );
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: JSON.stringify(evidence),
      ContentType: 'application/json',
    }),
  );
  return s3Key;
}

export async function fetchRawTemporalClassification(params: {
  jobId: string;
  chunkNumber: number;
}): Promise<unknown> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: getRawTemporalClassificationKey(params.jobId, params.chunkNumber),
    }),
  );
  if (!response.Body) {
    throw new Error(
      `No raw temporal classification found for export ${params.jobId} chunk ${params.chunkNumber}`,
    );
  }
  return JSON.parse(await response.Body.transformToString());
}

/**
 * Get the S3 bucket name from environment.
 */
export function getBucketName(): string {
  return BUCKET_NAME;
}
