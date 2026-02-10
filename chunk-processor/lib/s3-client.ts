/**
 * S3 client utilities for chunk uploads.
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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
    })
  );

  return s3Key;
}

/**
 * Get the S3 bucket name from environment.
 */
export function getBucketName(): string {
  return BUCKET_NAME;
}
