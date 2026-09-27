import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { buildChannel } from './build-channel.mjs';

const channel = buildChannel();
if (channel.name !== 'acceptance') throw Error('Set CYWORD_ACCEPTANCE_ORIGIN to the isolated HTTPS backend first');
const target = process.argv[2] || 'all';
if (!['all', 'windows', 'android'].includes(target)) throw Error('Expected all, windows or android');
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}
run('npm', ['run', 'build']);
if (target !== 'android') {
  const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
  const config = { ...packageJson.build, appId: channel.desktopId, productName: channel.productName,
    extraMetadata: { ...packageJson.build.extraMetadata, name: 'cyword-acceptance' },
    directories: { output: 'release/acceptance' },
    nsis: { ...packageJson.build.nsis, createDesktopShortcut: false, createStartMenuShortcut: true, runAfterFinish: false },
    publish: [{ provider: 'generic', url: `${channel.origin}/downloads/`, channel: 'latest', useMultipleRangeRequest: false }],
  };
  await fs.mkdir('.work/acceptance', { recursive: true });
  await fs.writeFile('.work/acceptance/electron-builder.json', JSON.stringify(config, null, 2));
  run('npx', ['electron-builder', '--config', '.work/acceptance/electron-builder.json', '--win', 'nsis', '--publish', 'never']);
}
if (target !== 'windows') {
  run('npx', ['cap', 'sync', 'android']);
  run('node', ['scripts/build-android.mjs', 'release']);
}
