import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { Catalog, WordDetail, WordSummary } from "../types";

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
  showHover: (wordRef: string, element: HTMLElement) => void;
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

function AudioPlayButton({ url }: { url?: string }) {
  const [playing, setPlaying] = useState(false);
  if (!url) return null;
  const play = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setPlaying(true);
      const audio = new Audio(url);
      audio.addEventListener("ended", () => setPlaying(false), { once: true });
      audio.addEventListener("error", () => setPlaying(false), { once: true });
      await audio.play();
    } catch {
      setPlaying(false);
    }
  };
  return (
    <button className="audio-button popover-audio" onClick={play}>
      {playing ? "停止" : "播放发音"}
    </button>
  );
}

function PopoverCard({
  state,
  detail,
  summary,
  onMouseEnter,
  onMouseLeave,
}: {
  state: HoverState;
  detail?: WordDetail;
  summary?: WordSummary;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; placement: "bottom" | "top" }>({
    top: 0,
    left: 0,
    placement: "bottom",
  });

  useEffect(() => {
    const rect = state.rect;
    const popoverWidth = 360;
    const estimatedHeight = 360;

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
      top = rect.bottom + 8;
    }

    setCoords({ top, left, placement });
  }, [state.rect]);

  const spelling = detail?.spelling || summary?.spelling || state.spelling;
  const pronunciation = detail?.pronunciation || summary?.pronunciation;
  const definition = detail?.definitionCn || summary?.definitionCn;
  const audioUrl = detail?.audioUrl;

  const orderedRoots = useMemo(() => {
    if (!detail?.roots) return [];
    return [...detail.roots].sort((a, b) => a.order - b.order);
  }, [detail]);

  const memoryHtml = useMemo(() => {
    if (!detail?.memoryMarkup) return "";
    const preprocessed = detail.memoryMarkup
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
        <div className="popover-meta">
          {state.isUnlearned ? (
            <span className="popover-badge unlearned">未学单词 · 第 {state.targetDay} 天</span>
          ) : (
            <span className="popover-badge learned">
              {state.targetDay ? `第 ${state.targetDay} 天已学` : "词书词汇"}
            </span>
          )}
        </div>
      </div>

      <div className="popover-scroll-body">
        <div className="popover-word-hero">
          <div className="popover-title-row">
            <h3 className="popover-spelling">{spelling}</h3>
            <AudioPlayButton url={audioUrl} />
          </div>
          {pronunciation && <span className="popover-pronunciation">{pronunciation}</span>}
          <p className="popover-definition">{definition}</p>
        </div>

        {detail ? (
          <>
            {detail.memoryMarkup && (
              <div className="popover-section">
                <h4>联想巧记</h4>
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
          <div className="popover-loading">正在加载单词详情…</div>
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
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setCurrentWordId(initialCurrentWordId);
  }, [initialCurrentWordId]);

  const { appearanceMap, spellingToIdMap } = useMemo(() => {
    const appearance = new Map<string, WordAppearance>();
    const spellingMap = new Map<string, string>();

    if (!catalog || !catalog.schedule) return { appearanceMap: appearance, spellingToIdMap: spellingMap };

    let globalIdx = 0;
    for (const day of catalog.schedule) {
      for (const groupId of day.groupIds) {
        const group = catalog.groups.find((g) => g.id === groupId);
        if (group) {
          for (const wId of group.wordIds) {
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

  const showHover = useCallback(
    (wordRef: string, element: HTMLElement) => {
      clearTimers();
      let clean = wordRef.toLowerCase().trim();
      clean = clean.replace(/-(?:根|缀|基|前缀|后缀|词根|词缀|词基)$/u, "");
      const targetApp = appearanceMap.get(clean);
      if (!targetApp) return;

      const rect = element.getBoundingClientRect();
      const status = checkWordStatus(wordRef);

      showTimerRef.current = window.setTimeout(() => {
        setHoverState({
          wordId: targetApp.wordId,
          spelling: targetApp.spelling,
          isUnlearned: status.isUnlearned,
          targetDay: targetApp.day,
          rect,
        });

        if (!details[targetApp.wordId]) {
          void loadWords([targetApp.wordId], "bookmarks", planDay || 1);
        }
      }, 120);
    },
    [appearanceMap, checkWordStatus, details, loadWords, planDay],
  );

  const hideHover = useCallback(() => {
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
    const handleScrollOrKey = (e: Event) => {
      if (e.type === "keydown") {
        if ((e as KeyboardEvent).key !== "Escape") return;
        clearTimers();
        setHoverState(null);
        return;
      }
      if (e.type === "scroll") {
        const target = e.target as HTMLElement | null;
        if (target && (target.closest?.(".word-hover-popover") || target.classList?.contains("word-hover-popover") || target.classList?.contains("popover-scroll-body"))) {
          return;
        }
        clearTimers();
        setHoverState(null);
      }
    };
    window.addEventListener("scroll", handleScrollOrKey, true);
    window.addEventListener("keydown", handleScrollOrKey);
    return () => {
      window.removeEventListener("scroll", handleScrollOrKey, true);
      window.removeEventListener("keydown", handleScrollOrKey);
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
          <PopoverCard
            state={hoverState}
            detail={details[hoverState.wordId]}
            summary={catalog?.words[hoverState.wordId]}
            onMouseEnter={keepHover}
            onMouseLeave={hideHover}
          />,
          document.body,
        )}
    </WordHoverContext.Provider>
  );
}
