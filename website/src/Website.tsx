import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { fetchLatestRelease, release, type ReleaseInfo } from "./release";
import { PronunciationPlayer } from "../../src/audio";
import { PronunciationSpelling, useSpellingSegmentation } from "../../src/components/PronunciationMemory";
import type { PronunciationGuide } from "../../src/types";

function Icon({ name, className = "" }: { name: string; className?: string }) {
  const shapes: Record<string, ReactNode> = {
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
    windows: <><path d="m3 5 8-1v7H3zm10-1 8-1v8h-8zM3 13h8v7l-8-1zm10 0h8v8l-8-1z" /></>,
    phone: <><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M10 18h4" /></>,
    book: <><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1zm0 0v15" /></>,
    branch: <><path d="M12 4v5m-7 7v-4h14v4M12 9v7" /><circle cx="12" cy="3" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="12" cy="19" r="2" /><circle cx="19" cy="19" r="2" /></>,
    bookmark: <path d="M6 3h12v18l-6-4-6 4z" />,
    check: <path d="m5 12 4 4L19 6" />,
    shield: <><path d="m12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6z" /><path d="m8 12 3 3 5-6" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    repeat: <><path d="M4 9a8 8 0 0 1 14-3l2 3M20 3v6h-6M20 15a8 8 0 0 1-14 3l-2-3M4 21v-6h6" /></>,
    monitor: <><rect x="3" y="3" width="18" height="13" rx="2" /><path d="M12 16v5m-5 0h10" /></>,
    chevron: <path d="m8 5 7 7-7 7" />,
    volume: <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></>,
    play: <polygon points="6 4 18 12 6 20 6 4" fill="currentColor" stroke="none" />,
    pause: <><rect x="6" y="4" width="3.5" height="16" fill="currentColor" stroke="none" /><rect x="14.5" y="4" width="3.5" height="16" fill="currentColor" stroke="none" /></>,
  };
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>;
}

function Brand({ footer = false }: { footer?: boolean }) {
  return <a className={`brand-link ${footer ? "brand-footer" : ""}`} href="#top" aria-label="CYword 官网首页"><span className="brand-name">CYword</span></a>;
}

const demoWords = [
  { word: "portable", type: "adj.", parts: [{ text: "port", meaning: "携带", root: true }, { text: "able", meaning: "能够…的", root: false }], definition: "轻便的；便携的", pronunciation: "/ˈpɔːtəbl/", memory: "把 por 联想成「婆婆」，table 想成桌子。连婆婆都能轻松扛着走的桌子，一定很轻便。", example: "This portable table is easy to carry.", translation: "这张便携桌很容易携带。", connection: "携带 ＋ 能够…的" },
  { word: "transport", type: "n.", parts: [{ text: "trans", meaning: "跨越", root: false }, { text: "port", meaning: "搬运", root: true }], definition: "运输；运送", pronunciation: "/ˈtrænspɔːt/", memory: "把 trans 联想成「传送」。一车货物跨过山河，被搬运到另一处，就有了「运输」。", example: "Rail transport connects these two cities.", translation: "铁路运输把这两座城市连接起来。", connection: "跨越 ＋ 搬运" },
  { word: "porter", type: "n.", parts: [{ text: "port", meaning: "搬运", root: true }, { text: "er", meaning: "做事的人", root: false }], definition: "搬运工；门卫", pronunciation: "/ˈpɔːtə(r)/", memory: "想想车站里替你搬行李的人。port 是搬运，-er 表示做事的人，连起来就是「搬运工」。", example: "The porter carried our bags to the train.", translation: "搬运工把我们的行李送到了火车旁。", connection: "搬运 ＋ 做事的人" },
];
const levels = ["未掌握", "不清楚", "已掌握"];

