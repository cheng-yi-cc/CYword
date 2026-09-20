import { isPublicRelease, releaseNotesUrl } from "../server/release-manifest";

export type ReleaseInfo = {
  version: string;
  date: string;
  size: string;
  filename: string;
  sizeBytes: number;
  downloadUrl: string;
  notesUrl: string;
  sha256: string;
};

// R2 尚未发布动态指针或暂时不可用时，官网继续提供最后一个已核验版本。
export const release: ReleaseInfo = {
  version: "0.4.4",
  date: "2026.09.20",
  size: "123 MB",
  filename: "CYword-Setup-0.4.4.exe",
  sizeBytes: 129150572,
  downloadUrl: "https://cyword.chengyi.me/downloads/releases/0.4.4/985ac100038fe023c23e921a4e86889d1374a2f9b5d8f2fd6f71eb6cd7ded9c0/CYword-Setup-0.4.4.exe",
  notesUrl: releaseNotesUrl,
  sha256: "985ac100038fe023c23e921a4e86889d1374a2f9b5d8f2fd6f71eb6cd7ded9c0",
};

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
  const response = await fetch(android ? "/downloads/android/latest.json" : "/downloads/latest.json", { cache: "no-store", signal: AbortSignal.timeout(12000) });
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
    notesUrl: releaseNotesUrl,
    sha256: value.sha256,
  };
}
