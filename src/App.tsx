import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  buildPlan,
  currentPlanDayNumber,
  isPlanDayComplete,
  normalizeProgress,
  planDayFraction,
  proficiencyCopy,
  proficiencyCounts,
  rateReviewWord,
  rateStudyWord,
  reviewCandidates,
  startReviewDay,
  toggleBookmark,
} from "./progress";
import { AuthModal } from "./components/AuthModal";
import { WordHoverProvider, useWordHover } from "./components/WordHoverContext";
import type {
  AppProgress,
  Catalog,
  PlanDay,
  Proficiency,
  StudyGroup,
  UpdateStatus,
  UserSession,
  ViewName,
  WordDetail,
} from "./types";

const navItems: Array<{ id: ViewName; label: string; glyph: string }> = [
  { id: "home", label: "首页", glyph: "⌂" },
  { id: "plan", label: "词书计划", glyph: "▦" },
  { id: "today", label: "今日学习", glyph: "▷" },
  { id: "vocabulary", label: "生词本", glyph: "◇" },
];

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

type TransitionPhase = "idle" | "leaving" | "entering";

function useSoftTransitionState<T>(initialValue: T): [T, (nextValue: T) => void, TransitionPhase] {
  const [value, setValue] = useState(initialValue);
  const [phase, setPhase] = useState<TransitionPhase>("idle");
  const timer = useRef<number | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
  }, []);

  const transitionTo = (nextValue: T) => {
    if (Object.is(nextValue, value) || phase === "leaving") return;
    const transitionDocument = document as ViewTransitionDocument;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(nextValue);
      return;
    }
    if (transitionDocument.startViewTransition) {
      transitionDocument.startViewTransition(() => setValue(nextValue));
      return;
    }
    setPhase("leaving");
    timer.current = window.setTimeout(() => {
      setValue(nextValue);
      setPhase("entering");
      frame.current = window.requestAnimationFrame(() => {
        frame.current = window.requestAnimationFrame(() => setPhase("idle"));
      });
    }, 75);
  };

  return [value, transitionTo, phase];
}

function MarkdownBlock({ value, empty = "当前数据没有提供这部分内容。" }: { value?: string; empty?: string }) {
  const hover = useWordHover();
  if (!value?.trim()) return <p className="empty-copy">{empty}</p>;

  const html = useMemo(() => {
    const parsedMarkdown = hover
      ? hover.renderWordMarkup(value)
      : value.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "**$2**").replace(/\[\[([^\]]+)\]\]/g, "**$1**");
    return DOMPurify.sanitize(marked.parse(parsedMarkdown, { breaks: true }) as string);
  }, [value, hover]);

  const handleMouseOver = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest("[data-word-ref]") as HTMLElement | null;
    if (target && hover) {
      const wordRef = target.getAttribute("data-word-ref");
      if (wordRef) hover.showHover(wordRef, target);
    }
  };

  const handleMouseOut = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest("[data-word-ref]") as HTMLElement | null;
    if (target && hover) {
      hover.hideHover();
    }
  };

  return (
    <div
      className="rich-text"
      dangerouslySetInnerHTML={{ __html: html }}
      onMouseOver={handleMouseOver}
      onMouseOut={handleMouseOut}
    />
  );
}

function AudioButton({ url }: { url?: string }) {
  const [playing, setPlaying] = useState(false);
  if (!url) return null;
  const play = async () => {
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
  return <button className="audio-button" onClick={play}>{playing ? "停止" : "播放发音"}</button>;
}

function FittedWordTitle({ word }: { word: string }) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    const fitTitle = () => {
      title.style.removeProperty("font-size");
      const availableWidth = title.clientWidth;
      const naturalWidth = title.scrollWidth;
      if (!availableWidth || naturalWidth <= availableWidth) return;
      const naturalSize = Number.parseFloat(window.getComputedStyle(title).fontSize);
      title.style.fontSize = `${Math.max(28, Math.floor(naturalSize * availableWidth / naturalWidth))}px`;
    };
    fitTitle();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fitTitle);
    if (title.parentElement) observer.observe(title.parentElement);
    return () => observer.disconnect();
  }, [word]);

  return <h1 ref={titleRef}>{word}</h1>;
}

function BookmarkButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button className={`bookmark-button ${active ? "active" : ""}`} onClick={onClick}>
      <span>{active ? "◆" : "◇"}</span>{active ? "已加入生词本" : "加入生词本"}
    </button>
  );
}

