import { completeJob, updateJobStatus } from './api-client';

const originalFetch = global.fetch;
beforeEach(() => { global.fetch = jest.fn(); });
afterEach(() => { global.fetch = originalFetch; });

it.each([400, 403, 503])('preserves bounded Matrix errors at HTTP %s for both callbacks', async status => {
  for (const action of [updateJobStatus, completeJob]) {
    const message = 'Export deadline exceeded. Narrow the export and retry.';
    jest.mocked(global.fetch).mockResolvedValue({ ok: false, status, json: async () => ({ error: message }) } as Response);
    const error = await action({ jobId: 'job', url: 'https://example.test', apiKey: 'key', status: 'compacting',
      fileKey: 'key', fileSize: 1, totalRows: 1, rejectClientErrors: true }).catch(error => error);
    expect(error.message).toBe(message);
    expect(error.retryable).toBe(status < 500 ? false : undefined);
  }
});

it.each([null, {}, { error: '' }, { error: 1 }, { error: 'x'.repeat(4097) }])('uses a safe fallback for malformed Matrix errors', async body => {
  jest.mocked(global.fetch).mockResolvedValue({ ok: false, status: 403, json: async () => body } as Response);
  await expect(updateJobStatus({ jobId: 'job', url: '', apiKey: '', status: 'compacting', rejectClientErrors: true }))
    .rejects.toMatchObject({ message: 'Failed to update job status (403).', retryable: false });
});

it('preserves ordinary callback status/error handling', async () => {
  jest.mocked(global.fetch).mockResolvedValue({ ok: false, status: 400, text: async () => 'ordinary error' } as Response);
  const error = await completeJob({ jobId: 'job', url: '', apiKey: '', fileKey: 'key', fileSize: 1, totalRows: 1 }).catch(error => error);
  expect(error.message).toBe('Failed to complete job (400): ordinary error');
  expect(error.retryable).toBeUndefined();
});
