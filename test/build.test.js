// Build-artifact validation: multi-file PWA bundle in `dist/`.
//
// Phase B1 (per the directive): validate dist/manifest.webmanifest as JSON
// with the required fields, that referenced icons exist on disk, that the
// service worker registration files are present, and that the built
// index.html still carries the CSP and other security meta tags.
//
// This file gracefully *skips* every assertion when `dist/` is missing so
// `npm test` stays green for contributors who haven't built locally. CI runs
// it after `npm run build` (see the `verify:build` npm script).
//
// No new runtime deps. Pure Node built-ins (`node:fs`, `node:path`).

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, "..", "dist");
const HAS_DIST = existsSync(DIST);

// Skip-or-run helper: `maybe(it, condition)` returns `it.skip` when the
// precondition isn't met. Avoids the all-or-nothing of `describe.skipIf`,
// so an individual mis-shaped artifact still surfaces a failure if dist/
// exists but one specific check is broken.
function maybe(testFn, condition, reason) {
  if (condition) return testFn;
  return Object.assign(
    (name, body) => testFn.skip(`${name} — skipped (${reason})`, body),
    { skip: testFn.skip }
  );
}

describe("PWA multi-file build artifact — Phase B1", () => {
  const runIt = maybe(it, HAS_DIST, "no dist/ — run `npm run build` first");

  runIt("dist/ exists and contains the expected top-level files", () => {
    for (const f of [
      "index.html",
      "manifest.webmanifest",
      "sw.js",
      "registerSW.js",
    ]) {
      const p = resolve(DIST, f);
      expect(existsSync(p), `${f} should exist in dist/`).toBe(true);
      const stat = statSync(p);
      expect(stat.size, `${f} should be non-empty`).toBeGreaterThan(0);
    }
  });

  runIt("dist/manifest.webmanifest parses as JSON and carries the required PWA fields", () => {
    const raw = readFileSync(resolve(DIST, "manifest.webmanifest"), "utf8");
    const manifest = JSON.parse(raw); // throws → test fails, exactly what we want.

    // Spec-required fields for an installable PWA.
    for (const key of [
      "name",
      "short_name",
      "description",
      "theme_color",
      "background_color",
      "display",
      "start_url",
      "scope",
      "icons",
    ]) {
      expect(manifest, `manifest is missing required field "${key}"`).toHaveProperty(key);
    }
    expect(typeof manifest.name).toBe("string");
    expect(typeof manifest.short_name).toBe("string");
    expect(typeof manifest.description).toBe("string");
    expect(manifest.display).toMatch(/standalone|fullscreen|minimal-ui/);
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  runIt("manifest references at least one 192x192 PNG AND one 512x512 PNG and both files exist on disk", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(DIST, "manifest.webmanifest"), "utf8")
    );
    const png192 = manifest.icons.find(
      (i) => i.sizes === "192x192" && (i.type ?? "").includes("png")
    );
    const png512 = manifest.icons.find(
      (i) => i.sizes === "512x512" && (i.type ?? "").includes("png")
    );
    expect(png192, "manifest should declare a 192x192 PNG icon").toBeTruthy();
    expect(png512, "manifest should declare a 512x512 PNG icon").toBeTruthy();
    expect(typeof png192.src).toBe("string");
    expect(typeof png512.src).toBe("string");
    // The icon `src` is relative to the manifest scope — resolve against DIST.
    const p192 = resolve(DIST, png192.src);
    const p512 = resolve(DIST, png512.src);
    expect(existsSync(p192), `${png192.src} should exist on disk`).toBe(true);
    expect(existsSync(p512), `${png512.src} should exist on disk`).toBe(true);
  });

  runIt("dist/sw.js is a Workbox service worker and precaches the app shell", () => {
    const sw = readFileSync(resolve(DIST, "sw.js"), "utf8");
    // The precache manifest is injected by vite-plugin-pwa / Workbox. We don't
    // assert the exact entry list (that drifts across builds) but we DO
    // assert structurally that a precache manifest and the Workbox import are
    // there — without them, offline installability is broken.
    expect(sw.length).toBeGreaterThan(0);
    expect(sw).toMatch(/precache|workbox/i);
    // index.html must be one of the precached routes — otherwise a cold open
    // offline would 404.
    expect(sw).toMatch(/index\.html/);
  });

  runIt("dist/registerSW.js exists and is non-empty", () => {
    const reg = readFileSync(resolve(DIST, "registerSW.js"), "utf8");
    expect(reg.length).toBeGreaterThan(0);
    // The vite-plugin-pwa registration script always references the service worker URL.
    expect(reg).toMatch(/sw\.js|serviceWorker|registerSW/i);
  });

  runIt("dist/index.html still carries the CSP and Permissions-Policy meta tags", () => {
    const html = readFileSync(resolve(DIST, "index.html"), "utf8");
    expect(html).toMatch(/http-equiv=["']Content-Security-Policy["']/i);
    expect(html).toMatch(/http-equiv=["']Permissions-Policy["']/i);
    // Must reference the registered service worker — otherwise the PWA never
    // installs even though dist/sw.js exists.
    expect(html).toMatch(/registerSW\.js|sw\.js/i);
    // Must reference the manifest — required for the install prompt to surface.
    expect(html).toMatch(/manifest\.webmanifest/i);
  });

  runIt("dist/index.html links scripts and styles relatively (no external CDN URLs)", () => {
    const html = readFileSync(resolve(DIST, "index.html"), "utf8");
    // Scan every <script src=...> and <link rel="stylesheet" href=...> for
    // an http:// or https:// URL. Any absolute external URL is a CSP /
    // privacy regression for the local-only promise.
    const scriptSrcs = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/gi)].map(
      (m) => m[1]
    );
    const linkHrefs = [
      ...html.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi),
    ].map((m) => m[1]);
    for (const url of [...scriptSrcs, ...linkHrefs]) {
      expect(
        /^https?:\/\//i.test(url),
        `Expected ${url} to be a relative asset, not an external URL`
      ).toBe(false);
    }
  });

  runIt("CSP from index.html — connect-src is locked down and 'unsafe-eval' is not in script-src", () => {
    const html = readFileSync(resolve(DIST, "index.html"), "utf8");
    // The CSP value contains single quotes ('self', 'none'); capture group
    // must use a back-reference to the same quote kind so it doesn't truncate
    // at the first apostrophe.
    const match = html.match(
      /http-equiv=["']Content-Security-Policy["']\s+content=(["'])([\s\S]*?)\1/i
    );
    expect(match, "CSP meta tag should be present in dist/index.html").toBeTruthy();
    const csp = match[2];
    // connect-src must NOT permit external origins.
    expect(csp).toMatch(/connect-src\s+'(none|self)'/);
    expect(csp).not.toMatch(/connect-src[^;]*https?:\/\//i);
    // script-src must NOT include 'unsafe-eval'.
    const scriptSrc = csp.match(/script-src\s+([^;]+)/i)?.[1] ?? "";
    expect(scriptSrc).not.toMatch(/'unsafe-eval'/);
    expect(csp).toMatch(/frame-src\s+'none'/);
    expect(csp).toMatch(/object-src\s+'none'/);
    expect(csp).toMatch(/base-uri\s+'self'/);
  });
});
