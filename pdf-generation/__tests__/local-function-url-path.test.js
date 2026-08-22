import path from 'path';
import fs from 'fs';
import os from 'os';
import { createHmac } from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  hasCompletedLocalExport,
  isValidArtifactSignature,
  resolveExportObjectPath,
  resolveOutputFilePath,
} from '../local-function-url.js';

describe('local-function-url path safety', () => {
  const outputDir = '/tmp/pdf-local-output';

  it('allows simple filenames under output root', () => {
    const resolved = resolveOutputFilePath('report.pdf', outputDir);
    expect(resolved).toBe(path.resolve(outputDir, 'report.pdf'));
  });

  it('blocks parent traversal attempts', () => {
    const resolved = resolveOutputFilePath('../../etc/passwd', outputDir);
    expect(resolved).toBeNull();
  });

  it('does not expose nested chunked artifacts through the unsigned file route', () => {
    expect(
      resolveOutputFilePath(
        'exports/job-1/final/export.csv.gz',
        outputDir,
      ),
    ).toBeNull();
  });

  it('blocks empty or invalid file values', () => {
    expect(resolveOutputFilePath('', outputDir)).toBeNull();
    expect(resolveOutputFilePath('.', outputDir)).toBeNull();
  });
});

describe('completed local exports', () => {
  it('recognizes a completed artifact so a replay does not rerun deleted chunks', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-export-replay-'));
    const artifactDir = path.join(outputDir, 'exports/job-1/final');
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, 'export.csv.gz'), 'complete');

    try {
      expect(hasCompletedLocalExport('job-1', outputDir)).toBe(true);
      expect(hasCompletedLocalExport('job-2', outputDir)).toBe(false);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

describe('resolveExportObjectPath', () => {
  it('allows nested export keys inside the runner output directory', () => {
    expect(
      resolveExportObjectPath(
        'exports/job-1/final/export.csv.gz',
        '/tmp/local-export-output',
      ),
    ).toBe('/tmp/local-export-output/exports/job-1/final/export.csv.gz');
  });

  it('rejects traversal outside the runner output directory', () => {
    expect(
      resolveExportObjectPath('../secrets.csv', '/tmp/local-export-output'),
    ).toBeNull();
  });
});

describe('local export artifact signatures', () => {
  const originalApiKey = process.env.LAMBDA_API_KEY;

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.LAMBDA_API_KEY;
    else process.env.LAMBDA_API_KEY = originalApiKey;
  });

  it('accepts an unexpired link signed with the shared runner key', () => {
    process.env.LAMBDA_API_KEY = 'shared-test-key';
    const key = 'exports/job-1/final/export.csv.gz';
    const expires = Math.floor(Date.now() / 1000) + 60;
    const signature = createHmac('sha256', 'shared-test-key')
      .update(`${key}\n${expires}`)
      .digest('hex');

    expect(isValidArtifactSignature(key, String(expires), signature)).toBe(true);
  });

  it('rejects an expired signature', () => {
    process.env.LAMBDA_API_KEY = 'shared-test-key';
    expect(
      isValidArtifactSignature(
        'exports/job-1/final/export.csv.gz',
        String(Math.floor(Date.now() / 1000) - 1),
        '0'.repeat(64),
      ),
    ).toBe(false);
  });
});
