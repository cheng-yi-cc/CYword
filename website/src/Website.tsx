import { useEffect, useState, useRef, type ReactNode } from "react";
import { fetchLatestRelease, release, type ReleaseInfo } from "./release";

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
  return <a className={`brand-link ${footer ? "brand-footer" : ""}`} href="#top" aria-label="CYword 官网首页"><span className="brand-mark">Cy</span><span className="brand-name">CYword<small>词根记忆 · ROOTED RECALL</small></span></a>;
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

function WebAudioButton({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false);
  const play = () => {
    try {
      setPlaying(true);
      const audio = new Audio(url);
      audio.addEventListener("ended", () => setPlaying(false), { once: true });
      audio.addEventListener("error", () => setPlaying(false), { once: true });
      audio.play().catch(() => setPlaying(false));
    } catch {
      setPlaying(false);
    }
  };
  return (
    <button
      className={`study-audio-btn ${playing ? "playing" : ""}`}
      onClick={play}
      aria-label="播放真人发音"
      title="播放真人发音"
    >
      <Icon name="volume" />
      <span className="audio-label">{playing ? "正在朗读" : "真人发音"}</span>
      <span className={`audio-wave ${playing ? "active" : ""}`} aria-hidden="true">
        <i /><i /><i />
      </span>
    </button>
  );
}

