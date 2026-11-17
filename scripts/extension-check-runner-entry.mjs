// Bundled for the browser page the worker checks a visual in: the viewers'
// host, run once per render (react-semaphor `runExtensionCheck`).
import { runExtensionCheck } from 'react-semaphor/extensions';

window.__runExtensionCheck = runExtensionCheck;
