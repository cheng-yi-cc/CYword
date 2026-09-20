import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load as parseYaml, dump as writeYaml, JSON_SCHEMA } from "js-yaml";
import { isReleasePointer, releaseNotesUrl } from "../website/server/release-manifest.ts";
import { assertReleaseSchemaSupport } from "./release-preflight.mjs";
import { verifyBlockmap } from "./verify-blockmap.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const bucket = "cyword-downloads";
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
      schemaVersion: 2, version, publishedAt: new Date().toISOString(), filename,
      sizeBytes: info.size, sha256,
      assetPath: `releases/android/${version}/${sha256}/${filename}`,
      notesUrl: releaseNotesUrl,
    };
    const work = path.join(root, ".work", "site-release", `android-${version}-${sha256.slice(0, 16)}`);
    await mkdir(work, { recursive: true });
    if (!isReleasePointer(pointer, true)) throw new Error("安卓发布清单无效");
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
  if (!installerStat.isFile() || !blockmapStat.isFile() || installerStat.size === 0 || blockmapStat.size === 0) {
    throw new Error("发布资产必须为非空普通文件");
  }

  if (Buffer.byteLength(manifest) > 64 * 1024) throw new Error("latest.yml 超过 64 KiB");
  // 使用 YAML 解析器拒绝重复键；不能只在整段文本中找到一个正确哈希就放行。
  const metadata = parseYaml(manifest, { schema: JSON_SCHEMA });
  const files = metadata && typeof metadata === "object" ? metadata.files : undefined;
  if (metadata?.version !== version) throw new Error(`latest.yml 版本与 package.json 的 ${version} 不一致`);
  if (!Array.isArray(files) || files.length !== 1 || files[0]?.url !== filename || metadata.path !== filename) {
    throw new Error("latest.yml 必须只引用当前安装包，禁止额外或外部下载地址");
  }
  const [sha256, sha512] = await Promise.all([
    fileDigest(installer, "sha256", "hex"),
    fileDigest(installer, "sha512", "base64"),
  ]);
  if (metadata.sha512 !== sha512 || files[0].sha512 !== sha512) throw new Error("latest.yml 的 SHA-512 与安装包不一致");
  if (files[0].size !== installerStat.size) throw new Error("latest.yml 的文件长度与安装包不一致");
  await verifyBlockmap(installer, blockmap);

  const baseKey = `releases/${version}/${sha256}`;
  const assetPath = `${baseKey}/${filename}`;
  const blockmapPath = `${assetPath}.blockmap`;
  const updaterMetadataPath = `${baseKey}/latest.yml`;
  const work = path.join(root, ".work", "site-release", `${version}-${sha256.slice(0, 16)}`);
  await mkdir(work, { recursive: true });
  const updaterMetadataFile = path.join(work, "latest.yml");
  const pointerFile = path.join(work, "current.json");
  const rewrittenManifest = writeYaml({ ...metadata, files: [{ ...files[0], url: assetPath }], path: assetPath }, { lineWidth: -1 });
  await writeFile(updaterMetadataFile, rewrittenManifest, "utf8");

  const parsedDate = metadata.releaseDate ? new Date(metadata.releaseDate) : new Date();
  const publishedAt = Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();
  const pointer = {
    schemaVersion: 2,
    version,
    publishedAt,
    filename,
    sizeBytes: installerStat.size,
    sha256,
    assetPath,
    blockmapPath,
    updaterMetadataPath,
    blockmapSha256: await fileDigest(blockmap, "sha256", "hex"),
    blockmapSizeBytes: blockmapStat.size,
    updaterMetadataSha256: createHash("sha256").update(rewrittenManifest).digest("hex"),
    updaterMetadataSizeBytes: Buffer.byteLength(rewrittenManifest),
    notesUrl: releaseNotesUrl,
  };
  if (!isReleasePointer(pointer)) throw new Error("Windows 发布清单无效");
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

function remoteMetadata(endpoint, key) {
  return new Promise((resolve, reject) => {
    const child = spawn("aws", ["s3api", "head-object", "--endpoint-url", endpoint,
      "--bucket", bucket, "--key", key, "--output", "json"],
    { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
      } else if (/\(404\)|NoSuchKey|Not Found/.test(stderr)) resolve(null);
      else reject(new Error(`读取 R2 对象 ${key} 失败：${stderr.trim()}`));
    });
  });
}

function remoteDigest(endpoint, key) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const child = spawn("aws", ["s3", "cp", `s3://${bucket}/${key}`, "-", "--endpoint-url", endpoint, "--no-progress"],
      { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "inherit"] });
    child.stdout.on("data", (chunk) => hash.update(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(hash.digest("hex")) : reject(new Error(`核验 R2 对象 ${key} 失败`)));
  });
}

async function upload(endpoint, file, key, contentType, cacheControl) {
  const expectedSize = (await stat(file)).size;
  const expectedHash = await fileDigest(file, "sha256", "hex");
  if (cacheControl.includes("immutable")) {
    const existing = await remoteMetadata(endpoint, key);
    if (existing) {
      if (existing.ContentLength !== expectedSize || await remoteDigest(endpoint, key) !== expectedHash) {
        throw new Error(`禁止覆盖已发布的 R2 对象：${key}`);
      }
      console.log(`已核验相同资产，跳过上传：${key}`);
      return;
    }
  }
  await run("aws", [
    "s3", "cp", file, `s3://${bucket}/${key}`,
    "--endpoint-url", endpoint, "--content-type", contentType,
    "--cache-control", cacheControl, "--no-progress",
  ]);
  const remote = await remoteMetadata(endpoint, key);
  if (remote?.ContentLength !== expectedSize || await remoteDigest(endpoint, key) !== expectedHash) {
    throw new Error(`R2 对象 ${key} 的长度或 SHA-256 不符，未确认发布成功`);
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

  await assertReleaseSchemaSupport(android);

  // 内容寻址资产先全部上传；current.json 是官网和自动更新共同的唯一发布开关，必须最后写入。
  await upload(endpoint, prepared.installer, prepared.pointer.assetPath, android ? "application/vnd.android.package-archive" : "application/octet-stream", immutable);
  if (!android) {
    await upload(endpoint, prepared.blockmap, prepared.pointer.blockmapPath, "application/octet-stream", immutable);
    await upload(endpoint, prepared.updaterMetadataFile, prepared.pointer.updaterMetadataPath, "application/x-yaml", immutable);
  }
  await upload(endpoint, prepared.pointerFile, android ? "releases/android/current.json" : "releases/current.json", "application/json", "no-store");
  console.log(`官网最新版指针已切换到 v${prepared.pointer.version}。`);
}
