import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { WordDetailPanel } from "../src/App";
import { WordHoverProvider } from "../src/components/WordHoverContext";
import { MeaningBridgeProvider } from "../src/components/MeaningBridgeMemory";
import { ErrorBoundary } from "../src/components/ErrorBoundary";
import { offlineBook } from "../src/offline-book";
import { emptyProgress } from "../src/progress";
import type { WordDetail } from "../src/types";
import "../src/styles.css";

// Audit entry point only. It is bundled separately and never shipped in dist.
const container = document.getElementById("audit")!;
const root = createRoot(container);
const catalog = (await offlineBook.inspect())!.catalog;
const progress = emptyProgress();
const ids = Object.keys(catalog.words);
const report = { words: 0, tabs: 0, pronunciationGuides: 0, meaningBridges: 0, rootMemories: 0, longSentences: 0, images: new Set<string>() };
const loadWords = async () => true;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function check(detail: WordDetail) {
  if (container.querySelector('.content-error')) throw Error(`Rendering boundary caught ${detail.id}`);
  if (!container.querySelector('.word-hero h2')?.textContent?.includes(detail.spelling)) throw Error(`Missing word heading ${detail.id}`);
  if (!container.querySelector('.detail-scroll')?.textContent?.trim()) throw Error(`Empty detail tab ${detail.id}`);
  for (const img of container.querySelectorAll<HTMLImageElement>('img')) {
    if (!img.src.includes('/book/images/')) throw Error(`Unresolved image ${detail.id}`);
    report.images.add(img.src);
  }
}
Object.assign(window, {
  auditIds: ids,
  async auditWords(start: number, count: number) {
    for (const id of ids.slice(start, start + count)) {
      const detail = (await offlineBook.readWords({ wordIds: [id], dataVersion: catalog.dataVersion, kind: "bookmarks", planDay: 1 })).words[id];
      flushSync(() => root.render(<WordHoverProvider catalog={catalog} details={{ [id]: detail }} loadWords={loadWords}>
        <MeaningBridgeProvider catalog={catalog} progress={progress}>
          <ErrorBoundary key={id}><WordDetailPanel key={id} detail={detail} /></ErrorBoundary>
        </MeaningBridgeProvider>
      </WordHoverProvider>));
      await settle();
      check(detail);
      if (detail.pronunciationGuide) {
        const toggle = container.querySelector<HTMLButtonElement>('.sound-memory-bar button');
        if (!toggle) throw Error(`Missing pronunciation guide ${id}`);
        flushSync(() => toggle.click());
        if (container.querySelectorAll('.sound-chunk').length !== detail.pronunciationGuide.chunks.length) throw Error(`Incomplete pronunciation chunks ${id}`);
        report.pronunciationGuides++;
      }
      for (const node of container.querySelectorAll<HTMLDetailsElement>('.morphology-node details')) { node.open = true; report.rootMemories++; }
      if (container.querySelector('.meaning-bridge')) report.meaningBridges++;
      const tabs = [...container.querySelectorAll<HTMLButtonElement>('.detail-tabs button')];
      for (const tab of tabs) {
        flushSync(() => tab.click()); check(detail); report.tabs++;
        for (const node of container.querySelectorAll<HTMLDetailsElement>('.long-sentence')) { node.open = true; report.longSentences++; }
      }
      report.words++;
    }
    return { ...report, images: report.images.size };
  },
  async auditImages() {
    let decoded = 0;
    const images = [...report.images];
    for (let start = 0; start < images.length; start += 8) {
      await Promise.all(images.slice(start, start + 8).map(async src => {
        const img = new Image(); img.src = src; await img.decode();
        if (!img.naturalWidth || !img.naturalHeight) throw Error('Empty decoded image'); decoded++;
      }));
    }
    return decoded;
  },
});
