import { processMatrixBatch } from './matrix-batch';
import { uploadExportAttempt } from './s3-client';
import { gzipSync } from 'node:zlib';
import { MATRIX_EXPORT_TRANSFER_BYTES } from 'react-semaphor/format-utils';
jest.mock('./s3-client', () => ({ uploadExportAttempt: jest.fn() }));
const originalFetch = global.fetch;
const deadlineAt = Date.now() + 60_000;
const input = { acquisition: 'continuation' as const, jobId: 'job', sequence: 1, deadlineAt };
const work = { kind: 'work', sequence: 1, deadlineAt, checkpointKey: 'exports/job/attempts/a/checkpoint.json', objects: [
  { key: 'exports/job/attempts/a/data.csv', content: 'A\n1\n', contentType: 'text/csv' },
  { key: 'exports/job/attempts/a/checkpoint.json', content: '{}', contentType: 'application/json' },
] };
const response = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body }) as Response;
beforeEach(() => { jest.clearAllMocks(); global.fetch = jest.fn(); jest.mocked(uploadExportAttempt).mockResolvedValue(undefined); });
afterAll(() => { global.fetch = originalFetch; });
it('finishes uploads before proposing commit, and returns only bounded control state', async () => {
  jest.mocked(global.fetch).mockResolvedValueOnce(response(work)).mockImplementationOnce(async () => {
    expect(uploadExportAttempt).toHaveBeenCalledTimes(2);
    return response({ kind: 'committed', sequence: 2, done: false, deadlineAt });
  });
  expect(await processMatrixBatch(input)).toEqual({ acquisition: 'continuation', sequence: 2, done: false, deadlineAt });
});
it('replays a lost commit response without another upload', async () => {
  jest.mocked(global.fetch).mockResolvedValue(response({ kind: 'committed', sequence: 2, done: true, deadlineAt }));
  expect((await processMatrixBatch(input)).done).toBe(true); expect(uploadExportAttempt).not.toHaveBeenCalled();
});
it.each([-1, 0, 1])('checks the full response before uploads at the byte ceiling (%i)', async delta => {
  const batch = { ...work, objects: work.objects.map(object => ({ ...object, content: '' })) };
  const padding = MATRIX_EXPORT_TRANSFER_BYTES + delta - Buffer.byteLength(JSON.stringify(batch));
  batch.objects[0].content = 'x'.repeat(Math.floor(padding / 2));
  batch.objects[1].content = 'x'.repeat(padding - Math.floor(padding / 2));
  expect(Buffer.byteLength(JSON.stringify(batch))).toBe(MATRIX_EXPORT_TRANSFER_BYTES + delta);
  jest.mocked(global.fetch).mockResolvedValueOnce(response(batch))
    .mockResolvedValueOnce(response({ kind: 'committed', sequence: 2, done: true, deadlineAt }));
  if (delta > 0) {
    await expect(processMatrixBatch(input)).rejects.toMatchObject({ retryable: false });
    expect(uploadExportAttempt).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  } else {
    expect((await processMatrixBatch(input)).done).toBe(true);
    expect(uploadExportAttempt).toHaveBeenCalledTimes(2);
  }
});
it('decodes bounded layout transport but persists ordinary JSON', async () => {
  const layout = JSON.stringify({ jobId: 'job', layout: { columns: ['wide'] } });
  jest.mocked(global.fetch).mockResolvedValueOnce(response({ ...work, objects: [...work.objects,
    { key: 'exports/job/attempts/a/layout.json', contentType: 'application/json', encoding: 'gzip-base64', content: gzipSync(layout).toString('base64') },
  ] })).mockResolvedValueOnce(response({ kind: 'committed', sequence: 2, done: false, deadlineAt }));
  await processMatrixBatch(input);
  expect(uploadExportAttempt).toHaveBeenCalledWith({ key: 'exports/job/attempts/a/layout.json', contentType: 'application/json', content: layout }, expect.any(AbortSignal));
});
it('rejects a compressed layout above the decoded budget before commit', async () => {
  jest.mocked(global.fetch).mockResolvedValueOnce(response({ ...work, objects: [...work.objects,
    { key: 'exports/job/attempts/a/layout.json', contentType: 'application/json', encoding: 'gzip-base64', content: gzipSync('x'.repeat(5 * 1024 * 1024 + 1)).toString('base64') },
  ] }));
  await expect(processMatrixBatch(input)).rejects.toThrow();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
it('never commits a partial local/S3 write', async () => {
  jest.mocked(global.fetch).mockResolvedValue(response(work));
  jest.mocked(uploadExportAttempt).mockRejectedValueOnce(Error('partial write'));
  await expect(processMatrixBatch(input)).rejects.toThrow('partial write');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
it('rejects unsafe keys and permission errors without retrying', async () => {
  jest.mocked(global.fetch).mockResolvedValueOnce(response({ ...work, objects: [{ ...work.objects[0], key: 'exports/job/attempts/../../escape' }, work.objects[1]] }));
  await expect(processMatrixBatch(input)).rejects.toThrow('artifact');
  expect(uploadExportAttempt).not.toHaveBeenCalled();
  jest.mocked(global.fetch).mockResolvedValueOnce(response({}, 403));
  await expect(processMatrixBatch(input)).rejects.toMatchObject({ retryable: false });
});
it.each([400, 403, 503])('preserves the app error at HTTP %i without changing retry classification', async status => {
  const message = 'Export exceeds its byte limit. Narrow the export and retry.';
  jest.mocked(global.fetch).mockResolvedValue(response({ error: message }, status));
  const error = await processMatrixBatch(input).catch(error => error);
  expect(error.message).toBe(message);
  expect(error.retryable).toBe(status < 500 ? false : undefined);
});
it.each([null, {}, { error: 1 }, { error: '' }, { error: 'x'.repeat(4097) }])('falls back safely for malformed error content: %j', async body => {
  jest.mocked(global.fetch).mockResolvedValue(response(body, 400));
  await expect(processMatrixBatch(input)).rejects.toMatchObject({ message: 'Matrix export batch failed (400).', retryable: false });
});
it('keeps HTTP retry classification when the error response is not JSON', async () => {
  jest.mocked(global.fetch).mockResolvedValue({ ok: false, status: 503, json: async () => { throw Error('invalid JSON'); } } as unknown as Response);
  await expect(processMatrixBatch(input)).rejects.toThrow('Matrix export batch failed (503).');
});

it.each([undefined, '123', NaN, Infinity, -1])('rejects an invalid deadline %s before HTTP', async value => {
  await expect(processMatrixBatch({ ...input, deadlineAt: value as number })).rejects.toMatchObject({ retryable: false });
  expect(global.fetch).not.toHaveBeenCalled();
});

it('rejects expiry and mismatched app deadlines without uploading', async () => {
  await expect(processMatrixBatch({ ...input, deadlineAt: Date.now() - 1 })).rejects.toMatchObject({ retryable: false });
  expect(global.fetch).not.toHaveBeenCalled();
  jest.mocked(global.fetch).mockResolvedValue(response({ ...work, deadlineAt: deadlineAt + 1 }));
  await expect(processMatrixBatch(input)).rejects.toThrow('deadline does not match');
  expect(uploadExportAttempt).not.toHaveBeenCalled();
});

it.each(['http', 'upload', 'commit'])('aborts active %s at the absolute deadline without committing more work', async stage => {
  jest.useFakeTimers();
  try {
    const current = { ...input, deadlineAt: Date.now() + 100 };
    let stopped = false;
    const pending = (signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => { stopped = true; reject(signal.reason); }, { once: true });
    });
    if (stage === 'http') jest.mocked(global.fetch).mockImplementation((_url, init) => pending(init!.signal as AbortSignal));
    else {
      jest.mocked(global.fetch).mockResolvedValueOnce(response({ ...work, deadlineAt: current.deadlineAt }));
      if (stage === 'upload') jest.mocked(uploadExportAttempt).mockImplementation((_input, signal) => pending(signal!));
      else jest.mocked(global.fetch).mockImplementationOnce((_url, init) => pending(init!.signal as AbortSignal));
    }
    const outcome = expect(processMatrixBatch(current)).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('deadline exceeded') });
    await jest.advanceTimersByTimeAsync(100);
    await outcome;
    expect(stopped).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(stage === 'commit' ? 2 : 1);
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});
