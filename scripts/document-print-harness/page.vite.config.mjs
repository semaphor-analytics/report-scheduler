// A production build of react-semaphor's print dev pages (the Document print
// page, and the card print page where the checkout has one), since the print
// route runs a production build and React's development mode would distort
// timings. run.mjs and aws.mjs set the two environment variables. The pages
// refuse to run outside development, so the build defines
// `import.meta.env.DEV`; nothing else they load branches on it.
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

// Measurement only (`aws.mjs build --lift-page-cap`): the page's PDF page cap
// lifted, so a Document past it prints and its memory and time are measured.
const liftPageCap = process.env.DOCUMENT_PRINT_LIFT_PAGE_CAP === '1';
const liftedPageCap = {
  name: 'measurement-lifted-page-cap',
  // Before the TypeScript transform, so it reads the source as written.
  enforce: 'pre',
  transform(code, id) {
    if (!liftPageCap || !id.endsWith('/shared/format-utils/pdf-export-policy.ts')) return null;
    if (!/maxPages: 300,/.test(code)) throw new Error('The page cap moved; update page.vite.config.mjs.');
    return code.replace(/maxPages: 300,/, 'maxPages: 1_000_000,');
  },
};

export default {
  root,
  plugins: [react(), liftedPageCap],
  resolve: { alias: { '@': path.resolve(root, 'src') } },
  define: { 'import.meta.env.DEV': 'true' },
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: false,
    minify: true,
    chunkSizeWarningLimit: 100_000,
    rollupOptions: {
      input: ['document-print-dev.html', 'card-print-dev.html']
        .map((page) => path.resolve(root, page))
        .filter((page) => fs.existsSync(page)),
    },
  },
};
