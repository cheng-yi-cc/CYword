import { useEffect, useMemo, useState } from "react";
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
  todayKey,
  toggleBookmark,
} from "./progress";
import type {
  AppProgress,
  Catalog,
  PlanDay,
  Proficiency,
  StudyGroup,
  ViewName,
  WordDetail,
} from "./types";

const navItems: Array<{ id: ViewName; label: string; glyph: string }> = [
  { id: "home", label: "首页", glyph: "⌂" },
  { id: "plan", label: "词书计划", glyph: "▦" },
  { id: "today", label: "今日学习", glyph: "▷" },
  { id: "vocabulary", label: "生词本", glyph: "◇" },
];

function renderMarkup(value: string) {
  const markdown = value
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "**$2**")
    .replace(/\[\[([^\]]+)\]\]/g, "**$1**");
  return DOMPurify.sanitize(marked.parse(markdown, { breaks: true }) as string);
}

function MarkdownBlock({ value, empty = "当前数据没有提供这部分内容。" }: { value?: string; empty?: string }) {
  if (!value?.trim()) return <p className="empty-copy">{empty}</p>;
  return <div className="rich-text" dangerouslySetInnerHTML={{ __html: renderMarkup(value) }} />;
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
  useEffect(() => setTab("core"), [detail?.id]);
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
  const percent = Math.round(fraction * 100);
  return (
    <div className="liquid-day" aria-label={`Day ${day}，完成 ${percent}%`}>
      <div className="day-outline">Day {day}</div>
      <div className="liquid-clip" style={{ height: `${Math.max(2, percent)}%` }}><div className="liquid-text">Day {day}</div><i /><b /></div>
    </div>
  );
}

function HomeView({
  catalog,
  progress,
  plan,
  current,
  goToday,
}: {
  catalog: Catalog;
  progress: AppProgress;
  plan: PlanDay[];
  current: PlanDay;
  goToday: () => void;
}) {
  const fraction = planDayFraction(progress, current);
  const counts = proficiencyCounts(progress);
  const dayState = progress.planDays[String(current.day)];
  const done = Boolean(dayState?.completedAt);
  const reviewed = dayState?.reviewedWordIds.length ?? 0;
  const rated = dayState?.ratedExposureKeys.length ?? 0;
  const target = current.kind === "study" ? current.appearanceCount : dayState?.reviewWordIds.length || Object.keys(progress.words).length;
  return (
    <div className="page home-page">
      <PageHeader eyebrow="CYWORD · ROOTED MEMORY" title="今天，从想起一个词开始" description="把词根当作线索，把熟练度交给你自己判断。" aside={<div className="home-date">{todayKey().replaceAll("-", " / ")}</div>} />
      <div className="home-stage">
        <section className="day-vessel">
          <LiquidDay day={current.day} fraction={fraction} />
          <div className="day-action">
            <span>{current.kind === "study" ? `第 ${current.studyDay} 个学习日` : "集中复习日"}</span>
            <h2>{done ? "今天已经完成" : current.kind === "study" ? "继续今天的词根学习" : "判断此前学过的单词"}</h2>
            <p>{done ? "进度已经保存，明天会进入下一计划日。" : `已完成 ${current.kind === "study" ? rated : reviewed} / ${target || 0}`}</p>
            <button onClick={goToday}>{done ? "查看今日记录" : current.kind === "study" ? "继续今日学习" : "进入复习判断"} <b>→</b></button>
          </div>
        </section>
        <aside className="home-summary">
          <div className="book-summary"><span>当前词书</span><h3>大学英语六级</h3><p><b>{Object.keys(progress.words).length}</b> / {catalog.stats.wordCount} 个唯一单词已学习</p><i><em style={{ width: `${Object.keys(progress.words).length / catalog.stats.wordCount * 100}%` }} /></i></div>
          <div className="mastery-summary">
            <span>熟练度分布</span>
            <div><i className="unmastered" /><b>{counts.unmastered}</b><small>未掌握</small></div>
            <div><i className="unclear" /><b>{counts.unclear}</b><small>不清楚</small></div>
            <div><i className="mastered" /><b>{counts.mastered}</b><small>已掌握</small></div>
          </div>
          <div className="next-review"><span>计划节奏</span><b>学习 3 天</b><i>→</i><b>集中复习 1 天</b><p>复习范围包含此前所有已学单词，默认跳过“已掌握”。</p></div>
        </aside>
      </div>
      <div className="home-plan-strip">
        {plan.slice(Math.max(0, current.day - 2), Math.min(plan.length, current.day + 4)).map((item) => <div className={`${item.day === current.day ? "active" : ""} ${item.kind}`} key={item.day}><span>DAY {item.day}</span><b>{item.kind === "study" ? `${item.appearanceCount} 词` : "复习日"}</b><i style={{ width: `${planDayFraction(progress, item) * 100}%` }} /></div>)}
      </div>
    </div>
  );
}

