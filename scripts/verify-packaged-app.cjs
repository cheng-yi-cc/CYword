const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { getRawHeader } = require('@electron/asar');

// Run before producing the installer. A source edit during ASAR streaming can
// otherwise leave stale offsets while the installer itself still builds.
module.exports = async function verifyPackagedApp(context) {
  const archive = path.join(context.appOutDir, 'resources', 'app.asar');
  const { header, headerSize } = getRawHeader(archive);
  const bytes = fs.readFileSync(archive);
  let checked = 0;
  function visit(directory, prefix = '') {
    for (const [name, entry] of Object.entries(directory.files || {})) {
      const file = prefix + name;
      if (file.startsWith('node_modules/@capacitor/')) throw new Error(`Android-only dependency entered desktop package: ${file}`);
      if (entry.files) { visit(entry, file + '/'); continue; }
      if (entry.link || entry.unpacked) continue;
      const start = 8 + headerSize + Number(entry.offset);
      if (!Number.isSafeInteger(start) || start < 8 + headerSize || start + entry.size > bytes.length)
        throw new Error(`ASAR offset/length invalid: ${file}`);
      const content = bytes.subarray(start, start + entry.size);
      if (entry.integrity?.algorithm !== 'SHA256' || createHash('sha256').update(content).digest('hex') !== entry.integrity.hash)
        throw new Error(`ASAR content changed during packaging: ${file}. Stop source edits and rebuild.`);
      if (file === 'package.json' || file === 'electron/generated/channel.json') JSON.parse(content.toString('utf8'));
      checked++;
    }
  }
  visit(header);
  console.log(`Verified ${checked} packed ASAR files before installer creation.`);
};

if (require.main === module) module.exports({ appOutDir: path.resolve(process.argv[2]) }).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
