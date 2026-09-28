import { useEffect, useRef, useState } from 'react';
import { LocalProgress } from './local-progress';
import type { AppProgress, Catalog, FlushResult } from './types';

export function useLocalProgress(catalog: Catalog | null) {
  const [progress, setProgress] = useState<AppProgress | null>(null);
  const [error, setError] = useState('');
  const store = useRef<LocalProgress | null>(null);
  useEffect(() => {
    if (!catalog) return;
    let active = true;
    const local = new LocalProgress(catalog, {
      read: () => window.cyword.readProgress(),
      write: value => window.cyword.writeProgress(value),
      change: value => { if (active) setProgress(value); },
    });
    store.current = local;
    void local.open().catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; if (store.current === local) store.current = null; };
  }, [catalog]);
  return {
    progress, error,
    save: async (value: AppProgress) => {
      if (!store.current) throw new Error('本机进度尚未就绪');
      await store.current.save(value);
    },
    flush: (): Promise<FlushResult> => store.current?.flush() ?? Promise.resolve({ localSaved: false, cloudSynced: true, message: '本机进度尚未就绪' }),
  };
}