function WordDemo() {
  const [activeRating, setActiveRating] = useState<number | null>(null);
  const [activeLane, setActiveLane] = useState<"word" | "morpheme" | "sentence">("word");
  const [hoveredRole, setHoveredRole] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("桌面端沉浸式学习体验：左栏探寻词根线索，中栏掌握音形巧记与真题，右栏深度拆解长难句语法结构");
  const word = immersivePortable;

  const handleRate = (idx: number) => {
    setActiveRating(idx);
    setStatusMsg(idx === 2 ? `${word.word} 已标记为“已掌握”，会自动移出待巩固列表。` : `${word.word} 已标记为“${levels[idx]}”，会自动收录到“词汇掌握”的待巩固列表。`);
  };


  return (
    <div className="hero-demo" id="experience">
      <div className="demo-caption">
        <span><i /> 桌面端沉浸式学习视窗 · 1:1 真实交互</span>
        <span>词根巧记 ＋ 真题例句 ＋ 长难句拆解 <span aria-hidden="true">↘</span></span>
      </div>

      <div className="immersive-window">
        {/* 顶部标题栏与窗口控制 */}
        <div className="immersive-topbar">
          <div className="topbar-brand">
            <span className="brand-dot" />
            <span className="brand-text">Cy 词根记忆</span>
            <span className="topbar-book">大学英语六级</span>
            <span className="topbar-group">Day 05 · port 词根家族</span>
          </div>

          <div className="topbar-center">
            <div className="topbar-progress-track" title="学习进度 33%">
              <i style={{ width: "33%" }} />
            </div>
          </div>

          <div className="topbar-meta">
            <span className="topbar-badge-scroll">沉浸学习模式</span>
            <span className="topbar-count">01 / 03</span>
            <span className="topbar-controls" aria-hidden="true">— &nbsp; □ &nbsp; ×</span>
          </div>
        </div>

        {/* 移动端/窄屏下的栏目切换器 */}
        <div className="immersive-mobile-tabs" role="tablist" aria-label="沉浸式栏目切换">
          <button
            role="tab"
            aria-selected={activeLane === "morpheme"}
            className={activeLane === "morpheme" ? "active" : ""}
            onClick={() => setActiveLane("morpheme")}
          >
            词根词缀
          </button>
          <button
            role="tab"
            aria-selected={activeLane === "word"}
            className={activeLane === "word" ? "active" : ""}
            onClick={() => setActiveLane("word")}
          >
            核心巧记
          </button>
          <button
            role="tab"
            aria-selected={activeLane === "sentence"}
            className={activeLane === "sentence" ? "active" : ""}
            onClick={() => setActiveLane("sentence")}
          >
            长难句精读
          </button>
        </div>

        {/* 真实三栏并排独立滑动网格 */}
        <div className={`study-session-grid show-${activeLane}`}>
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
          <main className="study-word-column">
            <div className="study-center-scroll">
              {/* 单词 Hero */}
              <header className="study-word-hero">
                <div className="study-hero-main">
                  <span className="hero-group-label">{word.group}</span>
                  <h2 className="study-word-title">{word.word}</h2>
                  <div className="study-phonetic-row">
                    <strong>{word.pronunciation}</strong>
                    <WebAudioButton url={word.audioUrl} />
                  </div>
                </div>
                <div className="study-hero-side">
                  <p className="study-definition">{word.definition}</p>
                  <p className="study-mastery-state" aria-live="polite">{activeRating === null ? "评级后自动整理到词汇掌握情况" : activeRating === 2 ? "已掌握 · 已移出待巩固列表" : levels[activeRating] + " · 已自动收录到待巩固列表"}</p>
                </div>
              </header>

              {/* 巧记思路 */}
              <section className="session-section memory-section">
                <header>
                  <span className="section-tag">MEMORY METHOD</span>
                  <h4>巧记思路</h4>
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
                    <kbd>{idx + 1}</kbd>
                    <b>{lvl}</b>
                    {activeRating === idx && <Icon name="check" />}
                  </button>
                ))}
              </div>
              <div className={`session-navigation ${activeRating !== null ? "has-next" : ""}`}>
                <span><kbd>←</kbd> 上一个</span>
                <span><kbd>空格</kbd> 播放发音</span>
                {activeRating !== null && <span>下一个 <kbd>→</kbd></span>}
              </div>
            </footer>
          </main>

          {/* 右栏：长难句精读（独立分开滑动） */}
          <aside className="study-sentence-column">
            <header className="study-column-header">
              <span className="column-tag">LONG SENTENCE</span>
              <h3>长难句精读</h3>
              <p>跟随当前词显示 · 独立滑动深读</p>
            </header>
            <div className="long-sentence-scroll">
              <article className="long-sentence-article">
                <p className="long-sentence-copy">{word.longSentence.sentence}</p>
                <p className="long-sentence-translation">{word.longSentence.translation}</p>

                <div className="sentence-subblock">
                  <h5>语法结构分层拆解 (悬停高亮)</h5>
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
                  <h5>考点与难点剖析</h5>
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

            {/* 右栏底部分页器 */}
            <footer className="long-sentence-pagination">
              <span className="page-tag">六级真题</span>
              <span className="page-num">第 1 句 / 共 1 句</span>
              <span className="page-status">已展开</span>
            </footer>
          </aside>
        </div>

        {/* 视窗底状态栏 */}
        <div className="immersive-statusbar">
          <span className="status-msg" role="status">{statusMsg}</span>
          <span className="status-tip">鼠标滚轮置于各栏即可独立上下滑动</span>
        </div>
      </div>
      <p className="demo-footnote">CYword 客户端沉浸式记忆视窗真实呈现 · 词书数据与真人发音均来自正式版六级词库</p>
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
  { question: "每天的学习量大概是多少？", answer: "当前六级计划每个学习日安排约 180 次单词学习，具体为 178–187 次。同一个词涉及多个词根时，会在相关组里再次出现；复习时按单词去重。这是计划安排的学习量，实际耗时和记忆效果会受词汇基础、专注程度与后续复习影响。" },
  { question: "巧记里的联想，就是单词的真正构词吗？", answer: "两者会分开展示。谐音、熟词和画面联想用来帮助记忆，构词分析则说明词根词缀的联系。有真正词根的单词按词根成组，没有独立词根的词会单独安排，跟着逐词巧记学习。" },
  { question: "需要注册账号，或者付费吗？", answer: "使用邮箱验证码登录后即可学习，目前没有内置付费步骤。请使用你自己的邮箱接收验证码。" },
  { question: "断网也能背单词吗？", answer: "当前版本需要联网获取词书和单词详情，邮箱登录、发音和更新检查也需要网络。学习记录会保存在当前设备，暂不提供离线学习模式。" },
  { question: "支持手机、Mac，或者其他词书吗？", answer: "本页提供 Windows 10 / 11 桌面版与 Android 7.0 及以上安卓安装包，使用相同的记忆和词汇掌握规则。当前支持含 5,166 个唯一单词的六级词书，尚无 Mac 版、四级或考研词书。" },
  { question: "安装时出现 Windows 安全提示怎么办？", answer: "当前安装包尚未进行代码签名，Windows 可能提示无法识别发布者。这不等于已经确认软件安全。请先确认文件来自本页的官方发布地址、文件名和版本一致；不确定来源时不要运行，也无需关闭系统安全防护。下载区提供文件校验值，供需要时核对。" },
  { question: "词汇掌握页面会收录哪些词？", answer: "安卓端和电脑端按同一规则展示全书掌握统计：已掌握、未掌握、不清楚和未学习。待巩固列表只收录已学过且评级为“未掌握”或“不清楚”的词；改为“已掌握”后自动移出，学习记录仍然保留。尚未学习、未评级的词不会混入列表。" },
  { question: "学习进度会保存吗？更新后还在吗？", answer: "学习记录和熟练度自动保存在当前设备。正常覆盖升级会保留进度，“词汇掌握”会根据最新评级自动更新，无需另存一份列表。电脑与手机使用同一邮箱登录即可同步，换设备前请确认“已与云端同步”；卸载或清理应用数据前，请先备份本机数据。" },
  { question: "下载没有开始，或者下载速度很慢？", answer: "主下载由本站通过 Cloudflare R2 提供，无需访问 GitHub，支持断点续传。跨境线路仍可能较慢，部分地区也可能无法连接。请先查看浏览器下载列表，尝试继续下载或稍后重试；也可以使用下载区的 GitHub 备用地址。两个地址提供的是同一份安装包，可核对下方 SHA-256。" },
];

