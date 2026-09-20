import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  buildPlan,
  completedStudyExposureKeys,
  currentPlanDayNumber,
  isPlanDayComplete,
  planDayFraction,
  proficiencyCopy,
  proficiencyCounts,
  rateReviewWord,
  rateStudyWord,
  rateSearchWord,
  reviewCandidates,
  startReviewDay,
  studyExposures,
  updateWordProficiency,
  vocabularyOverview,
} from "./progress";
import { AuthModal } from "./components/AuthModal";
import { useSyncedProgress } from "./useSyncedProgress";
import { wordMemoryDisplay } from "./memory-display";
import { bookWordOrder, searchBookWords } from "./word-search";
import { applyCurriculum } from "./curriculum";
import { WordHoverProvider, useWordHover } from "./components/WordHoverContext";
import { MeaningBridgeMemory, MeaningBridgeProvider } from "./components/MeaningBridgeMemory";
import { PronunciationMemory, PronunciationSpelling } from "./components/PronunciationMemory";
import { AudioButton } from "./components/AudioButton";
import { useSessionSave, useSessionWord } from "./session-state";
import { useWordResources } from "./useWordResources";
import { useSessionDialog } from "./useSessionDialog";
import { playPronunciation, stopPronunciation } from "./audio";
import { completedSegmentEnd } from "./study-segments";
import type {
  AppProgress,
  Catalog,
  PlanDay,
  Proficiency,
  PronunciationGuide,
  StudyGroup,
  UpdateStatus,
  UserSession,
  ViewName,
  WordDetail,
} from "./types";

const navItems: Array<{ id: ViewName; label: string; path: string }> = [
  { id: "home", label: "首页", path: "m3 10 9-7 9 7v10H3z M9 20v-7h6v7" },
  { id: "plan", label: "词书计划", path: "M4 4h16v16H4z M4 9h16 M9 9v11 M15 9v11 M4 15h16" },
  { id: "today", label: "今日学习", path: "m8 4 12 8-12 8z" },
  { id: "vocabulary", label: "词汇掌握", path: "m12 3 9 9-9 9-9-9z M8 12l3 3 5-6" },
  { id: "search", label: "单词搜索", path: "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0 M15 15l6 6" },
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

  const html = useMemo(() => {
    if (!value?.trim()) return "";
    const parsedMarkdown = hover
      ? hover.renderWordMarkup(value)
      : value.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "**$2**").replace(/\[\[([^\]]+)\]\]/g, "**$1**");
    return DOMPurify.sanitize(marked.parse(parsedMarkdown, { breaks: true }) as string);
  }, [value, hover]);
  if (!html) return <p className="empty-copy">{empty}</p>;

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
      onClick={handleMouseOver}
    />
  );
}

function FittedWordTitle({ word, guide }: { word: string; guide?: PronunciationGuide }) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    const fitTitle = () => {
      title.style.removeProperty("font-size");
      const availableWidth = title.clientWidth;
      const naturalWidth = guide
        ? Array.from(title.querySelectorAll(".sound-spelling-part")).reduce((width, part) => width + part.getBoundingClientRect().width, 0)
        : title.scrollWidth;
      if (!availableWidth || naturalWidth <= availableWidth) return;
      const naturalSize = Number.parseFloat(window.getComputedStyle(title).fontSize);
      title.style.fontSize = `${Math.max(28, Math.floor(naturalSize * availableWidth / naturalWidth))}px`;
    };
    fitTitle();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fitTitle);
    if (title.parentElement) observer.observe(title.parentElement);
    return () => observer.disconnect();
  }, [word, guide]);

  return <h1 ref={titleRef} className={guide ? "has-sound-spelling" : undefined}><PronunciationSpelling word={word} guide={guide} /></h1>;
}

