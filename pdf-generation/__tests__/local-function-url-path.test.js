import path from 'path';
import { describe, expect, it } from 'vitest';
import { resolveOutputFilePath } from '../local-function-url.js';

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

  it('blocks empty or invalid file values', () => {
    expect(resolveOutputFilePath('', outputDir)).toBeNull();
    expect(resolveOutputFilePath('.', outputDir)).toBeNull();
  });
});
