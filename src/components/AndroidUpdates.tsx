import { useState, useSyncExternalStore } from "react";
import type { AndroidUpdateState } from "../android-updates";

const idle: AndroidUpdateState = { status: "idle", currentVersion: "" };
const noSubscribe = () => () => {};
const noSnapshot = () => idle;
function useAndroidUpdate() {
  const service = window.cyword.androidUpdates;
  const state = useSyncExternalStore(service?.subscribe ?? noSubscribe, service?.getSnapshot ?? noSnapshot);
  return { service, state };
}

export function AndroidUpdateMenu() {
  const { service, state } = useAndroidUpdate();
  if (!service) return null;
  const available = Boolean(state.release);
  const busy = state.status === "checking" || state.status === "opening";
  return <section className="android-update-menu" aria-label="应用更新">
    <p>当前版本 {state.currentVersion || "—"}</p>
    <p role="status">{state.message || (available ? `发现新版本 ${state.release!.version}` : state.status === "current" ? "已是最新版本" : state.status === "checking" ? "正在检查…" : "")}</p>
    <button disabled={busy} onClick={() => void service.check()}>{state.status === "checking" ? "正在检查…" : "检查更新"}</button>
    {available && <button disabled={busy} onClick={() => void service.download()}>{state.status === "opening" ? "正在打开…" : "下载新版"}</button>}
  </section>;
}

export function AndroidUpdateNotice() {
  const { service, state } = useAndroidUpdate();
  const [dismissed, setDismissed] = useState("");
  if (!service || !state.release || dismissed === state.release.version || !["available", "opening"].includes(state.status)) return null;
  return <aside className="android-update-notice" aria-label="发现应用更新">
    <div><strong>新版本 {state.release.version}</strong>{state.message && <p role="status">{state.message}</p>}</div>
    <button disabled={state.status === "opening"} onClick={() => void service.download()}>{state.status === "opening" ? "正在打开…" : "下载"}</button>
    <button aria-label="稍后更新" onClick={() => setDismissed(state.release!.version)}>稍后</button>
  </aside>;
}
