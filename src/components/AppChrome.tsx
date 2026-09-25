import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSessionDialog } from "../useSessionDialog";
import { releaseNotes } from "../release-notes";

export function SearchIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.6" /><path d="m16 16 4.5 4.5" /></svg>;
}

export function PopupMenu({ className, label, children, disabled = false }: { className: string; label: ReactNode; children: ReactNode; disabled?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: Event) => {
      if (!ref.current?.open || ref.current.contains(event.target as Node)) return;
      ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        event.preventDefault(); event.stopPropagation(); ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    ref.current?.addEventListener("keydown", escape);
    const current = ref.current;
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("focusin", dismiss); current?.removeEventListener("keydown", escape); };
  }, []);
  return <details ref={ref} className={className}><summary aria-disabled={disabled || undefined} onClick={event => { if (disabled) event.preventDefault(); }}>{label}</summary><div className="chrome-menu">{children}</div></details>;
}

export function TitleBar({ onSearch, ready, bookName }: { onSearch?: () => void; ready?: boolean; bookName?: string }) {
  return <header className="desktop-titlebar" aria-label="应用标题栏">
    <button className="titlebar-search" aria-label="单词搜索" aria-keyshortcuts="Control+K Meta+K" disabled={!ready} onClick={onSearch}><SearchIcon /><span>搜索单词</span><kbd>Ctrl K</kbd></button>
    <PopupMenu className="book-picker" label={<><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15" /></svg><span>{bookName || "六级词书"}</span><span className="book-chevron" aria-hidden="true">⌄</span></>}>
      <div className="book-choice current"><span>{bookName || "六级词书"}</span><small>当前使用</small><span aria-hidden="true">✓</span></div>
      <button className="book-choice" disabled><span>四级词书</span><small>即将上线</small></button>
    </PopupMenu>
  </header>;
}

export function ShellDialog({ label, className = "", onClose, busy, children }: { label: string; className?: string; onClose: () => void; busy?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useSessionDialog({ active: true, dialogRef: ref, onClose, busy });
  return createPortal(<div className={`shell-dialog-backdrop ${className}`} onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><div ref={ref} className="shell-dialog" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>{children}<button className="dialog-close" aria-label={`关闭${label}`} disabled={busy} onClick={onClose}>×</button></div></div>, document.body);
}

export function ReleaseNotesDialog({ onClose }: { onClose: () => void }) {
  const android = Boolean(window.cyword.androidUpdates);
  const releases = releaseNotes.filter(item => android ? item.android : item.version);
  const [index, setIndex] = useState(0);
  const release = releases[index];
  return <ShellDialog label="更新日志" className="release-dialog" onClose={onClose}>
    <header className="release-heading"><h2>更新日志</h2></header>
    <div className="release-layout"><nav className="release-history" aria-label="历史版本">{releases.map((item, i) => <button key={item.version || item.android} aria-current={i === index ? "true" : undefined} onClick={() => setIndex(i)}><b>v{android ? item.android : item.version}</b>{i === 0 && <small>最新</small>}<time>{item.date}</time></button>)}</nav>
      <article className="release-detail" key={index}><div className="release-meta"><span>{android ? "Android" : "Windows"} {android ? release.android : release.version}</span><time>{release.date}</time></div><h3>{release.title}</h3><ul>{release.changes.map(change => <li key={change}>{change}</li>)}</ul></article>
    </div>
  </ShellDialog>;
}
