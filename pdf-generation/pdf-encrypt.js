import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'module';
import {
  applyPdfDocumentMetadata,
  applyPdfMetadata,
} from './lib/pdf-metadata.js';

const require = createRequire(import.meta.url);
const { PDFDocument } = require('pdf-lib-with-encrypt');
const execFileAsync = promisify(execFile);

const DEFAULT_BACKEND = 'qpdf';
const DEFAULT_QPDF_PATH = '/opt/bin/qpdf';
const QPDF_KEY_BITS = '256';

const DEFAULT_PERMISSIONS = {
  printing: 'highResolution',
  modifying: false,
  copying: false,
  annotating: false,
  fillingForms: true,
  contentAccessibility: true,
  documentAssembly: false,
};

export { PDFDocument };

function normalizeBackendName(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();

  if (
    normalized === 'pdf-lib' ||
    normalized === 'pdflib' ||
    normalized === 'pdf-lib-with-encrypt'
  ) {
    return 'pdf-lib';
  }

  if (normalized === 'qpdf') {
    return 'qpdf';
  }

  return DEFAULT_BACKEND;
}

export function resolveEncryptionBackend() {
  return normalizeBackendName(process.env.PDF_ENCRYPTION_BACKEND);
}

async function isExecutable(candidatePath) {
  try {
    await access(candidatePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findExecutableOnPath(binaryName) {
  const pathValue = String(process.env.PATH || '').trim();
  if (!pathValue) {
    return null;
  }

  for (const segment of pathValue.split(path.delimiter)) {
    if (!segment) {
      continue;
    }

    const candidatePath = path.join(segment, binaryName);
    if (await isExecutable(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

export async function resolveQpdfBinary() {
  const configuredPath = String(process.env.QPDF_BIN || '').trim();
  if (configuredPath) {
    if (await isExecutable(configuredPath)) {
      return configuredPath;
    }

    throw new Error(
      `QPDF_BIN is set but not executable: ${configuredPath}`
    );
  }

  if (await isExecutable(DEFAULT_QPDF_PATH)) {
    return DEFAULT_QPDF_PATH;
  }

  return findExecutableOnPath('qpdf');
}

function mapPrintingPermission(value) {
  if (value === 'lowResolution') {
    return 'low';
  }

  if (value === false || value === 'none') {
    return 'none';
  }

  return 'full';
}

function mapModifyPermission(permissions) {
  if (permissions.modifying) {
    return 'all';
  }

  if (permissions.annotating) {
    return 'annotate';
  }

  if (permissions.fillingForms) {
    return 'form';
  }

  if (permissions.documentAssembly) {
    return 'assembly';
  }

  return 'none';
}

export function buildQpdfCommandArgs(
  inputPath,
  outputPath,
  userPassword,
  options = {}
) {
  const permissions = {
    ...DEFAULT_PERMISSIONS,
    ...(options.permissions || {}),
  };
  const ownerPassword =
    typeof options.ownerPassword === 'string' &&
    options.ownerPassword.length > 0
      ? options.ownerPassword
      : randomUUID();

  return [
    '--encrypt',
    userPassword,
    ownerPassword,
    QPDF_KEY_BITS,
    `--print=${mapPrintingPermission(permissions.printing)}`,
    `--modify=${mapModifyPermission(permissions)}`,
    `--extract=${permissions.copying ? 'y' : 'n'}`,
    `--accessibility=${permissions.contentAccessibility ? 'y' : 'n'}`,
    '--cleartext-metadata',
    '--',
    inputPath,
    outputPath,
  ];
}

async function encryptWithPdfLib(pdfBuffer, password, options = {}) {
  const pdfDoc = await PDFDocument.load(pdfBuffer, {
    updateMetadata: false,
  });

  applyPdfDocumentMetadata(pdfDoc, options.metadata);

  pdfDoc.encrypt({
    userPassword: password,
    ownerPassword: options.ownerPassword || password,
    permissions: {
      ...DEFAULT_PERMISSIONS,
      ...options.permissions,
    },
  });

  return Buffer.from(
    await pdfDoc.save({
      useObjectStreams: false,
    })
  );
}

async function encryptWithQpdf(pdfBuffer, password, options = {}) {
  const qpdfBinary = await resolveQpdfBinary();

  if (!qpdfBinary) {
    throw new Error(
      'QPDF encryption backend selected but no qpdf executable was found. ' +
        'Install qpdf locally or set QPDF_BIN for local development, or provide /opt/bin/qpdf via the Lambda layer.'
    );
  }

  const preparedBuffer = await applyPdfMetadata(pdfBuffer, options.metadata);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'semaphor-qpdf-'));
  const inputPath = path.join(tempDir, 'input.pdf');
  const outputPath = path.join(tempDir, 'output.pdf');

  try {
    await writeFile(inputPath, preparedBuffer);

    const args = buildQpdfCommandArgs(inputPath, outputPath, password, options);

    await execFileAsync(qpdfBinary, args, {
      env: process.env,
    });

    const encryptedBuffer = Buffer.from(await readFile(outputPath));

    if (preparedBuffer.layoutApplied) {
      encryptedBuffer.layoutApplied = preparedBuffer.layoutApplied;
    }

    return encryptedBuffer;
  } catch (error) {
    const details =
      typeof error?.stderr === 'string' && error.stderr.trim().length > 0
        ? ` ${error.stderr.trim()}`
        : '';
    throw new Error(`qpdf encryption failed.${details}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function encryptPdfBuffer(pdfBuffer, password, options = {}) {
  const backend = resolveEncryptionBackend();

  if (backend === 'qpdf') {
    return encryptWithQpdf(pdfBuffer, password, options);
  }

  return encryptWithPdfLib(pdfBuffer, password, options);
}