function AndroidDownload({ currentRelease }: { currentRelease: ReleaseInfo | null }) {
  const [downloadStarted, setDownloadStarted] = useState(false);
  return <div className="download-card">
    <div className="download-card-heading"><span className="windows-tile"><Icon name="phone" /></span><div><h3>CYword for Android</h3><p>Android 7.0 及以上</p></div>{currentRelease && <span className="version-label">v{currentRelease.version}</span>}</div>
    {currentRelease ? <>
      <div className="download-meta"><span>大学英语六级词书 · 联网学习</span><span>{currentRelease.size} <i>·</i> {currentRelease.date}</span></div>
      <a className="button button-primary download-main" href={currentRelease.downloadUrl} onClick={() => setDownloadStarted(true)}><Icon name="download" />下载安卓安装包<Icon name="arrow" /></a>
      <p className="download-reassurance">下载 APK 后打开安装 · 邮箱验证码登录</p>
      <div className="download-links"><a href={currentRelease.githubDownloadUrl}>GitHub 备用下载 ↗</a><span>·</span><a href={currentRelease.notesUrl} target="_blank" rel="noreferrer">版本记录 ↗</a></div>
      <div className="download-feedback" role="status">{downloadStarted && <p>已发起下载，请在浏览器下载列表中打开 APK，并按系统提示安装。</p>}</div>
      <details className="checksum"><summary>安装说明与文件校验<Icon name="plus" /></summary><div><p>在安卓手机上打开 APK，按系统提示允许当前浏览器安装此应用。后续更新直接覆盖安装即可保留学习记录。</p><p className="filename">{currentRelease.filename}</p><span>SHA-256</span><code>{currentRelease.sha256}</code></div></details>
    </> : <p className="download-reassurance" role="status">暂时无法读取安卓版本信息，请稍后刷新重试。</p>}
  </div>;
}

