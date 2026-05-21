import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { injectFonts } from "./fonts/index.js";

// Inject @font-face declarations whose URLs are produced by Vite's asset
// pipeline. In the single-file build the URLs are inline `data:` URIs, so
// `dist-single/index.html` ships standalone with no sibling `fonts/` folder.
injectFonts();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
