import { build } from 'esbuild';
const bundle = build({ entryPoints: ['scripts/progress-preview.ts'], bundle: true, write: false, format: 'iife', globalName: 'IncrementalMock', platform: 'browser' });
export async function installSyncPreview(page) { await page.addInitScript({ content: (await bundle).outputFiles[0].text + '\n globalThis.IncrementalMock = IncrementalMock;' }); }