function Download({ currentRelease, androidRelease }: { currentRelease: ReleaseInfo; androidRelease: ReleaseInfo | null }) {
  const [downloadStarted, setDownloadStarted] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(currentRelease.downloadUrl); setCopyState("done"); }
    catch { setCopyState("failed"); }
  };
  return <section className="download-section section-wrap" id="download" aria-labelledby="download-title"><div className="download-intro"><span className="brand-mark download-logo" aria-hidden="true">Cy</span><span className="eyebrow">MAKE ROOM FOR A LITTLE PROGRESS</span><h2 id="download-title">下一组单词，<br className="mobile-break" />从这里开始。</h2><p>巧记、构词、分组与复习，都已经准备好。</p></div>
    <div className="download-platforms"><AndroidDownload currentRelease={androidRelease} />
    <div className="download-card"><div className="download-card-heading"><span className="windows-tile"><Icon name="windows" /></span><div><h3>CYword for Windows</h3><p>Windows 10 / 11 · 64 位</p></div><span className="version-label">v{currentRelease.version}</span></div><div className="download-meta"><span>大学英语六级词书 · 联网学习</span><span>{currentRelease.size} <i>·</i> {currentRelease.date}</span></div>
      <a className="button button-primary download-main" href={currentRelease.downloadUrl} onClick={() => setDownloadStarted(true)}><Icon name="download" />下载 Windows 安装包<Icon name="arrow" /></a><p className="download-reassurance">邮箱验证码登录 · 下载后双击安装 · 可选择安装目录</p>
      <div className="download-links"><button onClick={copyLink}>{copyState === "done" ? "下载地址已复制" : "复制下载地址"}</button><span>·</span><a href="#guide">查看安装步骤</a><span>·</span><a href={currentRelease.githubDownloadUrl}>GitHub 备用下载 ↗</a><span>·</span><a href={currentRelease.notesUrl} target="_blank" rel="noreferrer">版本记录 ↗</a></div>
      <div className="download-feedback" role="status">{downloadStarted && <p>已向浏览器发起下载，请查看下载列表。如果没有开始，可复制地址后重试。<a href="#faq">查看下载帮助</a></p>}{copyState === "done" && <p>下载地址已复制，可粘贴到 Windows 电脑的浏览器中打开。</p>}{copyState === "failed" && <label>浏览器未允许复制，请手动选择下面的地址：<input readOnly aria-label="Windows 安装包下载地址" value={currentRelease.downloadUrl} onFocus={(event) => event.currentTarget.select()} /></label>}</div>
      <details className="checksum"><summary>安装包来源与文件校验<Icon name="plus" /></summary><div><p>本站主下载和 GitHub 备用下载提供同一份官方发布文件，无需登录。当前安装包未签名，安装前请确认来源并核对校验值。</p><p className="filename">{currentRelease.filename}</p><span>SHA-256</span><code>{currentRelease.sha256}</code></div></details>
    </div></div>
  </section>;
}

