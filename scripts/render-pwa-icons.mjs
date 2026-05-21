// Renders PNG PWA icons from public/icons/icon.svg.
//
// iOS Safari ignores SVG icons in a web app manifest for the Add-to-Home
// -Screen flow, so the manifest also lists PNGs at 192x192 and 512x512.
// This script regenerates those PNGs from the canonical SVG. Run it whenever
// the SVG changes, then commit the resulting PNGs.
//
// Usage:
//   node scripts/render-pwa-icons.mjs
//
// Dependencies: `sharp` (devDependency). If `sharp` is unavailable on your
// platform you can render the PNGs manually with any SVG-aware tool, e.g.:
//   rsvg-convert -w 192 -h 192 public/icons/icon.svg > public/icons/icon-192.png
//   rsvg-convert -w 512 -h 512 public/icons/icon.svg > public/icons/icon-512.png

import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SVG_PATH = join(ROOT, "public", "icons", "icon.svg");
const OUTPUTS = [
  { size: 192, path: join(ROOT, "public", "icons", "icon-192.png") },
  { size: 512, path: join(ROOT, "public", "icons", "icon-512.png") },
];

let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch (err) {
  console.error("sharp is not installed. Run `npm install` (it is listed as a");
  console.error("devDependency) or install it manually with `npm i -D sharp`.");
  console.error("Original error:", err.message);
  process.exit(1);
}

const svg = await readFile(SVG_PATH);

for (const { size, path } of OUTPUTS) {
  const png = await sharp(svg, { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 7, g: 10, b: 20, alpha: 1 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(path, png);
  console.log(`  wrote ${path} (${size}x${size}, ${png.length} bytes)`);
}