const immersivePortable = {
  word: "portable",
  group: "port 词根家族",
  bookName: "大学英语六级",
  pronunciation: "/ˈpɔːtəbl/",
  pronunciationGuide: {
    pronunciation: "/ˈpɔːtəbl/",
    chunks: [{ text: "por", ipa: "pɔː", stress: "primary" }, { text: "ta", ipa: "tə", stress: "none" }, { text: "ble", ipa: "bl", stress: "none" }],
    notes: [],
  } satisfies PronunciationGuide,
  audioUrl: "https://cdn.aimwords.com/audio/1c2ef59fe4c50c37771b9fdac52db1e6edf47bea24ab80d495625d680fb8db87.mp3",
  definition: "adj. 轻便的，便携的；手提的",
  memoryMethod: "把 por 联想成「婆婆」，table 想成桌子。连婆婆都能轻松扛着走的桌子，一定很轻便。",
  roots: [
    {
      type: "root",
      typeLabel: "词根 · 01",
      spelling: "port",
      meaning: "运、运输、携带、搬运",
      memoryMethod: "把 port 联想成「坡」。一辆装满货物的小车，正往坡上运。记住这个画面，再带出「搬运、携带」的含义。",
    },
    {
      type: "suffix",
      typeLabel: "后缀 · 02",
      spelling: "-able",
      meaning: "形容词后缀，能…的",
      memoryMethod: "熟词 able（能够），作为后缀表示“有能力…的、可以…的”。",
    },
  ],
  equation: [
    { text: "port", meaning: "运、运输", root: true },
    { text: "-able", meaning: "能…的", root: false },
  ],
  etymologyAnalysis: "能够轻松运送移动的 → adj.轻便的，便携的；手提的",
  example: {
    sentence: "As remote learning becomes more common, portable devices have become essential tools for students.",
    translation: "随着远程学习变得越来越普遍，便携式设备已成为学生的必备工具。",
    note: "portable 在这里指“便携的”，描述这些设备可以随身携带、随时使用的特点。",
  },
  examExample: {
    source: "2016年12月六级真题(第3套) · 仔细阅读",
    sentence: "Those simultaneous challenges appear less overwhelming with increasingly better answers to a centuries-old question: how to make power portable.",
    translation: "那些同时出现的挑战似乎不那么令人难以招架了，因为一个古老的问题有了越来越好的答案：如何让电力变得便携。",
    note: "在句中作宾语补足语，修饰 power，与 make 构成“make + 宾语 + 形容词”结构，表示“使电力变得便携”。",
  },
  longSentence: {
    sentence: "Public economic institutions, which have long relied on fixed infrastructure to deliver services in remote regions, are now adopting portable digital terminals that can be transported by a single officer, because this shift significantly reduces operational costs while maintaining service quality, a balance that was previously difficult to achieve.",
    translation: "长期以来依赖固定基础设施在偏远地区提供服务的公共经济机构，如今正在采用可由一名官员携带的便携式数字终端，因为这一转变在保持服务质量的同时大幅降低了运营成本，而这种平衡以前很难实现。",
    segments: [
      { role: "主语", text: "Public economic institutions", gloss: "公共经济机构" },
      { role: "定语从句", text: ", which have long relied on fixed infrastructure to deliver services in remote regions,", gloss: "长期依赖固定基础设施在偏远地区提供服务" },
      { role: "谓语", text: "are now adopting", gloss: "如今正在采用" },
      { role: "宾语", text: "portable digital terminals", gloss: "便携式数字终端" },
      { role: "定语从句", text: "that can be transported by a single officer,", gloss: "可由一名官员携带" },
      { role: "原因状语", text: "because this shift significantly reduces operational costs while maintaining service quality,", gloss: "因为这一转变在保持服务质量的同时大幅降低了运营成本" },
      { role: "同位语", text: "a balance that was previously difficult to achieve.", gloss: "而这种平衡以前很难实现" },
    ],
    analyses: [
      {
        dimension: "目标词",
        text: "portable 最常见的意思是「便携的」，句中通过从句 that can be transported by a single officer 钉死了具体标准：轻到一人就能带着去偏远地区。对比前文 fixed infrastructure，强化了轻巧随人移动的产品特性。",
      },
      {
        dimension: "成分归属",
        text: "while maintaining service quality 紧跟在 reduces operational costs 后面，说明降低成本的同时保持了服务质量，是 this shift 带来的双重优势。",
      },
      {
        dimension: "指代",
        text: "this shift（这一转变）指从长期依赖固定设施到采用便携终端的整体战略转变。",
      },
    ],
  },
};

function WebAudioButton({ url, pronunciation, player }: { url: string; pronunciation: string; player: PronunciationPlayer }) {
  const playback = useSyncExternalStore(player.subscribe, player.snapshot);
  const playing = playback.url === url && (playback.status === "loading" || playback.status === "playing");
  const failed = playback.url === url && playback.status === "error";
  useEffect(() => () => player.stop(), [player, url]);
  const play = () => {
    if (playing) player.stop();
    else void player.play(url);
  };
  return <button className={`study-audio-btn ${playing ? "playing" : ""}`} onClick={play}
    aria-label={failed ? "发音加载失败，点击重试" : playing ? "停止发音" : "播放发音"}>
    <strong>{pronunciation}</strong><Icon name="volume" /><span className="audio-label">{failed ? "重试发音" : playing ? "停止发音" : "播放发音"}</span>
    <span className={`audio-wave ${playing ? "active" : ""}`} aria-hidden="true"><i /><i /><i /></span>
  </button>;
}

