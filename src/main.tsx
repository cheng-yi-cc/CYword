import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

if (!window.cyword) {
  window.cyword = {
    readCatalog: () => fetch("/api/catalog").then((response) => response.json()),
    readWord: (wordId) => fetch(`/api/word/${wordId}`).then((response) => response.json()),
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
