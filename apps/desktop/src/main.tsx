import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/fonts.css";
import "./styles/globals.css";

// Tell globals.css which window this webview is — the pill +
// switcher routes stay transparent, every other route gets the
// carved-from-darkness canvas. Runs synchronously before React mounts
// so there's no background flash.
if (typeof window !== "undefined") {
  const path = window.location.pathname;
  // Transparent windows: pill overlay + quick mode switcher. Every
  // other route opts into the main window canvas (including the
  // first-run overlay, which is rendered inside the main window).
  const isTransparentWindow = path === "/pill" || path === "/switcher";
  if (!isTransparentWindow) {
    document.documentElement.setAttribute("data-window", "main");
  }
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element in index.html");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
