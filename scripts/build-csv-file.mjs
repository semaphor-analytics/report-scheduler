#!/usr/bin/env node
// Bundles react-semaphor's CSV file contract (the BOM, quoting and record
// separators every delivered CSV uses) into
// pdf-generation/lib/generated/csv-file.js (ignored by git). pdf-generation
// has no react-semaphor dependency, so this is how it shares the contract.
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
  '../react-semaphor/src/shared/format-utils/exporters/csv-utils.ts',
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

await build({
  entryPoints: [resolve(root, 'scripts/csv-file-entry.mjs')],
  outfile: resolve(root, 'pdf-generation/lib/generated/csv-file.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  treeShaking: true,
  logLevel: 'warning',
  ...(source === 'workspace' ? { alias: { [specifier]: workspaceEntry } } : {}),
});
console.log(`Built the CSV file contract adapter from the ${source}.`);