function PlanView({ plan, progress, current, openToday }: { plan: PlanDay[]; progress: AppProgress; current: PlanDay; openToday: () => void }) {
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
          return <button className={`${day.kind} ${isCurrent ? "current" : ""} ${finished ? "finished" : ""}`} key={day.day} disabled={!isCurrent} onClick={openToday}><span>{day.kind === "study" ? `学习 ${day.studyDay}` : "集中复习"}</span><b>Day {day.day}</b><p>{count}</p><div><i style={{ width: `${fraction * 100}%` }} /></div><small>{Math.round(fraction * 100)}%</small></button>;
        })}
      </div>
    </div>
  );
}

function StudyToday({
  catalog,
  progress,
  plan,
  detail,
  loadWord,
  saveProgress,
  onToggleBookmark,
}: {
  catalog: Catalog;
  progress: AppProgress;
  plan: PlanDay;
  detail: WordDetail | null;
  loadWord: (id: string) => void;
  saveProgress: (progress: AppProgress) => Promise<void>;
  onToggleBookmark: (wordId: string) => void;
}) {
  const groupsById = useMemo(() => new Map(catalog.groups.map((group) => [group.id, group])), [catalog]);
  const groups = plan.groupIds.map((id) => groupsById.get(id)).filter(Boolean) as StudyGroup[];
  const dayState = progress.planDays[String(plan.day)];
  const completedGroups = new Set(dayState?.completedGroupIds ?? []);
  const firstIncomplete = groups.find((group) => !completedGroups.has(group.id)) ?? groups[0];
  const [groupId, setGroupId] = useState(firstIncomplete?.id ?? "");
  const group = groupsById.get(groupId) ?? firstIncomplete;

  useEffect(() => {
    if (!group) return;
    const nextWord = group.wordIds.find((id) => !dayState?.ratedExposureKeys.includes(`${group.id}:${id}`)) ?? group.wordIds[0];
    if (nextWord) loadWord(nextWord);
  }, [group?.id]);

  const rate = async (level: Proficiency) => {
    if (!group || !detail || isPlanDayComplete(progress, plan.day)) return;
    const next = rateStudyWord(progress, plan, group, detail.id, level);
    await saveProgress(next);
    const nextDayState = next.planDays[String(plan.day)];
    const nextWord = group.wordIds.find((id) => !nextDayState.ratedExposureKeys.includes(`${group.id}:${id}`));
    if (nextWord) loadWord(nextWord);
    else {
      const nextGroup = groups.find((item) => !nextDayState.completedGroupIds.includes(item.id));
      if (nextGroup) setGroupId(nextGroup.id);
    }
  };

  return (
    <div className="page today-page">
      <PageHeader eyebrow={`DAY ${plan.day} · STUDY`} title={isPlanDayComplete(progress, plan.day) ? "今天的新词已经学完" : "按词根，一组一组学完"} description={`今日 ${plan.appearanceCount} 次学习曝光；每个单词学完后必须判断熟练度。`} aside={<div className="today-progress"><b>{dayState?.ratedExposureKeys.length ?? 0}</b><span>/ {plan.appearanceCount}</span></div>} />
      <div className="study-workbench">
        <aside className="group-lane"><header><span>今日词根</span><b>{completedGroups.size}/{groups.length}</b></header><div>{groups.map((item, index) => <button className={`${item.id === group?.id ? "active" : ""} ${completedGroups.has(item.id) ? "done" : ""}`} key={item.id} onClick={() => setGroupId(item.id)}><i>{String(index + 1).padStart(2, "0")}</i><span><b>{item.spelling}</b><small>{item.kind === "solo" ? "单词自成词根" : item.meaning}</small></span><em>{completedGroups.has(item.id) ? "✓" : item.wordCount}</em></button>)}</div></aside>
        <section className="group-focus">
          {group && <><header><span>{group.kind === "root" ? "ROOT FAMILY" : "SOLO ROOT"}</span><div><h2>{group.spelling}</h2><b>{group.wordCount} 个单词</b></div><p>{group.meaning}</p><details><summary>先记住这个词根</summary><MarkdownBlock value={group.memoryMethod} /></details></header><div className="word-strip">{group.wordIds.map((wordId) => { const rated = dayState?.ratedExposureKeys.includes(`${group.id}:${wordId}`); return <button className={`${detail?.id === wordId ? "active" : ""} ${rated ? "rated" : ""}`} key={wordId} onClick={() => loadWord(wordId)}><b>{catalog.words[wordId].spelling}</b><span>{catalog.words[wordId].pronunciation}</span><i>{rated ? "●" : ""}</i></button>; })}</div><footer>{group.wordIds.filter((id) => dayState?.ratedExposureKeys.includes(`${group.id}:${id}`)).length} / {group.wordCount} 已判断</footer></>}
        </section>
        <WordDetailPanel detail={detail} compact bookmarked={Boolean(detail && progress.bookmarks[detail.id])} onToggleBookmark={() => detail && onToggleBookmark(detail.id)} footer={detail && !isPlanDayComplete(progress, plan.day) ? <ProficiencyPicker value={progress.words[detail.id]?.proficiency} onChange={rate} /> : undefined} />
      </div>
    </div>
  );
}

