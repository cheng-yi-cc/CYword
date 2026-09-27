import { build } from "esbuild";
import fs from "node:fs/promises";
import { buildChannel } from "./build-channel.mjs";
await build({
  stdin: { contents: `import {assertBookProgress} from './src/progress-business.ts'; import {progressCatalog} from './website/server/progress-curriculum.ts'; export {encodeProgressWire,decodeProgressWire} from './src/progress-compression.ts'; export function validStoredProgress(value) { try { assertBookProgress(value, progressCatalog); return true; } catch { return false; } }`, resolveDir: process.cwd(), sourcefile: "storage-validation.ts" },
  bundle: true, platform: "node", format: "cjs", outfile: "electron/generated/progress-validation.cjs",
});
await fs.writeFile('electron/generated/channel.json', JSON.stringify(buildChannel(), null, 2));
