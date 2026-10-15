/**
 * S3 client utilities for chunk uploads.
 */

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { ExportFileFormat, FlatTableExportTotalsByColumnId } from 'react-semaphor/format-utils';
import {
  exportFileTraits,
  parseRawTemporalChunkClassificationEvidence,
  type RawTemporalChunkClassificationEvidence,
} from 'react-semaphor/format-utils';

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

async function writeLocalObject(
  key: string,
  content: string,
): Promise<void> {
  const filePath = localObjectPath(key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function readLocalJson(key: string): Promise<unknown> {
  return JSON.parse(await readFile(localObjectPath(key), 'utf8'));
}

interface UploadChunkParams {
  jobId: string;
  chunkNumber: number;
  content: string;
  format: ExportFileFormat;
}

async function putObject(key: string, body: string, contentType: string): Promise<void> {
  if (LOCAL_STORAGE_DIR) {
    await writeLocalObject(key, body);
    return;
  }
  await s3Client.send(
    new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key, Body: body, ContentType: contentType }),
  );
}

async function readObjectText(key: string, missing: string): Promise<string> {
  if (LOCAL_STORAGE_DIR) return readFile(localObjectPath(key), 'utf8');
  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
  );
  if (!response.Body) throw new Error(missing);
  return response.Body.transformToString();
}

/**
 * Upload one chunk's part of the file: CSV records, or Excel sheet rows.
 * Path: exports/{jobId}/deltas/{chunkNumber:03d}.{partExtension}
 */
export async function uploadChunk(params: UploadChunkParams): Promise<string> {
  const { jobId, chunkNumber, content, format } = params;
  const traits = exportFileTraits(format);

  // Pad chunk number to 3 digits (001, 002, etc.)
  const paddedNumber = String(chunkNumber).padStart(3, '0');
  const s3Key = `exports/${jobId}/deltas/${paddedNumber}.${traits.partExtension}`;
  await putObject(s3Key, content, traits.partContentType);
  return s3Key;
}

/** The sheet layout every part of an Excel export shares; the first chunk writes it, compaction reads it. */
export function getXlsxSheetKey(jobId: string): string {
  return `exports/${jobId}/sheet.json`;
}

export async function uploadXlsxSheet(params: { jobId: string; sheet: string }): Promise<string> {
  const key = getXlsxSheetKey(params.jobId);
  await putObject(key, params.sheet, 'application/json');
  return key;
}

/**
 * A chunk's Excel columns (`serializeTableExportSheetColumns`), stored before
 * the chunk is completed (XL-D37); compaction settles the job's sheet from
 * them. The chunk result carries this key, so compaction never builds it.
 */
export function getXlsxColumnsKey(jobId: string, chunkNumber: number): string {
  const paddedNumber = String(chunkNumber).padStart(3, '0');
  return `exports/${jobId}/deltas/${paddedNumber}.xlsx-columns.json`;
}

export async function uploadXlsxColumns(params: {
  jobId: string;
  chunkNumber: number;
  columns: string;
}): Promise<string> {
  const key = getXlsxColumnsKey(params.jobId, params.chunkNumber);
  await putObject(key, params.columns, 'application/json');
  return key;
}

/** The stored columns text; parsing belongs to the shared owner. */
export async function fetchXlsxColumns(params: { jobId: string; chunkNumber: number }): Promise<string> {
  return readObjectText(
    getXlsxColumnsKey(params.jobId, params.chunkNumber),
    `No Excel columns found for export ${params.jobId} chunk ${params.chunkNumber}`,
  );
}

export function getTableTotalsMetadataKey(jobId: string): string {
  return `exports/${jobId}/deltas/001.totals.json`;
}

export async function uploadTableTotalsMetadata(params: {
  jobId: string;
  totalsByColumnId: FlatTableExportTotalsByColumnId;
}): Promise<string> {
  const s3Key = getTableTotalsMetadataKey(params.jobId);
  if (LOCAL_STORAGE_DIR) {
    await writeLocalObject(s3Key, JSON.stringify(params.totalsByColumnId));
    return s3Key;
  }
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
  if (LOCAL_STORAGE_DIR) {
    return readLocalJson(getTableTotalsMetadataKey(jobId));
  }
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
  if (LOCAL_STORAGE_DIR) {
    await writeLocalObject(s3Key, JSON.stringify(evidence));
    return s3Key;
  }
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
  if (LOCAL_STORAGE_DIR) {
    return readLocalJson(
      getRawTemporalClassificationKey(params.jobId, params.chunkNumber),
    );
  }
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

/** Unique attempt keys are never overwritten; DB completion publishes one. */
export async function uploadExportAttempt(input: { key: string; content: string; contentType: string }, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (LOCAL_STORAGE_DIR) {
    const filename = localObjectPath(input.key);
    await mkdir(path.dirname(filename), { recursive: true });
    signal?.throwIfAborted();
    await writeFile(filename, input.content, { flag: 'wx', signal });
    signal?.throwIfAborted();
    return;
  }
  await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: input.key,
    Body: input.content, ContentType: input.contentType, IfNoneMatch: '*' }), { abortSignal: signal });
  signal?.throwIfAborted();
}
