import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import Icon, { ICON_NAMES } from "../src/components/Icon.jsx";

describe("Icon component — US56", () => {
  it("@us US56: every named icon renders an <svg> with a non-empty <path>", () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      const svg = container.querySelector("svg");
      const path = container.querySelector("path");
      expect(svg, `${name} should render an svg`).toBeTruthy();
      expect(path, `${name} should render a path`).toBeTruthy();
      expect(path.getAttribute("d")?.length ?? 0).toBeGreaterThan(0);
      unmount();
    }
  });

  it("@us US56: an unknown icon name renders nothing (no broken glyph)", () => {
    const { container } = render(<Icon name="definitely-not-an-icon" />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("@us US56: decorative icons are aria-hidden; titled icons expose a <title>", () => {
    const plain = render(<Icon name="play" />);
    expect(plain.container.querySelector("svg").getAttribute("aria-hidden")).toBe("true");
    plain.unmount();

    const titled = render(<Icon name="play" title="Play" />);
    expect(titled.container.querySelector("title")?.textContent).toBe("Play");
    expect(titled.container.querySelector("svg").getAttribute("role")).toBe("img");
  });

  it("@us US56: size + color props are applied", () => {
    const { container } = render(<Icon name="play" size={32} color="#00f5d4" />);
    const svg = container.querySelector("svg");
    expect(svg.getAttribute("width")).toBe("32");
    // fill icon → path uses fill; stroke icon → path uses stroke
    const path = container.querySelector("path");
    expect(path.getAttribute("fill")).toBe("#00f5d4");
  });

  it("@us US56: stroke-style icons render with a stroke, not a fill", () => {
    const { container } = render(<Icon name="loop" color="#a78bfa" />);
    const path = container.querySelector("path");
    expect(path.getAttribute("stroke")).toBe("#a78bfa");
    expect(path.getAttribute("stroke-width")).toBe("2");
  });
});

describe("Brand enforcement: no emoji in the UI — US57", () => {
  // Walk src/ and assert no emoji / pictographic glyph appears in any source
  // file. Enforces BRANDING_GUIDE §5 ("No emoji. Ever.") at test time.
  const SRC = join(process.cwd(), "src");

  function collectFiles(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...collectFiles(full));
      else if (/\.(jsx?|css|html)$/.test(entry)) out.push(full);
    }
    return out;
  }

  // Pictographic / emoji ranges. Deliberately EXCLUDES the typographic arrows
  // U+2190–U+2193 (used as keycap labels) and box-drawing — those are allowed
  // text per BRANDING_GUIDE §5.
  const EMOJI_RANGES = [
    [0x1f000, 0x1faff], // pictographs, symbols & emoji
    [0x2600, 0x26ff], // misc symbols (☀ ☎ etc.)
    [0x2700, 0x27bf], // dingbats
    [0x2b00, 0x2bff], // misc symbols & arrows (decorative)
    [0xfe00, 0xfe0f], // variation selectors
    [0x1f1e6, 0x1f1ff], // regional indicators
  ];

  it("@us US57: no emoji or pictographic glyphs in src/", () => {
    const offenders = [];
    for (const file of collectFiles(SRC)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, idx) => {
        for (const ch of line) {
          const cp = ch.codePointAt(0);
          if (EMOJI_RANGES.some(([a, b]) => cp >= a && cp <= b)) {
            offenders.push(
              `${file.replace(SRC, "src")}:${idx + 1} → U+${cp
                .toString(16)
                .toUpperCase()} (${ch})`
            );
          }
        }
      });
    }
    expect(offenders, `emoji found:\n${offenders.join("\n")}`).toEqual([]);
  });
});
