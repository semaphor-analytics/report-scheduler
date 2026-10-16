import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXPORT_FILE_FORMATS, exportFileTraits } from 'react-semaphor/format-utils';

/**
 * The email sender attaches the finished file of every export job a Briefing
 * prepares: a Matrix attempt (`exports/<job>/attempts/<attempt>/`) or a
 * compacted table export (`exports/<job>/final/`), in every file format. Its
 * role and the bucket policy must both let it read exactly those files, named
 * by react-semaphor's file-format owner, and never a chunk part. A new format
 * fails here until both policies grant it (an Excel attachment once failed in
 * production with AccessDenied because only Matrix CSV was granted).
 */
const template = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../template.yaml'),
  'utf8',
);

/** The `Resource` entries of one block of the template: from its header line to the next block at the same indent. */
function resourcesOf(header) {
  const lines = template.split('\n');
  const start = lines.findIndex((line) => line.trimEnd().endsWith(header));
  expect(start, `template block ${header}`).toBeGreaterThanOrEqual(0);
  const indent = lines[start].length - lines[start].trimStart().length;
  const block = [];
  for (const line of lines.slice(start + 1)) {
    const depth = line.length - line.trimStart().length;
    if (line.trim() && depth <= indent) break;
    block.push(line);
  }
  return block
    .map((line) => line.match(/\$\{AWS::StackName\}\/([^']+)'/)?.[1])
    .filter(Boolean);
}

const finishedFiles = EXPORT_FILE_FORMATS.flatMap((format) => {
  const name = exportFileTraits(format).compactedFileName;
  return [`exports/*/attempts/*/${name}`, `exports/*/final/${name}`];
});

describe('the email sender can read every finished export file it attaches', () => {
  it.each([
    ['its role', 'EmailSenderFunctionRole:'],
    ['the bucket policy', 'Sid: AllowLambdaAccessEmailSender'],
  ])('%s grants every format, at both locations', (_label, header) => {
    const exportResources = resourcesOf(header).filter((resource) => resource.startsWith('exports/'));
    expect(finishedFiles).toEqual(expect.arrayContaining(['exports/*/final/export.xlsx']));
    expect([...exportResources].sort()).toEqual([...finishedFiles].sort());
  });
});
