import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
const originalFetch = global.fetch;
const originalDir = process.env.LOCAL_EXPORT_STORAGE_DIR;
let directory: string;
let deadlineAt: number;
beforeEach(async () => {
  deadlineAt = Date.now() + 60_000;
  jest.resetModules(); directory = await mkdtemp(path.join(tmpdir(), 'matrix-finalize-'));
  process.env.LOCAL_EXPORT_STORAGE_DIR = directory; global.fetch = jest.fn();
});
afterEach(async () => {
  global.fetch = originalFetch;
  if (originalDir === undefined) delete process.env.LOCAL_EXPORT_STORAGE_DIR; else process.env.LOCAL_EXPORT_STORAGE_DIR = originalDir;
  await rm(directory, { force: true, recursive: true });
});
it('streams >10k rows in committed sequence to a complete gzip before publication', async () => {
  const rows = Array.from({ length: 10001 }, (_, i) => `${i},0.000009\n`);
  const bodies = ['Group,Value\n', rows.slice(0, 5000).join(''), rows.slice(5000).join('')];
  // Deliberately reverse lexical order of attempt names.
  const keys = ['z', 'm', 'a'].map(attempt => `exports/job/attempts/${attempt}/data.csv`);
  for (let i = 0; i < keys.length; i++) {
    const filename = path.join(directory, keys[i]); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bodies[i]);
  }
  const manifest = { acquisition: 'continuation', deadlineAt, totalRows: 10001, totalBytes: Buffer.byteLength(bodies.join('')),
    chunks: keys.map((dataKey, index) => ({ dataKey, chunkNumber: index + 1 })) };
  jest.mocked(global.fetch).mockResolvedValueOnce({ ok: true, json: async () => manifest } as Response)
    .mockResolvedValueOnce({ ok: true } as Response)
    .mockImplementationOnce(async (_url, init) => {
      const completion = JSON.parse(String(init?.body));
      expect(completion.totalRows).toBe(10001);
      const csv = gunzipSync(await readFile(path.join(directory, completion.fileKey))).toString();
      expect(csv).toBe(bodies.join('')); expect(csv.split('Group,Value')).toHaveLength(2);
      return { ok: true } as Response;
    });
  const { compactMatrixExport } = await import('./matrix-compaction');
  expect((await compactMatrixExport('job', deadlineAt)).status).toBe('completed');
  expect(global.fetch).toHaveBeenCalledTimes(3);
});
it('does not publish when committed data is missing', async () => {
  jest.mocked(global.fetch).mockResolvedValue({ ok: true, json: async () => ({ acquisition: 'continuation', deadlineAt, totalRows: 1, totalBytes: 4,
    chunks: [{ chunkNumber: 1, dataKey: 'exports/job/attempts/missing/data.csv' }] }) } as Response);
  const { compactMatrixExport } = await import('./matrix-compaction');
  await expect(compactMatrixExport('job', deadlineAt)).rejects.toThrow();
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
it('replays publication bookkeeping without regenerating a committed artifact', async () => {
  deadlineAt = Date.now() - 1;
  jest.mocked(global.fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ acquisition: 'continuation', deadlineAt, totalRows: 0,
    totalBytes: 10, fileKey: 'exports/job/attempts/winner/export.csv.gz', fileSize: 30, chunks: [{ chunkNumber: 1, dataKey: 'exports/job/attempts/a/data.csv' }] }) } as Response)
    .mockResolvedValueOnce({ ok: true } as Response);
  const { compactMatrixExport } = await import('./matrix-compaction');
  expect((await compactMatrixExport('job', deadlineAt)).finalS3Key).toContain('winner');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

it('refuses expired unfinished manifests without status changes, download or publication', async () => {
  deadlineAt = Date.now() - 1;
  jest.mocked(global.fetch).mockResolvedValue({ ok: true, json: async () => ({ acquisition: 'continuation', deadlineAt,
    totalRows: 0, totalBytes: 0, chunks: [{ chunkNumber: 1, dataKey: 'unused' }] }) } as Response);
  const { compactMatrixExport } = await import('./matrix-compaction');
  await expect(compactMatrixExport('job', deadlineAt)).rejects.toMatchObject({ retryable: false });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it.each([400, 403, 503])('preserves manifest errors and HTTP retry classification (%s)', async status => {
  deadlineAt = Date.now() - 1;
  const message = 'Matrix export expired or access was revoked.';
  jest.mocked(global.fetch).mockResolvedValue({ ok: false, status, json: async () => ({ error: message }) } as Response);
  const { compactMatrixExport } = await import('./matrix-compaction');
  const error = await compactMatrixExport('job', deadlineAt).catch(error => error);
  expect(error.message).toBe(message);
  expect(error.retryable).toBe(status < 500 ? false : undefined);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it.each(['manifest', 'status', 'callback', 'expired replay'])('aborts %s HTTP and clears its timer', async stage => {
  const { compactMatrixExport } = await import('./matrix-compaction');
  jest.useFakeTimers();
  try {
    deadlineAt = Date.now() + (stage === 'expired replay' ? -1 : 100);
    const manifest = { acquisition: 'continuation', deadlineAt, totalRows: 0, totalBytes: 0,
      chunks: [{ chunkNumber: 1, dataKey: 'exports/job/attempts/a/data.csv' }],
      ...(stage === 'callback' || stage === 'expired replay' ? { fileKey: 'exports/job/attempts/winner/export.csv.gz', fileSize: 20 } : {}),
    };
    let stopped = false;
    const pending = (_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => { stopped = true; reject(init!.signal!.reason); }, { once: true });
    });
    if (stage !== 'manifest') jest.mocked(global.fetch).mockResolvedValueOnce({ ok: true, json: async () => manifest } as Response);
    jest.mocked(global.fetch).mockImplementation(pending);
    const outcome = expect(compactMatrixExport('job', deadlineAt)).rejects.toMatchObject({ retryable: false });
    await jest.advanceTimersByTimeAsync(stage === 'expired replay' ? 30_000 : 100);
    await outcome;
    expect(stopped).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});
