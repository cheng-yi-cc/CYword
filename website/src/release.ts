export type ReleaseInfo = {
  version: string;
  date: string;
  size: string;
  filename: string;
  sizeBytes: number;
  downloadUrl: string;
  githubDownloadUrl: string;
  notesUrl: string;
  repositoryUrl: string;
  sha256: string;
};

type PublicRelease = {
  version: string;
  publishedAt: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  downloadPath: string;
  githubDownloadUrl: string;
  notesUrl: string;
  repositoryUrl: string;
};

const repositoryUrl = "https://github.com/cheng-yi-cc/CYword";

// R2 尚未发布动态指针或暂时不可用时，官网继续提供最后一个已核验版本。
export const release: ReleaseInfo = {
  version: "0.2.1",
  date: "2026.08.30",
  size: "134 MB",
  filename: "CYword-Setup-0.2.1.exe",
  sizeBytes: 140500489,
  downloadUrl: "https://cyword.chengyi.me/downloads/CYword-Setup-0.2.1.exe",
  githubDownloadUrl: `${repositoryUrl}/releases/download/v0.2.1/CYword-Setup-0.2.1.exe`,
  notesUrl: `${repositoryUrl}/releases/tag/v0.2.1`,
  repositoryUrl,
  sha256: "47aa16276aaf3ef7230149bd44aff16be0172b55f5a3caa930a0d7944da9b5fa",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPublicRelease(value: unknown, android = false): value is PublicRelease {
  if (!isRecord(value)) return false;
  const version = value.version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) return false;
  const filename = android ? `CYword-Android-${version}.apk` : `CYword-Setup-${version}.exe`;
  const tag = `${android ? "android-v" : "v"}${version}`;
  const expectedGithubUrl = `${repositoryUrl}/releases/download/${tag}/${filename}`;
  const versionedPath = new RegExp(`^/downloads/releases/${android ? "android/" : ""}${version.replace(/\./g, "\\.")}/[a-f0-9]{64}/${filename.replace(/\./g, "\\.")}$`);
  return value.filename === filename &&
    typeof value.publishedAt === "string" && Number.isFinite(Date.parse(value.publishedAt)) &&
    Number.isSafeInteger(value.sizeBytes) && Number(value.sizeBytes) > 0 &&
    typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256) &&
    typeof value.downloadPath === "string" &&
      ((!android && value.downloadPath === `/downloads/${filename}`) || versionedPath.test(value.downloadPath)) &&
    value.githubDownloadUrl === expectedGithubUrl &&
    value.notesUrl === `${repositoryUrl}/releases/tag/${tag}` &&
    value.repositoryUrl === repositoryUrl;
}

function formatDate(publishedAt: string): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(publishedAt));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}.${value.month}.${value.day}`;
}

export async function fetchLatestRelease(android = false): Promise<ReleaseInfo> {
  const response = await fetch(android ? "/downloads/android/latest.json" : "/downloads/latest.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Latest release request failed (${response.status})`);
  const value: unknown = await response.json();
  if (!isPublicRelease(value, android)) throw new Error("Latest release response is invalid");
  return {
    version: value.version,
    date: formatDate(value.publishedAt),
    size: `${Math.round(value.sizeBytes / (1024 * 1024))} MB`,
    filename: value.filename,
    sizeBytes: value.sizeBytes,
    downloadUrl: new URL(value.downloadPath, window.location.origin).toString(),
    githubDownloadUrl: value.githubDownloadUrl,
    notesUrl: value.notesUrl,
    repositoryUrl: value.repositoryUrl,
    sha256: value.sha256,
  };
}
