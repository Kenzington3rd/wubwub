// Content-Security-Policy enforcement check — Phase B3.
//
// The CSP lives in two places:
//   1. The source `index.html` head, which is what the dev server serves and
//      what every build starts from.
//   2. `vite.config.js#CSP_CONTENT`, which is the canonical string the
//      `reinjectSecurityMeta` plugin re-injects into the built HTML after
//      `vite-plugin-pwa` / `vite-plugin-singlefile` would otherwise drop it.
//
// We parse the source CSP and assert it forbids every external-origin attack
// surface. We ALSO assert the vite.config.js CSP_CONTENT string holds the same
// promises — those two strings should never drift apart.
//
// This is the headless-safe complement to the build-artifact tests in
// `build.test.js` / `build-single.test.js`. It runs in every `npm test` run
// (no `dist/` required) and gives developers an instant signal when the CSP
// is loosened by accident.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_INDEX = resolve(__dirname, "..", "index.html");
const VITE_CONFIG = resolve(__dirname, "..", "vite.config.js");

function readCspFromHtml(htmlPath) {
  const html = readFileSync(htmlPath, "utf8");
  // The CSP value itself contains single quotes ('self', 'none', etc.), so
  // we can't use [^"'] as the inner character class — that would truncate at
  // the first apostrophe. Match the attribute's opening quote, then capture
  // everything up to the matching closing quote of the same kind.
  const match = html.match(
    /http-equiv=["']Content-Security-Policy["']\s+content=(["'])([\s\S]*?)\1/i
  );
  if (!match) throw new Error(`No CSP meta tag in ${htmlPath}`);
  return match[2];
}

function readCspFromViteConfig(configPath) {
  // CSP_CONTENT is concatenated via `+` inside vite.config.js. Each string
  // literal in the chain contains its own `;` directive separator, which
  // makes a lazy "stop at the first `;`" match useless here. Instead we
  // anchor on the `const CSP_CONTENT = ` declaration and walk to the next
  // top-level `const` declaration that follows it. We don't execute the
  // file (Vite ESM imports would pull in the whole plugin chain).
  const src = readFileSync(configPath, "utf8");
  const startMatch = src.match(/const\s+CSP_CONTENT\s*=/);
  if (!startMatch) throw new Error("Could not find CSP_CONTENT in vite.config.js");
  const startIdx = startMatch.index + startMatch[0].length;
  // Cut off at the next sibling `const ` declaration (or end of file).
  const tail = src.slice(startIdx);
  const endRel = tail.search(/\n\s*const\s+/);
  const block = endRel === -1 ? tail : tail.slice(0, endRel);
  // Extract every string literal in the block and concat them — the runtime
  // value of CSP_CONTENT is exactly that concatenation. Double-quoted only,
  // matching how vite.config.js writes them (so apostrophes inside `'self'`
  // do not split the literal).
  const literals = [...block.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  return literals.join("");
}

const directiveOf = (csp, name) => {
  const re = new RegExp(`${name}\\s+([^;]+)`, "i");
  return csp.match(re)?.[1]?.trim() ?? "";
};

describe("CSP — Phase B3 — source index.html", () => {
  let csp;
  it("CSP meta tag is present and parseable", () => {
    csp = readCspFromHtml(SRC_INDEX);
    expect(typeof csp).toBe("string");
    expect(csp.length).toBeGreaterThan(0);
  });

  it("connect-src is 'none' — the app makes ZERO outbound requests", () => {
    csp = csp || readCspFromHtml(SRC_INDEX);
    const dir = directiveOf(csp, "connect-src");
    // Strictly 'none' is the local-only promise. 'self' would also be safe
    // but loosens the contract — the source uses 'none' and the test pins it.
    expect(dir).toMatch(/^'none'$/);
    expect(dir).not.toMatch(/https?:\/\//);
    expect(dir).not.toMatch(/\*/);
  });

  it("frame-src is 'none' — no iframes / embeds / pop-ins", () => {
    csp = csp || readCspFromHtml(SRC_INDEX);
    expect(directiveOf(csp, "frame-src")).toMatch(/^'none'$/);
  });

  it("object-src is 'none' — no Flash / plug-in surface", () => {
    csp = csp || readCspFromHtml(SRC_INDEX);
    expect(directiveOf(csp, "object-src")).toMatch(/^'none'$/);
  });

  it("base-uri is 'self' — no DOM-based <base> hijack", () => {
    csp = csp || readCspFromHtml(SRC_INDEX);
    expect(directiveOf(csp, "base-uri")).toMatch(/^'self'$/);
  });

  it("form-action is 'none' — no POST exfiltration surface", () => {
    csp = csp || readCspFromHtml(SRC_INDEX);
    expect(directiveOf(csp, "form-action")).toMatch(/^'none'$/);
  });

  it("script-src does NOT include 'unsafe-eval'", () => {
    csp = csp || readCspFromHtml(SRC_INDEX);
    const dir = directiveOf(csp, "script-src");
    expect(dir).not.toMatch(/'unsafe-eval'/);
    // No external host either.
    expect(dir).not.toMatch(/https?:\/\//);
  });

  it("default-src is 'self' — every fallback directive defaults to same-origin", () => {
    csp = csp || readCspFromHtml(SRC_INDEX);
    expect(directiveOf(csp, "default-src")).toMatch(/^'self'$/);
  });

  it("img-src and font-src allow data: but never an external host", () => {
    csp = csp || readCspFromHtml(SRC_INDEX);
    const img = directiveOf(csp, "img-src");
    const font = directiveOf(csp, "font-src");
    // data: is required (the single-file build inlines images + fonts as data: URIs).
    expect(img).toMatch(/data:/);
    expect(font).toMatch(/data:/);
    // But not the wider web.
    expect(img).not.toMatch(/https?:\/\//);
    expect(font).not.toMatch(/https?:\/\//);
  });

  it("worker-src includes blob: — the looper worklet is a Blob URL", () => {
    csp = csp || readCspFromHtml(SRC_INDEX);
    // The looper worklet is registered from `URL.createObjectURL(blob)`;
    // dropping `blob:` here silently breaks the looper in every build mode.
    expect(directiveOf(csp, "worker-src")).toMatch(/blob:/);
  });
});

describe("CSP — Phase B3 — vite.config.js canonical string matches source", () => {
  it("CSP_CONTENT in vite.config.js has the same hardened directives as index.html", () => {
    const fromConfig = readCspFromViteConfig(VITE_CONFIG);
    expect(directiveOf(fromConfig, "connect-src")).toMatch(/^'none'$/);
    expect(directiveOf(fromConfig, "frame-src")).toMatch(/^'none'$/);
    expect(directiveOf(fromConfig, "object-src")).toMatch(/^'none'$/);
    expect(directiveOf(fromConfig, "base-uri")).toMatch(/^'self'$/);
    expect(directiveOf(fromConfig, "form-action")).toMatch(/^'none'$/);
    expect(directiveOf(fromConfig, "script-src")).not.toMatch(/'unsafe-eval'/);
    expect(directiveOf(fromConfig, "worker-src")).toMatch(/blob:/);
  });
});
