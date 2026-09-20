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
  version: "0.4.5",
  date: "2026.09.20",
  size: "123 MB",
  filename: "CYword-Setup-0.4.5.exe",
  sizeBytes: 129160435,
  downloadUrl: "https://cyword.chengyi.me/downloads/releases/0.4.5/3663022f0c87080ffb5cb4e411b2af8791e58969a2218ecbbf3f5c39a6b02320/CYword-Setup-0.4.5.exe",
  notesUrl: releaseNotesUrl,
  sha256: "3663022f0c87080ffb5cb4e411b2af8791e58969a2218ecbbf3f5c39a6b02320",
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