function ProficiencyPicker({
  value,
  onChange,
  title = "学完后，标记当前熟练度",
}: {
  value?: Proficiency;
  onChange: (value: Proficiency) => void;
  title?: string;
}) {
  return (
    <div className="proficiency-picker">
      <span>{title}</span>
      <div>
        {(Object.keys(proficiencyCopy) as Proficiency[]).map((level) => (
          <button className={`${level} ${value === level ? "active" : ""}`} key={level} onClick={() => onChange(level)}>
            <b>{proficiencyCopy[level].label}</b>
            <small>{proficiencyCopy[level].hint}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function Section({ title, eyebrow, count, children }: { title: string; eyebrow: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="detail-section">
      <div className="section-heading">
        <div><span>{eyebrow}</span><h3>{title}</h3></div>
        {typeof count === "number" && <b>{count}</b>}
      </div>
      {children}
    </section>
  );
}

function MorphologyRail({ detail }: { detail: WordDetail }) {
  const labels = { root: "词根", prefix: "前缀", suffix: "后缀", base: "词基" };
  if (!detail.roots.length) return <p className="empty-copy">该单词没有独立词根，按单词自身成组。</p>;
  return (
    <div className="morphology-rail">
      {detail.roots.map((part, index) => (
        <div className={`morphology-node ${part.type}`} key={`${part.id}-${part.order}`}>
          <div><span>{labels[part.type]}</span><b>{part.spelling}</b></div>
          <p>{part.meaning}</p>
          <details>
            <summary>音形巧记</summary>
            <MarkdownBlock value={part.memoryMethod} empty="原始数据未提供独立音标或巧记。" />
          </details>
          {index < detail.roots.length - 1 && <i>＋</i>}
        </div>
      ))}
    </div>
  );
}

function SentenceList({ rows, exam = false }: { rows: Record<string, string>[]; exam?: boolean }) {
  if (!rows.length) return <p className="empty-copy">暂无例句数据。</p>;
  return (
    <div className="sentence-list">
      {rows.map((item, index) => (
        <div key={item.example_id || item.exam_example_id || index}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <div>
            <p>{item.sentence}</p>
            <p className="translation">{item.translation}</p>
            {item.context_explanation && <small>{item.context_explanation}</small>}
            {item.target_word_analysis && <small>{item.target_word_analysis}</small>}
            {item.difficulty_rationale && <small>{item.difficulty_rationale}</small>}
            {exam && <small>{[item.source_year, item.source_paper, item.source_section].filter(Boolean).join(" · ")}</small>}
          </div>
        </div>
      ))}
    </div>
  );
}

function SentenceSpotlight({
  eyebrow,
  title,
  rows,
  index,
  onNext,
  exam = false,
}: {
  eyebrow: string;
  title: string;
  rows: Record<string, string>[];
  index: number;
  onNext: () => void;
  exam?: boolean;
}) {
  const item = rows[index];
  return (
    <section className="session-section sentence-spotlight">
      <header>
        <div><span>{eyebrow}</span><h3>{title}</h3></div>
        {rows.length > 1 && <button onClick={onNext}>换一句 <b>↻</b></button>}
      </header>
      {item ? <div>
        {exam && <small>{[item.source_year, item.source_paper, item.source_section].filter(Boolean).join(" · ") || "真题语境"}</small>}
        <p>{item.sentence}</p>
        <p className="translation">{item.translation}</p>
        {(item.context_explanation || item.target_word_analysis) && <em>{item.context_explanation || item.target_word_analysis}</em>}
      </div> : <p className="empty-copy">暂无{title}数据。</p>}
    </section>
  );
}

function WordDetailPanel({
  detail,
  bookmarked,
  onToggleBookmark,
  footer,
  compact = false,
}: {
  detail: WordDetail | null;
  bookmarked: boolean;
  onToggleBookmark: () => void;
  footer?: React.ReactNode;
  compact?: boolean;
}) {
  const [tab, setTab] = useState<"core" | "sentences" | "expand" | "long">("core");
  const hover = useWordHover();
  useEffect(() => setTab("core"), [detail?.id]);
  useEffect(() => {
    if (hover && detail?.id) hover.setCurrentWordId(detail.id);
  }, [detail?.id, hover]);
  if (!detail) return <div className="word-placeholder"><span>WORD DETAIL</span><h2>选择一个单词</h2><p>这里会展开词义、巧记、构词链与例句。</p></div>;

  return (
    <article className={`word-detail ${compact ? "compact" : ""}`}>
      <header className="word-hero">
        <div>
          <span className="eyebrow">{detail.bookName || detail.bookCode}</span>
          <h2>{detail.spelling}</h2>
          <div className="pronunciation"><strong>{detail.pronunciation || "音标未提供"}</strong><AudioButton url={detail.audioUrl} /></div>
        </div>
        <div className="word-meaning"><p>{detail.definitionCn}</p><BookmarkButton active={bookmarked} onClick={onToggleBookmark} /></div>
      </header>
      <div className="detail-tabs">
        <button className={tab === "core" ? "active" : ""} onClick={() => setTab("core")}>核心记忆</button>
        <button className={tab === "sentences" ? "active" : ""} onClick={() => setTab("sentences")}>例句 {detail.examples.length + detail.examExamples.length}</button>
        <button className={tab === "expand" ? "active" : ""} onClick={() => setTab("expand")}>搭配与关联</button>
        <button className={tab === "long" ? "active" : ""} onClick={() => setTab("long")}>长难句 {detail.longSentences.length}</button>
      </div>
      <div className="detail-scroll">
        {tab === "core" && <>
          <Section eyebrow="MEMORY" title="联想巧记"><MarkdownBlock value={detail.memoryMarkup} /></Section>
          <Section eyebrow="MORPHEME" title="词根词缀构成"><MorphologyRail detail={detail} /></Section>
          <Section eyebrow="COMPOSITION" title="词根词缀分析"><MarkdownBlock value={detail.etymologyMarkup} /></Section>
          <Section eyebrow="ACCUMULATION" title="词根词缀积累"><MarkdownBlock value={detail.rootAffixAccumulation} /></Section>
          <Section eyebrow="NOTES" title="补充笔记"><MarkdownBlock value={detail.rootAffixNotes} /></Section>
        </>}
        {tab === "sentences" && <>
          <Section eyebrow="EXAMPLES" title="普通例句" count={detail.examples.length}><SentenceList rows={detail.examples} /></Section>
          <Section eyebrow="EXAM" title="真题例句" count={detail.examExamples.length}><SentenceList rows={detail.examExamples} exam /></Section>
        </>}
        {tab === "expand" && <>
          <Section eyebrow="COLLOCATION" title="常用搭配" count={detail.collocations.length}>
            {detail.collocations.length ? <div className="collocation-list">{detail.collocations.map((item, index) => <div key={item.collocation_id || index}><strong>{item.phrase}</strong><p>{item.meaning}</p><small>{item.example}</small></div>)}</div> : <p className="empty-copy">暂无搭配数据。</p>}
          </Section>
          <Section eyebrow="RELATIONS" title="关联词" count={detail.relations.length}>
            {detail.relations.length ? detail.relations.map((relation, index) => <div className="relation-group" key={index}><h4>{String(relation.relation_type || "关联")}</h4><div>{relation.words.map((word, wordIndex) => <span key={word.related_word_id || wordIndex}><b>{word.spelling || word.display_text}</b>{word.meaning && ` · ${word.meaning}`}</span>)}</div></div>) : <p className="empty-copy">暂无关联词数据。</p>}
          </Section>
          <Section eyebrow="FREQUENCY" title="考试词频" count={detail.frequencies.length}>
            {detail.frequencies.length ? <div className="frequency-grid">{detail.frequencies.map((item, index) => <div key={index}><span>{item.exam_type}</span><b>{item.frequency_count}</b><small>每万词 {item.per_10k_words}</small></div>)}</div> : <p className="empty-copy">暂无词频数据。</p>}
          </Section>
        </>}
        {tab === "long" && <Section eyebrow="LONG SENTENCES" title="长难句精读" count={detail.longSentences.length}>
          {detail.longSentences.length ? detail.longSentences.map((item, index) => <details className="long-sentence" key={String(item.long_sentence_id ?? index)}><summary>{String(item.sentence || `长难句 ${index + 1}`)}</summary><p>{String(item.translation || "")}</p>{item.segments?.map((segment, segmentIndex) => <div className="segment" key={segmentIndex}><b>{segment.role_label || segment.role}</b><span>{segment.text}</span><small>{segment.gloss}</small></div>)}{item.analyses?.map((analysis, analysisIndex) => <div className="analysis-note" key={analysisIndex}><b>{analysis.dimension}</b><p>{analysis.analysis_text}</p></div>)}</details>) : <p className="empty-copy">暂无长难句数据。</p>}
        </Section>}
      </div>
      {footer}
    </article>
  );
}

function PageHeader({ eyebrow, title, description, aside }: { eyebrow: string; title: string; description: string; aside?: React.ReactNode }) {
  return <header className="page-header"><div><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{aside}</header>;
}

function LiquidDay({ day, fraction }: { day: number; fraction: number }) {
  const percent = Math.min(100, Math.max(0, Math.round(fraction * 100)));
  return (
    <div className="liquid-day" aria-label={`Day ${day}，完成 ${percent}%`}>
      <div className="day-base-text">Day {day}</div>
      <div
        className="day-fill-text"
        style={{ clipPath: `inset(${100 - percent}% 0 0 0)` }}
      >
        Day {day}
      </div>
    </div>
  );
}

function HomeView({
  progress,
  current,
  goToday,
}: {
  catalog?: Catalog;
  progress: AppProgress;
  plan?: PlanDay[];
  current: PlanDay;
  goToday: () => void;
}) {
  const fraction = planDayFraction(progress, current);
  const dayState = progress.planDays[String(current.day)];
  const done = Boolean(dayState?.completedAt);
  const completed = current.kind === "study" ? (dayState?.ratedExposureKeys.length ?? 0) : (dayState?.reviewedWordIds.length ?? 0);
  const target = current.kind === "study" ? current.appearanceCount : (dayState?.reviewWordIds.length || Object.keys(progress.words).length);

  return (
    <div className="page home-page">
      <div className="home-stage">
        <section className="day-vessel">
          <LiquidDay day={current.day} fraction={fraction} />
          <div className="day-progress-count">
            <b>{completed}</b> <span>/</span> {target}
          </div>
          <div className="day-action">
            <button onClick={goToday}>{done ? "查看今日记录" : current.kind === "study" ? "继续今日学习" : "进入复习判断"} <b>→</b></button>
          </div>
        </section>
      </div>
    </div>
  );
}

function PlanView({ plan, progress, current, onSelectDay }: { plan: PlanDay[]; progress: AppProgress; current: PlanDay; onSelectDay: (dayNumber: number) => void }) {
  return (
    <div className="page plan-page">
      <PageHeader eyebrow="40 DAY PLAN" title="词书计划" description="每三个学习日插入一个集中复习日；复习范围会随已学单词动态增长。" aside={<div className="plan-legend"><span><i className="study" />学习日</span><span><i className="review" />复习日</span></div>} />
      <div className="plan-overview"><div><span>当前进度</span><b>Day {current.day}</b></div><div><span>学习日</span><b>30</b></div><div><span>复习日</span><b>10</b></div><div><span>学习曝光</span><b>{plan.filter((day) => day.kind === "study").reduce((sum, day) => sum + day.appearanceCount, 0)}</b></div></div>
      <div className="plan-grid">
        {plan.map((day) => {
          const fraction = planDayFraction(progress, day);
          const dayProgress = progress.planDays[String(day.day)];
          const finished = Boolean(dayProgress?.completedAt);
          const isCurrent = day.day === current.day;
          const count = day.kind === "study" ? `${day.appearanceCount} 词` : `最多 ${day.plannedReviewWordCount} 词`;
          return (
            <button
              className={`${day.kind} ${isCurrent ? "current" : ""} ${finished ? "finished" : ""}`}
              key={day.day}
              onClick={() => onSelectDay(day.day)}
              title={`查看 Day ${day.day} 学习内容`}
            >
              <span>{day.kind === "study" ? `学习 ${day.studyDay}` : "集中复习"}</span>
              <b>Day {day.day}</b>
              <p>{count}</p>
              <div><i style={{ width: `${fraction * 100}%` }} /></div>
              <small>{Math.round(fraction * 100)}%</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StudyToday({
  catalog,
  progress,
  plan,
  details,
  loadWords,
  saveProgress,
  onToggleBookmark,
}: {
  catalog: Catalog;
  progress: AppProgress;
  plan: PlanDay;
  details: Record<string, WordDetail>;
  loadWords: (ids: string[], kind: "study" | "review" | "bookmarks", planDay: number) => Promise<boolean>;
  saveProgress: (progress: AppProgress) => Promise<void>;
  onToggleBookmark: (wordId: string) => void;
}) {
  const groupsById = useMemo(() => new Map(catalog.groups.map((group) => [group.id, group])), [catalog]);
  const groups = plan.groupIds.map((id) => groupsById.get(id)).filter(Boolean) as StudyGroup[];
  const dayState = progress.planDays[String(plan.day)];
  const completedGroups = new Set(dayState?.completedGroupIds ?? []);
  const exposures = useMemo(() => groups.flatMap((group) => group.wordIds.map((wordId) => ({
    groupId: group.id,
    wordId,
    key: `${group.id}:${wordId}`,
  }))), [groups]);
  const completedCount = dayState?.ratedExposureKeys.length ?? 0;
  const finished = isPlanDayComplete(progress, plan.day);
  const [sessionActive, transitionSession, sessionTransitionPhase] = useSoftTransitionState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [simpleExampleIndex, setSimpleExampleIndex] = useState(0);
  const [examExampleIndex, setExamExampleIndex] = useState(0);
  const [longSentenceIndex, setLongSentenceIndex] = useState(0);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set());
  const exposure = exposures[activeIndex];
  const group = exposure ? groupsById.get(exposure.groupId) : undefined;
  const activeDetail = exposure?.wordId ? details[exposure.wordId] ?? null : null;
  const hover = useWordHover();

  useEffect(() => {
    if (hover && activeDetail?.id) hover.setCurrentWordId(activeDetail.id);
  }, [activeDetail?.id, hover]);

  const openWordSession = async (targetGroupId: string, targetWordId: string) => {
    const targetIndex = exposures.findIndex((item) => item.groupId === targetGroupId && item.wordId === targetWordId);
    setActiveIndex(targetIndex >= 0 ? targetIndex : 0);
    transitionSession(true);
    void loadWords([targetWordId], "study", plan.day).then(() => {
      const remainingIds = [...new Set(exposures.map((item) => item.wordId))].filter((id) => id !== targetWordId);
      if (remainingIds.length) void loadWords(remainingIds, "bookmarks", plan.day);
    });
  };

  const startSession = async () => {
    const nextIndex = exposures.findIndex((item) => !dayState?.ratedExposureKeys.includes(item.key));
    const targetIdx = nextIndex >= 0 ? nextIndex : 0;
    setActiveIndex(targetIdx);
    transitionSession(true);
    const firstWordId = exposures[targetIdx]?.wordId;
    if (firstWordId) {
      void loadWords([firstWordId], "study", plan.day).then(() => {
        const remainingIds = [...new Set(exposures.map((item) => item.wordId))].filter((id) => id !== firstWordId);
        if (remainingIds.length) void loadWords(remainingIds, "bookmarks", plan.day);
      });
    }
  };

  useEffect(() => {
    if (sessionActive && exposure?.wordId && !details[exposure.wordId]) {
      void loadWords([exposure.wordId], "study", plan.day);
    }
  }, [sessionActive, exposure?.wordId, details, plan.day]);

  const move = (direction: -1 | 1) => {
    setActiveIndex((current) => Math.max(0, Math.min(exposures.length - 1, current + direction)));
  };

  const toggleGroup = (groupId: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  useEffect(() => {
    setSimpleExampleIndex(0);
    setExamExampleIndex(0);
    setLongSentenceIndex(0);
  }, [exposure?.key]);

  const rate = async (level: Proficiency) => {
    if (!group || !activeDetail || !exposure || ratingBusy) return;
    setRatingBusy(true);
    const next = rateStudyWord(progress, plan, group, exposure.wordId, level);
    await saveProgress(next);
    const ratedKeys = next.planDays[String(plan.day)]?.ratedExposureKeys ?? [];
    const nextUnrated = exposures.findIndex((item, index) => index > activeIndex && !ratedKeys.includes(item.key));
    const anyUnrated = nextUnrated >= 0 ? nextUnrated : exposures.findIndex((item) => !ratedKeys.includes(item.key));
    setActiveIndex(anyUnrated >= 0 ? anyUnrated : Math.min(activeIndex + 1, exposures.length - 1));
    setRatingBusy(false);
  };

  useEffect(() => {
    if (!sessionActive) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, select, [contenteditable='true']");
      if (event.key === "Escape") {
        event.preventDefault();
        transitionSession(false);
        return;
      }
      if (editing) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        move(event.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat && activeDetail?.audioUrl) void new Audio(activeDetail.audioUrl).play().catch(() => undefined);
        return;
      }
      const shortcut: Record<string, Proficiency> = { "1": "unmastered", "2": "unclear", "3": "mastered" };
      const level = shortcut[event.key];
      if (level && !event.repeat) {
        event.preventDefault();
        void rate(level);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sessionActive, activeIndex, activeDetail?.id, activeDetail?.audioUrl, ratingBusy, progress]);

  const rootPriority = { root: 0, prefix: 1, suffix: 2, base: 3 };
  const rootLabels = { root: "词根", prefix: "前缀", suffix: "后缀", base: "词基" };
  const orderedParts = [...(activeDetail?.roots ?? [])].sort((a, b) => rootPriority[a.type] - rootPriority[b.type] || a.order - b.order);
  const longSentences = activeDetail?.longSentences ?? [];
  const longSentence = longSentences[longSentenceIndex];
  const rated = exposure ? dayState?.ratedExposureKeys.includes(exposure.key) : false;
  const activeProficiency = rated && exposure ? progress.words[exposure.wordId]?.proficiency : undefined;

  return (
    <div className={`today-view soft-transition transition-${sessionTransitionPhase}`}>
      <div className="page today-overview-page">
        <div className="today-overview-progress" role="progressbar" aria-label="今日学习总进度" aria-valuemin={0} aria-valuemax={plan.appearanceCount} aria-valuenow={completedCount}><i style={{ width: `${completedCount / Math.max(1, plan.appearanceCount) * 100}%` }} /></div>
        <header className="today-plan-header">
          <h1>Day {plan.day}</h1>
          <p>已完成 <b>{completedCount}</b> / {plan.appearanceCount}</p>
        </header>
        <div className="today-root-ledger">
          {groups.map((item, groupIndex) => {
            const collapsed = collapsedGroupIds.has(item.id);
            return <article className={`${completedGroups.has(item.id) ? "completed" : ""} ${collapsed ? "collapsed" : ""}`} key={item.id}>
            <button className="today-group-toggle" aria-expanded={!collapsed} aria-label={`${collapsed ? "展开" : "收起"}${item.spelling}词根组`} onClick={() => toggleGroup(item.id)}>
              <i>{String(groupIndex + 1).padStart(2, "0")}</i>
              <div><span>{item.kind === "root" ? "词根" : "独立成组"}</span><h2>{item.spelling}</h2></div>
              <p>{item.kind === "solo" ? "无独立词根，按单词自身学习" : item.meaning}</p>
              <em>{item.wordCount} 词</em>
            </button>
            {!collapsed && <div className="today-word-table">
              {item.wordIds.map((wordId) => {
                const word = catalog.words[wordId];
                const exposureRated = dayState?.ratedExposureKeys.includes(`${item.id}:${wordId}`);
                const proficiency = exposureRated ? progress.words[wordId]?.proficiency : undefined;
                return (
                  <button
                    className="today-word-row"
                    key={wordId}
                    onClick={() => void openWordSession(item.id, wordId)}
                    title={`直接学习 ${word.spelling}`}
                  >
                    <b>{word.spelling}</b>
                    <span>{word.pronunciation || "—"}</span>
                    <p>{word.definitionCn}</p>
                    <i className={proficiency}>{proficiency ? proficiencyCopy[proficiency].label : "待学习"}</i>
                  </button>
                );
              })}
            </div>}
          </article>;})}
        </div>
        <button className="floating-study-start" aria-label={!exposures.length ? "今日无学习内容" : finished ? "回顾今日内容" : completedCount ? "继续学习" : "开始学习"} title={!exposures.length ? "今日无学习内容" : finished ? "回顾今日内容" : completedCount ? "继续学习" : "开始学习"} onClick={() => void startSession()} disabled={!exposures.length}><i /></button>
      </div>

      {sessionActive && exposure && <div className="study-session-overlay" role="dialog" aria-modal="true" aria-label="今日单词学习">
        <header className="study-session-topbar">
          <div><span>大学英语六级</span><b>Day {plan.day} · {group?.kind === "root" ? group.spelling : "独立词"}</b></div>
          <div className="session-progress"><i style={{ width: `${Math.max(completedCount / Math.max(1, plan.appearanceCount), 1 / Math.max(1, plan.appearanceCount)) * 100}%` }} /></div>
          <strong>{activeIndex + 1} / {exposures.length}</strong>
          <button onClick={() => transitionSession(false)}><kbd>Esc</kbd> 退出学习</button>
        </header>

        <div className="study-session-grid">
          <aside className="study-morpheme-column">
            <header><span>MORPHEME NOTES</span><h2>词根词缀</h2><p>词根优先，先抓住最稳定的含义线索。</p></header>
            <div className="study-column-scroll">
              {activeDetail ? orderedParts.length ? orderedParts.map((part, index) => <section className={`study-part-card ${part.type}`} key={`${part.id}-${part.order}`}>
                <header><span>{rootLabels[part.type]} · {String(index + 1).padStart(2, "0")}</span><b>{part.spelling}</b></header>
                <p>{part.meaning}</p>
                <div><span>巧记</span><MarkdownBlock value={part.memoryMethod} empty="暂无独立巧记。" /></div>
              </section>) : <div className="session-empty"><b>{activeDetail.spelling}</b><p>这个单词没有独立词根，按单词整体记忆。</p></div> : <div className="session-loading">正在准备词根词缀…</div>}
            </div>
          </aside>

          <main className="study-word-column">
            <div className="study-center-scroll">
              {activeDetail ? <>
                <header className="study-word-hero">
                  <div><span>{group?.kind === "root" ? `${group.spelling} 词根家族` : "独立单词"}</span><FittedWordTitle word={activeDetail.spelling} /><div><strong>{activeDetail.pronunciation || "音标未提供"}</strong><AudioButton url={activeDetail.audioUrl} /></div></div>
                  <div><p>{activeDetail.definitionCn}</p><BookmarkButton active={Boolean(progress.bookmarks[activeDetail.id])} onClick={() => onToggleBookmark(activeDetail.id)} /></div>
                </header>
                <section className="session-section"><header><div><span>MEMORY</span><h3>巧记</h3></div></header><MarkdownBlock value={activeDetail.memoryMarkup} /></section>
                <section className="session-section etymology-study"><header><div><span>WORD BUILDING</span><h3>词根词缀分析</h3></div></header>
                  {orderedParts.length > 0 && <div className="study-word-equation">{orderedParts.map((part, index) => <div className="study-word-equation-piece" key={`${part.id}-${part.order}`}>{index > 0 && <i aria-hidden="true">＋</i>}<span><b>{part.spelling}</b><small>{part.meaning}</small></span></div>)}</div>}
                  <MarkdownBlock value={activeDetail.etymologyMarkup} empty="暂无独立构词分析，请结合左栏词根词缀巧记整体记忆。" />
                </section>
                <SentenceSpotlight eyebrow="EXAMPLE" title="简单例句" rows={activeDetail.examples} index={simpleExampleIndex} onNext={() => setSimpleExampleIndex((simpleExampleIndex + 1) % activeDetail.examples.length)} />
                <SentenceSpotlight eyebrow="EXAM" title="真题例句" rows={activeDetail.examExamples} index={examExampleIndex} onNext={() => setExamExampleIndex((examExampleIndex + 1) % activeDetail.examExamples.length)} exam />
              </> : <div className="session-loading center">正在展开 {catalog.words[exposure.wordId]?.spelling}…</div>}
            </div>
            <footer className="study-session-controls">
              <div className="session-rating">
                {(["unmastered", "unclear", "mastered"] as Proficiency[]).map((level, index) => <button className={`${level} ${activeProficiency === level ? "active" : ""}`} disabled={!activeDetail || ratingBusy} onClick={() => void rate(level)} key={level}><kbd>{index + 1}</kbd><b>{proficiencyCopy[level].label}</b></button>)}
              </div>
              <div className="session-navigation">
                <button disabled={activeIndex === 0} onClick={() => move(-1)}><kbd>←</kbd> 上一个</button>
                <span><kbd>空格</kbd> 发音</span>
                <button disabled={activeIndex === exposures.length - 1} onClick={() => move(1)}>下一个 <kbd>→</kbd></button>
              </div>
            </footer>
          </main>

          <aside className="study-sentence-column">
            <header><span>LONG SENTENCE</span><h2>长难句</h2><p>{longSentences.length ? `第 ${longSentenceIndex + 1} 句，共 ${longSentences.length} 句` : "跟随当前单词显示"}</p></header>
            <div className="study-column-scroll long-sentence-scroll">
              {activeDetail ? longSentence ? <article>
                <p className="long-sentence-copy">{String(longSentence.sentence || "")}</p>
                <p className="long-sentence-translation">{String(longSentence.translation || "")}</p>
                {longSentence.segments?.length > 0 && <section><h3>结构拆分</h3>{longSentence.segments.map((segment, index) => <div className="session-segment" key={index}><span>{segment.role_label || segment.role}</span><b>{segment.text}</b><small>{segment.gloss}</small></div>)}</section>}
                {longSentence.analyses?.length > 0 && <section><h3>难点分析</h3>{longSentence.analyses.map((analysis, index) => <div className="session-analysis" key={index}><span>{analysis.dimension || "解析"}</span><p>{analysis.analysis_text}</p></div>)}</section>}
              </article> : <div className="session-empty"><b>暂无长难句</b><p>当前单词没有匹配的长难句分析。</p></div> : <div className="session-loading">正在准备长难句…</div>}
            </div>
            {longSentences.length > 1 && <footer className="long-sentence-pagination">
              <button disabled={longSentenceIndex === 0} onClick={() => setLongSentenceIndex((current) => Math.max(0, current - 1))}>‹</button>
              <div>{longSentences.map((item, index) => <button className={index === longSentenceIndex ? "active" : ""} aria-label={`查看第 ${index + 1} 条长难句`} onClick={() => setLongSentenceIndex(index)} key={String(item.long_sentence_id ?? index)} />)}</div>
              <button disabled={longSentenceIndex === longSentences.length - 1} onClick={() => setLongSentenceIndex((current) => Math.min(longSentences.length - 1, current + 1))}>›</button>
            </footer>}
          </aside>
        </div>
      </div>}
    </div>
  );
}

function ReviewToday({
  catalog,
  progress,
  plan,
  details,
  loadWords,
  saveProgress,
  onToggleBookmark,
}: {
  catalog: Catalog;
  progress: AppProgress;
  plan: PlanDay;
  details: Record<string, WordDetail>;
  loadWords: (ids: string[], kind: "study" | "review" | "bookmarks", planDay: number) => Promise<boolean>;
  saveProgress: (progress: AppProgress) => Promise<void>;
  onToggleBookmark: (wordId: string) => void;
}) {
  const [skipMastered, setSkipMastered] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const day = progress.planDays[String(plan.day)];
  const candidates = reviewCandidates(progress, skipMastered);
  const queue = day?.reviewWordIds.filter((id) => !day.reviewedWordIds.includes(id)) ?? [];
  const currentId = queue[0];
  const finished = isPlanDayComplete(progress, plan.day);
  const hover = useWordHover();

  useEffect(() => {
    setRevealed(false);
    if (hover && currentId) hover.setCurrentWordId(currentId);
  }, [currentId, hover]);

  useEffect(() => {
    if (day?.reviewWordIds.length) void loadWords(day.reviewWordIds, "review", plan.day);
  }, [plan.day, day?.reviewWordIds]);

  const start = async () => {
    if (!await loadWords(candidates, "review", plan.day)) return;
    await saveProgress(startReviewDay(progress, plan.day, candidates, skipMastered));
  };
  const rate = async (level: Proficiency) => {
    if (!currentId) return;
    await saveProgress(rateReviewWord(progress, plan.day, currentId, level));
    setRevealed(false);
  };

  if (!day) {
    const counts = proficiencyCounts(progress);
    return <div className="page review-setup"><PageHeader eyebrow={`DAY ${plan.day} · REVIEW`} title="先决定本轮复习范围" description="复习覆盖此前学过的全部唯一单词，并按“未掌握 → 不清楚 → 已掌握”的顺序出现。" /><div className="review-setup-card"><span>本轮复习</span><b>{candidates.length}</b><small>个单词</small><label><input type="checkbox" checked={skipMastered} onChange={(event) => setSkipMastered(event.target.checked)} /><i />不复习已掌握单词 <em>默认开启</em></label><div><p>未掌握 <b>{counts.unmastered}</b></p><p>不清楚 <b>{counts.unclear}</b></p><p className={skipMastered ? "muted" : ""}>已掌握 <b>{counts.mastered}</b></p></div><button onClick={start}>开始判断式复习 <b>→</b></button></div></div>;
  }

  if (finished) return <div className="page review-finished"><PageHeader eyebrow={`DAY ${plan.day} · COMPLETE`} title="今天的复习判断已经完成" description={`共重新判断 ${day.reviewedWordIds.length} 个单词，新的熟练度已经保存。`} /><div className="review-finished-mark">✓<span>REVIEW COMPLETE</span></div></div>;
  const word = currentId ? catalog.words[currentId] : null;
  const detail = currentId ? details[currentId] ?? null : null;
  return <div className="page review-session"><PageHeader eyebrow={`DAY ${plan.day} · REVIEW`} title="先回想，再点击查看详情" description={`本轮剩余 ${queue.length} 个单词；同一个单词只出现一次。`} aside={<div className="today-progress"><b>{day.reviewedWordIds.length}</b><span>/ {day.reviewWordIds.length}</span></div>} /><div className={`judgment-card ${revealed ? "revealed" : ""}`}>{!revealed && word ? <button className="judgment-front" onClick={() => setRevealed(true)}><span>点击屏幕查看详细情况</span><h2>{word.spelling}</h2><p>{word.pronunciation}</p><i>CLICK TO REVEAL</i></button> : <WordDetailPanel detail={detail} bookmarked={Boolean(detail && progress.bookmarks[detail.id])} onToggleBookmark={() => detail && onToggleBookmark(detail.id)} footer={<ProficiencyPicker value={currentId ? progress.words[currentId]?.proficiency : undefined} onChange={rate} title="重新判断这个单词的熟练度" />} />}</div></div>;
}

function VocabularyView({ catalog, progress, details, loadWords, planDay, onToggleBookmark }: { catalog: Catalog; progress: AppProgress; details: Record<string, WordDetail>; loadWords: (ids: string[], kind: "study" | "review" | "bookmarks", planDay: number) => Promise<boolean>; planDay: number; onToggleBookmark: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const ids = useMemo(() => Object.entries(progress.bookmarks).sort((a, b) => b[1].localeCompare(a[1])).map(([id]) => id).filter((id) => { const term = query.trim().toLowerCase(); const word = catalog.words[id]; return !term || word.spelling.toLowerCase().includes(term) || word.definitionCn.includes(term); }), [catalog, progress.bookmarks, query]);
  useEffect(() => {
    if (!ids.length) return;
    if (!ids.includes(selectedId)) setSelectedId(ids[0]);
    void loadWords(ids, "bookmarks", planDay);
  }, [ids.join("|"), planDay]);
  const detail = selectedId ? details[selectedId] ?? null : null;
  return <div className="page vocabulary-page"><PageHeader eyebrow="VOCABULARY BOOK" title="生词本" description="学习或复习时随手收藏，集中查看仍需要额外注意的单词。" aside={<label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索生词" /></label>} />{ids.length ? <div className="vocabulary-layout"><aside>{ids.map((id) => <button className={selectedId === id ? "active" : ""} key={id} onClick={() => setSelectedId(id)}><b>{catalog.words[id].spelling}</b><span>{catalog.words[id].pronunciation}</span><small>{catalog.words[id].definitionCn}</small><i className={progress.words[id]?.proficiency}>{progress.words[id] ? proficiencyCopy[progress.words[id].proficiency].label : "未学习"}</i></button>)}</aside><WordDetailPanel detail={detail} bookmarked={Boolean(detail && progress.bookmarks[detail.id])} onToggleBookmark={() => detail && onToggleBookmark(detail.id)} /></div> : <div className="vocabulary-empty"><span>◇</span><h2>生词本还是空的</h2><p>在单词详情中点击“加入生词本”，它会出现在这里。</p></div>}</div>;
}

function UpdateControl() {
  const [update, setUpdate] = useState<UpdateStatus>({ status: "idle", currentVersion: "" });

  useEffect(() => {
    let active = true;
    const unsubscribe = window.cyword.onUpdateStatus?.((status) => {
      if (active) setUpdate(status);
    });
    window.cyword.getUpdateStatus?.().then((status) => {
      if (active) setUpdate(status);
    }).catch(() => undefined);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  if (update.status === "idle") return null;

  const percent = Math.round(update.percent ?? 0);
  const label = update.status === "available"
    ? `${update.message || `发现 ${update.version ?? "新"} 版本`}，点击下载`
    : update.status === "downloading"
      ? `正在下载 ${update.version ?? "新版本"}：${percent}%`
      : `${update.version ?? "新版本"} 已下载，点击重启更新`;

  const handleClick = async () => {
    if (update.status === "available") {
      const next = await window.cyword.downloadUpdate?.();
      if (next) setUpdate(next);
    } else if (update.status === "downloaded") {
      await window.cyword.installUpdate?.();
    }
  };

  return (
    <div className={`update-control ${update.status}`}>
      <button
        type="button"
        aria-label={label}
        title={label}
        disabled={update.status === "downloading"}
        onClick={() => void handleClick()}
      >
        <span
          className="update-icon"
          style={{ "--update-progress": `${percent}%` } as React.CSSProperties}
        >
          {update.status === "downloaded" ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 8a7.5 7.5 0 0 0-12.7-2L4 8" />
              <path d="M4 4v4h4" />
              <path d="M5 16a7.5 7.5 0 0 0 12.7 2L20 16" />
              <path d="M20 20v-4h-4" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 4v10" />
              <path d="m8 11 4 4 4-4" />
              <path d="M5 19h14" />
            </svg>
          )}
        </span>
      </button>
    </div>
  );
}

function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [progress, setProgress] = useState<AppProgress | null>(null);
  const [session, setSession] = useState<UserSession | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [view, transitionView, viewTransitionPhase] = useSoftTransitionState<ViewName>("home");
  const [details, setDetails] = useState<Record<string, WordDetail>>({});
  const detailsRef = useRef<Record<string, WordDetail>>({});
  const detailsGeneration = useRef(0);
  const wordLoadRef = useRef<Promise<boolean> | null>(null);
  const [loadingWords, setLoadingWords] = useState(false);
  const [error, setError] = useState("");
  const [selectedDayNumber, setSelectedDayNumber] = useState<number | null>(null);

  useEffect(() => {
    document.querySelector(".app-shell > main")?.scrollTo({ top: 0, behavior: "auto" });
  }, [view]);

  useEffect(() => {
    const initAuth = async () => {
      try {
        let loadedSession: UserSession | null = null;
        if (window.cyword?.readSession) {
          loadedSession = await window.cyword.readSession();
        } else {
          const raw = localStorage.getItem("cyword_session");
          if (raw) loadedSession = JSON.parse(raw);
        }
        if (loadedSession?.token) {
          setSession(loadedSession);
        }
      } catch (err) {
        console.warn("Failed to restore session:", err);
      } finally {
        setSessionChecked(true);
      }
    };
    initAuth();
  }, []);

  useEffect(() => {
    Promise.all([window.cyword.readCatalog(), window.cyword.readProgress()]).then(async ([nextCatalog, rawProgress]) => {
      const nextProgress = normalizeProgress(rawProgress);
      setCatalog(nextCatalog);
      setProgress(nextProgress);
      if ((rawProgress as { version?: number } | null)?.version !== 2) await window.cyword.writeProgress(nextProgress);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const loadWords = async (ids: string[], kind: "study" | "review" | "bookmarks", planDay: number) => {
    if (!catalog) return false;
    const missing = [...new Set(ids)].filter((id) => !detailsRef.current[id]);
    if (!missing.length) return true;
    const isMainSessionKind = kind === "study" || kind === "review";
    const generation = detailsGeneration.current;
    if (isMainSessionKind) setLoadingWords(true);

    try {
      const response = await window.cyword.readWords({
        dataVersion: catalog.dataVersion,
        planDay,
        kind,
        wordIds: missing,
      });
      if (!response?.words || missing.some((id) => !response.words[id])) {
        throw new Error("词库服务返回的数据不完整，请重试");
      }
      if (generation !== detailsGeneration.current) return false;
      detailsRef.current = { ...detailsRef.current, ...response.words };
      setDetails(detailsRef.current);
      return true;
    }
    catch (reason) {
      if (isMainSessionKind) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } else {
        console.warn("Background word load failed:", reason);
      }
      return false;
    }
    finally {
      if (isMainSessionKind) setLoadingWords(false);
    }
  };

  const saveProgress = async (next: AppProgress) => {
    setProgress(next);
    try { await window.cyword.writeProgress(next); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const handleLogout = async () => {
    try {
      if (window.cyword?.clearSession) {
        await window.cyword.clearSession();
      } else {
        localStorage.removeItem("cyword_session");
      }
    } catch (err) {
      console.warn("Logout error:", err);
    }
    setSession(null);
  };

  if (error) return <div className="fatal-error"><span>CYWORD</span><h1>应用未能加载词书</h1><p>{error}</p></div>;
  if (!catalog || !progress || !sessionChecked) return <div className="loading-screen"><div>Cy</div><p>正在铺开今天的词书计划…</p></div>;

  const plan = buildPlan(catalog);
  const currentDayNumber = currentPlanDayNumber(progress, plan.length);
  const activeDayNumber = selectedDayNumber ?? currentDayNumber;
  const current = plan[activeDayNumber - 1] ?? plan[0];
  const toggleWordBookmark = (wordId: string) => saveProgress(toggleBookmark(progress, wordId));

  const navigate = (nextView: ViewName) => {
    if (nextView !== view) {
      if (nextView === "today") {
        setSelectedDayNumber(null);
      }
      detailsGeneration.current += 1;
      detailsRef.current = {};
      setDetails({});
      transitionView(nextView);
    }
  };

  const handleSelectPlanDay = (dayNumber: number) => {
    setSelectedDayNumber(dayNumber);
    detailsGeneration.current += 1;
    detailsRef.current = {};
    setDetails({});
    transitionView("today");
  };

  return (
    <WordHoverProvider
      catalog={catalog}
      details={details}
      loadWords={loadWords}
      planDay={current?.day}
    >
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand"><div>Cy</div><span><b>词根记忆</b><small>Rooted recall</small></span></div>
          <nav>{navItems.map((item) => <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => navigate(item.id)}><i>{item.glyph}</i><b>{item.label}</b>{item.id === "vocabulary" && Object.keys(progress.bookmarks).length > 0 && <em>{Object.keys(progress.bookmarks).length}</em>}</button>)}</nav>
          {session && (
            <footer className="sidebar-user-footer">
              <div className="sidebar-user-info">
                <div className="sidebar-user-avatar">
                  {session.user.email.charAt(0).toUpperCase()}
                </div>
                <span className="sidebar-user-email" title={session.user.email}>
                  {session.user.email}
                </span>
              </div>
              <button className="btn-logout" onClick={handleLogout}>退出登录</button>
            </footer>
          )}
        </aside>
        <main className={`app-content soft-transition transition-${viewTransitionPhase}`}>
          {view === "home" && <HomeView catalog={catalog} progress={progress} plan={plan} current={current} goToday={() => handleSelectPlanDay(currentDayNumber)} />}
          {view === "plan" && <PlanView plan={plan} progress={progress} current={plan[currentDayNumber - 1] ?? current} onSelectDay={handleSelectPlanDay} />}
          {view === "today" && (current.kind === "study" ? <StudyToday catalog={catalog} progress={progress} plan={current} details={details} loadWords={loadWords} saveProgress={saveProgress} onToggleBookmark={toggleWordBookmark} /> : <ReviewToday catalog={catalog} progress={progress} plan={current} details={details} loadWords={loadWords} saveProgress={saveProgress} onToggleBookmark={toggleWordBookmark} />)}
          {view === "vocabulary" && <VocabularyView catalog={catalog} progress={progress} details={details} loadWords={loadWords} planDay={current.day} onToggleBookmark={toggleWordBookmark} />}
        </main>
        {!session && <AuthModal onSuccess={(s) => setSession(s)} />}
        <UpdateControl />
        {loadingWords && <div className="word-loading">正在获取今天需要的词汇…</div>}
      </div>
    </WordHoverProvider>
  );
}

export default App;
