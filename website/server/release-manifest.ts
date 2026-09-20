export type ReleasePointer = {
  schemaVersion: 1 | 2;
  version: string;
  publishedAt: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  assetPath: string;
  blockmapPath?: string;
  updaterMetadataPath?: string;
  blockmapSha256?: string;
  blockmapSizeBytes?: number;
  updaterMetadataSha256?: string;
  updaterMetadataSizeBytes?: number;
  notesUrl: string;
  githubDownloadUrl?: string;
  repositoryUrl?: string;
};

export type PublicRelease = Pick<ReleasePointer,
  "version" | "publishedAt" | "filename" | "sizeBytes" | "sha256" | "notesUrl"> & { downloadPath: string };

export const releaseNotesUrl = "/#release-notes";
const legacyRepositoryUrl = "https://github.com/cheng-yi-cc/CYword";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isSize = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

function hasReleaseIdentity(value: Record<string, unknown>, android: boolean): boolean {
  const version = value.version;
  return typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version) &&
    value.filename === (android ? `CYword-Android-${version}.apk` : `CYword-Setup-${version}.exe`) &&
    isHash(value.sha256) && isSize(value.sizeBytes) &&
    typeof value.publishedAt === "string" && Number.isFinite(Date.parse(value.publishedAt));
}

export function isReleasePointer(value: unknown, android = false): value is ReleasePointer {
  if (!isRecord(value) || !hasReleaseIdentity(value, android)) return false;
  const basePath = `releases/${android ? "android/" : ""}${value.version}/${value.sha256}`;
  if (value.assetPath !== `${basePath}/${value.filename}` || (!android &&
    (value.blockmapPath !== `${basePath}/${value.filename}.blockmap` || value.updaterMetadataPath !== `${basePath}/latest.yml`))) return false;
  // 线上已发布的 v1 指针继续可读，但私有仓库链接不再出现在公开响应中。
  if (value.schemaVersion === 1) {
    const tag = `${android ? "android-v" : "v"}${value.version}`;
    return value.githubDownloadUrl === `${legacyRepositoryUrl}/releases/download/${tag}/${value.filename}` &&
      value.notesUrl === `${legacyRepositoryUrl}/releases/tag/${tag}` && value.repositoryUrl === legacyRepositoryUrl;
  }
  return value.schemaVersion === 2 && value.notesUrl === releaseNotesUrl &&
    (android || (isHash(value.blockmapSha256) && isSize(value.blockmapSizeBytes) &&
      isHash(value.updaterMetadataSha256) && isSize(value.updaterMetadataSizeBytes)));
}

export function toPublicRelease(pointer: ReleasePointer): PublicRelease {
  return {
    version: pointer.version, publishedAt: pointer.publishedAt, filename: pointer.filename,
    sizeBytes: pointer.sizeBytes, sha256: pointer.sha256,
    downloadPath: `/downloads/${pointer.assetPath}`, notesUrl: releaseNotesUrl,
  };
}

export function isPublicRelease(value: unknown, android = false): value is PublicRelease {
  if (!isRecord(value) || !hasReleaseIdentity(value, android)) return false;
  const path = `/downloads/releases/${android ? "android/" : ""}${value.version}/${value.sha256}/${value.filename}`;
  const legacyTag = `${android ? "android-v" : "v"}${value.version}`;
  return (value.downloadPath === path || (!android && value.downloadPath === `/downloads/${value.filename}`)) &&
    (value.notesUrl === releaseNotesUrl || value.notesUrl === `${legacyRepositoryUrl}/releases/tag/${legacyTag}`);
}
