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
  });
}
