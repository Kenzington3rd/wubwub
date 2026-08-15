// App icon — the mark that ships as the favicon, the PWA/home-screen icon and
// the Windows / macOS / Linux desktop app icon (package.json#build.*.icon all
// point at icon-512.png).
//
// `test/build.test.js` already checks the manifest *declares* icons. This file
// checks the icons are actually good: correct dimensions, genuinely rendered
// (not a blank square), and — the failure mode that has no other guard — the
// committed PNGs still match the SVG they are generated from. Editing
// icon.svg and forgetting to re-run scripts/render-pwa-icons.mjs ships a new
// mark in the browser tab and the old one on the desktop.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const SVG_PATH = "public/icons/icon.svg";
const SVG = readFileSync(SVG_PATH, "utf8");

// Minimal PNG header reader — width/height are big-endian at bytes 16..24 of
// the IHDR chunk. Avoids pulling an image library in for two integers.
function pngSize(path) {
  const buf = readFileSync(path);
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
}

describe("app icon — source mark — US76", () => {
  it("@us US76: icon.svg exists and is a square, viewBox-scaled SVG", () => {
    expect(existsSync(SVG_PATH)).toBe(true);
    expect(SVG).toMatch(/<svg[^>]*viewBox="0 0 512 512"/);
    // No fixed width/height: the mark must scale cleanly from 16 px favicon to
    // a 512 px desktop icon.
    expect(SVG).not.toMatch(/<svg[^>]*\swidth="\d/);
  });

  it("@us US76: the mark is self-contained — no external refs, no raster embeds", () => {
    // Danger zone: the icon is precached by the service worker and inlined
    // into the single-file build. An external href would be a network call.
    // `xmlns` is a namespace identifier, not a URL that is ever fetched —
    // strip it before looking for real external references.
    const withoutNs = SVG.replace(/xmlns(:\w+)?="[^"]*"/g, "");
    expect(withoutNs).not.toMatch(/https?:\/\//);
    expect(SVG).not.toMatch(/<image\b/);
    expect(SVG).not.toMatch(/xlink:href/);
  });

  it("@us US76: the mark carries an accessible title", () => {
    expect(SVG).toMatch(/<title>WAVECRAFT<\/title>/);
    expect(SVG).toMatch(/aria-label="WAVECRAFT"/);
  });

  it("@us US76: artwork sits inside the maskable safe zone", () => {
    // PWA maskable icons can be cropped to a circle of 80% of the canvas.
    // The disc is the outermost artwork, so its diameter must stay under
    // 0.8 × 512 = 409.6 px or Android will clip the mark.
    const r = Number(/<circle cx="256" cy="256" r="(\d+)" fill="url\(#disc\)"/.exec(SVG)[1]);
    expect(r * 2).toBeLessThanOrEqual(409);
    // ...and be large enough to actually fill the tile rather than float in it.
    expect(r * 2).toBeGreaterThan(300);
  });
});

describe("app icon — rendered PNGs — US76", () => {
  const CASES = [
    { path: "public/icons/icon-192.png", size: 192 },
    { path: "public/icons/icon-512.png", size: 512 },
  ];

  for (const { path, size } of CASES) {
    it(`@us US76: ${path} is a real ${size}×${size} PNG with actual artwork`, () => {
      expect(existsSync(path)).toBe(true);
      const png = pngSize(path);
      expect(png.width).toBe(size);
      expect(png.height).toBe(size);
      // A flat/blank square compresses to almost nothing. The real mark has a
      // gradient disc, grooves and nine cut-outs, so it cannot be this small.
      expect(png.bytes).toBeGreaterThan(size * 12);
    });
  }

  it("@us US76: the committed PNGs were regenerated from the current SVG", async () => {
    // The one drift no other test catches: icon.svg edited, PNGs not re-rendered.
    // Re-render in memory and compare dimensions + rough ink coverage against
    // the committed files.
    let sharp;
    try {
      ({ default: sharp } = await import("sharp"));
    } catch {
      // sharp is a devDependency and is skipped in some CI installs; the
      // dimension checks above still apply. Don't fail the suite for a
      // missing optional renderer — but don't silently claim coverage either.
      console.warn("sharp unavailable — skipping SVG↔PNG sync check");
      return;
    }

    for (const { path, size } of CASES) {
      // Mirror scripts/render-pwa-icons.mjs, including its palette
      // quantization — otherwise this compares against an encoding the
      // project never actually ships.
      const fresh = await sharp(readFileSync(SVG_PATH), { density: 384 })
        .resize(size, size, { fit: "contain", background: { r: 7, g: 10, b: 20, alpha: 1 } })
        .png({ compressionLevel: 9, palette: true, colors: 128 })
        .toBuffer();
      const committed = readFileSync(path);

      // Byte-identical output isn't guaranteed across sharp/libvips versions,
      // so compare the decoded pixels instead — that is what actually ships.
      // `removeAlpha` normalizes channel count: palette PNGs decode to RGB,
      // truecolor ones to RGBA, and the mark is fully opaque either way.
      const [a, b] = await Promise.all([
        sharp(fresh).removeAlpha().raw().toBuffer(),
        sharp(committed).resize(size, size).removeAlpha().raw().toBuffer(),
      ]);
      expect(a.length).toBe(b.length);

      let diff = 0;
      for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 8) diff++;
      const ratio = diff / a.length;
      expect(
        ratio,
        `${path} differs from icon.svg in ${(ratio * 100).toFixed(1)}% of subpixels — ` +
          "run `node scripts/render-pwa-icons.mjs` and commit the result",
      ).toBeLessThan(0.02);
    }
  });
});
