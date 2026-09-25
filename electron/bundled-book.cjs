const fs = require("node:fs/promises");
const path = require("node:path");

function readBundledBookFile(directory, file) {
  if (typeof file !== "string" || !/^(catalog\.json|manifest\.json|words\/[a-zA-Z0-9_-]+\.json)$/.test(file)) {
    throw new Error("Invalid installed book path");
  }
  return fs.readFile(path.join(directory, file), "utf8").then(JSON.parse);
}
module.exports = { readBundledBookFile };
