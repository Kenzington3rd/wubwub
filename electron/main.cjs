// WAVECRAFT desktop shell (Electron).
//
// Wraps the SAME single-file build that ships as wavecraft.html — no separate
// desktop codebase, no forked UI. The shell's only jobs are: give the app a
// real window, give it a SECURE ORIGIN, and make sure the desktop build can't
// do anything the browser build is forbidden from doing.
//
// Why a custom protocol instead of loadFile():
//   `file://` is NOT a secure context, so getUserMedia is unavailable there —
//   the VOX mic panel would be dead in the desktop app exactly as it is when
//   you double-click wavecraft.html. Registering `wavecraft://` as a secure,
//   standard scheme gives the page a trustworthy origin, so VOX works offline
//   on the desktop with no server and no hosting.
//
// Danger-zone parity with the web build (CLAUDE.md):
//   - no network: every outbound request except our own scheme is blocked at
//     the session level, so the desktop build cannot phone home even if a
//     future dependency tries.
//   - no auto-updater. Updates come from the user downloading a new build.
//   - no telemetry, no crash reporting.
const { app, BrowserWindow, protocol, session, shell, net } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const SCHEME = "wavecraft";
const ORIGIN = `${SCHEME}://app`;

// Serve the single-file bundle. Built by `npm run build:single`; packaged into
// the asar at `dist-single/index.html`.
const INDEX = path.join(__dirname, "..", "dist-single", "index.html");

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true, // ← the bit that makes getUserMedia (VOX) work
      supportFetchAPI: true,
    },
  },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 380, // the app's mobile layout floor
    minHeight: 600,
    backgroundColor: "#070a14", // matches the app shell; avoids a white flash
    title: "WAVECRAFT",
    autoHideMenuBar: true,
    webPreferences: {
      // The app is entirely client-side and needs no bridge, so give the
      // renderer nothing: no node, no remote module, context isolated.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.loadURL(`${ORIGIN}/index.html`);

  // External links open in the real browser rather than hijacking the app
  // window (and never in a Node-privileged context).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(ORIGIN)) e.preventDefault();
  });

  return win;
}

app.whenReady().then(() => {
  // Serve the bundle from the secure scheme.
  protocol.handle(SCHEME, async () => {
    try {
      const html = await fs.promises.readFile(INDEX);
      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    } catch {
      return new Response("Build missing — run `npm run build:single`.", {
        status: 404,
        headers: { "content-type": "text/plain" },
      });
    }
  });

  // Hard network block. The web build promises "nothing leaves your device";
  // the desktop build must promise the same. Anything that isn't our own
  // scheme is cancelled outright.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith(`${SCHEME}://`) });
  });

  // Microphone (VOX) is the only permission the app ever needs, and only from
  // our own origin. Everything else is denied.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    const fromApp = (wc.getURL() || "").startsWith(ORIGIN);
    cb(fromApp && permission === "media");
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
