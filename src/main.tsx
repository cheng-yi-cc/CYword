import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./mobile.css";
import { installPlatform } from "./platform";
import { AndroidUpdateNotice } from "./components/AndroidUpdates";

installPlatform();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <AndroidUpdateNotice />
  </React.StrictMode>,
);
