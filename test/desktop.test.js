import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

// W4.1 — desktop shell (US74).
//
// The desktop build must inherit the web build's promises, not quietly relax
// them: no network, no telemetry, no auto-update, no Node in the renderer.
// Electron can't be booted in this environment (no display, and the binary is
// skipped in CI installs), so — exactly like test/csp.test.js and
// test/build.test.js — these assert the SOURCE and CONFIG invariants that
// would let a regression through.

const MAIN = readFileSync("electron/main.cjs", "utf8");
const PKG = JSON.parse(readFileSync("package.json", "utf8"));

// Comments explain what the shell deliberately does NOT do, so they mention
// the very APIs the negative assertions forbid. Strip them, or the file's own
// documentation trips its own tests.
const MAIN_CODE = MAIN.replace(/^\s*\/\/.*$/gm, "");

describe("desktop shell — wiring — US74", () => {
  it("@us US74: package.json points at the Electron entry point", () => {
    expect(PKG.main).toBe("electron/main.cjs");
    expect(existsSync("electron/main.cjs")).toBe(true);
  });

  it("@us US74: build + run scripts exist and reuse the single-file bundle", () => {
    // The desktop app must ship the SAME artifact as wavecraft.html — a
    // separate desktop bundle would be a second thing to keep in sync.
    expect(PKG.scripts.desktop).toContain("build:single");
    expect(PKG.scripts["build:desktop"]).toContain("build:single");
    expect(PKG.scripts["build:desktop"]).toContain("electron-builder");
  });

  it("@us US74: electron ships as a devDependency, never a runtime dep", () => {
    // The web build's "zero runtime dependencies beyond react/react-dom"
    // claim (README) must stay true.
    expect(Object.keys(PKG.dependencies)).toEqual(["react", "react-dom"]);
    expect(PKG.devDependencies.electron).toBeTruthy();
    expect(PKG.devDependencies["electron-builder"]).toBeTruthy();
  });
});

describe("desktop shell — secure context for VOX — US74", () => {
  it("@us US74: the app scheme is registered as secure and standard", () => {
    // Without `secure: true` the page is not a secure context and
    // getUserMedia — the whole VOX panel — silently dies on the desktop.
    expect(MAIN).toMatch(/registerSchemesAsPrivileged/);
    expect(MAIN).toMatch(/secure:\s*true/);
    expect(MAIN).toMatch(/standard:\s*true/);
  });

  it("@us US74: the window loads the custom scheme, not file://", () => {
    expect(MAIN).toMatch(/loadURL\(`\$\{ORIGIN\}/);
    expect(MAIN_CODE).not.toMatch(/loadFile\(/);
  });

  it("@us US74: microphone is the only permission granted, and only to our origin", () => {
    expect(MAIN).toMatch(/setPermissionRequestHandler/);
    expect(MAIN).toMatch(/permission === "media"/);
    // Gated on the requesting page actually being our app.
    expect(MAIN).toMatch(/startsWith\(ORIGIN\)/);
  });
});

describe("desktop shell — danger-zone parity — US74", () => {
  it("@us US74: all non-app requests are cancelled (no network, same as web)", () => {
    expect(MAIN).toMatch(/onBeforeRequest/);
    expect(MAIN).toMatch(/cancel:\s*!details\.url\.startsWith/);
  });

  it("@us US74: no auto-updater, telemetry, or crash reporting", () => {
    // An updater is an outbound request by definition — forbidden here.
    expect(MAIN_CODE).not.toMatch(/autoUpdater|electron-updater|crashReporter/);
    expect(PKG.build.publish).toBeNull();
    expect(JSON.stringify(PKG.devDependencies)).not.toMatch(/electron-updater/);
  });

  it("@us US74: the renderer gets no Node access", () => {
    expect(MAIN).toMatch(/nodeIntegration:\s*false/);
    expect(MAIN).toMatch(/contextIsolation:\s*true/);
    expect(MAIN).toMatch(/sandbox:\s*true/);
    expect(MAIN).toMatch(/webSecurity:\s*true/);
  });

  it("@us US74: external navigation is refused, links go to the real browser", () => {
    expect(MAIN).toMatch(/will-navigate/);
    expect(MAIN).toMatch(/setWindowOpenHandler/);
    expect(MAIN).toMatch(/action:\s*"deny"/);
  });
});

describe("desktop shell — packaging config — US74", () => {
  it("@us US74: packages the single-file bundle and the shell, nothing else", () => {
    const files = PKG.build.files;
    expect(files).toContain("dist-single/index.html");
    expect(files).toContain("electron/**/*");
    // Shipping src/ or test/ inside the installer would be dead weight.
    expect(files.some((f) => f.startsWith("src/"))).toBe(false);
    expect(files.some((f) => f.startsWith("test/"))).toBe(false);
  });

  it("@us US74: targets all three desktop platforms with double-clickable formats", () => {
    expect(PKG.build.linux.target).toContain("AppImage");
    expect(PKG.build.win.target).toContain("portable");
    expect(PKG.build.mac.target).toContain("dmg");
  });

  it("@us US74: desktop output goes to its own directory, not dist/", () => {
    // Must not collide with the web build or the bundle-size check.
    expect(PKG.build.directories.output).toBe("dist-desktop");
    expect(PKG.build.directories.output).not.toMatch(/^dist$|^dist-single$/);
  });

  it("@us US74: the icon referenced by the packaging config exists on disk", () => {
    for (const platform of ["linux", "win", "mac"]) {
      expect(existsSync(PKG.build[platform].icon)).toBe(true);
    }
  });
});
