#!/usr/bin/env node
// Bundles react-semaphor's Document print contract
// (`react-semaphor/format-utils`, its `document-print` module) into
// pdf-generation/lib/generated/document-print.js (ignored by git).
//
//   --source=package    the installed react-semaphor; deploys use this, so the
//                       installed version must include the module.
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
  '../react-semaphor/src/shared/format-utils/document-print.ts',
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
  entryPoints: [resolve(root, 'scripts/document-print-entry.mjs')],
  outfile: resolve(root, 'pdf-generation/lib/generated/document-print.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  treeShaking: true,
  logLevel: 'warning',
  ...(source === 'workspace' ? { alias: { [specifier]: workspaceEntry } } : {}),
});
console.log(`Built the Document print adapter from the ${source}.`);
