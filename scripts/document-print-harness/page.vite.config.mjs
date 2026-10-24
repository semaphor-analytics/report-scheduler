// A production build of react-semaphor's Document print dev page, since the
// print route runs a production build and React's development mode would
// distort timings. run.mjs sets the two environment variables. The page
// refuses to run outside development, so the build defines
// `import.meta.env.DEV`; nothing else the page loads branches on it.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.DOCUMENT_PRINT_REACT_SEMAPHOR;
const outDir = process.env.DOCUMENT_PRINT_PAGE_OUT;
if (!root || !outDir) {
  throw new Error('Run through run.mjs, which sets DOCUMENT_PRINT_REACT_SEMAPHOR and DOCUMENT_PRINT_PAGE_OUT.');
}
// The checkout's own React plugin, by its ESM entry (its CJS build loads Vite's deprecated CJS API).
const pluginDir = path.join(root, 'node_modules/@vitejs/plugin-react');
const pluginEntry = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8')).exports['.'].import;
const react = (await import(pathToFileURL(path.join(pluginDir, typeof pluginEntry === 'string' ? pluginEntry : pluginEntry.default)).href)).default;

export default {
  root,
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(root, 'src') } },
  define: { 'import.meta.env.DEV': 'true' },
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: false,
    minify: true,
    chunkSizeWarningLimit: 100_000,
    rollupOptions: { input: path.resolve(root, 'document-print-dev.html') },
  },
};
