import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

describe('chunk storage local adapter', () => {
  const originalStorageDir = process.env.LOCAL_EXPORT_STORAGE_DIR;
  let storageDir: string;

  beforeEach(async () => {
    jest.resetModules();
    storageDir = await mkdtemp(path.join(os.tmpdir(), 'chunk-storage-'));
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

  it('writes the production chunk key to local storage without S3', async () => {
    const { uploadChunk } = await import('./s3-client');
    const key = await uploadChunk({
      jobId: 'job-1',
      chunkNumber: 1,
      content: 'id,name\n1,Ada\n',
    });

    expect(key).toBe('exports/job-1/deltas/001.csv');
    await expect(readFile(path.join(storageDir, key), 'utf8')).resolves.toBe(
      'id,name\n1,Ada\n',
    );
  });
});
