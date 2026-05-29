// Keyboard-focus visibility — Phase B6.
//
// happy-dom does not run the CSS engine, so we can't render a control and
// assert `getComputedStyle(el).outline` produces "2px solid …". The next-best
// guarantee is a source-level grep: the rule MUST exist in `src/index.css`,
// it MUST be `*:focus-visible`, and the outline must use the documented
// text-primary token (#ccd6f6) per DESIGN_GUIDE §6 (which explains why the
// ring is bound to a neutral colour, not the deck accent).
//
// This is the same contract as the structural-evidence row in
// `docs/E2E_VERIFICATION.md`, lifted into Vitest so a maintainer who deletes
// the rule trips a build-time failure instead of relying on manual QA.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_CSS = resolve(__dirname, "..", "src", "index.css");

describe("CSS focus rings — Phase B6 — index.css source", () => {
  let css;
  it("src/index.css exists and is non-empty", () => {
    css = readFileSync(INDEX_CSS, "utf8");
    expect(css.length).toBeGreaterThan(0);
  });

  it("declares a *:focus-visible rule", () => {
    css = css || readFileSync(INDEX_CSS, "utf8");
    // Tolerant whitespace; the selector itself is the load-bearing piece.
    expect(css).toMatch(/\*\s*:\s*focus-visible\s*{/);
  });

  it("the focus-visible rule sets an outline using the text-primary token (#ccd6f6)", () => {
    css = css || readFileSync(INDEX_CSS, "utf8");
    // Pull out the rule body so a stray `outline: 2px solid #ccd6f6` elsewhere
    // can't satisfy the test by accident.
    const block = css.match(/\*\s*:\s*focus-visible\s*{([\s\S]*?)}/);
    expect(block, "expected the *:focus-visible rule body to exist").toBeTruthy();
    const body = block[1];
    // Token check — neutral text colour, not a deck accent. DESIGN_GUIDE §6
    // calls this out so the ring stays readable on every deck theme.
    expect(body).toMatch(/outline\s*:\s*2px\s+solid\s+#ccd6f6/i);
    expect(body).toMatch(/outline-offset\s*:\s*2px/i);
  });

  it("the global outline rule is NOT removed or scoped behind a no-op selector", () => {
    css = css || readFileSync(INDEX_CSS, "utf8");
    // Sanity: a maintainer who replaces `*:focus-visible` with `:focus`
    // would lose the mouse-vs-keyboard discrimination that :focus-visible
    // gives us — block that regression explicitly.
    expect(css).not.toMatch(/^\s*:focus\s*{/m);
  });
});