function WordDemo() {
  const [activeRating, setActiveRating] = useState<number | null>(null);
  const [activeLane, setActiveLane] = useState<"word" | "morpheme" | "sentence">("word");
  const [hoveredRole, setHoveredRole] = useState<string | null>(null);
  const [sentenceExpanded, setSentenceExpanded] = useState(false);
  const [statusMsg, setStatusMsg] = useState("交互示例 · 评级只在本页展示，刷新后重置，不保存学习记录。");
  const word = immersivePortable;
  const [player] = useState(() => new PronunciationPlayer());
  const segmentation = useSpellingSegmentation(word.word, word.audioUrl, player);

  const handleRate = (idx: number) => {
    setActiveRating(idx);
    setStatusMsg(`示例评级：${levels[idx]}。此操作不保存学习记录。`);
  };


  return (
    <div className="hero-demo" id="experience">
      <div className="demo-caption">
        <span><i /> 学习界面交互示例 · 不保存记录</span>
        <span>词根巧记 ＋ 真题例句 ＋ 长难句拆解 <span aria-hidden="true">↘</span></span>
      </div>

      <div className="immersive-window">
        {/* 顶部标题栏与窗口控制 */}
        <div className="immersive-topbar">
          <div className="topbar-brand">
            <span className="brand-dot" />
            <span className="brand-text">CYword</span>
            <span className="topbar-book">大学英语六级</span>
            <span className="topbar-group">port 单词示例</span>
          </div>

        </div>

        {/* 移动端/窄屏下的栏目切换器 */}
        <div className="immersive-mobile-tabs" role="group" aria-label="示例栏目切换">
          <button
            aria-pressed={activeLane === "word"}
            className={activeLane === "word" ? "active" : ""}
            onClick={() => setActiveLane("word")}
          >
            单词
          </button>
          <button
            aria-pressed={activeLane === "morpheme"}
            className={activeLane === "morpheme" ? "active" : ""}
            onClick={() => setActiveLane("morpheme")}
          >
            词根
          </button>
          <button
            aria-pressed={activeLane === "sentence"}
            className={activeLane === "sentence" ? "active" : ""}
            onClick={() => setActiveLane("sentence")}
          >
            长难句
          </button>
        </div>

        {/* 真实三栏并排独立滑动网格 */}
        <div className={`study-session-grid show-${activeLane} ${sentenceExpanded ? "sentences-open" : "sentences-collapsed"}`}>
          {/* 左栏：词根词缀（独立分开滑动） */}
          <aside className="study-morpheme-column">
            <header className="study-column-header">
              <span className="column-tag">MORPHEME NOTES</span>
              <h3>词根词缀</h3>
              <p>词根优先 · 独立滑动浏览</p>
            </header>
            <div className="study-column-scroll">
              {word.roots.map((part) => (
                <section className={`study-part-card ${part.type}`} key={part.spelling}>
                  <header>
                    <span className="part-label">{part.typeLabel}</span>
                    <b className="part-spelling">{part.spelling}</b>
                  </header>
                  <p className="part-meaning">{part.meaning}</p>
                  <div className="part-mnemonic">
                    <span className="section-micro">音形巧记</span>
                    <p>{part.memoryMethod}</p>
                  </div>
                </section>
              ))}
            </div>
          </aside>

          {/* 中栏：单词主体（独立分开滑动） */}
          <div className="study-word-column">
            <div className="study-center-scroll">
              {/* 单词 Hero */}
              <header className="study-word-hero">
                <div className="study-hero-main">
                  <span className="hero-group-label">{word.group}</span>
                  <h2 className="study-word-title"><PronunciationSpelling word={word.word} guide={word.pronunciationGuide} {...segmentation} /></h2>
                  <div className="study-phonetic-row">
                    <WebAudioButton url={word.audioUrl} pronunciation={word.pronunciation} player={player} />
                  </div>
                </div>
                <div className="study-hero-side">
                  <p className="study-definition">{word.definition}</p>
                  <p className="study-mastery-state" aria-live="polite">{activeRating === null ? "试着选择一个熟练度" : `示例评级：${levels[activeRating]} · 不保存`}</p>
                </div>
              </header>

              {/* 巧记思路 */}
              <section className="session-section memory-section">
                <header>
                  <span className="section-tag">MEMORY METHOD</span>
                  <h4>单词巧记</h4>
                </header>
                <div className="mnemonic-box">
                  <p>{word.memoryMethod}</p>
                </div>
              </section>

              {/* 词根词缀构词分析 */}
              <section className="session-section etymology-section">
                <header>
                  <span className="section-tag">WORD BUILDING</span>
                  <h4>词根词缀分析</h4>
                </header>
                <div className="study-word-equation">
                  {word.equation.map((piece, i) => (
                    <span className="study-word-equation-piece" key={piece.text}>
                      {i > 0 && <i className="equation-plus">＋</i>}
                      <span className={`equation-chip ${piece.root ? "is-root" : ""}`}>
                        <b>{piece.text}</b>
                        <small>{piece.meaning}</small>
                      </span>
                    </span>
                  ))}
                  <span className="equation-result">
                    <Icon name="arrow" />
                    <span>{word.definition.split("；")[0]}</span>
                  </span>
                </div>
                <p className="etymology-desc">{word.etymologyAnalysis}</p>
              </section>

              {/* 常用例句 */}
              <section className="session-section sentence-section">
                <header>
                  <span className="section-tag">COMMON EXAMPLE</span>
                  <h4>常用例句</h4>
                </header>
                <div className="spotlight-card">
                  <p className="en-sentence">{word.example.sentence}</p>
                  <p className="cn-sentence">{word.example.translation}</p>
                  <small className="sentence-hint">{word.example.note}</small>
                </div>
              </section>

              {/* 六级真题例句 */}
              <section className="session-section exam-section">
                <header>
                  <span className="section-tag">EXAM REALITY</span>
                  <h4>六级真题例句</h4>
                </header>
                <div className="spotlight-card exam-card">
                  <span className="exam-source">{word.examExample.source}</span>
                  <p className="en-sentence">{word.examExample.sentence}</p>
                  <p className="cn-sentence">{word.examExample.translation}</p>
                  <small className="sentence-hint">{word.examExample.note}</small>
                </div>
              </section>
            </div>

            {/* 底部悬浮打分与操作栏 */}
            <footer className="study-session-controls">
              <div className="session-rating">
                {levels.map((lvl, idx) => (
                  <button
                    key={lvl}
                    className={`rate-btn rate-${idx} ${activeRating === idx ? "active" : ""}`}
                    onClick={() => handleRate(idx)}
                    aria-pressed={activeRating === idx}
                  >
                    <b>{lvl}</b>
                    {activeRating === idx && <Icon name="check" />}
                  </button>
                ))}
              </div>
              <div className="session-navigation">
                <span>单词示例 1 / 1</span>
                <button onClick={() => { setActiveRating(null); setStatusMsg("示例已重置 · 不保存学习记录。"); }}>重置示例</button>
              </div>
            </footer>
          </div>

          {/* 右栏：长难句精读（独立分开滑动） */}
          <aside className="study-sentence-column">
            <button className="sentence-toggle" aria-expanded={sentenceExpanded} aria-controls="demo-long-sentence" aria-label={sentenceExpanded ? "收起长难句" : "展开长难句"} onClick={() => setSentenceExpanded(open => !open)}><span aria-hidden="true">‹</span><b>长难句</b></button>
            <div className="study-sentence-content" id="demo-long-sentence" inert={!sentenceExpanded && activeLane !== "sentence"}>
            <header className="study-column-header">
              <span className="column-tag">LONG SENTENCE</span>
              <h3>长难句</h3>
              <p>第 1 句，共 1 句</p>
            </header>
            <div className="long-sentence-scroll">
              <article className="long-sentence-article">
                <p className="long-sentence-copy">{word.longSentence.sentence}</p>
                <p className="long-sentence-translation">{word.longSentence.translation}</p>

                <div className="sentence-subblock">
                  <h5>结构拆分</h5>
                  <div className="segment-list">
                    {word.longSentence.segments.map((seg, i) => (
                      <div
                        className={`session-segment role-${seg.role} ${hoveredRole === seg.role ? "glow-active" : ""}`}
                        key={i}
                        onMouseEnter={() => setHoveredRole(seg.role)}
                        onMouseLeave={() => setHoveredRole(null)}
                      >
                        <span className="role-badge">{seg.role}</span>
                        <div className="segment-content">
                          <b className="seg-text">{seg.text}</b>
                          <small className="seg-gloss">{seg.gloss}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="sentence-subblock">
                  <h5>难点分析</h5>
                  <div className="analysis-list">
                    {word.longSentence.analyses.map((ana, i) => (
                      <div
                        className={`session-analysis ${hoveredRole && ana.dimension.includes(hoveredRole) ? "glow-active" : ""}`}
                        key={i}
                      >
                        <span className="analysis-dim">{ana.dimension}</span>
                        <p>{ana.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            </div>

            </div>
          </aside>
        </div>

        {/* 视窗底状态栏 */}
        <div className="immersive-statusbar">
          <span className="status-msg" role="status">{statusMsg}</span>
          <span className="status-tip">鼠标滚轮置于各栏即可独立上下滑动</span>
        </div>
      </div>
      <p className="demo-footnote">本页仅演示 portable 的阅读、发音与评级操作；完整学习计划请在客户端使用。</p>
    </div>
  );
}

function MnemonicMethod() {
  return <section className="method-section section-wrap" id="method" aria-labelledby="method-title">
    <div className="section-heading method-heading"><div><span className="eyebrow">FROM A GOOD IDEA TO EVERY WORD</span><h2 id="method-title">课上听懂的好方法，<br />这次，真的能用起来。</h2></div><p>老师举几个例子，巧记和词根就很好理解。<br />轮到自己背一整本词书，还要逐词找词根、想联想、安排复习。<br /><strong>这些准备工作，CYword 已经替你做好。</strong></p></div>

    <div className="method-chapter" id="mnemonics"><header className="chapter-heading"><span className="chapter-number">01</span><div><span className="eyebrow">先有巧记，单词才好记</span><h3>每个词，都带着记忆思路。</h3></div><p>5,166 个六级单词，逐词准备巧记。<br />词根词缀也配有含义和助记线索，跟着看就能开始。</p></header>
      <div className="mnemonic-notes"><article className="word-story"><span className="note-label">单词巧记 · 先在脑海里放一幅画</span><h4>portable <small>轻便的；便携的</small></h4><div className="story-equation" aria-label="把 por 联想成婆婆，table 联想成桌子"><span><b>por</b><small>联想「婆婆」</small></span><i>＋</i><span><b>table</b><small>想到「桌子」</small></span></div><p>想象一位婆婆，<br /><strong>扛着桌子，轻轻松松走过街头。</strong><br />连她都能带着走的桌子，该有多轻便！</p><p className="story-footnote">这是帮助记忆的谐音与画面联想。真正构词是下面的 port ＋ -able。</p></article>
        <div className="morpheme-stories"><article><span className="note-label">词根的含义，也给你一条线索</span><h4>port <small>搬运；携带</small></h4><p>把 port 联想成「坡」。一辆装满货物的小车，正往坡上运。记住这个画面，再带出「搬运、携带」的含义。</p></article><article><span className="note-label">前缀同样可以跟着联想</span><h4>trans- <small>跨越；转移</small></h4><p>联想「传送」。从一处传送到另一处，途中跨过山河，就有了「跨越、转移」的线索。</p></article></div>
      </div><p className="method-source-note">以上巧记根据内置词书节选整理，页面只展示与这组单词有关的部分含义。</p>
    </div>

    <div className="method-chapter family-chapter"><header className="chapter-heading"><span className="chapter-number">02</span><div><span className="eyebrow">再拆开理解，顺着词根串起来</span><h3>记住一个线索，带着学一串词。</h3></div><p>刚记过的词根，会在同组单词里再次遇见。<br />拆词、释义和分组都已整理好，省下自己查找归纳的时间。</p></header>
      <div className="root-family-diagram" aria-label="port 词根连接 portable 便携的、transport 运输、porter 搬运工"><div className="root-origin"><span className="micro">一个词根</span><b>port</b><span>搬运 · 携带</span></div><div className="root-branches">{demoWords.map((word) => <div className="root-branch" key={word.word}><span>{word.connection}</span><strong>{word.parts.map((part) => part.root ? <em key={part.text}>{part.text}</em> : <span key={part.text}>{part.text}</span>)}</strong><small>{word.definition.split("；")[0]}</small></div>)}</div><span className="family-annotation">同一家的单词，安排在同一天。</span></div>
      <div className="family-explanation"><p>巧记帮你找到记忆入口，构词帮你理解单词之间的联系。边理解、边成组学习，每次遇到新词都有前面的线索可以接着用。</p><span>有词根的按根成组；没有独立词根的单词，单独安排。</span></div>
    </div>
  </section>;
}

function ProficiencyDemo() {
  const [ratings, setRatings] = useState<Record<string, number>>({ portable: 1, transport: 0, porter: 2 });
  const [skipMastered, setSkipMastered] = useState(true);
  const queue = demoWords.filter((word) => !skipMastered || ratings[word.word] !== 2);
  return <div className="proficiency-preview"><div className="proficiency-explanation"><p>这一遍学完了，<br /><strong>你对它还有多大把握？</strong></p><dl>{levels.map((level, index) => <div key={level}><dt><span className={`level-dot level-${index}`} />{level}</dt><dd>{["还想不起来，需要重点再看。", "有印象，但含义还拿不准。", "能很快想起来，本轮可以先跳过。"][index]}</dd></div>)}</dl><p className="proficiency-note">“词汇掌握”展示整本词书的掌握分布。已学过且标为“未掌握”“不清楚”的词自动收录，改为“已掌握”后自动移出，无需手动收藏。</p></div>
    <div className="review-simulator"><div className="review-simulator-header"><span className="micro">复习方式 · 试着改一改</span><span>3 个已学示例词</span></div><div className="review-word-settings">{demoWords.map((word) => <label key={word.word}><span>{word.word}</span><select aria-label={`${word.word} 的演示熟练度`} value={ratings[word.word]} onChange={(event) => setRatings({ ...ratings, [word.word]: Number(event.target.value) })}>{levels.map((level, index) => <option key={level} value={index}>{level}</option>)}</select></label>)}</div><label className="skip-mastered-option"><input type="checkbox" checked={skipMastered} onChange={(event) => setSkipMastered(event.target.checked)} /><span>本轮跳过「已掌握」</span><small>软件默认选项</small></label><div className="review-result" role="status" aria-live="polite" aria-atomic="true"><div><span>本轮要复习</span><strong>{queue.length}<small> 词</small></strong></div>{queue.length ? <ul>{queue.map((word) => <li key={word.word}>{word.word}</li>)}</ul> : <p>这三个示例词都已掌握，本轮没有待复习的词。</p>}<span>累计已学单词先去重，再按你的选项决定本轮复习内容。</span></div><p className="simulator-footnote">仅为官网演示，修改不会影响软件中的学习进度。</p></div>
  </div>;
}

const dayDescriptions = [
  { title: "从一组词根，开始今天", body: "按当天计划逐组学习。同一词根下的单词会安排在同一天，把联系一起记住。", type: "学习日" },
  { title: "继续学习，新词也有线索", body: "跟着巧记建立联想，拆开构词理解含义，再结合例句看用法。为每个单词标记当前熟练度。", type: "学习日" },
  { title: "完成这一轮新词学习", body: "继续完成当天的词根组。标为“未掌握”“不清楚”的词会自动进入“词汇掌握”，方便集中巩固。", type: "学习日" },
  { title: "回头看看，哪些真的记住了", body: "累计复习此前学过的单词。同一个词只出现一次，默认跳过已掌握的词，把时间留给还不熟悉的部分。", type: "复习日" },
];

function Rhythm() {
  const [activeDay, setActiveDay] = useState(3);
  return <section className="rhythm-section" id="plan" aria-labelledby="plan-title"><div className="section-wrap"><header className="chapter-heading review-chapter-heading"><span className="chapter-number">03</span><div><span className="eyebrow">分清熟练度，把复习接上</span><h2 id="plan-title">记得多牢，复习就有轻重。</h2></div><p>每个词标记当前熟练度，复习时重新判断。<br />默认跳过已掌握的词，把时间留给还不熟的部分。</p></header><ProficiencyDemo /><div className="rhythm-layout">
    <div className="rhythm-copy"><span className="eyebrow">复习也已经排进日程</span><h3>向前学三天，<br />回头巩固一天。</h3><p>前三天按词根组学习新词，第四天累计复习。<br />从怎么记，到什么时候再看，都有现成的安排。</p><div className="plan-total"><b>30 <span>天学习</span></b><i>＋</i><b>10 <span>天复习</span></b><span className="total-tag">一轮 40 天</span></div><p className="plan-note">40 天是计划安排，实际进度取决于你的学习完成情况。</p></div>
    <div className="rhythm-preview"><div className="rhythm-label"><span>你的第一个学习循环</span><span>点击查看每日安排</span></div><div className="day-tabs" role="tablist" aria-label="学习复习循环">
      {dayDescriptions.map((day, i) => <button role="tab" aria-selected={activeDay === i} aria-controls="day-panel" id={`day-tab-${i}`} tabIndex={activeDay === i ? 0 : -1} className={`${i === 3 ? "review-day" : ""} ${activeDay === i ? "active" : ""}`} key={day.title} onClick={() => setActiveDay(i)} onKeyDown={(event) => {const next = event.key === "ArrowRight" ? (i + 1) % 4 : event.key === "ArrowLeft" ? (i + 3) % 4 : event.key === "Home" ? 0 : event.key === "End" ? 3 : null; if (next !== null) { event.preventDefault(); setActiveDay(next); document.getElementById(`day-tab-${next}`)?.focus(); } }}><span>DAY</span><b>{i + 1}</b><small>{day.type}</small>{i === 3 && <Icon name="repeat" />}</button>)}
    </div><div className="day-detail" id="day-panel" role="tabpanel" tabIndex={0} aria-labelledby={`day-tab-${activeDay}`}><span className={activeDay === 3 ? "review-label" : "study-label"}>{dayDescriptions[activeDay].type}</span><h3>{dayDescriptions[activeDay].title}</h3><p>{dayDescriptions[activeDay].body}</p></div><div className="cycle-tail"><span /><Icon name="repeat" /><p>然后，带着记住的继续下一轮。</p><span /></div></div>
  </div></div></section>;
}

const faqs = [
  { question: "每天的学习量大概是多少？", answer: "当前六级计划每个学习日安排约 180 次单词学习，具体以客户端当日计划为准。同一个词涉及多个词根时，会在相关组里再次出现；复习时按单词去重。这是计划安排的学习量，实际耗时和记忆效果会受词汇基础、专注程度与后续复习影响。" },
  { question: "巧记里的联想，就是单词的真正构词吗？", answer: "两者会分开展示。谐音、熟词和画面联想用来帮助记忆，构词分析则说明词根词缀的联系。有真正词根的单词按词根成组，没有独立词根的词会单独安排，跟着逐词巧记学习。" },
  { question: "需要注册账号，或者付费吗？", answer: "使用邮箱验证码登录后即可学习，目前没有内置付费步骤。请使用你自己的邮箱接收验证码。" },
  { question: "断网也能背单词吗？", answer: "Windows 和安卓安装包已包含完整词书、全部发音及配图。首次联网登录后即可离线学习、搜索和播放发音，无需再下载资源。重新登录与更新检查需要网络。" },
  { question: "支持手机、Mac，或者其他词书吗？", answer: "本页提供 Windows 10 / 11 桌面版与 Android 7.0 及以上安卓安装包，使用相同的记忆和词汇掌握规则。当前支持含 5,166 个唯一单词的六级词书，尚无 Mac 版、四级或考研词书。" },
  { question: "安装时出现 Windows 安全提示怎么办？", answer: "当前安装包尚未进行代码签名，Windows 可能提示无法识别发布者。这不等于已经确认软件安全。请先确认文件来自本页的官方发布地址、文件名和版本一致；不确定来源时不要运行，也无需关闭系统安全防护。下载区提供文件校验值，供需要时核对。" },
  { question: "词汇掌握页面会收录哪些词？", answer: "安卓端和电脑端按同一规则展示全书掌握统计：已掌握、未掌握、不清楚和未学习。待巩固列表只收录已学过且评级为“未掌握”或“不清楚”的词；改为“已掌握”后自动移出，学习记录仍然保留。尚未学习、未评级的词不会混入列表。" },
  { question: "学习进度会保存吗？更新后还在吗？", answer: "学习记录和熟练度自动保存在当前设备，正常覆盖升级会保留。新版在每台设备按账号导入旧云端记录一次，此后不再自动跨设备同步。卸载或清理应用数据前，请先备份本机数据。" },
  { question: "下载没有开始，或者下载速度很慢？", answer: "主下载由本站通过 Cloudflare R2 提供，无需访问 GitHub，支持断点续传。跨境线路仍可能较慢，部分地区也可能无法连接。请先查看浏览器下载列表，尝试继续下载或稍后重试；也可以复制本站下载地址重试，并核对下载区的 SHA-256。" },
];

function InstallGuide() {
  return <section className="guide-section section-wrap" id="guide" aria-labelledby="guide-title">
    <div className="section-heading"><div><span className="eyebrow">START WITH CYWORD</span><h2 id="guide-title">装好，登录，开始今天。</h2></div><p>完整词书、发音和配图已随安装包提供，邮箱验证码登录后即可离线学习。<br />进度保存在当前设备，旧云端记录只导入一次。</p></div>
    <div className="platform-guide">
      <article id="guide-windows"><h3><Icon name="windows" />Windows 10 / 11 · 64 位</h3><ol>
        <li>下载 Windows 安装包，核对文件名、版本和下载区校验值。</li>
        <li>打开 .exe 并选择安装位置；遇到发布者提示时先确认来源，不需要关闭系统安全防护。</li>
        <li>打开 CYword，用邮箱验证码登录后直接进入学习，无需再下载词书资源。</li>
      </ol><a href="#download">下载 Windows 安装包 <Icon name="arrow" /></a></article>
      <article id="guide-android"><h3><Icon name="phone" />Android 7.0 及以上</h3><ol>
        <li>在安卓手机上下载 APK，从浏览器的下载列表打开。</li>
        <li>核对来源后按系统提示允许当前浏览器安装此应用；安装后可关闭该权限。</li>
        <li>登录后直接使用预装词书、发音和配图。更新时直接覆盖安装；进度保存在本机，请勿卸载或清理应用数据。</li>
      </ol><a href="#download">下载安卓安装包 <Icon name="arrow" /></a></article>
    </div>
  </section>;
}

function ReleaseNotes() {
  return <section className="information-section section-wrap" id="release-notes" aria-labelledby="release-notes-title">
    <div className="section-heading"><h2 id="release-notes-title">版本记录</h2><p>这里记录已发布的客户端改动，安装包版本以下载区为准。</p></div>
    <div className="release-notes-grid">
      <article><span className="eyebrow">2026.09.25</span><h3>Windows 0.4.7 / Android 0.1.4</h3><p>完整六级词书、全部发音和巧记配图随安装包提供，登录后无需二次下载。每日学习连续进行，取消中途分段休息页；内置音标字体，减少手机字体缺字问题。升级保留本机学习记录。</p></article>
      <article><span className="eyebrow">2026.09.21</span><h3>Windows 0.4.6 / Android 0.1.3</h3><p>登录后下载完整词书与发音，支持离线学习；进度默认保存本机，旧云端记录导入一次。单词默认完整显示，点击切换分割，发音时临时分割并在结束后恢复，官网示例同步支持。</p></article>
      <article><span className="eyebrow">2026.09.20</span><h3>Windows 0.4.5</h3><p>新增全书搜索、以音记形与以熟带生；改进学习、保存与同步，隐藏滚动条。后续更新自动下载，准备完成后点击安装。</p></article>
      <article><span className="eyebrow">2026.09.20</span><h3>Android 0.1.2</h3><p>新增自动检查更新，“我的”支持手动检查和下载新版。0.1.1 及更早版本需先从官网覆盖安装一次。</p></article>
    </div>
  </section>;
}

function PrivacyNotice() {
  return <section className="information-section section-wrap" id="privacy" aria-labelledby="privacy-title">
    <div className="section-heading"><h2 id="privacy-title">隐私与数据</h2><p>更新于 2026 年 9 月 21 日</p></div>
    <div className="privacy-details">
      <details open><summary>账号与学习记录<Icon name="plus" /></summary><p>客户端用邮箱接收登录验证码，服务端保存邮箱、账号标识与登录时间。新版学习进度、熟练度和复习记录默认只保存在当前设备；每台设备按账号导入旧云端记录一次，此后不再自动同步。旧云端记录仍保留，旧版客户端可能继续同步。退出登录保留本机记录；卸载或清理应用数据会删除本机记录，但不会删除云端记录。</p></details>
      <details><summary>网站、发音与服务提供方<Icon name="plus" /></summary><p>官网交互示例只保存在当前页面内存中，刷新即重置，不读取客户端学习记录；官网没有添加统计脚本。下载、账号与同步服务使用 Cloudflare，验证码邮件通过 Resend 发送；点播放发音时，浏览器会请求词书音频服务 cdn.aimwords.com。这些网络服务会接收完成请求所需的网络信息。</p></details>
      <details id="feedback" open><summary>反馈与数据删除<Icon name="plus" /></summary><p>账号、云端记录与本机数据需要分别处理。删除云端记录前，请先保留需要的学习进度，并停止其他设备的同步，避免记录再次上传。</p><p>反馈或申请删除账号及云端学习记录，请联系 <a href="mailto:cyi907369@gmail.com">cyi907369@gmail.com</a>。删除申请请使用登录邮箱发送。</p></details>
    </div>
  </section>;
}

function AndroidDownload({ currentRelease, status, retry }: { currentRelease: ReleaseInfo | null; status: "loading" | "ready" | "error"; retry: () => void }) {
  const [downloadStarted, setDownloadStarted] = useState(false);
  return <div className="download-card">
    <div className="download-card-heading"><span className="windows-tile"><Icon name="phone" /></span><div><h3>CYword for Android</h3><p>Android 7.0 及以上</p></div>{currentRelease && <span className="version-label">v{currentRelease.version}</span>}</div>
    {currentRelease ? <>
      <div className="download-meta"><span>大学英语六级词书 · 完整资源预装</span><span>{currentRelease.size} <i>·</i> {currentRelease.date}</span></div>
      <a className="button button-primary download-main" href={currentRelease.downloadUrl} onClick={() => setDownloadStarted(true)}><Icon name="download" />下载安卓安装包<Icon name="arrow" /></a>
      <p className="download-reassurance">下载 APK 后打开安装 · 邮箱验证码登录</p>
      <div className="download-links"><a href="#guide-android">安卓安装步骤</a><span>·</span><a href={currentRelease.notesUrl}>版本记录</a></div>
      <div className="download-feedback" role="status">{downloadStarted && <p>已发起下载，请在浏览器下载列表中打开 APK，并按系统提示安装。</p>}</div>
      <details className="checksum"><summary>安装说明与文件校验<Icon name="plus" /></summary><div><p>在安卓手机上打开 APK，按系统提示允许当前浏览器安装此应用。后续更新直接覆盖安装即可保留学习记录。</p><p className="filename">{currentRelease.filename}</p><span>SHA-256</span><code>{currentRelease.sha256}</code></div></details>
    </> : <div className="release-error" role="status"><p>{status === "loading" ? "正在读取安卓版本信息…" : "暂时无法读取安卓版本信息，版本和校验值尚未确认。"}</p>{status === "error" && <button className="button" onClick={retry}>重新读取</button>}<a href="#guide-android">查看安卓安装步骤</a></div>}
  </div>;
}

function Download({ currentRelease, androidRelease, androidStatus, windowsFallback, retryAndroid }: { currentRelease: ReleaseInfo; androidRelease: ReleaseInfo | null; androidStatus: "loading" | "ready" | "error"; windowsFallback: boolean; retryAndroid: () => void }) {
  const [downloadStarted, setDownloadStarted] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(currentRelease.downloadUrl); setCopyState("done"); }
    catch { setCopyState("failed"); }
  };
  return <section className="download-section section-wrap" id="download" aria-labelledby="download-title"><div className="download-intro"><span className="brand-mark download-logo" aria-hidden="true">Cy</span><span className="eyebrow">MAKE ROOM FOR A LITTLE PROGRESS</span><h2 id="download-title">下一组单词，<br className="mobile-break" />从这里开始。</h2><p>巧记、构词、分组与复习，都已经准备好。</p></div>
    <div className="download-platforms"><AndroidDownload currentRelease={androidRelease} status={androidStatus} retry={retryAndroid} />
    <div className="download-card"><div className="download-card-heading"><span className="windows-tile"><Icon name="windows" /></span><div><h3>CYword for Windows</h3><p>Windows 10 / 11 · 64 位</p></div><span className="version-label">v{currentRelease.version}</span></div><div className="download-meta"><span>大学英语六级词书 · 完整资源预装</span><span>{currentRelease.size} <i>·</i> {currentRelease.date}</span></div>
      <a className="button button-primary download-main" href={currentRelease.downloadUrl} onClick={() => setDownloadStarted(true)}><Icon name="download" />下载 Windows 安装包<Icon name="arrow" /></a><p className="download-reassurance">邮箱验证码登录 · 下载后双击安装 · 可选择安装目录</p>
      <div className="download-links"><button onClick={copyLink}>{copyState === "done" ? "下载地址已复制" : "复制下载地址"}</button><span>·</span><a href="#guide-windows">Windows 安装步骤</a><span>·</span><a href={currentRelease.notesUrl}>版本记录</a></div>
      <div className="download-feedback" role="status">{downloadStarted && <p>已向浏览器发起下载，请查看下载列表。如果没有开始，可复制地址后重试。<a href="#faq">查看下载帮助</a></p>}{copyState === "done" && <p>下载地址已复制，可粘贴到 Windows 电脑的浏览器中打开。</p>}{copyState === "failed" && <label>浏览器未允许复制，请手动选择下面的地址：<input readOnly aria-label="Windows 安装包下载地址" value={currentRelease.downloadUrl} onFocus={(event) => event.currentTarget.select()} /></label>}</div>
      {windowsFallback && <p className="release-status" role="status">最新版本信息暂不可用，当前提供最后核验的 Windows v{currentRelease.version}。</p>}
      <details className="checksum"><summary>安装包来源与文件校验<Icon name="plus" /></summary><div><p>安装包通过本站下载服务提供，下载不需要登录。当前安装包未签名，安装前请确认来源并核对校验值。</p><p className="filename">{currentRelease.filename}</p><span>SHA-256</span><code>{currentRelease.sha256}</code></div></details>
    </div></div>
  </section>;
}

export default function Website() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [currentRelease, setCurrentRelease] = useState(release);
  const [androidRelease, setAndroidRelease] = useState<ReleaseInfo | null>(null);
  const [androidStatus, setAndroidStatus] = useState<"loading" | "ready" | "error">("loading");
  const [windowsFallback, setWindowsFallback] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    fetchLatestRelease().then((latest) => { if (active) { setCurrentRelease(latest); setWindowsFallback(false); } }).catch(() => { if (active) setWindowsFallback(true); });
    setAndroidStatus("loading");
    fetchLatestRelease(true).then((latest) => { if (active) { setAndroidRelease(latest); setAndroidStatus("ready"); } }).catch(() => { if (active) setAndroidStatus("error"); });
    return () => { active = false; };
  }, [retryAttempt]);
  return <>
    <div id="top" aria-hidden="true" />
    <a className="skip-link" href="#main">跳到正文</a>
    <header className="site-header"><div className="header-inner"><Brand /><nav id="main-navigation" aria-label="主导航" className={menuOpen ? "menu-open" : ""}><a href="#method" onClick={() => setMenuOpen(false)}>学习方式</a><a href="#plan" onClick={() => setMenuOpen(false)}>分级复习</a><a href="#guide" onClick={() => setMenuOpen(false)}>上手指南</a><a href="#faq" onClick={() => setMenuOpen(false)}>常见问题</a></nav><div className="header-actions"><a className="header-download" href="#download" onClick={() => setMenuOpen(false)}>下载软件<Icon name="download" /></a><button className="menu-toggle" aria-expanded={menuOpen} aria-controls="main-navigation" aria-label={menuOpen ? "收起导航" : "展开导航"} onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? "close" : "menu"} /></button></div></div></header>
    <main id="main">
      <section className="hero section-wrap" aria-labelledby="hero-title"><div className="hero-copy"><span className="hero-kicker"><i /> 巧记 · 词根分组 · 分级复习</span><h1 id="hero-title">巧记带着学，<br /><em>单词成串记。</em></h1><p className="hero-description">5,166 个六级单词，逐词备好巧记思路。<br />拆开词根词缀，一组一组带着你记，<br />再按熟练度复习，把时间留给还不熟的词。</p><div className="hero-actions"><a className="button button-primary" href="#download"><Icon name="download" />下载 CYword<Icon name="arrow" /></a><a className="text-link" href="#experience">先体验一下 <span aria-hidden="true">↗</span></a></div><div className="hero-availability"><span className="availability-dot" />Windows v{currentRelease.version}<i>·</i>{androidRelease ? `Android v${androidRelease.version}` : androidStatus === "loading" ? "Android 版本读取中" : "Android 版本暂不可用"}<i>·</i>邮箱验证码登录</div><div className="hero-note"><span aria-hidden="true">↳</span> 省下自己找词根、编巧记、排复习的准备时间。</div></div><WordDemo /></section>
      <div className="facts-strip section-wrap"><div><span className="fact-number">5,166</span><span>每词都有巧记<span>从怎么记，就给你思路</span></span></div><div><Icon name="branch" /><span>词根成组学习<span>同根单词，在同一天串起来</span></span></div><div><span className="fact-number">3 <i>档</i></span><span>熟练度分级<span>让复习分清轻重</span></span></div></div>
      <MnemonicMethod />
      <Rhythm />
      <InstallGuide />
      <Download currentRelease={currentRelease} androidRelease={androidRelease} androidStatus={androidStatus}
        windowsFallback={windowsFallback} retryAndroid={() => setRetryAttempt((value) => value + 1)} />
      <ReleaseNotes />

      <section className="faq-section section-wrap" id="faq" aria-labelledby="faq-title"><div><span className="eyebrow">A FEW THINGS TO KNOW</span><h2 id="faq-title">你可能还想知道</h2><p>开始之前，把这些小问题说清楚。</p></div><div className="faq-list">{faqs.map((faq, i) => <details name="faq" key={faq.question} open={i === 0 ? true : undefined}><summary>{faq.question}<Icon name="plus" /></summary><p>{faq.answer}</p></details>)}</div></section>
      <PrivacyNotice />
    </main>
    <footer className="site-footer section-wrap"><div className="footer-top"><Brand footer /><p>每个词有巧记，每一组有联系，学过之后有复习。</p><a href="#top">回到顶部 ↑</a></div><div className="footer-bottom"><span>© {new Date().getFullYear()} CYword</span><span><a href="https://github.com/cheng-yi-cc/CYword" target="_blank" rel="noreferrer">开源代码</a><a href="#release-notes">版本记录</a><a href="#privacy">隐私与数据</a><a href="#feedback">反馈与删除申请</a></span></div></footer>
  </>;
}
