import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const bucket = "cyword-downloads";
const repositoryUrl = "https://github.com/cheng-yi-cc/CYword";
const prepareOnly = process.argv.includes("--prepare-only");
const android = process.argv.includes("--android");
const positional = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const releaseDirectory = path.resolve(root, positional[0] ?? "release");

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}，未发布官网安装包`);
  return value;
}

async function fileDigest(file, algorithm, encoding) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}

function yamlScalar(value) {
  return value.trim().replace(/^(['"])(.*)\1$/, "$2");
}

function replaceManifestAsset(manifest, filename, assetPath) {
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let urlCount = 0;
  const rewritten = manifest.replace(
    new RegExp(`^(\\s*(?:-\\s+)?)(url|path):(\\s*)(['"]?)${escaped}\\4\\s*$`, "gm"),
    (line, prefix, field, spacing, quote) => {
      if (field === "url") urlCount++;
      return `${prefix}${field}:${spacing}${quote}${assetPath}${quote}`;
    },
  );
  if (urlCount !== 1) {
    throw new Error(`latest.yml 应且仅应包含一个 ${filename} 的 files[].url，实际为 ${urlCount}`);
  }
  return rewritten;
}

async function prepareRelease() {
  if (android) {
    const { versionName: version } = JSON.parse(await readFile(path.join(root, "android/version.json"), "utf8"));
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("安卓版本号无效");
    const filename = `CYword-Android-${version}.apk`;
    const installer = path.join(releaseDirectory, filename);
    const info = await stat(installer);
    if (!info.isFile() || info.size === 0) throw new Error("安卓安装包无效");
    const sha256 = await fileDigest(installer, "sha256", "hex");
    const pointer = {
      schemaVersion: 1, version, publishedAt: new Date().toISOString(), filename,
      sizeBytes: info.size, sha256,
      assetPath: `releases/android/${version}/${sha256}/${filename}`,
      githubDownloadUrl: `${repositoryUrl}/releases/download/android-v${version}/${filename}`,
      notesUrl: `${repositoryUrl}/releases/tag/android-v${version}`, repositoryUrl,
    };
    const work = path.join(root, ".work", "site-release", `android-${version}-${sha256.slice(0, 16)}`);
    await mkdir(work, { recursive: true });
    const pointerFile = path.join(work, "current.json");
    await writeFile(pointerFile, `${JSON.stringify(pointer, null, 2)}\n`);
    return { installer, pointerFile, pointer };
  }
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const version = packageJson.version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`不支持的 package.json 版本：${version}`);

  const filename = `CYword-Setup-${version}.exe`;
  const installer = path.join(releaseDirectory, filename);
  const blockmap = `${installer}.blockmap`;
  const sourceManifest = path.join(releaseDirectory, "latest.yml");
  const [installerStat, blockmapStat, manifest] = await Promise.all([
    stat(installer),
    stat(blockmap),
    readFile(sourceManifest, "utf8"),
  ]);
  if (!installerStat.isFile() || !blockmapStat.isFile()) throw new Error("发布资产不是普通文件");

  const manifestVersion = manifest.match(/^version:\s*(.+?)\s*$/m);
  if (!manifestVersion || yamlScalar(manifestVersion[1]) !== version) {
    throw new Error(`latest.yml 版本与 package.json 的 ${version} 不一致`);
  }

  const [sha256, sha512] = await Promise.all([
    fileDigest(installer, "sha256", "hex"),
    fileDigest(installer, "sha512", "base64"),
  ]);
  const manifestSha512 = [...manifest.matchAll(/^\s*sha512:\s*(.+?)\s*$/gm)]
    .map((match) => yamlScalar(match[1]));
  if (!manifestSha512.includes(sha512)) throw new Error("latest.yml 的 SHA-512 与安装包不一致");
  const manifestSizes = [...manifest.matchAll(/^\s*size:\s*(\d+)\s*$/gm)]
    .map((match) => Number(match[1]));
  if (!manifestSizes.includes(installerStat.size)) throw new Error("latest.yml 的文件长度与安装包不一致");

  const baseKey = `releases/${version}/${sha256}`;
  const assetPath = `${baseKey}/${filename}`;
  const blockmapPath = `${assetPath}.blockmap`;
  const updaterMetadataPath = `${baseKey}/latest.yml`;
  const work = path.join(root, ".work", "site-release", `${version}-${sha256.slice(0, 16)}`);
  await mkdir(work, { recursive: true });
  const updaterMetadataFile = path.join(work, "latest.yml");
  const pointerFile = path.join(work, "current.json");
  const rewrittenManifest = replaceManifestAsset(manifest, filename, assetPath);
  await writeFile(updaterMetadataFile, rewrittenManifest, "utf8");

  const releaseDate = manifest.match(/^releaseDate:\s*(.+?)\s*$/m);
  const parsedDate = releaseDate ? new Date(yamlScalar(releaseDate[1])) : new Date();
  const publishedAt = Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();
  const pointer = {
    schemaVersion: 1,
    version,
    publishedAt,
    filename,
    sizeBytes: installerStat.size,
    sha256,
    assetPath,
    blockmapPath,
    updaterMetadataPath,
    githubDownloadUrl: `${repositoryUrl}/releases/download/v${version}/${filename}`,
    notesUrl: `${repositoryUrl}/releases/tag/v${version}`,
    repositoryUrl,
  };
  await writeFile(pointerFile, `${JSON.stringify(pointer, null, 2)}\n`, "utf8");

  return {
    installer,
    blockmap,
    updaterMetadataFile,
    pointerFile,
    pointer,
  };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} 退出码 ${code ?? "unknown"}`)));
  });
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${command} 退出码 ${code ?? "unknown"}`)));
  });
}

