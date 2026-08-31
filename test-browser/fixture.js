// Shared test fixtures.
//
// Two jobs, and the ORDER of them is the whole point:
//   1. attach console/pageerror listeners,
//   2. THEN navigate.
// Doing it the other way round (the obvious way, with `appErrors` depending on
// an already-navigated `page`) silently misses every error thrown during boot —
// which is exactly the class of error most worth catching.
import { test as base, expect } from "@playwright/test";

const ERRORS = Symbol("appErrors");

export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page[ERRORS] = errors;

    await page.goto(baseURL, { waitUntil: "networkidle" });
    // Wait for React to mount rather than a fixed sleep.
    await page.getByRole("button", { name: /Load audio for Deck A/i }).waitFor();
    await use(page);
  },

  // Live array — assert on it at the END of a test to cover the whole run.
  appErrors: async ({ page }, use) => {
    await use(page[ERRORS]);
  },
});

export { expect };
