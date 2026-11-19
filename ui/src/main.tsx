import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { installTitleTips } from "./components/Tooltip/titleTips.ts";
import "./fonts.css";
import "./globals.css";
import "./transitions.css";

// every `title` in the app shows as the game's own tooltip, never the browser's
installTitleTips();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
