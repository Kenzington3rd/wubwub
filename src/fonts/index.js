// ──────────────────────────────────────────────────────────
// WAVECRAFT — font @font-face injector
//
// Importing each .woff2 via `?url` runs it through Vite's asset pipeline:
//   - multi-file build (`npm run build`)   → emits a hashed sibling file
//     and `?url` resolves to its relative URL
//   - single-file build (`npm run build:single`) → with
//     `assetsInlineLimit: 100000` in vite.config.js, Vite base64-inlines the
//     woff2 and `?url` resolves to a `data:` URI
//
// Either way, the @font-face block below references a Vite-rewritten URL, so
// the multi-file build keeps the font as a sibling asset while the single
// -file build produces a genuinely standalone `dist-single/index.html`.
// Replaces the previous `src/index.css` declarations that hard-coded the
// absolute `/fonts/...` path (which Vite cannot rewrite from CSS).
// ──────────────────────────────────────────────────────────
import audiowideUrl from "./Audiowide-Regular.woff2?url";
import exo2Url from "./Exo2-Variable.woff2?url";

const FONT_FACE_CSS = `
@font-face {
  font-family: "Audiowide";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("${audiowideUrl}") format("woff2");
}
@font-face {
  font-family: "Exo 2";
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url("${exo2Url}") format("woff2-variations"),
       url("${exo2Url}") format("woff2");
}
`;

let injected = false;

/**
 * Inject WAVECRAFT's @font-face declarations into the document <head>.
 * Safe to call multiple times — only the first call adds the <style>.
 * No-op if `document` is unavailable (e.g. server-side, worker contexts).
 */
export function injectFonts() {
  if (injected) return;
  if (typeof document === "undefined") return;
  const style = document.createElement("style");
  style.setAttribute("data-wavecraft-fonts", "true");
  style.textContent = FONT_FACE_CSS;
  document.head.appendChild(style);
  injected = true;
}
