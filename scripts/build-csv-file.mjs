#!/usr/bin/env node
// Bundles react-semaphor's export file contracts from format-utils into
// pdf-generation/lib/generated/ (ignored by git). pdf-generation has no
// react-semaphor dependency, so this is how it shares them:
//   csv-file.js       the CSV file contract (the BOM, quoting and record
//                     separators every delivered CSV uses) and the export file
//                     format owner (names, content types and storage of CSV
//                     and Excel artifacts);
//   rendered-file.js  the rendered file contract (PDF, PNG and zip names and
//                     content types, the image size and scale rule; PNG
//                     exports SPEC §2.1 to §2.3).
//
//   --source=package    the installed react-semaphor; deploys use this.
//   --source=workspace  the sibling ../react-semaphor checkout, for checking
//                       unreleased contract changes locally.
//   --source=auto       the sibling checkout when present, else the package;
//                       tests and local runs use this.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const specifier = 'react-semaphor/format-utils';
const workspaceEntry = resolve(
  root,
  '../react-semaphor/src/shared/format-utils/exporters/index.ts',
);

const sourceArg = process.argv.find((arg) => arg.startsWith('--source='));
const requested = sourceArg ? sourceArg.slice('--source='.length) : 'package';
if (!['package', 'workspace', 'auto'].includes(requested)) {
  console.error(`Unknown --source "${requested}"; use package, workspace or auto.`);
  process.exit(1);
}
const source =
  requested === 'auto'
    ? existsSync(workspaceEntry)
      ? 'workspace'
      : 'package'
    : requested;
if (source === 'workspace' && !existsSync(workspaceEntry)) {
  console.error(`No react-semaphor checkout at ${workspaceEntry}.`);
  process.exit(1);
}

for (const adapter of ['csv-file', 'rendered-file']) {
  await build({
    entryPoints: [resolve(root, `scripts/${adapter}-entry.mjs`)],
    outfile: resolve(root, `pdf-generation/lib/generated/${adapter}.js`),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    treeShaking: true,
    logLevel: 'warning',
    ...(source === 'workspace' ? { alias: { [specifier]: workspaceEntry } } : {}),
  });
}
console.log(`Built the CSV and rendered file contract adapters from the ${source}.`);