function ProficiencyPicker({
  value,
  onChange,
  title = "学完后，标记当前熟练度",
  disabled = false,
}: {
  value?: Proficiency;
  onChange: (value: Proficiency) => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <div className="proficiency-picker">
      <span>{title}</span>
      <div>
        {(Object.keys(proficiencyCopy) as Proficiency[]).map((level) => (
          <button className={`${level} ${value === level ? "active" : ""}`} key={level} disabled={disabled} onClick={() => onChange(level)}>
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
      {[...detail.roots].sort((a, b) => a.order - b.order).map((part, index) => (
        <div className={`morphology-node ${part.type}`} key={`${part.id}-${part.order}`}>
          <div><span>{labels[part.type]}</span><b>{part.spelling}</b></div>
          <p>{part.meaning}</p>
          {part.memoryMethod?.trim() && <details>
            <summary>巧记</summary>
            <MarkdownBlock value={part.memoryMethod} empty="原始数据未提供独立音标或巧记。" />
          </details>}
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
  if (!rows.length) return null;
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
  footer,
  compact = false,
}: {
  detail: WordDetail | null;
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
          <h2><PronunciationSpelling word={detail.spelling} guide={detail.pronunciationGuide} /></h2>
          <div className="pronunciation"><strong>{detail.pronunciation || "音标未提供"}</strong><AudioButton url={detail.audioUrl} /></div>
        </div>
        <div className="word-meaning"><p>{detail.definitionCn}</p></div>
      </header>
      <div className="detail-tabs">
        <button className={tab === "core" ? "active" : ""} onClick={() => setTab("core")}>核心记忆</button>
        {(detail.examples.length + detail.examExamples.length > 0) && <button className={tab === "sentences" ? "active" : ""} onClick={() => setTab("sentences")}>例句 {detail.examples.length + detail.examExamples.length}</button>}
        {(detail.collocations.length + detail.relations.length + detail.frequencies.length > 0) && <button className={tab === "expand" ? "active" : ""} onClick={() => setTab("expand")}>搭配与关联</button>}
        {detail.longSentences.length > 0 && <button className={tab === "long" ? "active" : ""} onClick={() => setTab("long")}>长难句 {detail.longSentences.length}</button>}
      </div>
      <div className="detail-scroll">
        {tab === "core" && <>
          <PronunciationMemory key={detail.id} guide={detail.pronunciationGuide} />
          <Section eyebrow="MEMORY" title="单词巧记"><MarkdownBlock value={wordMemoryDisplay(detail.memoryMarkup)} /></Section>
          {detail.roots.length > 0 && <Section eyebrow="MORPHEME" title="词根词缀构成"><MorphologyRail detail={detail} /></Section>}
          {detail.etymologyMarkup?.trim() && <Section eyebrow="COMPOSITION" title="词根词缀分析"><MarkdownBlock value={detail.etymologyMarkup} /></Section>}
          <MeaningBridgeMemory detail={detail} />
          {detail.rootAffixAccumulation?.trim() && <Section eyebrow="ACCUMULATION" title="词根词缀积累"><MarkdownBlock value={detail.rootAffixAccumulation} /></Section>}
          {detail.rootAffixNotes?.trim() && <Section eyebrow="NOTES" title="补充笔记"><MarkdownBlock value={detail.rootAffixNotes} /></Section>}
        </>}
        {tab === "sentences" && <>
          {detail.examples.length > 0 && <Section eyebrow="EXAMPLES" title="普通例句" count={detail.examples.length}><SentenceList rows={detail.examples} /></Section>}
          {detail.examExamples.length > 0 && <Section eyebrow="EXAM" title="真题例句" count={detail.examExamples.length}><SentenceList rows={detail.examExamples} exam /></Section>}
        </>}
        {tab === "expand" && <>
          {detail.collocations.length > 0 && <Section eyebrow="COLLOCATION" title="常用搭配" count={detail.collocations.length}>
            {detail.collocations.length ? <div className="collocation-list">{detail.collocations.map((item, index) => <div key={item.collocation_id || index}><strong>{item.phrase}</strong><p>{item.meaning}</p><small>{item.example}</small></div>)}</div> : <p className="empty-copy">暂无搭配数据。</p>}
          </Section>}
          {detail.relations.length > 0 && <Section eyebrow="RELATIONS" title="关联词" count={detail.relations.length}>
            {detail.relations.length ? detail.relations.map((relation, index) => <div className="relation-group" key={index}><h4>{String(relation.relation_type || "关联")}</h4><div>{relation.words.map((word, wordIndex) => <span key={word.related_word_id || wordIndex}><b>{word.spelling || word.display_text}</b>{word.meaning && ` · ${word.meaning}`}</span>)}</div></div>) : <p className="empty-copy">暂无关联词数据。</p>}
          </Section>}
          {detail.frequencies.length > 0 && <Section eyebrow="FREQUENCY" title="考试词频" count={detail.frequencies.length}>
            {detail.frequencies.length ? <div className="frequency-grid">{detail.frequencies.map((item, index) => <div key={index}><span>{item.exam_type}</span><b>{item.frequency_count}</b><small>每万词 {item.per_10k_words}</small></div>)}</div> : <p className="empty-copy">暂无词频数据。</p>}
          </Section>}
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
  const emptyY = 320;
  const fullY = 50;
  const currentY = emptyY - (percent / 100) * (emptyY - fullY);
  const clipId = `liquid-day-clip-${day}`;

  return (
    <div className="liquid-day" aria-label={`Day ${day}，完成 ${percent}%`}>
      <svg
        className="liquid-day-svg"
        viewBox="0 0 1000 340"
        preserveAspectRatio="xMidYMid meet"
        role="img"
      >
        <defs>
          <clipPath id={clipId}>
            <text
              x="500"
              y="245"
              textAnchor="middle"
              dominantBaseline="alphabetic"
              className="liquid-day-text"
            >
              Day {day}
            </text>
          </clipPath>
        </defs>

        <text
          x="500"
          y="245"
          textAnchor="middle"
          dominantBaseline="alphabetic"
          className="liquid-day-text liquid-day-base"
        >
          Day {day}
        </text>

        <g clipPath={`url(#${clipId})`}>
          <g
            className="liquid-wave-group"
            style={{ transform: `translateY(${currentY}px)` }}
          >
            <path
              className="liquid-wave liquid-wave-back"
              d="
                M -1200,0
                c 200,-18 200,18 400,0
                c 200,-18 200,18 400,0
                c 200,-18 200,18 400,0
                c 200,-18 200,18 400,0
                c 200,-18 200,18 400,0
                c 200,-18 200,18 400,0
                c 200,-18 200,18 400,0
                c 200,-18 200,18 400,0
                c 200,-18 200,18 400,0
                L 2400,500 L -1200,500 Z
              "
            />
            <path
              className="liquid-wave liquid-wave-front"
              d="
                M -400,0
                c 200,14 200,-14 400,0
                c 200,14 200,-14 400,0
                c 200,14 200,-14 400,0
                c 200,14 200,-14 400,0
                c 200,14 200,-14 400,0
                c 200,14 200,-14 400,0
                c 200,14 200,-14 400,0
                L 2400,500 L -400,500 Z
              "
            />
          </g>
        </g>

        <text
          x="500"
          y="245"
          textAnchor="middle"
          dominantBaseline="alphabetic"
          className="liquid-day-text liquid-day-outline"
          aria-hidden="true"
        >
          Day {day}
        </text>
      </svg>
    </div>
  );
}

function HomeView({
  progress,
  current,
  goToday,
  showPlan,
}: {
  catalog?: Catalog;
  progress: AppProgress;
  plan?: PlanDay[];
  current: PlanDay;
  goToday: () => void;
  showPlan: () => void;
}) {
  const fraction = planDayFraction(progress, current);
  const dayState = progress.planDays[String(current.day)];
  const done = Boolean(dayState?.completedAt);
  const completed = current.kind === "study" ? completedStudyExposureKeys(progress, current).length : (dayState?.reviewedWordIds.length ?? 0);
  const target = current.kind === "study" ? current.appearanceCount : (dayState?.reviewWordIds.length ?? reviewCandidates(progress, true).length);

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
            <button className="home-plan-link" onClick={showPlan}>查看今日安排</button>
          </div>
        </section>
      </div>
    </div>
  );
}

function PlanView({ plan, progress, current, onSelectDay }: { plan: PlanDay[]; progress: AppProgress; current: PlanDay; onSelectDay: (dayNumber: number) => void }) {
  const today = progress.planDays[String(current.day)];
  const todayTotal = current.kind === "study" ? current.appearanceCount : (today?.reviewWordIds.length ?? reviewCandidates(progress, true).length);
  const todayDone = current.kind === "study" ? completedStudyExposureKeys(progress, current).length : (today?.reviewedWordIds.length ?? 0);
  const todayFraction = todayTotal ? Math.min(1, todayDone / todayTotal) : (today?.completedAt ? 1 : 0);
  return (
    <div className="page plan-page">
      <header className="plan-heading"><h1>词书计划</h1></header>
      <div className="plan-overview">
        <div className="plan-metric">
          <div className="plan-metric-heading"><span>总进度</span></div>
          <b>{current.day}<span>/ {plan.length}</span><small>天</small></b>
          <div className="plan-day-track" role="progressbar" aria-label="总进度" aria-valuenow={current.day} aria-valuemin={0} aria-valuemax={plan.length}>
            {plan.map((day) => <i key={day.day} className={`${day.day <= current.day ? "reached" : ""} ${day.kind}`} />)}
          </div>
        </div>
        <div className="plan-metric today-metric">
          <div className="plan-metric-heading"><span>当日进度</span></div>
          <b>{todayDone}<span>/ {todayTotal}</span><small>词</small></b>
          <div className="plan-progress-track" role="progressbar" aria-label="当日进度" aria-valuenow={todayDone} aria-valuemin={0} aria-valuemax={todayTotal || 1}><i style={{ width: `${todayFraction * 100}%` }} /></div>
        </div>
      </div>
      <div className="plan-calendar" role="region" aria-label="日期卡片" tabIndex={0}><div className="plan-grid">
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
              <small>{Math.round(fraction * 100)}%</small>
              <div role="progressbar" aria-label={`Day ${day.day} 进度`} aria-valuenow={Math.round(fraction * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${fraction * 100}%` }} /></div>
            </button>
          );
        })}
      </div></div>
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
  autoStart = false,
  preview = false,
}: {
  catalog: Catalog;
  progress: AppProgress;
  plan: PlanDay;
  details: Record<string, WordDetail>;
  loadWords: (ids: string[], kind: "study" | "review" | "bookmarks", planDay: number) => Promise<boolean>;
  saveProgress: (progress: AppProgress) => Promise<void>;
  autoStart?: boolean;
  preview?: boolean;
}) {
  const groupsById = useMemo(() => new Map(catalog.groups.map((group) => [group.id, group])), [catalog]);
  const groups = plan.groupIds.map((id) => groupsById.get(id)).filter(Boolean) as StudyGroup[];
  const dayState = progress.planDays[String(plan.day)];
  const completedGroups = new Set(dayState?.completedGroupIds ?? []);
  const exposures = useMemo(() => studyExposures(plan, groups), [plan, groups]);
  const completedKeys = useMemo(() => new Set(completedStudyExposureKeys(progress, plan)), [progress, plan]);
  const completedCount = completedKeys.size;
  const finished = isPlanDayComplete(progress, plan.day);
  const [sessionActive, transitionSession, sessionTransitionPhase] = useSoftTransitionState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [breakNextIndex, setBreakNextIndex] = useState<number | null>(null);
  const shownBreaks = useRef(new Set<number>());
  const [simpleExampleIndex, setSimpleExampleIndex] = useState(0);
  const [examExampleIndex, setExamExampleIndex] = useState(0);
  const [longSentenceIndex, setLongSentenceIndex] = useState(0);
  const [sentencesOpen, setSentencesOpen] = useState(false);
  const saving = useSessionSave();
  const ratingBusy = saving.busy;
  const [mobilePanel, setMobilePanel] = useState<"word" | "roots" | "sentences">("word");
  const ratingLock = saving.lock;
  const closingSession = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set());
  const exposure = exposures[activeIndex];
  const group = exposure ? groupsById.get(exposure.groupId) : undefined;
  const activeDetail = exposure?.wordId ? details[exposure.wordId] ?? null : null;
  const hover = useWordHover();
  const rated = exposure ? completedKeys.has(exposure.key) : false;
  const activeProficiency = rated && exposure ? progress.words[exposure.wordId]?.proficiency : undefined;
  const resource = useSessionWord(sessionActive ? exposure?.wordId : undefined, loadWords, "study", plan.day, exposures.slice(activeIndex + 1, activeIndex + 5).map(item => item.wordId));
  const endSession = () => { closingSession.current = true; transitionSession(false); };
  const closeSession = () => { if (!ratingLock.current) endSession(); };
  useSessionDialog({ active: sessionActive, dialogRef, bodyClass: "study-mode-active", onClose: closeSession, busy: () => ratingLock.current });

  useEffect(() => {
    if (hover && activeDetail?.id) hover.setCurrentWordId(activeDetail.id);
  }, [activeDetail?.id, hover]);

  const openWordSession = async (targetGroupId: string, targetWordId: string) => {
    if (ratingLock.current) return;
    closingSession.current = false;
    setBreakNextIndex(null);
    shownBreaks.current.clear();
    const targetIndex = exposures.findIndex((item) => item.groupId === targetGroupId && item.wordId === targetWordId);
    setActiveIndex(targetIndex >= 0 ? targetIndex : 0);
    setSentencesOpen(false);
    transitionSession(true);
  };

  const startSession = async () => {
    if (ratingLock.current) return;
    closingSession.current = false;
    setBreakNextIndex(null);
    shownBreaks.current.clear();
    const nextIndex = exposures.findIndex((item) => !completedKeys.has(item.key));
    const targetIdx = nextIndex >= 0 ? nextIndex : 0;
    setActiveIndex(targetIdx);
    setSentencesOpen(false);
    transitionSession(true);
  };

  useEffect(() => {
    if (autoStart) void startSession();
  }, [autoStart]);
  useEffect(() => () => stopPronunciation(), []);
  useEffect(() => { if (!sessionActive) stopPronunciation(); }, [sessionActive]);
  useLayoutEffect(() => {
    if (breakNextIndex !== null) dialogRef.current?.querySelector<HTMLButtonElement>(".study-break-panel button")?.focus({ preventScroll: true });
  }, [breakNextIndex]);

  const move = (direction: -1 | 1) => {
    if (ratingLock.current || closingSession.current || breakNextIndex !== null || (direction > 0 && !rated)) return;
    saving.setError("");
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
    setMobilePanel("word");
    stopPronunciation();
    document.querySelectorAll(".study-center-scroll, .study-column-scroll").forEach((element) => element.scrollTo(0, 0));
  }, [exposure?.key]);

  const rate = async (level: Proficiency) => {
    if (!group || !activeDetail || !exposure || ratingLock.current || closingSession.current || breakNextIndex !== null) return;
    const next = rateStudyWord(progress, plan, group, exposure.wordId, level);
    await saving.run(() => saveProgress(next), () => {
      if (finished) {
        if (activeIndex < exposures.length - 1) setActiveIndex(activeIndex + 1);
        else endSession();
      } else {
        const ratedKeys = new Set(completedStudyExposureKeys(next, plan));
        const nextUnrated = exposures.findIndex((item, index) => index > activeIndex && !ratedKeys.has(item.key));
        const anyUnrated = nextUnrated >= 0 ? nextUnrated : exposures.findIndex((item) => !ratedKeys.has(item.key));
        if (anyUnrated >= 0) {
          const boundary = !rated ? completedSegmentEnd(plan.segmentEnds, activeIndex, anyUnrated, exposures, ratedKeys) : null;
          if (boundary !== null && !shownBreaks.current.has(boundary)) {
            shownBreaks.current.add(boundary);
            setBreakNextIndex(anyUnrated);
          } else setActiveIndex(anyUnrated);
        }
        else endSession();
      }
    });
  };

  useEffect(() => {
    if (!sessionActive) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, select, [contenteditable='true']");
      if (ratingLock.current || closingSession.current || breakNextIndex !== null) return;
      if (editing || target?.closest(".sound-memory, .meaning-bridge, .word-hover-popover")) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        move(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (rated) move(1);
        return;
      }
      if (event.code === "Space") {
        if (target?.closest("button, a, summary, [role='button']")) return;
        event.preventDefault();
        if (!event.repeat && activeDetail?.audioUrl) void playPronunciation(activeDetail.audioUrl);
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
  }, [sessionActive, activeIndex, activeDetail?.id, activeDetail?.audioUrl, ratingBusy, progress, rated, breakNextIndex]);

  const rootPriority = { root: 0, prefix: 1, suffix: 2, base: 3 };
  const rootLabels = { root: "词根", prefix: "前缀", suffix: "后缀", base: "词基" };
  const studyPriority = [...(activeDetail?.roots ?? [])].sort((a, b) => rootPriority[a.type] - rootPriority[b.type] || a.order - b.order);
  const wordOrder = [...(activeDetail?.roots ?? [])].sort((a, b) => a.order - b.order);
  const longSentences = activeDetail?.longSentences ?? [];
  const longSentence = longSentences[longSentenceIndex];

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
              <div>{item.kind === "root" && <span>词根</span>}<h2>{item.spelling}</h2></div>
              {item.kind === "root" && <p>{item.meaning}</p>}
              <em>{item.wordCount} 词</em>
            </button>
            {!collapsed && <div className="today-word-table">
              {item.wordIds.map((wordId) => {
                const word = catalog.words[wordId];
                const exposureRated = completedKeys.has(`${item.id}:${wordId}`);
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
        <button className="floating-study-start" onClick={() => void startSession()} disabled={!exposures.length}><i /><span>{!exposures.length ? "今日无学习内容" : finished ? "回顾今日内容" : completedCount ? "继续学习" : "开始学习"}</span></button>
      </div>

      {sessionActive && exposure && createPortal(<div ref={dialogRef} tabIndex={-1} className={`study-session-overlay mobile-panel-${mobilePanel}`} role="dialog" aria-modal="true" aria-label="今日单词学习">
        <header className="study-session-topbar">
          <div><span>{catalog.book.name}</span><b>{preview ? "查看 " : ""}Day {plan.day} · {group?.kind === "root" ? group.spelling : "独立词"}</b>{mobilePanel !== "word" && <div className="session-word-anchor"><b>{activeDetail?.spelling || catalog.words[exposure.wordId]?.spelling}</b><AudioButton url={activeDetail?.audioUrl} /></div>}</div>
          <div className="session-progress"><i style={{ width: `${Math.max(completedCount / Math.max(1, plan.appearanceCount), 1 / Math.max(1, plan.appearanceCount)) * 100}%` }} /></div>
          <strong>{activeIndex + 1} / {exposures.length}</strong>
          <button disabled={ratingBusy} onClick={closeSession}><kbd>Esc</kbd> 返回</button>
        </header>
        <nav className="study-session-tabs" aria-label="学习内容" inert={breakNextIndex !== null}>
          {([['word', '单词'], ['roots', '词根'], ['sentences', '长难句']] as const).filter(([id]) => id !== "sentences" || longSentences.length > 0).map(([id, label]) => <button disabled={ratingBusy} key={id} aria-pressed={mobilePanel === id} onClick={() => setMobilePanel(id)}>{label}</button>)}
        </nav>

        {breakNextIndex !== null ? <section className="study-break-panel" aria-live="polite"><h2>本段完成</h2><p>今天已学 {completedCount} / {plan.appearanceCount} 词，可以休息一下。</p><div><button onClick={() => { setActiveIndex(breakNextIndex); setBreakNextIndex(null); }}>继续下一段</button><button onClick={closeSession}>返回安排</button></div></section> : <div className={`study-session-grid ${longSentences.length ? sentencesOpen ? "sentences-open" : "sentences-collapsed" : "without-sentences"}`}>
          <aside className="study-morpheme-column" inert={ratingBusy}>
            <header><span>MORPHEME NOTES</span><h2>词根词缀</h2></header>
            <div className="study-column-scroll">
              {activeDetail ? studyPriority.length ? studyPriority.map((part, index) => <section className={`study-part-card ${part.type}`} key={`${part.id}-${part.order}`}>
                <header><span>{rootLabels[part.type]} · {String(index + 1).padStart(2, "0")}</span><b>{part.spelling}</b></header>
                <p>{part.meaning}</p>
                {part.memoryMethod?.trim() && <div><span>巧记</span><MarkdownBlock value={part.memoryMethod} /></div>}
              </section>) : <div className="session-empty"><b>{activeDetail.spelling}</b><p>这个单词没有独立词根，按单词整体记忆。</p></div> : <div className="session-loading" role="status">{resource.failed ? <><p>单词详情加载失败</p><button onClick={resource.retry}>重新加载</button></> : "正在准备词根词缀…"}</div>}
            </div>
          </aside>

          <main className="study-word-column">
            <div className="study-center-scroll" inert={ratingBusy}>
              {activeDetail ? <>
                <header className="study-word-hero">
                  <div><span>{group?.kind === "root" ? `${group.spelling} 词根家族` : "独立单词"}</span><FittedWordTitle word={activeDetail.spelling} guide={activeDetail.pronunciationGuide} /><div><strong>{activeDetail.pronunciation || "音标未提供"}</strong><AudioButton url={activeDetail.audioUrl} /></div></div>
                  <div><p>{activeDetail.definitionCn}</p></div>
                </header>
                <PronunciationMemory key={activeDetail.id} guide={activeDetail.pronunciationGuide} />
                <section className="session-section"><header><div><span>MEMORY</span><h3>单词巧记</h3></div></header><MarkdownBlock value={wordMemoryDisplay(activeDetail.memoryMarkup)} /></section>
                {(wordOrder.length > 0 || activeDetail.etymologyMarkup?.trim()) && <section className="session-section etymology-study"><header><div><span>WORD BUILDING</span><h3>词根词缀分析</h3></div></header>
                  {wordOrder.length > 0 && <div className="study-word-equation">{wordOrder.map((part, index) => <div className="study-word-equation-piece" key={`${part.id}-${part.order}`}>{index > 0 && <i aria-hidden="true">＋</i>}<span><b>{part.spelling}</b><small>{part.meaning}</small></span></div>)}</div>}
                  {activeDetail.etymologyMarkup?.trim() && <MarkdownBlock value={activeDetail.etymologyMarkup} />}
                </section>}
                <MeaningBridgeMemory detail={activeDetail} position={{ day: plan.day, index: activeIndex }} />
                <SentenceSpotlight eyebrow="EXAMPLE" title="简单例句" rows={activeDetail.examples} index={simpleExampleIndex} onNext={() => setSimpleExampleIndex((simpleExampleIndex + 1) % activeDetail.examples.length)} />
                <SentenceSpotlight eyebrow="EXAM" title="真题例句" rows={activeDetail.examExamples} index={examExampleIndex} onNext={() => setExamExampleIndex((examExampleIndex + 1) % activeDetail.examExamples.length)} exam />
              </> : <div className="session-loading center" role="status">{resource.failed ? <><p>单词详情加载失败</p><button onClick={resource.retry}>重新加载</button></> : <>正在展开 {catalog.words[exposure.wordId]?.spelling}…</>}</div>}
            </div>
            <footer className="study-session-controls">
              {saving.error && <p className="session-save-error" role="alert">{saving.error} 请重新选择评级重试。</p>}
              <div className="session-rating">
                {(["unmastered", "unclear", "mastered"] as Proficiency[]).map((level, index) => <button className={`${level} ${activeProficiency === level ? "active" : ""}`} disabled={!activeDetail || ratingBusy} onClick={() => void rate(level)} key={level}><kbd>{index + 1}</kbd><b>{proficiencyCopy[level].label}</b></button>)}
              </div>
              <div className={`session-navigation ${rated ? "has-next" : ""}`}>
                <button disabled={activeIndex === 0 || ratingBusy} onClick={() => move(-1)}><kbd>←</kbd> 上一个</button>
                <span
                  role="button"
                  tabIndex={0}
                  className="session-audio-trigger"
                  onClick={() => activeDetail?.audioUrl && void playPronunciation(activeDetail.audioUrl)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (activeDetail?.audioUrl) void playPronunciation(activeDetail.audioUrl);
                    }
                  }}
                  title="播放发音"
                >
                  <kbd>空格</kbd> 发音
                </span>
                {rated && (
                  <button disabled={activeIndex === exposures.length - 1 || ratingBusy} onClick={() => move(1)}>下一个 <kbd>→</kbd></button>
                )}
              </div>
            </footer>
          </main>

          {longSentences.length > 0 && <aside className="study-sentence-column" inert={ratingBusy}>
            <button className="sentence-toggle" aria-expanded={sentencesOpen} aria-controls="study-sentence-content" aria-label={sentencesOpen ? "收起长难句" : "展开长难句"} onClick={() => setSentencesOpen((open) => !open)}><span aria-hidden="true">‹</span><b>长难句</b></button>
            <div className="study-sentence-content" id="study-sentence-content" inert={!sentencesOpen && mobilePanel !== "sentences"}>
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
            </div>
          </aside>}
        </div>}
      </div>, document.body)}
    </div>
  );
}

function ReviewToday({ catalog, progress, plan, details, loadWords, saveProgress, autoStart = false }: {
  catalog: Catalog;
  progress: AppProgress;
  plan: PlanDay;
  details: Record<string, WordDetail>;
  loadWords: (ids: string[], kind: "study" | "review" | "bookmarks", planDay: number) => Promise<boolean>;
  saveProgress: (progress: AppProgress) => Promise<void>;
  autoStart?: boolean;
}) {
  const [skipMastered, setSkipMastered] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const saving = useSessionSave();
  const day = progress.planDays[String(plan.day)];
  const candidates = reviewCandidates(progress, skipMastered);
  const queue = day?.reviewWordIds.filter((id) => !day.reviewedWordIds.includes(id)) ?? [];
  const currentId = queue[0];
  const finished = isPlanDayComplete(progress, plan.day);
  const hover = useWordHover();
  const resource = useSessionWord(currentId, loadWords, "review", plan.day, queue.slice(1, 5));
  useEffect(() => {
    setRevealed(false);
    stopPronunciation();
    if (hover && currentId) hover.setCurrentWordId(currentId);
  }, [currentId]);
  const start = () => saving.run(
    () => saveProgress(startReviewDay(progress, plan.day, candidates, skipMastered)),
    () => setRevealed(false),
  );
  useEffect(() => { if (autoStart && !day) void start(); }, [autoStart]);
  useEffect(() => () => stopPronunciation(), []);
  const rate = (level: Proficiency) => {
    if (!currentId || !details[currentId] || !revealed) return;
    return saving.run(() => saveProgress(rateReviewWord(progress, plan.day, currentId, level)), () => setRevealed(false));
  };
  const saveNotice = saving.error && <p className="session-save-error" role="alert">{saving.error} 请重试。</p>;
  if (!day) {
    const counts = proficiencyCounts(progress);
    return <div className="page review-setup"><PageHeader eyebrow={`DAY ${plan.day} · REVIEW`} title="本轮复习" description="先回想词义，再判断熟练度。" /><div className="review-setup-card"><span>本轮复习</span><b>{candidates.length}</b><small>个单词</small><label><input type="checkbox" checked={skipMastered} disabled={saving.busy} onChange={(event) => setSkipMastered(event.target.checked)} /><i />跳过已掌握</label><div><p>未掌握 <b>{counts.unmastered}</b></p><p>不清楚 <b>{counts.unclear}</b></p><p className={skipMastered ? "muted" : ""}>已掌握 <b>{counts.mastered}</b></p></div>{saveNotice}<button disabled={saving.busy} onClick={() => void start()}>{saving.busy ? "正在准备…" : "开始复习"} <b>→</b></button></div></div>;
  }
  if (finished) return <div className="page review-finished"><PageHeader eyebrow={`DAY ${plan.day} · COMPLETE`} title="今天的复习已完成" description={`已保存 ${day.reviewedWordIds.length} 个单词的判断。`} /><div className="review-finished-mark">✓<span>REVIEW COMPLETE</span></div></div>;
  const word = currentId ? catalog.words[currentId] : null;
  const detail = currentId ? details[currentId] ?? null : null;
  return <div className="page review-session"><PageHeader eyebrow={`DAY ${plan.day} · REVIEW`} title="先回想，再查看详情" description={`还剩 ${queue.length} 词`} aside={<div className="today-progress"><b>{day.reviewedWordIds.length}</b><span>/ {day.reviewWordIds.length}</span></div>} />{saveNotice}<div className={`judgment-card ${revealed ? "revealed" : ""}`}>
    {!revealed && word ? <button className="judgment-front" disabled={saving.busy} onClick={() => setRevealed(true)}><span>查看词义</span><h2>{word.spelling}</h2><p>{word.pronunciation}</p></button> : detail ? <WordDetailPanel detail={detail} footer={<ProficiencyPicker disabled={saving.busy} value={currentId ? progress.words[currentId]?.proficiency : undefined} onChange={(level) => void rate(level)} title="重新判断熟练度" />} /> : <div className="vocabulary-loading" role="status"><p>{resource.failed ? "单词详情加载失败" : "正在加载单词详情…"}</p>{resource.failed && <button onClick={resource.retry}>重新加载</button>}</div>}
  </div></div>;
}
function WordBrowseSession({ wordIds, initialIndex, category, progress, details, loadWords, planDay, saveProgress, onClose }: {
  wordIds: string[];
  initialIndex: number;
  category: "unmastered" | "unclear" | "search";
  progress: AppProgress;
  details: Record<string, WordDetail>;
  loadWords: (ids: string[], kind: "study" | "review" | "bookmarks", planDay: number) => Promise<boolean>;
  planDay: number;
  saveProgress: (next: AppProgress) => Promise<void>;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [ratedIds, setRatedIds] = useState<Set<string>>(() => new Set());
  const saving = useSessionSave();
  const busy = saving.busy;
  const [closing, setClosing] = useState(false);
  const ratingLock = saving.lock;
  const dialogRef = useRef<HTMLDivElement>(null);
  const wordId = wordIds[index];
  const detail = details[wordId] ?? null;
  const rated = ratedIds.has(wordId);
  const requestClose = () => { if (!ratingLock.current) setClosing(true); };

  const resource = useSessionWord(wordId, loadWords, "bookmarks", planDay, wordIds.slice(index + 1, index + 5));
  useSessionDialog({ active: true, dialogRef, bodyClass: "vocabulary-session-active", onClose: requestClose, busy: () => ratingLock.current });
  useEffect(() => { stopPronunciation(); }, [wordId]);
  useEffect(() => () => stopPronunciation(), []);
  useEffect(() => {
    if (!closing) return;
    document.querySelector<HTMLButtonElement>(".popover-close")?.click();
    const timer = window.setTimeout(onClose, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180);
    return () => window.clearTimeout(timer);
  }, [closing, onClose]);
  const move = (delta: number) => {
    if (ratingLock.current || closing || (delta > 0 && !rated)) return;
    saving.setError("");
    setIndex((value) => Math.max(0, Math.min(wordIds.length - 1, value + delta)));
  };
  const rate = async (level: Proficiency) => {
    if (!detail || (category !== "search" && !progress.words[wordId]) || ratingLock.current || closing) return;
    await saving.run(() => saveProgress(category === "search" ? rateSearchWord(progress, wordId, level) : updateWordProficiency(progress, wordId, level)), () => {
      setRatedIds((previous) => new Set([...previous, wordId]));
      if (index < wordIds.length - 1) setIndex(index + 1);
      else setClosing(true);
    });
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || ratingLock.current || closing) return;
      if ((event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"], .word-hover-popover, .sound-memory, .meaning-bridge')) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1); }
      const shortcut: Record<string, Proficiency> = { "1": "unmastered", "2": "unclear", "3": "mastered" };
      if (shortcut[event.key] && !event.repeat) { event.preventDefault(); void rate(shortcut[event.key]); }
      if (event.code === "Space" && event.target === document.body) { event.preventDefault(); if (detail?.audioUrl && !event.repeat) void playPronunciation(detail.audioUrl); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index, detail, progress, rated, closing]);
  return createPortal(<div ref={dialogRef} tabIndex={-1} className={"vocabulary-session " + (closing ? "is-closing" : "")} role="dialog" aria-modal="true" aria-label={category === "search" ? "单词搜索全屏详情" : "词汇掌握全屏详情"}>
    <header className="vocabulary-session-header"><button onClick={requestClose} disabled={busy}>‹ 返回列表</button><b>{category === "search" ? "单词搜索" : proficiencyCopy[category].label}</b><span aria-live="polite">{index + 1} / {wordIds.length}</span></header>
    <div className="vocabulary-session-content" key={wordId} inert={busy}>
      {detail ? <WordDetailPanel detail={detail} /> : <div className="vocabulary-loading" role="status"><p>{resource.failed ? "单词详情加载失败，请重试。" : "正在加载单词详情…"}</p>{resource.failed && <button onClick={resource.retry}>重新加载</button>}</div>}
    </div>
    <footer className="vocabulary-session-controls">
      {saving.error && <p className="session-save-error" role="alert">{saving.error} 请重新选择评级重试。</p>}
      <div className="session-rating">{(Object.keys(proficiencyCopy) as Proficiency[]).map((level) => <button className={level + (rated && progress.words[wordId]?.proficiency === level ? " active" : "")} key={level} disabled={busy || !detail || closing} onClick={() => void rate(level)}>{proficiencyCopy[level].label}</button>)}</div>
      <nav className="vocabulary-session-navigation" aria-label="切换单词"><button onClick={() => move(-1)} disabled={index === 0 || busy || closing}>‹ 上一个</button><button onClick={() => move(1)} disabled={!rated || index === wordIds.length - 1 || busy || closing}>下一个 ›</button></nav>
    </footer>
  </div>, document.body);
}

function VocabularyView({ catalog, progress, details, loadWords, planDay, saveProgress }: {
  catalog: Catalog;
  progress: AppProgress;
  details: Record<string, WordDetail>;
  loadWords: (ids: string[], kind: "study" | "review" | "bookmarks", planDay: number) => Promise<boolean>;
  planDay: number;
  saveProgress: (next: AppProgress) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"unmastered" | "unclear">("unmastered");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [session, setSession] = useState<{ wordIds: string[]; initialIndex: number; category: "unmastered" | "unclear" } | null>(null);
  const overview = useMemo(() => vocabularyOverview(progress, catalog), [progress, catalog]);
  const ids = useMemo(() => overview.ids.filter((id) => {
    const word = catalog.words[id], term = query.trim().toLowerCase();
    return progress.words[id].proficiency === filter
      && (!term || word.spelling.toLowerCase().includes(term) || word.definitionCn.includes(term));
  }), [overview, catalog, progress.words, query, filter]);
  const pageCount = Math.max(1, Math.ceil(ids.length / 50));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleIds = ids.slice(currentPage * 50, (currentPage + 1) * 50);
  const statistics = [
    { key: "mastered", label: "已掌握", count: overview.counts.mastered },
    { key: "unmastered", label: "未掌握", count: overview.counts.unmastered },
    { key: "unclear", label: "不清楚", count: overview.counts.unclear },
    { key: "unlearned", label: "未学习", count: overview.counts.unlearned },
  ];
  return <div className="page vocabulary-page">
    <PageHeader eyebrow="VOCABULARY PROGRESS" title="词汇掌握情况" description="看清整本词书的掌握情况，集中巩固还没记牢的词。" />
    <section className="vocabulary-overview" aria-label="全书词汇掌握统计">
      <header><span>全书 <b>{overview.total}</b> 词</span><span>已学习 <b>{overview.total - overview.counts.unlearned}</b> 词</span></header>
      <div className="mastery-distribution" role="img" aria-label={statistics.map((item) => item.label + item.count + "词").join("，")}>
        {statistics.map((item) => <i key={item.key} className={item.key} style={{ width: (item.count / Math.max(1, overview.total) * 100) + "%" }} />)}
      </div>
      <dl>{statistics.map((item) => <div className={item.key} key={item.key}><dt><i />{item.label}</dt><dd>{item.count}<small>词</small></dd></div>)}</dl>
    </section>
    <div className="vocabulary-toolbar">
      <div className="vocabulary-filters" aria-label="筛选待巩固词汇">
        {(["unmastered", "unclear"] as const).map((level) => <button key={level} aria-pressed={filter === level} onClick={() => { setFilter(level); setPage(0); }}>{proficiencyCopy[level].label}<b>{overview.counts[level]}</b></button>)}
      </div>
      <label className="search-box"><span aria-hidden="true">⌕</span><input aria-label="搜索待巩固词汇" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="搜索单词或中文释义" /></label>
    </div>
    <p className="vocabulary-hint">未掌握、不清楚的已学词自动收录；改为已掌握后自动移出。</p>
    {ids.length ? <>
      <div className="vocabulary-layout">
        <aside aria-label="词汇列表">{visibleIds.map((id) => <button className={selectedId === id ? "active" : ""} key={id} onClick={() => { setSelectedId(id); setSession({ wordIds: [...ids], initialIndex: ids.indexOf(id), category: filter }); }}><b>{catalog.words[id].spelling}</b><span>{catalog.words[id].pronunciation}</span><small>{catalog.words[id].definitionCn}</small><i className={progress.words[id].proficiency}>{proficiencyCopy[progress.words[id].proficiency].label}</i></button>)}</aside>
      </div>
      {pageCount > 1 && <nav className="vocabulary-pagination" aria-label="词汇列表翻页"><button disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); }}>上一页</button><span>{currentPage + 1} / {pageCount} · 共 {ids.length} 词</span><button disabled={currentPage + 1 === pageCount} onClick={() => { setPage(currentPage + 1); }}>下一页</button></nav>}
    </> : <div className="vocabulary-empty"><span aria-hidden="true">◇</span><h2>{query.trim() ? "没有找到匹配的词" : overview.ids.length ? "当前分类没有待巩固词汇" : overview.counts.unlearned === overview.total ? "学过之后，在这里看见进步" : "已学词汇都已掌握"}</h2></div>}
    {session && <WordBrowseSession {...session} progress={progress} details={details} loadWords={loadWords} planDay={planDay} saveProgress={saveProgress} onClose={() => setSession(null)} />}
  </div>;
}

function WordSearchView({ catalog, progress, details, loadWords, planDay, saveProgress }: {
  catalog: Catalog;
  progress: AppProgress;
  details: Record<string, WordDetail>;
  loadWords: (ids: string[], kind: "study" | "review" | "bookmarks", planDay: number) => Promise<boolean>;
  planDay: number;
  saveProgress: (next: AppProgress) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [session, setSession] = useState<{ wordIds: string[]; initialIndex: number } | null>(null);
  const orderedIds = useMemo(() => bookWordOrder(catalog), [catalog]);
  const matches = useMemo(() => searchBookWords(catalog, orderedIds, query), [catalog, orderedIds, query]);
  const ids = useMemo(() => searchBookWords(catalog, orderedIds, submittedQuery), [catalog, orderedIds, submittedQuery]);
  const suggestions = matches.slice(0, 8);
  const showSuggestions = suggestionsOpen && !!query.trim() && !session;
  const pageCount = Math.max(1, Math.ceil(ids.length / 50));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleIds = ids.slice(currentPage * 50, (currentPage + 1) * 50);

  useEffect(() => {
    suggestionsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeSuggestion]);

  const openWord = (id: string, wordIds: string[]) => {
    setSelectedId(id);
    setSuggestionsOpen(false);
    setSession({ wordIds: [...wordIds], initialIndex: wordIds.indexOf(id) });
  };
  const submitSearch = () => {
    setSubmittedQuery(query.trim());
    setPage(0);
    setActiveSuggestion(-1);
    setSuggestionsOpen(false);
    inputRef.current?.blur();
  };

  return <div className={`page word-search-page${submittedQuery ? " has-results" : ""}${showSuggestions ? " is-suggesting" : ""}`}>
    <header className="word-search-header"><h1>单词搜索</h1>
      <form className={`word-search-form${showSuggestions ? " is-open" : ""}`} role="search" onSubmit={(event) => { event.preventDefault(); submitSearch(); }} onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setSuggestionsOpen(false); setActiveSuggestion(-1); }
      }}>
        <div className="word-search-input-row">
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.6" /><path d="m16 16 4.5 4.5" /></svg>
          <input ref={inputRef} type="search" role="combobox" aria-label="搜索单词" aria-autocomplete="list" aria-expanded={showSuggestions} aria-controls={showSuggestions ? "word-search-suggestions" : undefined} aria-activedescendant={showSuggestions && activeSuggestion >= 0 ? `word-suggestion-${activeSuggestion}` : undefined} autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search" value={query} onFocus={() => setSuggestionsOpen(true)} onChange={(event) => {
            setQuery(event.target.value); setActiveSuggestion(-1); setSuggestionsOpen(true);
            if (!event.target.value.trim()) { setSubmittedQuery(""); setPage(0); }
          }} onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length) {
              event.preventDefault(); setSuggestionsOpen(true);
              setActiveSuggestion((index) => event.key === "ArrowDown" ? Math.min(index + 1, suggestions.length - 1) : Math.max(-1, index - 1));
            } else if (event.key === "Escape") {
              event.preventDefault(); setSuggestionsOpen(false); setActiveSuggestion(-1);
            } else if (event.key === "Enter" && showSuggestions && activeSuggestion >= 0) {
              event.preventDefault(); openWord(suggestions[activeSuggestion], matches);
            }
          }} placeholder="输入单词" />
          {query && <button type="button" className="word-search-clear" aria-label="清空搜索" onClick={() => { setQuery(""); setSubmittedQuery(""); setPage(0); setActiveSuggestion(-1); inputRef.current?.focus(); }}>×</button>}
          <button type="submit" className="word-search-submit" aria-label="搜索"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></button>
        </div>
        {showSuggestions && <div className="word-search-dropdown">
          {suggestions.length ? <div ref={suggestionsRef} id="word-search-suggestions" role="listbox" aria-label="匹配单词">
            {suggestions.map((id, index) => <button type="button" role="option" id={`word-suggestion-${index}`} aria-selected={activeSuggestion === index} tabIndex={-1} key={id} onMouseDown={(event) => event.preventDefault()} onClick={() => openWord(id, matches)}>
              <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.6" /><path d="m16 16 4.5 4.5" /></svg>
              <b>{catalog.words[id].spelling}</b><span>{catalog.words[id].definitionCn}</span>
            </button>)}
          </div> : <div id="word-search-suggestions" role="listbox" aria-label="匹配单词" />}
          {matches.length ? <button type="submit" className="word-search-all">查看全部 {matches.length} 词 <span aria-hidden="true">↗</span></button> : <p role="status">没有找到匹配的词</p>}
        </div>}
      </form>
    </header>
    {submittedQuery && <section className="word-search-results" aria-label="单词搜索结果">
      <div className="search-result-count" role="status">{ids.length} 词</div>
      {ids.length > 0 ? <>
      <div className="search-result-list">
        {visibleIds.map((id) => {
          const word = catalog.words[id], level = progress.words[id]?.proficiency;
          return <button key={id} className={selectedId === id ? "active" : ""} onClick={() => openWord(id, ids)}>
            <b>{word.spelling}</b><span>{word.pronunciation}</span><small>{word.definitionCn}</small><i className={level ?? "unlearned"}>{level ? proficiencyCopy[level].label : "待学习"}</i>
          </button>;
        })}
      </div>
      {pageCount > 1 && <nav className="vocabulary-pagination" aria-label="搜索结果翻页"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {pageCount}</span><button disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>下一页</button></nav>}
      </> : <div className="word-search-empty">没有找到匹配的词</div>}
    </section>}
    {session && <WordBrowseSession {...session} category="search" progress={progress} details={details} loadWords={loadWords} planDay={planDay} saveProgress={saveProgress} onClose={() => setSession(null)} />}
  </div>;
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
    ? (update.message || "下载失败，点击重试")
    : update.status === "downloading"
      ? `正在下载 ${update.version ?? "新版本"}：${percent}%`
      : `${update.version ?? "新版本"} 已下载，点击立即安装`;

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

function LogoutNotice({ message, canLeave, busy, onRetry, onContinue, onCancel }: {
  message: string; canLeave: boolean; busy: boolean; onRetry: () => void; onContinue: () => void; onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useSessionDialog({ active: true, dialogRef, onClose: onCancel, busy });
  return createPortal(<div className="logout-notice-backdrop"><div ref={dialogRef} tabIndex={-1} className="logout-notice" role="dialog" aria-modal="true" aria-labelledby="logout-title"><h2 id="logout-title">退出登录</h2><p>{message}</p><div><button disabled={busy} onClick={onRetry}>{busy ? "正在保存…" : "重试"}</button>{canLeave && <button disabled={busy} onClick={onContinue}>继续退出</button>}<button disabled={busy} onClick={onCancel}>留在当前账号</button></div></div></div>, document.body);
}

function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [session, setSession] = useState<UserSession | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionRestoreError, setSessionRestoreError] = useState("");
  const authGeneration = useRef(0);
  const synced = useSyncedProgress(session, catalog, () => {
    authGeneration.current += 1;
    setSession(null);
    setSessionExpired(true);
    setLogoutNotice(null);
    setSelectedDayNumber(null);
    setError("");
    void window.cyword.clearSession?.().catch((reason) => console.warn("清除过期会话失败:", reason));
  });
  const progress = synced.progress;
  const [sessionChecked, setSessionChecked] = useState(false);
  const [view, transitionView, viewTransitionPhase] = useSoftTransitionState<ViewName>("home");
  const { details, loadWords } = useWordResources(catalog);
  const saveLock = useRef(false);
  const [savingProgress, setSavingProgress] = useState(false);
  const [autoStartStudy, setAutoStartStudy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const logoutLock = useRef(false);
  const [logoutNotice, setLogoutNotice] = useState<{ message: string; canLeave: boolean } | null>(null);
  const [error, setError] = useState("");
  const [selectedDayNumber, setSelectedDayNumber] = useState<number | null>(null);

  useEffect(() => {
    document.querySelector(".app-shell > main")?.scrollTo({ top: 0, behavior: "auto" });
  }, [view]);

  useEffect(() => {
    const back = (event: Event) => {
      if (event.defaultPrevented) return;
      if (saveLock.current || logoutLock.current) { event.preventDefault(); return; }
      const close = document.querySelector<HTMLButtonElement>(".popover-close");
      if (close) { event.preventDefault(); event.stopImmediatePropagation(); close.click(); return; }
      if (document.body.classList.contains("study-mode-active") || document.body.classList.contains("vocabulary-session-active")) return;
      if (view !== "home") { event.preventDefault(); transitionView("home"); }
    };
    window.addEventListener("cyword-back", back);
    return () => window.removeEventListener("cyword-back", back);
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
        setSessionRestoreError("读取受保护登录状态失败。本机学习记录已保留，请重启应用重试或重新登录。");
      } finally {
        setSessionChecked(true);
      }
    };
    initAuth();
  }, []);

  useEffect(() => {
    window.cyword.readCatalog().then((nextCatalog) => {
      setCatalog(applyCurriculum(nextCatalog));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const saveProgress = async (next: AppProgress) => {
    if (saveLock.current || logoutLock.current || logoutNotice) throw new Error("正在保存，请稍后重试。");
    saveLock.current = true;
    setSavingProgress(true);
    try { await synced.save(next); }
    finally { saveLock.current = false; setSavingProgress(false); }
  };
  const finishLogout = async () => {
    if (window.cyword?.clearSession) {
      if (!await window.cyword.clearSession()) throw new Error("退出失败：无法清除本机登录状态，请重试。");
    } else localStorage.removeItem("cyword_session");
    stopPronunciation();
    setLogoutNotice(null);
    setSelectedDayNumber(null);
    setAutoStartStudy(false);
    transitionView("home");
    setSession(null);
  };
  const handleLogout = async (continueWithoutCloud = false) => {
    if (saveLock.current || logoutLock.current) return;
    logoutLock.current = true;
    setLogoutBusy(true);
    const generation = authGeneration.current;
    try {
      if (!continueWithoutCloud) {
        const result = await synced.flush();
        if (generation !== authGeneration.current) return;
        if (!result.localSaved) { setLogoutNotice({ message: result.message || "本机保存失败，请重试后退出。", canLeave: false }); return; }
        if (!result.cloudSynced) { setLogoutNotice({ message: "本机记录已保存，但云端同步未完成。继续退出后，请勿清理当前设备数据；在其他设备上可能暂时看不到本次进度。", canLeave: true }); return; }
      }
      await finishLogout();
    } catch (reason) {
      if (generation === authGeneration.current) setLogoutNotice({ message: reason instanceof Error ? reason.message : "退出失败，请重试。", canLeave: false });
    } finally { logoutLock.current = false; setLogoutBusy(false); }
  };
  if (sessionChecked && !session) return <><AuthModal notice={sessionRestoreError || (sessionExpired ? "登录已过期，请重新登录。本机学习记录已保留。" : undefined)} onSuccess={(s) => { authGeneration.current += 1; setLogoutNotice(null); setSessionRestoreError(""); setSessionExpired(false); setSession(s); }} /><UpdateControl /></>;
  if (error) return <div className="fatal-error"><span>CYWORD</span><h1>暂时无法继续</h1><p>{error}</p><button onClick={() => location.reload()}>重新连接</button></div>;
  if (session && !progress && synced.status === "error") return <div className="fatal-error"><h1>进度读取失败</h1><p>{synced.message}</p><button onClick={() => location.reload()}>重试</button></div>;
  if (!catalog || !progress || !sessionChecked) return <div className="loading-screen"><div>Cy</div><p>正在铺开今天的词书计划…</p></div>;

  const plan = buildPlan(catalog);
  const currentDayNumber = currentPlanDayNumber(progress, plan.length);
  const activeDayNumber = selectedDayNumber ?? currentDayNumber;
  const current = plan[currentDayNumber - 1] ?? plan[0];
  const selected = plan[activeDayNumber - 1] ?? current;

  const navigate = (nextView: ViewName) => {
    if (saveLock.current || logoutLock.current || logoutNotice) return;
    setAutoStartStudy(false);
    if (nextView !== view || (nextView === "today" && selectedDayNumber !== null)) {
      if (nextView === "today") {
        setSelectedDayNumber(null);
      }
      stopPronunciation();
      transitionView(nextView);
    }
  };

  const handleSelectPlanDay = (dayNumber: number, start = false) => {
    if (saveLock.current || logoutLock.current || logoutNotice) return;
    setSelectedDayNumber(dayNumber);
    setAutoStartStudy(start);
    stopPronunciation();
    transitionView("today");
  };

  return (
    <WordHoverProvider
      catalog={catalog}
      details={details}
      loadWords={loadWords}
      planDay={selected.day}
    >
      <MeaningBridgeProvider catalog={catalog} progress={progress}>
      <div className="app-wallpaper" aria-hidden="true" />
      <div className="app-shell">
        <header className="mobile-header"><a className="mobile-brand" href="#" onClick={(event) => { event.preventDefault(); navigate("home"); }}>CYword</a><details className="mobile-account"><summary aria-label={`我的账号，${synced.message}`}><i className={`sync-dot ${synced.status}`} aria-hidden="true" /><span>我的</span><svg className="account-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></summary><div><b>{session?.user.email}</b><p className="account-sync-message"><i className={`sync-dot ${synced.status}`} aria-hidden="true" />{synced.message}</p><button onClick={() => void synced.sync()}>立即同步</button><button disabled={savingProgress || logoutBusy} onClick={() => void handleLogout()}>退出登录</button></div></details></header>
        <aside className="sidebar">
          <div className="brand"><b>CYword</b></div>
          <nav>{navItems.map((item) => <button disabled={savingProgress || logoutBusy || Boolean(logoutNotice)} aria-label={item.label} aria-current={view === item.id ? "page" : undefined} className={view === item.id ? "active" : ""} key={item.id} onClick={() => navigate(item.id)}><i><svg viewBox="0 0 24 24" aria-hidden="true"><path d={item.path} /></svg></i><b>{item.label}</b></button>)}</nav>
          {session && (
            <footer className="sidebar-user-footer">
              <button className={`sync-status ${synced.status}`} title={synced.message} onClick={() => void synced.sync()}><i className={`sync-dot ${synced.status}`} />{synced.message}</button>
              <div className="sidebar-user-info">
                <div className="sidebar-user-avatar">
                  {session.user.email.charAt(0).toUpperCase()}
                </div>
                <span className="sidebar-user-email" title={session.user.email}>
                  {session.user.email}
                </span>
              </div>
              <button className="btn-logout" disabled={savingProgress || logoutBusy} onClick={() => void handleLogout()}>退出登录</button>
            </footer>
          )}
        </aside>
        <main className={`app-content soft-transition transition-${viewTransitionPhase}`}>
          {view === "home" && <HomeView catalog={catalog} progress={progress} plan={plan} current={current} goToday={() => handleSelectPlanDay(currentDayNumber, !isPlanDayComplete(progress, currentDayNumber))} showPlan={() => handleSelectPlanDay(currentDayNumber)} />}
          {view === "plan" && <PlanView plan={plan} progress={progress} current={plan[currentDayNumber - 1] ?? current} onSelectDay={handleSelectPlanDay} />}
          {view === "today" && <>{selected.day !== current.day && <div className="day-preview-banner">正在查看 Day {selected.day}<button disabled={savingProgress} onClick={() => handleSelectPlanDay(current.day)}>返回今日</button></div>}{selected.kind === "study" ? <StudyToday key={`${session?.user.id}:${selected.day}`} catalog={catalog} progress={progress} plan={selected} details={details} loadWords={loadWords} saveProgress={saveProgress} autoStart={autoStartStudy} preview={selected.day !== current.day} /> : <ReviewToday key={`${session?.user.id}:${selected.day}`} catalog={catalog} progress={progress} plan={selected} details={details} loadWords={loadWords} saveProgress={saveProgress} autoStart={autoStartStudy} />}</>}
          {view === "vocabulary" && <VocabularyView catalog={catalog} progress={progress} details={details} loadWords={loadWords} planDay={current.day} saveProgress={saveProgress} />}
          {view === "search" && <WordSearchView catalog={catalog} progress={progress} details={details} loadWords={loadWords} planDay={current.day} saveProgress={saveProgress} />}
        </main>
        {!session && <AuthModal onSuccess={(s) => setSession(s)} />}
        <UpdateControl />
        {logoutNotice && <LogoutNotice {...logoutNotice} busy={logoutBusy} onRetry={() => void handleLogout()} onContinue={() => void handleLogout(true)} onCancel={() => setLogoutNotice(null)} />}
      </div>
      </MeaningBridgeProvider>
    </WordHoverProvider>
  );
}

export default App;
