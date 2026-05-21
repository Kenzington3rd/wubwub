import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// `src/fonts/index.js` keeps its `injected` flag at module scope. To verify
// "safe to call multiple times" cleanly, each test re-imports the module via
// `vi.resetModules()` so the flag starts fresh.

const SELECTOR = "style[data-wavecraft-fonts]";

async function loadInjectFonts() {
  vi.resetModules();
  const mod = await import("../src/fonts/index.js");
  return mod.injectFonts;
}

describe("injectFonts()", () => {
  beforeEach(() => {
    // Remove any leftover marker from prior runs.
    for (const el of document.querySelectorAll(SELECTOR)) el.remove();
  });

  afterEach(() => {
    for (const el of document.querySelectorAll(SELECTOR)) el.remove();
  });

  it("injects exactly one marked <style> on a single call", async () => {
    const injectFonts = await loadInjectFonts();
    injectFonts();
    const styles = document.querySelectorAll(SELECTOR);
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toContain("@font-face");
    expect(styles[0].textContent).toContain("Audiowide");
    expect(styles[0].textContent).toContain("Exo 2");
  });

  it("is idempotent — two calls still produce exactly one <style>", async () => {
    const injectFonts = await loadInjectFonts();
    injectFonts();
    injectFonts();
    injectFonts(); // third for good measure
    expect(document.querySelectorAll(SELECTOR)).toHaveLength(1);
  });

  it("does not throw when document is undefined (worker / SSR contexts)", async () => {
    // Stub `document` to undefined for the lifetime of this test. Using
    // `vi.stubGlobal` so the cleanup is automatic (vitest restores on
    // `unstubAllGlobals` between tests when configured, but we restore
    // explicitly to be safe across the suite).
    const realDocument = globalThis.document;
    try {
      // eslint-disable-next-line no-global-assign
      globalThis.document = undefined;
      const injectFonts = await loadInjectFonts();
      expect(() => injectFonts()).not.toThrow();
    } finally {
      globalThis.document = realDocument;
    }
    // And the real document still has no injected style afterwards.
    expect(document.querySelectorAll(SELECTOR)).toHaveLength(0);
  });
});
