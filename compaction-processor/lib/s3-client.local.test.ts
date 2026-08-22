import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';

describe('compaction storage local adapter', () => {
  const originalStorageDir = process.env.LOCAL_EXPORT_STORAGE_DIR;
  let storageDir: string;

  beforeEach(async () => {
    jest.resetModules();
    storageDir = await mkdtemp(path.join(os.tmpdir(), 'compaction-storage-'));
    process.env.LOCAL_EXPORT_STORAGE_DIR = storageDir;
  });

  afterEach(async () => {
    if (originalStorageDir === undefined) {
      delete process.env.LOCAL_EXPORT_STORAGE_DIR;
    } else {
      process.env.LOCAL_EXPORT_STORAGE_DIR = originalStorageDir;
    }
    await rm(storageDir, { recursive: true, force: true });
  });

  it('streams local output and reads it back without S3', async () => {
    const { deleteObjects, getObjectStream, uploadStream } = await import(
      './s3-client'
    );
    const key = 'exports/job-1/final/export.csv.gz';
    const source = new PassThrough();
    const upload = uploadStream(key, source);
    source.end(Buffer.from('compressed-content'));

    await expect(upload).resolves.toBe(Buffer.byteLength('compressed-content'));
    const stored = await getObjectStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stored) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString('utf8')).toBe('compressed-content');

    await deleteObjects([key]);
    const missing = await getObjectStream(key);
    await expect(
      (async () => {
        for await (const _chunk of missing) {
          // Drain the stream so filesystem errors are observed.
        }
      })(),
    ).rejects.toThrow('ENOENT');
  });
});
