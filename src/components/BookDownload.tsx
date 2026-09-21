import { useState } from "react";
import { offlineBook, type DownloadState } from "../offline-book";
import type { Catalog } from "../types";

export function BookDownload({ onReady, onLogout }: { onReady: (catalog: Catalog) => void; onLogout: () => Promise<void> }) {
  const [state, setState] = useState<DownloadState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const download = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      // Best effort: an unsupported persistence request must not prevent download.
      void navigator.storage?.persist?.().catch(() => false);
      onReady(await offlineBook.download(setState));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "下载失败，请重试"); }
    finally { setBusy(false); }
  };
  return <div className="book-download-screen"><section className="book-download-card">
    <span className="book-download-brand">CYword</span><h1>下载六级词书</h1>
    <p>完整词书与全部发音下载到本机后，即可离线学习。</p>
    {state && <div className="book-download-progress" role="status"><span>{state.phase === "words" ? "词书" : "发音"} {state.completed} / {state.total}</span><progress value={state.completed} max={state.total} /></div>}
    {error && <p role="alert">{error}，已下载的内容会保留。</p>}
    <button className="book-download-start" disabled={busy} onClick={() => void download()}>{busy ? "正在下载…" : error || state ? "继续下载" : "下载词书"}</button>
    <button className="book-download-logout" disabled={busy} onClick={() => void onLogout().catch(reason => setError(String(reason)))}>退出登录</button>
  </section></div>;
}
