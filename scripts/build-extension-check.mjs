#!/usr/bin/env node
// Bundles react-semaphor's custom visual checks (`react-semaphor/extensions`,
// custom visuals Plan 1 Phase 4) into
// pdf-generation/lib/generated/extension-check.js (ignored by git): the
// audits and fix list rules for Node, and the viewers' sandbox host as a
// browser script the worker injects into the page it renders in.
//
//   --source=package    the installed react-semaphor; deploys use this, so the
//                       installed version must include the module.
//   --source=workspace  the sibling ../react-semaphor checkout, for checking
//                       unreleased changes locally.
//   --source=auto       the sibling checkout when present, else the package;
//                       tests and local runs use this.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const specifier = 'react-semaphor/extensions';
const workspaceEntry = resolve(root, '../react-semaphor/src/shared/extensions/index.ts');

const sourceArg = process.argv.find((arg) => arg.startsWith('--source='));
const requested = sourceArg ? sourceArg.slice('--source='.length) : 'package';
if (!['package', 'workspace', 'auto'].includes(requested)) {
  console.error(`Unknown --source "${requested}"; use package, workspace or auto.`);
  process.exit(1);
}
const source = requested === 'auto' ? (existsSync(workspaceEntry) ? 'workspace' : 'package') : requested;
if (source === 'workspace' && !existsSync(workspaceEntry)) {
  console.error(`No react-semaphor checkout at ${workspaceEntry}.`);
  process.exit(1);
}
const alias = source === 'workspace' ? { [specifier]: workspaceEntry } : {};
// The page only needs the runner and the host under it.
const runnerAlias =
  source === 'workspace' ? { [specifier]: resolve(root, '../react-semaphor/src/shared/extensions/check-runner.ts') } : {};

// The host for the page: one browser script, returned as text.
const runner = await build({
  entryPoints: [resolve(root, 'scripts/extension-check-runner-entry.mjs')],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
  treeShaking: true,
  minify: true,
  logLevel: 'warning',
  alias: runnerAlias,
});
const runnerScript = runner.outputFiles[0].text;

await build({
  entryPoints: [resolve(root, 'scripts/extension-check-entry.mjs')],
  outfile: resolve(root, 'pdf-generation/lib/generated/extension-check.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  treeShaking: true,
  logLevel: 'warning',
  alias,
  plugins: [
    {
      name: 'runner-script',
      setup(builder) {
        builder.onResolve({ filter: /^extension-check-runner-script$/ }, () => ({ path: 'runner', namespace: 'runner-script' }));
        builder.onLoad({ filter: /.*/, namespace: 'runner-script' }, () => ({
          contents: `export const RUNNER_SCRIPT = ${JSON.stringify(runnerScript)};`,
          loader: 'js',
        }));
      },
    },
  ],
});
console.log(`Built the custom visual checks from the ${source}.`);
