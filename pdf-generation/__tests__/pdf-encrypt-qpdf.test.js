import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  accessMock,
  applyPdfDocumentMetadataMock,
  applyPdfMetadataMock,
  execFileMock,
  mkdtempMock,
  readFileMock,
  rmMock,
  writeFileMock,
} = vi.hoisted(() => {
  const accessMock = vi.fn();
  const applyPdfDocumentMetadataMock = vi.fn();
  const applyPdfMetadataMock = vi.fn(async buffer => buffer);
  const execFileMock = vi.fn((file, args, options, callback) => {
    callback(null, '', '');
  });
  const mkdtempMock = vi.fn(async () => '/tmp/semaphor-qpdf-test');
  const readFileMock = vi.fn(async () => Buffer.from('encrypted-output'));
  const rmMock = vi.fn(async () => {});
  const writeFileMock = vi.fn(async () => {});

  return {
    accessMock,
    applyPdfDocumentMetadataMock,
    applyPdfMetadataMock,
    execFileMock,
    mkdtempMock,
    readFileMock,
    rmMock,
    writeFileMock,
  };
});

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('node:fs/promises', () => ({
  access: accessMock,
  mkdtemp: mkdtempMock,
  readFile: readFileMock,
  rm: rmMock,
  writeFile: writeFileMock,
}));

vi.mock('../lib/pdf-metadata.js', () => ({
  applyPdfDocumentMetadata: applyPdfDocumentMetadataMock,
  applyPdfMetadata: applyPdfMetadataMock,
}));

const {
  buildQpdfCommandArgs,
  encryptPdfBuffer,
  resolveEncryptionBackend,
  resolveQpdfBinary,
} = await import('../pdf-encrypt.js');

describe('qpdf encryption backend', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      PATH: '/usr/local/bin:/usr/bin',
      PDF_ENCRYPTION_BACKEND: 'qpdf',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('normalizes the configured backend name', () => {
    process.env.PDF_ENCRYPTION_BACKEND = 'qpdf';
    expect(resolveEncryptionBackend()).toBe('qpdf');

    process.env.PDF_ENCRYPTION_BACKEND = 'pdf-lib-with-encrypt';
    expect(resolveEncryptionBackend()).toBe('pdf-lib');
  });

  it('resolves qpdf from QPDF_BIN when provided', async () => {
    process.env.QPDF_BIN = '/custom/qpdf';
    accessMock.mockResolvedValue(undefined);

    await expect(resolveQpdfBinary()).resolves.toBe('/custom/qpdf');
    expect(accessMock).toHaveBeenCalledWith(
      '/custom/qpdf',
      expect.any(Number)
    );
  });

  it('builds qpdf command args with cleartext metadata and permissions', () => {
    const args = buildQpdfCommandArgs(
      '/tmp/input.pdf',
      '/tmp/output.pdf',
      'secret',
      {
        ownerPassword: 'owner-secret',
      }
    );

    expect(args).toEqual([
      '--encrypt',
      'secret',
      'owner-secret',
      '256',
      '--print=full',
      '--modify=form',
      '--extract=n',
      '--accessibility=y',
      '--cleartext-metadata',
      '--',
      '/tmp/input.pdf',
      '/tmp/output.pdf',
    ]);
  });

  it('uses qpdf when selected and preserves pre-applied metadata', async () => {
    process.env.QPDF_BIN = '/custom/qpdf';
    accessMock.mockResolvedValue(undefined);

    const encryptedBuffer = await encryptPdfBuffer(
      Buffer.from('plain-input'),
      'secret',
      {
        metadata: {
          title: 'Quarterly Revenue',
        },
      }
    );

    expect(applyPdfMetadataMock).toHaveBeenCalledWith(
      Buffer.from('plain-input'),
      {
        title: 'Quarterly Revenue',
      }
    );
    expect(execFileMock).toHaveBeenCalledWith(
      '/custom/qpdf',
      expect.arrayContaining([
        '--encrypt',
        'secret',
        '256',
        '--cleartext-metadata',
      ]),
      expect.objectContaining({
        env: process.env,
      }),
      expect.any(Function)
    );
    expect(writeFileMock).toHaveBeenCalled();
    expect(readFileMock).toHaveBeenCalledWith('/tmp/semaphor-qpdf-test/output.pdf');
    expect(rmMock).toHaveBeenCalledWith('/tmp/semaphor-qpdf-test', {
      recursive: true,
      force: true,
    });
    expect(encryptedBuffer).toEqual(Buffer.from('encrypted-output'));
  });

  it('fails with a clear message when qpdf is unavailable', async () => {
    delete process.env.QPDF_BIN;
    process.env.PATH = '';
    accessMock.mockRejectedValue(new Error('missing'));

    await expect(
      encryptPdfBuffer(Buffer.from('plain-input'), 'secret', {
        metadata: {
          title: 'Quarterly Revenue',
        },
      })
    ).rejects.toThrow(/no qpdf executable was found/i);
  });
});
