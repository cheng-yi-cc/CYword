import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./mobile.css";
import { installPlatform } from "./platform";
import { AndroidUpdateNotice } from "./components/AndroidUpdates";
import { pronunciationPlayer } from "./audio";
import { offlineBook } from "./offline-book";

installPlatform();
pronunciationPlayer.setSourceResolver(url => offlineBook.audioUrl(url));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <AndroidUpdateNotice />
  </React.StrictMode>,
);