export default function Website() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [currentRelease, setCurrentRelease] = useState(release);
  const [androidRelease, setAndroidRelease] = useState<ReleaseInfo | null>(null);
  useEffect(() => {
    let active = true;
    fetchLatestRelease().then((latest) => { if (active) setCurrentRelease(latest); }).catch(() => {});
    fetchLatestRelease(true).then((latest) => { if (active) setAndroidRelease(latest); }).catch(() => {});
    return () => { active = false; };
  }, []);
  return <>
    <div id="top" aria-hidden="true" />
    <a className="skip-link" href="#main">跳到正文</a>
    <header className="site-header"><div className="header-inner"><Brand /><nav id="main-navigation" aria-label="主导航" className={menuOpen ? "menu-open" : ""}><a href="#method" onClick={() => setMenuOpen(false)}>学习方式</a><a href="#plan" onClick={() => setMenuOpen(false)}>分级复习</a><a href="#guide" onClick={() => setMenuOpen(false)}>上手指南</a><a href="#faq" onClick={() => setMenuOpen(false)}>常见问题</a></nav><div className="header-actions"><a className="header-download" href="#download" onClick={() => setMenuOpen(false)}>下载软件<Icon name="download" /></a><button className="menu-toggle" aria-expanded={menuOpen} aria-controls="main-navigation" aria-label={menuOpen ? "收起导航" : "展开导航"} onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? "close" : "menu"} /></button></div></div></header>
    <main id="main">
      <section className="hero section-wrap" aria-labelledby="hero-title"><div className="hero-copy"><span className="hero-kicker"><i /> 巧记 · 词根分组 · 分级复习</span><h1 id="hero-title">巧记带着学，<br /><em>单词成串记。</em></h1><p className="hero-description">5,166 个六级单词，逐词备好巧记思路。<br />拆开词根词缀，一组一组带着你记，<br />再按熟练度复习，把时间留给还不熟的词。</p><div className="hero-actions"><a className="button button-primary" href="#download"><Icon name="download" />下载 CYword<Icon name="arrow" /></a><a className="text-link" href="#experience">先体验一下 <span aria-hidden="true">↗</span></a></div><div className="hero-availability"><span className="availability-dot" />v{currentRelease.version}<i>·</i>Windows / Android<i>·</i>邮箱验证码登录</div><div className="hero-note"><span aria-hidden="true">↳</span> 省下自己找词根、编巧记、排复习的准备时间。</div></div><WordDemo /></section>
      <div className="facts-strip section-wrap"><div><span className="fact-number">5,166</span><span>每词都有巧记<span>从怎么记，就给你思路</span></span></div><div><Icon name="branch" /><span>词根成组学习<span>同根单词，在同一天串起来</span></span></div><div><span className="fact-number">3 <i>档</i></span><span>熟练度分级<span>让复习分清轻重</span></span></div></div>
      <MnemonicMethod />
      <Rhythm />
      <section className="guide-section section-wrap" id="guide" aria-labelledby="guide-title"><div className="section-heading"><div><span className="eyebrow">A SMALL START IS STILL A START</span><h2 id="guide-title">装好，打开，<br className="mobile-break" />开始今天。</h2></div><p>不需要懂代码，也不用研究项目页面。<br />三个小步骤，就能开始学习。</p></div><ol className="guide-steps"><li><span className="step-number">01</span><div className="step-art installer-art"><Icon name="download" /><span>CYword-Setup<small>.exe</small></span><Icon name="check" /></div><h3>下载安装包</h3><p>在 Windows 电脑上点击下载，保存安装文件。无需下载源码，也不用注册账号。</p><a href="#download">前往下载 <Icon name="arrow" /></a></li><li><span className="step-number">02</span><div className="step-art install-art"><span className="mini-cy">Cy</span><div><span>选择安装位置</span><small>D:\CYword</small></div><span className="mini-install-label">安装</span></div><h3>双击，完成安装</h3><p>打开下载好的 .exe 文件，按提示选择安装位置。安装完成后，从桌面打开 CYword。</p><a href="#faq">遇到安全提示？ <Icon name="arrow" /></a></li><li><span className="step-number">03</span><div className="step-art first-day-art"><span>Day 1</span><span className="mini-start-label">开始学习 <Icon name="arrow" /></span></div><h3>从第一组词根开始</h3><p>点击首页的「继续今日学习」，进入今日计划后点击开始按钮，跟着巧记按组学习，标记熟练度。进度会自动保存。</p><a href="#experience">先试试学习体验 <Icon name="arrow" /></a></li></ol></section>
      <Download currentRelease={currentRelease} androidRelease={androidRelease} />
      <section className="faq-section section-wrap" id="faq" aria-labelledby="faq-title"><div><span className="eyebrow">A FEW THINGS TO KNOW</span><h2 id="faq-title">你可能还想知道</h2><p>开始之前，把这些小问题说清楚。</p></div><div className="faq-list">{faqs.map((faq, i) => <details name="faq" key={faq.question} open={i === 0 ? true : undefined}><summary>{faq.question}<Icon name="plus" /></summary><p>{faq.answer}</p></details>)}</div></section>
    </main>
    <footer className="site-footer section-wrap"><div className="footer-top"><Brand footer /><p>每个词有巧记，每一组有联系，学过之后有复习。</p><a href="#top">回到顶部 ↑</a></div><div className="footer-bottom"><span>© {new Date().getFullYear()} CYword · 词根记忆</span><span>巧记带着学，单词成串记。<a href={currentRelease.repositoryUrl} target="_blank" rel="noreferrer">开源项目 ↗</a></span></div></footer>
  </>;
}
