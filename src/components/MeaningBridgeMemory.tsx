import React, { createContext, useContext, useMemo } from "react";
import type { AppProgress, Catalog, WordDetail } from "../types";
import { buildBridgeOrder, selectMeaningBridge, type StudyPosition } from "../meaning-bridges";
import { useWordHover } from "./WordHoverContext";

const MeaningBridgeContext = createContext<((detail: WordDetail, position?: StudyPosition) => ReturnType<typeof selectMeaningBridge>) | null>(null);

export function MeaningBridgeProvider({ catalog, progress, children }: { catalog: Catalog | null; progress: AppProgress | null; children: React.ReactNode }) {
  const order = useMemo(() => catalog ? buildBridgeOrder(catalog) : null, [catalog]);
  const select = useMemo(() => (detail: WordDetail, position?: StudyPosition) =>
    catalog && order ? selectMeaningBridge(detail, catalog, progress, order, position) : undefined, [catalog, progress, order]);
  return <MeaningBridgeContext.Provider value={select}>{children}</MeaningBridgeContext.Provider>;
}

export function MeaningBridgeMemory({ detail, position }: { detail: WordDetail; position?: StudyPosition }) {
  const select = useContext(MeaningBridgeContext);
  const hover = useWordHover();
  const bridge = select?.(detail, position);
  if (!bridge || !hover) return null;
  return <section className="session-section meaning-bridge" aria-label="以熟带生">
    <header><div><span>FAMILIAR WORD</span><h3>以熟带生</h3></div></header>
    <div className="meaning-bridge-anchor">
      <span>{bridge.relation === "antonym" ? "反义对照" : "近义参照"}</span>
      <button type="button" className="word-tag-link" aria-label={`查看熟词 ${bridge.anchorSpelling}`}
        onMouseEnter={event => hover.showHover(bridge.anchorId, event.currentTarget, true)}
        onMouseLeave={hover.hideHover}
        onFocus={event => hover.showHover(bridge.anchorId, event.currentTarget, true)}
        onBlur={hover.hideHover}
        onClick={event => { event.stopPropagation(); hover.showHover(bridge.anchorId, event.currentTarget, true, true); }}>
        {bridge.anchorSpelling}
      </button>
    </div>
    <p>{bridge.explanation}</p>
  </section>;
}
