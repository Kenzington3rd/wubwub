// Single-file build artifact validation — Phase B2.
//
// `npm run build:single` produces ONE self-contained `dist-single/index.html`.
// The portability promise is that opening that file from `file://` works with
// zero sibling fetches: scripts and styles are inlined, fonts are inlined as
// data: URIs, the apple-touch-icon is inlined as a data: PNG.
//
// This test inspects the built HTML and asserts every one of those promises
// holds. It SKIPS when `dist-single/` is absent so `npm test` stays green
// without running `build:single` first. CI runs it after build (see the
// `verify:single` npm script).

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_SINGLE = resolve(__dirname, "..", "dist-single");
const HAS_DIST = existsSync(DIST_SINGLE);

function maybe(testFn, condition, reason) {
  if (condition) return testFn;
  return Object.assign(
    (name, body) => testFn.skip(`${name} — skipped (${reason})`, body),
    { skip: testFn.skip }
  );
}

describe("Single-file build artifact — Phase B2", () => {
  const runIt = maybe(
    it,
    HAS_DIST,
    "no dist-single/ — run `npm run build:single` first"
  );

  runIt("dist-single/index.html exists and is non-empty", () => {
    const p = resolve(DIST_SINGLE, "index.html");
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).size).toBeGreaterThan(0);
  });

  runIt("the single-file HTML has NO <script src='external URL'> references", () => {
    const html = readFileSync(resolve(DIST_SINGLE, "index.html"), "utf8");
    const externalScripts = [
      ...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/gi),
    ].filter((m) => /^https?:\/\//i.test(m[1]));
    expect(
      externalScripts,
      `external <script src> references found: ${externalScripts
        .map((m) => m[1])
        .join(", ")}`
    ).toHaveLength(0);
  });

  runIt(
    "the single-file HTML has NO <link rel='stylesheet'> referencing external URLs",
    () => {
      const html = readFileSync(resolve(DIST_SINGLE, "index.html"), "utf8");
      const externalSheets = [
        ...html.matchAll(
          /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi
        ),
      ].filter((m) => /^https?:\/\//i.test(m[1]));
      expect(
        externalSheets,
        `external <link rel=stylesheet> references found: ${externalSheets
          .map((m) => m[1])
          .join(", ")}`
      ).toHaveLength(0);
    }
  );

  runIt("fonts are inlined as data:font/woff2 URIs in the HTML body", () => {
    const html = readFileSync(resolve(DIST_SINGLE, "index.html"), "utf8");
    // Self-hosted woff2 fonts (Audiowide + Exo 2) are imported via Vite `?url`
    // and inlined into the single-file build as data: URIs. If either is
    // missing the artifact would still render but would fall back to the
    // browser's default font + lose the WAVECRAFT visual identity.
    const dataFontMatches = html.match(/data:font\/woff2;base64,/g) ?? [];
    expect(
      dataFontMatches.length,
      "expected at least 2 inlined woff2 fonts (Audiowide + Exo 2)"
    ).toBeGreaterThanOrEqual(2);
  });

  runIt("apple-touch-icon is inlined as a data:image/png URI (no sibling icon file)", () => {
    const html = readFileSync(resolve(DIST_SINGLE, "index.html"), "utf8");
    // The single-file build replaces the icon path with a data: PNG so
    // file:// opens have zero sibling fetches.
    expect(html).toMatch(
      /<link\s+rel=["']apple-touch-icon["'][^>]*href=["']data:image\/png;base64,/i
    );
  });

  runIt("the CSP <meta> tag is present and connect-src does NOT permit external origins", () => {
    const html = readFileSync(resolve(DIST_SINGLE, "index.html"), "utf8");
    // CSP value contains single quotes; capture group uses a back-reference so
    // it doesn't truncate at the first apostrophe inside the attribute value.
    const cspMatch = html.match(
      /http-equiv=["']Content-Security-Policy["']\s+content=(["'])([\s\S]*?)\1/i
    );
    expect(cspMatch, "CSP meta tag should be present").toBeTruthy();
    const csp = cspMatch[2];
    // connect-src must be 'none' or 'self' — never `*`, never an external host.
    expect(csp).toMatch(/connect-src\s+'(none|self)'/);
    expect(csp).not.toMatch(/connect-src[^;]*https?:\/\//i);
    expect(csp).not.toMatch(/connect-src[^;]*\*/);
  });

  runIt("inline <script type='module'> carries the React + app bundle", () => {
    const html = readFileSync(resolve(DIST_SINGLE, "index.html"), "utf8");
    // At least one inline module script should be present (the inlined bundle).
    expect(html).toMatch(/<script\s+type=["']module["']>/i);
  });

  runIt("no PWA service-worker registration leaks into the single-file build", () => {
    const html = readFileSync(resolve(DIST_SINGLE, "index.html"), "utf8");
    // vite-plugin-singlefile and vite-plugin-pwa are mutually exclusive — a
    // registerSW reference in the single-file artifact would be a build bug.
    expect(html).not.toMatch(/registerSW\.js/);
    expect(html).not.toMatch(/manifest\.webmanifest/);
  });
});
