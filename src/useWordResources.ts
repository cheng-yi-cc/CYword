import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { WordResourceCache } from "./word-resources";
import type { Catalog, WordDetail, WordsRequest } from "./types";

const emptyDetails: Record<string, WordDetail> = {};
const noSubscribe = () => () => undefined;
const emptySnapshot = () => emptyDetails;

export function useWordResources(catalog: Catalog | null) {
  const cache = useMemo(() => catalog ? new WordResourceCache({
    bookCode: catalog.book.code,
    dataVersion: catalog.dataVersion,
    request: request => window.cyword.readWords(request),
  }) : null, [catalog?.book.code, catalog?.dataVersion]);
  const details = useSyncExternalStore(cache?.subscribe ?? noSubscribe, cache?.snapshot ?? emptySnapshot);
  useEffect(() => () => { cache?.clear(); }, [cache]);
  const loadWords = useCallback((ids: string[], kind: WordsRequest["kind"], planDay: number) => cache?.load(ids, kind, planDay) ?? Promise.resolve(false), [cache]);
  return { details, loadWords };
}
