import { useEffect, useRef, useState } from "react";

/** One synchronous gate covers pointer and keyboard actions before React renders. */
export function useSessionSave() {
  const lock = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const run = async (save: () => Promise<void>, afterSave: () => void) => {
    if (lock.current || !mounted.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await save();
      if (mounted.current) afterSave();
    } catch (reason) {
      if (mounted.current) setError(`这次操作未保存：${reason instanceof Error ? reason.message : "请重试。"}`);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { lock, busy, error, setError, run };
}

export function useSessionWord(
  id: string | undefined,
  load: (ids: string[], kind: "study" | "review" | "bookmarks", day: number) => Promise<boolean>,
  kind: "study" | "review" | "bookmarks",
  day: number,
  nextIds: string[] = [],
) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const loader = useRef(load);
  const upcoming = useRef(nextIds);
  loader.current = load;
  upcoming.current = nextIds;
  useEffect(() => {
    let active = true;
    setFailed(false);
    if (id) void loader.current([id], kind, day).then((ok) => {
      if (!active) return;
      setFailed(!ok);
      if (ok && upcoming.current.length) void loader.current(upcoming.current, "bookmarks", day).catch(() => undefined);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [id, kind, day, attempt]);
  return { failed, retry: () => setAttempt(value => value + 1) };
}
