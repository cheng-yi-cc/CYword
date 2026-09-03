import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import type { WordsRequest } from "./types";

async function readResponse(response: Response) {
  if (!response.ok) throw new Error(`词库服务暂时不可用（${response.status}）`);
  return response.json();
}

if (!window.cyword) {
  window.cyword = {
    readCatalog: () => fetch("/api/books/cet6/catalog", { cache: "no-store", signal: AbortSignal.timeout(10_000) }).then(readResponse),
    readWords: (request: WordsRequest) => fetch("/api/books/cet6/words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15_000),
    }).then(readResponse),
    readProgress: async () => {
      const stored = localStorage.getItem("cyword-preview-progress");
      return stored ? JSON.parse(stored) : { version: 2, planDays: {}, words: {}, bookmarks: {}, reviewHistory: [] };
    },
    writeProgress: async (progress) => {
      localStorage.setItem("cyword-preview-progress", JSON.stringify(progress));
      return true;
    },
  };
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
