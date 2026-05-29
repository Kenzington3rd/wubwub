// Beat-pulse animation — Phase B7.
//
// happy-dom does not run the CSS engine or the browser's animation runtime,
// so this test, like focus-rings.test.js, is a source-level grep. Two parts:
//
//   1. `@keyframes beatPulse` is declared in `src/index.css` with the
//      documented opacity + transform stops (the actual animation engine
//      lives in the browser; here we only verify the rule exists and shape-
//      matches the design contract).
//   2. At least one component sets `animation: beatPulse Ns infinite ...` —
//      otherwise the keyframes are dead CSS and the visible behaviour is gone.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_CSS = resolve(__dirname, "..", "src", "index.css");
const COMPONENTS_DIR = resolve(__dirname, "..", "src", "components");

function readAllComponentSources() {
  const files = readdirSync(COMPONENTS_DIR).filter((f) => f.endsWith(".jsx"));
  return files.map((f) => ({
    name: f,
    src: readFileSync(resolve(COMPONENTS_DIR, f), "utf8"),
  }));
}

describe("Beat-pulse animation — Phase B7", () => {
  it("src/index.css declares @keyframes beatPulse", () => {
    const css = readFileSync(INDEX_CSS, "utf8");
    expect(css).toMatch(/@keyframes\s+beatPulse\s*{/);
  });

  it("the beatPulse keyframes carry an opacity stop and a transform stop", () => {
    const css = readFileSync(INDEX_CSS, "utf8");
    const block = css.match(/@keyframes\s+beatPulse\s*{([\s\S]*?)^\}/m);
    expect(block, "could not extract @keyframes beatPulse body").toBeTruthy();
    const body = block[1];
    expect(body).toMatch(/opacity\s*:/);
    expect(body).toMatch(/transform\s*:/);
  });

  it("at least one component consumes the beatPulse animation by name", () => {
    // Source-grep: a component must reference the `beatPulse` name in an
    // `animation` declaration. Without this, the keyframes are dead weight.
    // Components write the property either as a quoted string (`"beatPulse 1s …"`)
    // or as a template literal (`` `beatPulse ${seconds}s …` ``) — so we
    // must accept ' " or ` as the opener. After the `animation:` key, scan
    // forward for any opener, then for the literal word `beatPulse` within
    // the same statement (no `;` or line break between them).
    const matches = readAllComponentSources().filter(({ src }) =>
      /animation\s*:[^;\n]*?(['"`])[^'"`;\n]*beatPulse/i.test(src)
    );
    expect(
      matches.length,
      "expected at least one component to set animation: beatPulse …"
    ).toBeGreaterThanOrEqual(1);
  });

  it("prefers-reduced-motion media query neutralises animation duration", () => {
    // Accessibility: the beat pulse (and every animation) is gated by a
    // reduced-motion override at src/index.css:27-33. Drop that override and
    // users with vestibular-trigger sensitivities lose their pause button.
    const css = readFileSync(INDEX_CSS, "utf8");
    expect(css).toMatch(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/);
    expect(css).toMatch(/animation-duration\s*:\s*0\.01ms\s*!important/);
  });
});
