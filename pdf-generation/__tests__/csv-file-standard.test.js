import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The renderer no longer copies a page as a CSV (card data attachments
// CD-D8); a card's CSV is written by the shared contract in the app and only
// stored here (`stored-csv.test.js`). The guard below keeps every worker on
// the one CSV contract.

/**
 * Every CSV file the workers deliver is written through the CSV file contract
 * (react-semaphor format-utils, bundled here as lib/generated/csv-file.js). A
 * second BOM or escaper anywhere else is how CSV paths drifted apart before.
 */
describe('CSV file standard guard (report scheduler)', () => {
  const repo = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
  const DIRS = ['chunk-processor/lib', 'compaction-processor/lib', 'pdf-generation/lib', 'email-sender/lib'];
  const files = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        return ['generated', 'node_modules', '__tests__'].includes(name) ? [] : files(path);
      }
      return /\.(ts|js|mjs)$/.test(name) && !/\.(test|spec)\./.test(name) ? [path] : [];
    });
  const sources = DIRS.flatMap((dir) => files(join(repo, dir))).map((path) => ({
    path: relative(repo, path),
    text: readFileSync(path, 'utf8'),
  }));

  it('scans the worker sources', () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it('has no BOM in any spelling', () => {
    const bom = /\\u\{?feff\}?|0xfeff|65279/i;
    expect(
      sources
        .filter(({ text }) => bom.test(text) || text.includes(String.fromCharCode(0xfeff)))
        .map(({ path }) => path),
    ).toEqual([]);
  });

  it('has no CSV escaper of its own', () => {
    const quoteDoubling = /replace\(\s*\/"\/g,\s*['"`]""['"`]\s*\)/;
    expect(sources.filter(({ text }) => quoteDoubling.test(text)).map(({ path }) => path)).toEqual([]);
  });
});