async function upload(endpoint, file, key, contentType, cacheControl) {
  await run("aws", [
    "s3", "cp", file, `s3://${bucket}/${key}`,
    "--endpoint-url", endpoint,
    "--content-type", contentType,
    "--cache-control", cacheControl,
    "--no-progress",
  ]);
  const expectedSize = (await stat(file)).size;
  const remoteSize = Number(await capture("aws", [
    "s3api", "head-object",
    "--endpoint-url", endpoint,
    "--bucket", bucket,
    "--key", key,
    "--query", "ContentLength",
    "--output", "text",
  ]));
  if (remoteSize !== expectedSize) {
    throw new Error(`R2 对象 ${key} 长度不符：预期 ${expectedSize}，实际 ${remoteSize}`);
  }
}

const prepared = await prepareRelease();
console.log(`官网发布资产校验通过：${prepared.pointer.filename} (${prepared.pointer.sha256})`);

if (prepareOnly) {
  console.log(`仅生成发布文件，未上传：${path.dirname(prepared.pointerFile)}`);
} else {
  const accountId = requiredEnvironment("CLOUDFLARE_ACCOUNT_ID");
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error("CLOUDFLARE_ACCOUNT_ID 格式无效");
  requiredEnvironment("AWS_ACCESS_KEY_ID");
  requiredEnvironment("AWS_SECRET_ACCESS_KEY");
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const immutable = "public, max-age=31536000, immutable, no-transform";

  // 内容寻址资产先全部上传；current.json 是官网和自动更新共同的唯一发布开关，必须最后写入。
  await upload(endpoint, prepared.installer, prepared.pointer.assetPath, android ? "application/vnd.android.package-archive" : "application/octet-stream", immutable);
  if (!android) {
    await upload(endpoint, prepared.blockmap, prepared.pointer.blockmapPath, "application/octet-stream", immutable);
    await upload(endpoint, prepared.updaterMetadataFile, prepared.pointer.updaterMetadataPath, "application/x-yaml", immutable);
  }
  await upload(endpoint, prepared.pointerFile, android ? "releases/android/current.json" : "releases/current.json", "application/json", "no-store");
  console.log(`官网最新版指针已切换到 v${prepared.pointer.version}。`);
}
