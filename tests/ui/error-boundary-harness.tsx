import React from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "../../src/components/ErrorBoundary";

export function mountBoundaryFixture() {
  let broken = true;
  function Content() { if (broken) throw new Error("isolated rendering fault"); return <p>内容已恢复</p>; }
  const container = document.createElement("div"); container.id = "boundary-fixture"; document.body.append(container);
  const root = createRoot(container);
  root.render(<ErrorBoundary><Content /></ErrorBoundary>);
  return { repair: () => { broken = false; }, close: () => { root.unmount(); container.remove(); } };
}
