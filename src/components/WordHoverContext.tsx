import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { wordMemoryDisplay } from "../memory-display";
import type { Catalog, WordDetail, WordSummary } from "../types";
import { buildPlan, studyExposures } from "../progress";
import { AudioButton } from "./AudioButton";
import { stopPronunciation } from "../audio";

interface WordAppearance {
  day: number;
  index: number;
  wordId: string;
  spelling: string;
}

interface HoverState {
  wordId: string;
  spelling: string;
  isUnlearned: boolean;
  targetDay?: number;
  rect: DOMRect;
}

interface WordHoverContextValue {
  showHover: (wordRef: string, element: HTMLElement, familiar?: boolean, pinned?: boolean) => void;
  hideHover: () => void;
  keepHover: () => void;
  checkWordStatus: (wordRef: string) => { isUnlearned: boolean; targetDay?: number; wordId?: string; inBook: boolean };
  currentWordId?: string;
  setCurrentWordId: (id?: string) => void;
  renderWordMarkup: (text: string) => string;
}

const WordHoverContext = createContext<WordHoverContextValue | null>(null);

export function useWordHover() {
  return useContext(WordHoverContext);
}

function PopoverCard({
  state,
  detail,
  summary,
  onMouseEnter,
  onMouseLeave,
  onClose,
  loadFailed,
  onRetry,
}: {
  state: HoverState;
  detail?: WordDetail;
  summary?: WordSummary;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClose: () => void;
  loadFailed: boolean;
  onRetry: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; placement: "bottom" | "top" }>({
    top: 0,
    left: 0,
    placement: "bottom",
  });

  useLayoutEffect(() => {
    const rect = state.rect;
    const popoverWidth = cardRef.current?.offsetWidth ?? 395;
    const estimatedHeight = cardRef.current?.offsetHeight ?? 360;

    let left = rect.left + rect.width / 2 - popoverWidth / 2;
    if (left + popoverWidth > window.innerWidth - 16) {
      left = window.innerWidth - popoverWidth - 16;
    }
    if (left < 16) left = 16;

    const spaceBelow = window.innerHeight - rect.bottom - 16;
    const spaceAbove = rect.top - 16;

    let top: number;
    let placement: "bottom" | "top" = "bottom";

    if (spaceBelow < 280 && spaceAbove > spaceBelow) {
      placement = "top";
      top = Math.max(16, rect.top - estimatedHeight - 10);
    } else {
      placement = "bottom";
      top = Math.min(rect.bottom + 8, Math.max(16, window.innerHeight - estimatedHeight - 16));
    }

    setCoords({ top, left, placement });
  }, [state.rect, detail]);

  const spelling = detail?.spelling || summary?.spelling || state.spelling;
  const pronunciation = detail?.pronunciation || summary?.pronunciation;
  const definition = detail?.definitionCn || summary?.definitionCn;
  const audioUrl = detail?.audioUrl;
  useEffect(() => () => { if (audioUrl) stopPronunciation(audioUrl); }, [audioUrl]);

  const orderedRoots = useMemo(() => {
    if (!detail?.roots) return [];
    return [...detail.roots].sort((a, b) => a.order - b.order);
  }, [detail]);

  const memoryHtml = useMemo(() => {
    if (!detail?.memoryMarkup) return "";
    const preprocessed = wordMemoryDisplay(detail.memoryMarkup)!
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "**$2**")
      .replace(/\[\[([^\]]+)\]\]/g, "**$1**");
    return DOMPurify.sanitize(marked.parse(preprocessed, { breaks: true }) as string);
  }, [detail?.memoryMarkup]);

  return (
    <div
      ref={cardRef}
      className={`word-hover-popover placement-${coords.placement}`}
      style={{
        position: "fixed",
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        zIndex: 9999,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="popover-header">
        <button className="popover-close" onClick={onClose} aria-label="关闭关联词">×</button>
        <div className="popover-meta">
          {state.isUnlearned ? (
            <span className="popover-badge unlearned">计划后序词 · 第 {state.targetDay} 天</span>
          ) : (
            <span className="popover-badge learned">
              {state.targetDay ? `学习计划 · 第 ${state.targetDay} 天` : "词书词汇"}
            </span>
          )}
        </div>
      </div>

      <div className="popover-scroll-body">
        <div className="popover-word-hero">
          <div className="popover-title-row">
            <h3 className="popover-spelling">{spelling}</h3>
            <AudioButton url={audioUrl} className="popover-audio" />
          </div>
          {pronunciation && <span className="popover-pronunciation">{pronunciation}</span>}
          <p className="popover-definition">{definition}</p>
        </div>

        {detail ? (
          <>
            {detail.memoryMarkup && (
              <div className="popover-section">
                <h4>单词巧记</h4>
                <div
                  className="popover-rich-text"
                  dangerouslySetInnerHTML={{ __html: memoryHtml }}
                />
              </div>
            )}

            {orderedRoots.length > 0 && (
              <div className="popover-section">
                <h4>构词分解</h4>
                <div className="popover-equation">
                  {orderedRoots.map((part, index) => (
                    <span className="popover-part" key={`${part.id}-${index}`}>
                      {index > 0 && <i>＋</i>}
                      <b>{part.spelling}</b>
                      <small>{part.meaning}</small>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {detail.examples && detail.examples.length > 0 && (
              <div className="popover-section">
                <h4>精选示例</h4>
                <div className="popover-example">
                  <p className="en">{detail.examples[0].sentence_en || detail.examples[0].sentence}</p>
                  <p className="cn">{detail.examples[0].sentence_cn || detail.examples[0].translation}</p>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="popover-loading" role="status">{loadFailed ? <>单词加载失败 <button onClick={onRetry}>重试</button></> : "正在加载单词详情…"}</div>
        )}
      </div>
    </div>
  );
}

export function WordHoverProvider({
  catalog,
  details,
  loadWords,
  currentWordId: initialCurrentWordId,
  planDay,
  children,
}: {
  catalog: Catalog | null;
  details: Record<string, WordDetail>;
  loadWords: (ids: string[], kind: "study" | "review" | "bookmarks", planDay: number) => Promise<boolean>;
  currentWordId?: string;
  planDay?: number;
  children: ReactNode;
}) {
  const [currentWordId, setCurrentWordId] = useState<string | undefined>(initialCurrentWordId);
  const [hoverState, setHoverState] = useState<HoverState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const pinnedRef = useRef(false);
  const hoverWordId = hoverState?.wordId;
  const hoverDetail = hoverWordId ? details[hoverWordId] : undefined;
  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    if (hoverWordId && !hoverDetail) void loadWords([hoverWordId], "bookmarks", planDay || 1).then(ok => {
      if (active) setLoadFailed(!ok);
    });
    return () => { active = false; };
  }, [hoverWordId, hoverDetail, planDay, retry, loadWords]);

  useEffect(() => {
    setCurrentWordId(initialCurrentWordId);
  }, [initialCurrentWordId]);

  const { appearanceMap, spellingToIdMap } = useMemo(() => {
    const appearance = new Map<string, WordAppearance>();
    const spellingMap = new Map<string, string>();

    if (!catalog || !catalog.schedule) return { appearanceMap: appearance, spellingToIdMap: spellingMap };

    let globalIdx = 0;
    for (const day of buildPlan(catalog)) {
      if (day.kind !== "study") continue;
      for (const { wordId: wId } of studyExposures(day, catalog.groups)) {
        const wordSummary = catalog.words[wId];
        const lowerSpelling = wordSummary ? wordSummary.spelling.toLowerCase() : "";
        if (lowerSpelling) spellingMap.set(lowerSpelling, wId);

        if (!appearance.has(wId)) {
          const item: WordAppearance = {
            day: day.day,
            index: globalIdx,
            wordId: wId,
            spelling: wordSummary?.spelling || "",
          };
          appearance.set(wId, item);
          if (lowerSpelling && !appearance.has(lowerSpelling)) {
            appearance.set(lowerSpelling, item);
          }
        }
        globalIdx++;
      }
    }
    return { appearanceMap: appearance, spellingToIdMap: spellingMap };
  }, [catalog]);

  const currentAppearance = useMemo(() => {
    if (!currentWordId) return null;
    return appearanceMap.get(currentWordId) || null;
  }, [currentWordId, appearanceMap]);

  const checkWordStatus = useCallback(
    (wordRef: string) => {
      let clean = wordRef.toLowerCase().trim();
      // Clean affix suffixes like vis-根 -> vis, un-前缀 -> un
      clean = clean.replace(/-(?:根|缀|基|前缀|后缀|词根|词缀|词基)$/u, "");
      const targetApp = appearanceMap.get(clean);
      if (!targetApp) {
        return { isUnlearned: false, inBook: false };
      }

      if (currentAppearance) {
        const isUnlearned = targetApp.index > currentAppearance.index;
        return {
          isUnlearned,
          targetDay: targetApp.day,
          wordId: targetApp.wordId,
          inBook: true,
        };
      }

      return {
        isUnlearned: false,
        targetDay: targetApp.day,
        wordId: targetApp.wordId,
        inBook: true,
      };
    },
    [appearanceMap, currentAppearance],
  );

  const clearTimers = () => {
    if (showTimerRef.current) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  useEffect(() => {
    clearTimers();
    pinnedRef.current = false;
    setHoverState(null);
  }, [currentWordId]);

  const showHover = useCallback(
    (wordRef: string, element: HTMLElement, familiar = false, pinned = false) => {
      if (pinnedRef.current && !pinned) return;
      clearTimers();
      let clean = wordRef.toLowerCase().trim();
      clean = clean.replace(/-(?:根|缀|基|前缀|后缀|词根|词缀|词基)$/u, "");
      const targetApp = appearanceMap.get(clean);
      if (!targetApp) return;
      pinnedRef.current = pinned;

      const rect = element.getBoundingClientRect();
      const status = checkWordStatus(wordRef);

      showTimerRef.current = window.setTimeout(() => {
        setHoverState({
          wordId: targetApp.wordId,
          spelling: targetApp.spelling,
          isUnlearned: familiar ? false : status.isUnlearned,
          targetDay: targetApp.day,
          rect,
        });

      }, 120);
    },
    [appearanceMap, checkWordStatus, details, loadWords, planDay],
  );

  const hideHover = useCallback(() => {
    if (pinnedRef.current) return;
    if (showTimerRef.current) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    hideTimerRef.current = window.setTimeout(() => {
      setHoverState(null);
    }, 220);
  }, []);

  const keepHover = useCallback(() => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".word-hover-popover, .meaning-bridge button, [data-word-ref]")) return;
      clearTimers();
      pinnedRef.current = false;
      setHoverState(null);
    };
    const handleScrollOrKey = (e: Event) => {
      if (e.type === "keydown") {
        if ((e as KeyboardEvent).key !== "Escape") return;
        clearTimers();
        pinnedRef.current = false;
        setHoverState(null);
        return;
      }
      if (e.type === "scroll") {
        const target = e.target as HTMLElement | null;
        if (target && (target.closest?.(".word-hover-popover") || target.classList?.contains("word-hover-popover") || target.classList?.contains("popover-scroll-body"))) {
          return;
        }
        clearTimers();
        pinnedRef.current = false;
        setHoverState(null);
      }
    };
    window.addEventListener("scroll", handleScrollOrKey, true);
    window.addEventListener("keydown", handleScrollOrKey);
    window.addEventListener("pointerdown", dismissOutside);
    return () => {
      window.removeEventListener("scroll", handleScrollOrKey, true);
      window.removeEventListener("keydown", handleScrollOrKey);
      window.removeEventListener("pointerdown", dismissOutside);
      clearTimers();
    };
  }, []);

  const renderWordMarkup = useCallback(
    (text: string) => {
      return text
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_m, rawTarget, display) => {
          const status = checkWordStatus(rawTarget);
          if (status.inBook) {
            const unlearnedClass = status.isUnlearned ? "unlearned" : "";
            const dayAttr = status.targetDay ? ` data-day="${status.targetDay}"` : "";
            return `<span class="word-tag-link ${unlearnedClass}" data-word-ref="${rawTarget}"${dayAttr}>${display}</span>`;
          }
          return `**${display}**`;
        })
        .replace(/\[\[([^\]]+)\]\]/g, (_m, rawTarget) => {
          const status = checkWordStatus(rawTarget);
          if (status.inBook) {
            const unlearnedClass = status.isUnlearned ? "unlearned" : "";
            const dayAttr = status.targetDay ? ` data-day="${status.targetDay}"` : "";
            return `<span class="word-tag-link ${unlearnedClass}" data-word-ref="${rawTarget}"${dayAttr}>${rawTarget}</span>`;
          }
          return `**${rawTarget}**`;
        });
    },
    [checkWordStatus],
  );

  const contextValue = useMemo(
    () => ({
      showHover,
      hideHover,
      keepHover,
      checkWordStatus,
      currentWordId,
      setCurrentWordId,
      renderWordMarkup,
    }),
    [showHover, hideHover, keepHover, checkWordStatus, currentWordId, renderWordMarkup],
  );

  return (
    <WordHoverContext.Provider value={contextValue}>
      {children}
      {hoverState &&
        createPortal(
          <><div className="popover-backdrop" onClick={() => { clearTimers(); pinnedRef.current = false; setHoverState(null); }} /><PopoverCard
            state={hoverState}
            detail={details[hoverState.wordId]}
            summary={catalog?.words[hoverState.wordId]}
            onMouseEnter={keepHover}
            onMouseLeave={hideHover}
            onClose={() => { clearTimers(); pinnedRef.current = false; setHoverState(null); }}
            loadFailed={loadFailed}
            onRetry={() => setRetry(value => value + 1)}
          /></>,
          document.body,
        )}
    </WordHoverContext.Provider>
  );
}
