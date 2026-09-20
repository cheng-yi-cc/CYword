import { useId, useState } from "react";
import type { PronunciationGuide } from "../types";

export function PronunciationSpelling({ word, guide }: { word: string; guide?: PronunciationGuide }) {
  if (!guide) return <>{word}</>;
  return <span className="sound-spelling" aria-label={word} onCopy={(event) => {
    event.clipboardData.setData("text/plain", word);
    event.preventDefault();
  }}>{guide.chunks.map((chunk, index) =>
    <span key={index} className={`sound-spelling-part stress-${chunk.stress}`} aria-hidden="true">{chunk.text}</span>,
  )}</span>;
}

export function PronunciationMemory({ guide }: { guide?: PronunciationGuide }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const id = useId();
  if (!guide) return null;
  return <section className="sound-memory" aria-label="以音记形">
    <div className="sound-memory-bar">
      <span>以音记形</span>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {open ? "收起音形对照" : "展开音形对照"}<span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
    </div>
    {open && <div id={id} className="sound-memory-content">
      <p className="sound-memory-help">上排看拼写，下排对读音；下划线标出重读。</p>
      <div className="sound-chunks" aria-label="拼写与音标对应">
        {guide.chunks.map((chunk, index) => <button type="button" key={index}
          className={`sound-chunk stress-${chunk.stress} ${selected === index ? "selected" : ""}`}
          aria-pressed={selected === index}
          aria-label={`${chunk.text}，${chunk.ipa}，${chunk.stress === "primary" ? "重读" : chunk.stress === "secondary" ? "次重读" : "未标重音"}`}
          onClick={() => setSelected(selected === index ? null : index)}>
          <b>{chunk.text}</b><span>/{chunk.ipa}/</span>
          <small>{chunk.stress === "primary" ? "重读" : chunk.stress === "secondary" ? "次重读" : "\u00a0"}</small>
        </button>)}
      </div>
      {guide.notes.length > 0 && <ul className="sound-notes">{guide.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>}
      <p className="sound-memory-caption">按当前音标分块；字母组合可能合读或不发音，分块与词根拆解不同。</p>
    </div>}
  </section>;
}
