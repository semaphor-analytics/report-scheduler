/**
 * S3 client utilities for compaction operations.
 */

import {
  S3Client,
  GetObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable, PassThrough } from 'stream';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, readFile, stat, unlink } from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
});

const BUCKET_NAME = process.env.S3_BUCKET || '';
const LOCAL_STORAGE_DIR = process.env.LOCAL_EXPORT_STORAGE_DIR?.trim() || '';

function localObjectPath(key: string): string {
  const root = path.resolve(LOCAL_STORAGE_DIR);
  const candidate = path.resolve(root, key);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Invalid local export object key: ${key}`);
  }
  return candidate;
}

/**
 * Get a readable stream for an S3 object.
 */
export async function getObjectStream(key: string): Promise<Readable> {
  if (LOCAL_STORAGE_DIR) {
    return createReadStream(localObjectPath(key));
  }
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    })
  );

  if (!response.Body) {
    throw new Error(`No body returned for S3 object: ${key}`);
  }

  return response.Body as Readable;
}

/**
 * Fetch the durable raw-temporal classification stored beside a completed
 * chunk. Parsing and contract validation remain owned by the caller so this
 * transport helper does not duplicate the shared format-utils contract.
 */
export async function fetchRawTemporalClassificationByKey(
  key: string,
): Promise<unknown> {
  if (LOCAL_STORAGE_DIR) {
    return JSON.parse(await readFile(localObjectPath(key), 'utf8'));
  }
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }),
  );

  if (!response.Body) {
    throw new Error(`No body returned for raw temporal sidecar: ${key}`);
  }

  return JSON.parse(await response.Body.transformToString());
}

/**
 * Upload a stream to S3 using multipart upload.
 * Returns the final file size.
 */
export async function uploadStream(
  key: string,
  stream: PassThrough,
  contentType: string = 'application/gzip'
): Promise<number> {
  if (LOCAL_STORAGE_DIR) {
    const filePath = localObjectPath(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await pipeline(stream, createWriteStream(filePath));
    return (await stat(filePath)).size;
  }
  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: BUCKET_NAME,
      Key: key,
      Body: stream,
      ContentType: contentType,
      // Note: Don't set ContentEncoding: 'gzip' here - that would cause S3/browsers
      // to auto-decompress on download, but we want the file to stay compressed
    },
  });

  const result = await upload.done();

  // Get the size from the completed upload
  // The Upload class doesn't directly return size, so we track it during streaming
  // For now, return 0 and let the caller track size if needed
  return 0;
}

/**
 * Delete multiple S3 objects.
 */
export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  if (LOCAL_STORAGE_DIR) {
    await Promise.all(
      keys.map((key) => unlink(localObjectPath(key)).catch(() => undefined)),
    );
    return;
  }

  // S3 DeleteObjects has a limit of 1000 objects per request
  const batches: string[][] = [];
  for (let i = 0; i < keys.length; i += 1000) {
    batches.push(keys.slice(i, i + 1000));
  }

  for (const batch of batches) {
    await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET_NAME,
        Delete: {
          Objects: batch.map((key) => ({ Key: key })),
          Quiet: true,
        },
      })
    );
  }
}

/**
 * Get the S3 bucket name from environment.
 */
export function getBucketName(): string {
  return BUCKET_NAME;
}
