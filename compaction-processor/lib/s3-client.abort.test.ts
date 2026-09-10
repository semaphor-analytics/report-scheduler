import { S3Client } from '@aws-sdk/client-s3';
import { PassThrough } from 'node:stream';

describe('Matrix storage cancellation', () => {
  const originalDir = process.env.LOCAL_EXPORT_STORAGE_DIR;
  beforeEach(() => { delete process.env.LOCAL_EXPORT_STORAGE_DIR; });
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalDir !== undefined) process.env.LOCAL_EXPORT_STORAGE_DIR = originalDir;
  });

  it.each([false, true])('cancels actual S3 sends and awaits multipart cleanup (multipart=%s)', async multipart => {
    const { uploadStream } = await import('./s3-client');
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    let inFlight = 0;
    let cleaned = false;
    jest.spyOn(S3Client.prototype, 'send').mockImplementation((async (command: { constructor: { name: string } }, options: { abortSignal: AbortSignal }) => {
      const name = command.constructor.name;
      if (name === 'CreateMultipartUploadCommand') return { UploadId: 'upload' };
      if (name === 'AbortMultipartUploadCommand') {
        expect(options.abortSignal.aborted).toBe(false);
        cleaned = true;
        return {};
      }
      expect(['PutObjectCommand', 'UploadPartCommand']).toContain(name);
      expect(options.abortSignal).toBe(controller.signal);
      inFlight += 1;
      started();
      try {
        await new Promise((_resolve, reject) => {
          if (options.abortSignal.aborted) reject(options.abortSignal.reason);
          else options.abortSignal.addEventListener('abort', () => reject(options.abortSignal.reason), { once: true });
        });
      } finally { inFlight -= 1; }
    }) as never);
    const source = new PassThrough();
    const outcome = expect(uploadStream('exports/job/final', source, 'application/gzip', controller.signal)).rejects.toThrow('deadline');
    source.end(Buffer.alloc(multipart ? 6 * 1024 * 1024 : 100));
    await ready;
    controller.abort(Error('deadline'));
    await outcome;
    expect(inFlight).toBe(0);
    expect(source.destroyed).toBe(true);
    expect(cleaned).toBe(multipart);
  });

  it('cancels an active GetObject request', async () => {
    const { getObjectStream } = await import('./s3-client');
    const controller = new AbortController();
    const send = jest.spyOn(S3Client.prototype, 'send').mockImplementation((async (_command: unknown, options: { abortSignal: AbortSignal }) => {
      expect(options.abortSignal).toBe(controller.signal);
      return new Promise((_resolve, reject) => options.abortSignal.addEventListener('abort', () => reject(options.abortSignal.reason)));
    }) as never);
    const outcome = expect(getObjectStream('key', controller.signal)).rejects.toThrow('deadline');
    controller.abort(Error('deadline'));
    await outcome;
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['deadline', 'success'],
    ['transient', 'success'],
    ['deadline', 'NoSuchUpload'],
    ['deadline', 'failure'],
    ['deadline', 'timeout'],
  ])('cleans up rejected multipart completion (%s, cleanup=%s) without masking it', async (failure, cleanup) => {
    const { uploadStream } = await import('./s3-client');
    const controller = new AbortController();
    const originalError = Error(failure);
    const calls: string[] = [];
    let cleanupStarted!: () => void;
    const cleanupReady = new Promise<void>(resolve => { cleanupStarted = resolve; });
    let cleanupFinished = false;
    jest.useFakeTimers();
    const timeout = jest.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      const cleanupController = new AbortController();
      if (cleanup === 'timeout') setTimeout(() => cleanupController.abort(Error('cleanup timeout')), ms);
      return cleanupController.signal;
    });
    jest.spyOn(S3Client.prototype, 'send').mockImplementation((async (
      command: { constructor: { name: string }; input: Record<string, unknown> },
      options: { abortSignal: AbortSignal },
    ) => {
      const name = command.constructor.name;
      calls.push(name);
      if (name === 'CreateMultipartUploadCommand') return { UploadId: 'completion-upload' };
      if (name === 'UploadPartCommand') return { ETag: `part-${command.input.PartNumber}` };
      if (name === 'CompleteMultipartUploadCommand') {
        expect(options.abortSignal).toBe(controller.signal);
        if (failure === 'deadline') {
          return new Promise((_resolve, reject) => {
            options.abortSignal.addEventListener('abort', () => reject(options.abortSignal.reason), { once: true });
            controller.abort(originalError);
          });
        }
        throw originalError;
      }
      expect(name).toBe('AbortMultipartUploadCommand');
      expect(command.input).toEqual({ Bucket: process.env.S3_BUCKET || '', Key: 'exports/job/final', UploadId: 'completion-upload' });
      expect(controller.signal.aborted).toBe(failure === 'deadline');
      expect(options.abortSignal).not.toBe(controller.signal);
      expect(options.abortSignal.aborted).toBe(false);
      cleanupStarted();
      try {
        if (cleanup === 'timeout') {
          await new Promise((_resolve, reject) => options.abortSignal.addEventListener('abort', () => reject(options.abortSignal.reason)));
        } else if (cleanup !== 'success') {
          throw Object.assign(Error(cleanup), { name: cleanup });
        }
        return {};
      } finally { cleanupFinished = true; }
    }) as never);
    try {
      const source = new PassThrough();
      let settled = false;
      const outcome = expect(uploadStream('exports/job/final', source, 'application/gzip', controller.signal)
        .finally(() => { settled = true; })).rejects.toBe(originalError);
      source.end(Buffer.alloc(6 * 1024 * 1024));
      if (cleanup === 'timeout') {
        await jest.advanceTimersByTimeAsync(0);
        // Check the call before awaiting readiness so a missing cleanup fails clearly.
        expect(calls).toContain('AbortMultipartUploadCommand');
        await cleanupReady;
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(29_999);
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(1);
      }
      await outcome;
      expect(calls).toEqual(['CreateMultipartUploadCommand', 'UploadPartCommand', 'UploadPartCommand',
        'CompleteMultipartUploadCommand', 'AbortMultipartUploadCommand']);
      expect(timeout).toHaveBeenCalledWith(30_000);
      expect(cleanupFinished).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
  });

  it('leaves ordinary multipart completion failure handling unchanged', async () => {
    const { uploadStream } = await import('./s3-client');
    const originalError = Error('ordinary completion failed');
    const calls: string[] = [];
    jest.spyOn(S3Client.prototype, 'send').mockImplementation((async (
      command: { constructor: { name: string }; input: Record<string, unknown> },
    ) => {
      const name = command.constructor.name;
      calls.push(name);
      if (name === 'CreateMultipartUploadCommand') return { UploadId: 'ordinary-upload' };
      if (name === 'UploadPartCommand') return { ETag: `part-${command.input.PartNumber}` };
      throw originalError;
    }) as never);
    const source = new PassThrough();
    const outcome = expect(uploadStream('exports/job/final', source)).rejects.toBe(originalError);
    source.end(Buffer.alloc(6 * 1024 * 1024));
    await outcome;
    expect(calls).toEqual(['CreateMultipartUploadCommand', 'UploadPartCommand', 'UploadPartCommand', 'CompleteMultipartUploadCommand']);
  });

  it('destroys the S3 response body when expiry occurs after response headers', async () => {
    const { getObjectStream } = await import('./s3-client');
    const body = new PassThrough();
    jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({ Body: body } as never);
    const controller = new AbortController();
    const stream = await getObjectStream('key', controller.signal);
    const outcome = expect((async () => { for await (const _chunk of stream) { /* drain */ } })()).rejects.toThrow();
    controller.abort(Error('deadline'));
    await outcome;
    expect(body.destroyed).toBe(true);
  });
});
