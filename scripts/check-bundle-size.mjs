// Bundle-size budget check (backlog item W1.6).
//
// WAVECRAFT ships as an offline-precached PWA and as a single portable HTML
// file, so build size is a real product constraint. This script runs after a
// `vite build` and fails loudly when a change bloats the bundle.
//
// Node built-ins only (no new dependencies): node:fs, node:zlib, node:path.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// --- Budgets -----------------------------------------------------------------
// Ceilings sit ABOVE current measured sizes with headroom: they absorb normal
// growth but catch real regressions. Update deliberately, never to silence a
// failure. Current (2026-05): main JS ~67 KB gzip, total precache ~265 KB.
const MAIN_JS_GZIP_BUDGET_BYTES = 90 * 1024; // 90 KB — main entry chunk, gzipped
const TOTAL_PRECACHE_BUDGET_BYTES = 400 * 1024; // 400 KB — everything in dist/

// --- Paths -------------------------------------------------------------------
const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const DIST = join(ROOT, "dist");
const ASSETS = join(DIST, "assets");

// --- Helpers -----------------------------------------------------------------
const KB = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

/** Recursively collect every file path under a directory. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function fail(message) {
  console.error(`\n  ERROR: ${message}`);
  console.error("  Run `npm run build` first, then re-run this check.\n");
  process.exit(1);
}

// --- Locate the main JS bundle ----------------------------------------------
let assetFiles;
try {
  assetFiles = readdirSync(ASSETS);
} catch {
  fail(`dist/assets/ not found at ${ASSETS}`);
}

// Vite emits the entry chunk as the largest hashed .js file in assets/.
const jsBundles = assetFiles
  .filter((name) => name.endsWith(".js"))
  .map((name) => {
    const path = join(ASSETS, name);
    return { name, path, raw: statSync(path).size };
  })
  .sort((a, b) => b.raw - a.raw);

if (jsBundles.length === 0) fail("no .js bundle found in dist/assets/");

const mainBundle = jsBundles[0];
const mainGzip = gzipSync(readFileSync(mainBundle.path)).length;

// --- Measure total precache size --------------------------------------------
// The PWA service worker precaches the whole dist/ tree, so total dist/ size is
// a fair proxy for the offline payload users download.
const totalRaw = walk(DIST).reduce((sum, file) => sum + statSync(file).size, 0);

// --- Report ------------------------------------------------------------------
const checks = [
  {
    label: "Main JS bundle (gzip)",
    detail: mainBundle.name,
    actual: mainGzip,
    budget: MAIN_JS_GZIP_BUDGET_BYTES,
  },
  {
    label: "Total dist/ precache (raw)",
    detail: "all precached assets",
    actual: totalRaw,
    budget: TOTAL_PRECACHE_BUDGET_BYTES,
  },
];

console.log("\n  WAVECRAFT bundle-size budget check");
console.log("  ----------------------------------");

let failed = false;
for (const c of checks) {
  const ok = c.actual <= c.budget;
  if (!ok) failed = true;
  const status = ok ? "PASS" : "FAIL";
  const pct = ((c.actual / c.budget) * 100).toFixed(0);
  console.log(
    `  [${status}] ${c.label}: ${KB(c.actual)} / ${KB(c.budget)} budget (${pct}%)`,
  );
  console.log(`         ${c.detail}`);
}
console.log("  ----------------------------------");

if (failed) {
  console.error("  Budget exceeded. Trim the build or, if the growth is");
  console.error("  intentional and justified, raise the budget constant.\n");
  process.exit(1);
}

console.log("  All bundle-size budgets satisfied.\n");
process.exit(0);
