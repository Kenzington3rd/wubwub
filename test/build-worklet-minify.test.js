// Build-artifact check: `?raw` worklet sources are minified at build time
// (vite.config.js → minifyRawWorklets) yet still registered by name and still
// shipped inside the bundle for Blob-URL registration. Skipped when the
// build output is absent (run `npm run build` / `npm run build:single`).

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function bundleText(dir) {
  if (dir === "dist-single") {
    return readFileSync(resolve(ROOT, dir, "index.html"), "utf8");
  }
  const assets = resolve(ROOT, dir, "assets");
  return readdirSync(assets)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(resolve(assets, f), "utf8"))
    .join("\n");
}

// The `?raw` worklet source is embedded as a template literal containing
// registerProcessor("<name>", …). esbuild strips non-legal comments even with
// minify off, so the comment check alone cannot detect minification being
// disabled; indentation and size can.
//
// Measured from the real minified output (identical in dist/ and dist-single/):
//   looper-processor   source 2662 B  -> minified 1111 B  (bound 1400, ~26% headroom)
//   stretch-processor  source 34015 B -> minified 10053 B  (bound 11600, ~15% headroom)
// Bump the bound when a worklet legitimately grows; it exists to catch
// minification being switched off, not to cap size.
const MAX_MINIFIED_BYTES = {
  "looper-processor": 1400,
  "stretch-processor": 11600,
};

function embeddedSource(all, name) {
  const at = all.indexOf(`registerProcessor("${name}"`);
  if (at < 0) return null;
  const start = all.lastIndexOf("`", at);
  const end = all.indexOf("`", at);
  return start < 0 || end < 0 ? null : all.slice(start + 1, end);
}

// Distinctive comment phrases from each worklet source.
const COMMENTS = [
  "Continuously writes incoming audio into a circular buffer", // looper
  "Registered exactly like the looper worklet", // stretch
];

for (const [dir, marker] of [
  ["dist", "assets"],
  ["dist-single", "index.html"],
]) {
  const run = existsSync(resolve(ROOT, dir, marker)) ? it : it.skip;
  describe(`worklet minification — ${dir}/`, () => {
    run("registers both processors by name", () => {
      const all = bundleText(dir);
      for (const name of ["stretch-processor", "looper-processor"]) {
        // Worklet source is a JS string literal, so quotes may be escaped.
        expect(all).toMatch(
          new RegExp(`registerProcessor\\(\\\\?["']${name}\\\\?["']`),
        );
      }
    });
    run("does not ship worklet comments", () => {
      const all = bundleText(dir);
      for (const phrase of COMMENTS) expect(all).not.toContain(phrase);
    });
    run("embeds minified worklet sources (no indentation, size bounded)", () => {
      const all = bundleText(dir);
      for (const [name, max] of Object.entries(MAX_MINIFIED_BYTES)) {
        const src = embeddedSource(all, name);
        expect(src, `${name} embedded source not found`).not.toBeNull();
        expect(src).not.toMatch(/\n {2,}/);
        expect(src.length).toBeLessThan(max);
      }
    });
  });
}
