#!/usr/bin/env node
// Bundles react-semaphor's PDF table layout engine
// (`react-semaphor/format-utils/pdf-table-layout`) into
// pdf-generation/lib/generated/pdf-table-layout.js (ignored by git).
//
//   --source=package    the installed react-semaphor; deploys use this.
//   --source=workspace  the sibling ../react-semaphor checkout, for checking
//                       unreleased engine changes locally.
//   --source=auto       the sibling checkout when present, else the package;
//                       tests and local runs use this.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const specifier = 'react-semaphor/format-utils/pdf-table-layout';
const workspaceEntry = resolve(
  root,
  '../react-semaphor/src/shared/format-utils/pdf-table-layout/index.ts',
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
  entryPoints: [resolve(root, 'scripts/pdf-table-layout-entry.mjs')],
  outfile: resolve(root, 'pdf-generation/lib/generated/pdf-table-layout.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  treeShaking: true,
  logLevel: 'warning',
  ...(source === 'workspace' ? { alias: { [specifier]: workspaceEntry } } : {}),
});
console.log(`Built the PDF table layout adapter from the ${source}.`);
