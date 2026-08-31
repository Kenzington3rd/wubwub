// Playwright drives the REAL single-file build in a REAL browser.
//
// This complements the Vitest suite rather than duplicating it: Vitest runs in
// happy-dom with Web Audio mocked, which is fast and covers component logic and
// full interaction coverage (WC-COVER). It cannot, by construction, exercise
// real audio decoding, a real filter graph, a real canvas, or the `file://`
// origin the single-file build actually ships on. That is this suite's job.
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

// The app under test is the artifact users actually download.
const APP = "file://" + path.resolve("dist-single/index.html");

/**
 * Chromium binary to drive.
 *
 * CI installs a browser matching the pinned @playwright/test, so nothing is
 * needed there. Some sandboxes ship a pre-installed Chromium whose build number
 * does not match, and Playwright refuses it rather than falling back — set
 * WAVECRAFT_CHROMIUM to that binary (or just have it on the standard path) and
 * this picks it up instead of failing with "Executable doesn't exist".
 */
function resolveChromium() {
  if (process.env.WAVECRAFT_CHROMIUM) return process.env.WAVECRAFT_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !fs.existsSync(root)) return undefined; // let Playwright decide
  const dir = fs
    .readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort()
    .pop();
  if (!dir) return undefined;
  const bin = path.join(root, dir, "chrome-linux", "chrome");
  return fs.existsSync(bin) ? bin : undefined;
}

const CHROMIUM = resolveChromium();

export default defineConfig({
  testDir: "./test-browser",
  // Audio decode + detection are genuinely slow; these are not unit tests.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: APP,
    trace: "retain-on-failure",
    video: "off",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1600, height: 1000 },
        launchOptions: {
          ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
          args: [
            // Headless Chromium will not start an AudioContext without a user
            // gesture; without this every audio assertion tests nothing.
            "--autoplay-policy=no-user-gesture-required",
            // CI containers run as root.
            "--no-sandbox",
          ],
        },
      },
    },
  ],
});
