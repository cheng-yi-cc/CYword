import { useEffect, useRef } from "react";
import type { FlushResult } from "./sync-client";

export function useExitProtection(flush: () => Promise<FlushResult>, hasProgress: boolean) {
  const locked = useRef(false);
  const current = useRef({ flush, hasProgress });
  current.current = { flush, hasProgress };
  useEffect(() => {
    if (!window.cyword.onPrepareExit) return;
    let active = true;
    // Capture at window level also covers portals and keyboard rating shortcuts.
    const block = (event: Event) => {
      if (locked.current) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const events = ["click", "pointerdown", "keydown", "submit", "cyword-back"];
    for (const name of events) window.addEventListener(name, block, true);
    const unsubscribe = window.cyword.onPrepareExit(async () => {
      locked.current = true;
      document.documentElement.classList.add("exit-saving");
      const result = current.current.hasProgress ? await current.current.flush() : { localSaved: true, cloudSynced: true, message: "" };
      if (!active) return { localSaved: false, cloudSynced: false, message: "界面正在重新加载，请重试。" };
      return result;
    }, () => {
      locked.current = false;
      document.documentElement.classList.remove("exit-saving");
    });
    return () => {
      active = false; unsubscribe(); locked.current = false;
      document.documentElement.classList.remove("exit-saving");
      for (const name of events) window.removeEventListener(name, block, true);
    };
  }, []);
  return locked;
}