function ReviewToday({
  catalog,
  progress,
  plan,
  detail,
  loadWord,
  saveProgress,
  onToggleBookmark,
}: {
  catalog: Catalog;
  progress: AppProgress;
  plan: PlanDay;
  detail: WordDetail | null;
  loadWord: (id: string) => void;
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

  useEffect(() => {
    setRevealed(false);
    if (currentId) loadWord(currentId);
  }, [currentId]);

  const start = async () => saveProgress(startReviewDay(progress, plan.day, candidates, skipMastered));
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
  return <div className="page review-session"><PageHeader eyebrow={`DAY ${plan.day} · REVIEW`} title="先回想，再点击查看详情" description={`本轮剩余 ${queue.length} 个单词；同一个单词只出现一次。`} aside={<div className="today-progress"><b>{day.reviewedWordIds.length}</b><span>/ {day.reviewWordIds.length}</span></div>} /><div className={`judgment-card ${revealed ? "revealed" : ""}`}>{!revealed && word ? <button className="judgment-front" onClick={() => setRevealed(true)}><span>点击屏幕查看详细情况</span><h2>{word.spelling}</h2><p>{word.pronunciation}</p><i>CLICK TO REVEAL</i></button> : <WordDetailPanel detail={detail} bookmarked={Boolean(detail && progress.bookmarks[detail.id])} onToggleBookmark={() => detail && onToggleBookmark(detail.id)} footer={<ProficiencyPicker value={currentId ? progress.words[currentId]?.proficiency : undefined} onChange={rate} title="重新判断这个单词的熟练度" />} />}</div></div>;
}

function VocabularyView({ catalog, progress, detail, loadWord, onToggleBookmark }: { catalog: Catalog; progress: AppProgress; detail: WordDetail | null; loadWord: (id: string) => void; onToggleBookmark: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const ids = useMemo(() => Object.entries(progress.bookmarks).sort((a, b) => b[1].localeCompare(a[1])).map(([id]) => id).filter((id) => { const term = query.trim().toLowerCase(); const word = catalog.words[id]; return !term || word.spelling.toLowerCase().includes(term) || word.definitionCn.includes(term); }), [catalog, progress.bookmarks, query]);
  useEffect(() => { if (ids[0] && !ids.includes(detail?.id ?? "")) loadWord(ids[0]); }, [ids[0]]);
  return <div className="page vocabulary-page"><PageHeader eyebrow="VOCABULARY BOOK" title="生词本" description="学习或复习时随手收藏，集中查看仍需要额外注意的单词。" aside={<label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索生词" /></label>} />{ids.length ? <div className="vocabulary-layout"><aside>{ids.map((id) => <button className={detail?.id === id ? "active" : ""} key={id} onClick={() => loadWord(id)}><b>{catalog.words[id].spelling}</b><span>{catalog.words[id].pronunciation}</span><small>{catalog.words[id].definitionCn}</small><i className={progress.words[id]?.proficiency}>{progress.words[id] ? proficiencyCopy[progress.words[id].proficiency].label : "未学习"}</i></button>)}</aside><WordDetailPanel detail={detail} bookmarked={Boolean(detail && progress.bookmarks[detail.id])} onToggleBookmark={() => detail && onToggleBookmark(detail.id)} /></div> : <div className="vocabulary-empty"><span>◇</span><h2>生词本还是空的</h2><p>在单词详情中点击“加入生词本”，它会出现在这里。</p></div>}</div>;
}

function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [progress, setProgress] = useState<AppProgress | null>(null);
  const [view, setView] = useState<ViewName>("home");
  const [detail, setDetail] = useState<WordDetail | null>(null);
  const [loadingWord, setLoadingWord] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    document.querySelector(".app-shell > main")?.scrollTo({ top: 0, behavior: "auto" });
  }, [view]);

  useEffect(() => {
    Promise.all([window.cyword.readCatalog(), window.cyword.readProgress()]).then(async ([nextCatalog, rawProgress]) => {
      const nextProgress = normalizeProgress(rawProgress);
      setCatalog(nextCatalog);
      setProgress(nextProgress);
      if ((rawProgress as { version?: number } | null)?.version !== 2) await window.cyword.writeProgress(nextProgress);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const loadWord = async (id: string) => {
    if (detail?.id === id || loadingWord === id) return;
    setLoadingWord(id);
    try { setDetail(await window.cyword.readWord(id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoadingWord(""); }
  };

  const saveProgress = async (next: AppProgress) => {
    setProgress(next);
    try { await window.cyword.writeProgress(next); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  if (error) return <div className="fatal-error"><span>CYWORD</span><h1>应用未能读取本地数据</h1><p>{error}</p></div>;
  if (!catalog || !progress) return <div className="loading-screen"><div>Cy</div><p>正在铺开今天的词书计划…</p></div>;

  const plan = buildPlan(catalog);
  const currentDayNumber = currentPlanDayNumber(progress, plan.length);
  const current = plan[currentDayNumber - 1];
  const toggleWordBookmark = (wordId: string) => saveProgress(toggleBookmark(progress, wordId));
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><div>Cy</div><span><b>词根记忆</b><small>Rooted recall</small></span></div><nav>{navItems.map((item) => <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => setView(item.id)}><i>{item.glyph}</i><b>{item.label}</b>{item.id === "vocabulary" && Object.keys(progress.bookmarks).length > 0 && <em>{Object.keys(progress.bookmarks).length}</em>}</button>)}</nav><footer><span>大学英语六级</span><p>Day {current.day} / {plan.length}</p><i><b style={{ width: `${(current.day - 1 + planDayFraction(progress, current)) / plan.length * 100}%` }} /></i><small>数据与进度保存在本机</small></footer></aside><main>{view === "home" && <HomeView catalog={catalog} progress={progress} plan={plan} current={current} goToday={() => setView("today")} />}{view === "plan" && <PlanView plan={plan} progress={progress} current={current} openToday={() => setView("today")} />}{view === "today" && (current.kind === "study" ? <StudyToday catalog={catalog} progress={progress} plan={current} detail={detail} loadWord={loadWord} saveProgress={saveProgress} onToggleBookmark={toggleWordBookmark} /> : <ReviewToday catalog={catalog} progress={progress} plan={current} detail={detail} loadWord={loadWord} saveProgress={saveProgress} onToggleBookmark={toggleWordBookmark} />)}{view === "vocabulary" && <VocabularyView catalog={catalog} progress={progress} detail={detail} loadWord={loadWord} onToggleBookmark={toggleWordBookmark} />}</main>{loadingWord && <div className="word-loading">正在展开 {catalog.words[loadingWord]?.spelling}…</div>}</div>;
}

export default App;
