import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { viteSingleFile } from "vite-plugin-singlefile";

// Two build modes:
//   default → multi-file static site + PWA (precached for offline)
//   --mode single → one self-contained index.html (no SW), for max portability

// The Content-Security-Policy declared in index.html is currently stripped
// from the built HTML by the PWA / singlefile post-processing pipeline. Keep
// the canonical CSP string here and re-inject it into the final HTML via a
// `transformIndexHtml` hook that runs in the `post` slot (after every other
// plugin). Single source of truth for both build modes — and any future
// tightening only has to change once.
const CSP_CONTENT =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; " +
  "font-src 'self' data:; " +
  "media-src 'self' blob:; " +
  "worker-src 'self' blob:; " +
  "connect-src 'none'; " +
  "frame-src 'none'; " +
  "form-action 'none'; " +
  "object-src 'none'; " +
  "base-uri 'self';";

const PERMISSIONS_POLICY =
  "geolocation=(), camera=(), microphone=(), interest-cohort=(), " +
  "browsing-topics=(), payment=(), usb=(), serial=(), bluetooth=(), hid=()";

/**
 * Vite plugin: re-inject the CSP + Permissions-Policy <meta> tags into the
 * built index.html. Both VitePWA (when it rewrites <head> for the SW registration)
 * and viteSingleFile (when it inlines + reorders) have a tendency to drop
 * the meta tags between the parser and the emit step. We run in the `post`
 * slot so we run after them and our additions survive.
 */
function reinjectSecurityMeta() {
  const cspTag = `<meta http-equiv="Content-Security-Policy" content="${CSP_CONTENT}">`;
  const permTag = `<meta http-equiv="Permissions-Policy" content="${PERMISSIONS_POLICY}">`;
  return {
    name: "wavecraft:reinject-security-meta",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        let out = html;
        if (!/http-equiv=["']Content-Security-Policy["']/i.test(out)) {
          out = out.replace(/<head([^>]*)>/i, (m) => `${m}\n    ${cspTag}`);
        }
        if (!/http-equiv=["']Permissions-Policy["']/i.test(out)) {
          out = out.replace(/<head([^>]*)>/i, (m) => `${m}\n    ${permTag}`);
        }
        return out;
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const isSingle = mode === "single";

  return {
    base: "./",
    plugins: [
      react(),
      isSingle
        ? viteSingleFile({
            removeViteModuleLoader: true,
          })
        : VitePWA({
            registerType: "autoUpdate",
            // Worklet is no longer shipped as a sibling — it's imported as a
            // raw string in src/App.jsx and registered via a Blob URL. Fonts
            // ditto via src/fonts/index.js (`?url` import).
            includeAssets: [
              "icons/icon.svg",
              "icons/icon-192.png",
              "icons/icon-512.png",
            ],
            manifest: {
              name: "WAVECRAFT",
              short_name: "WAVECRAFT",
              description:
                "Free, local-only DJ mixing app. No accounts, no telemetry.",
              theme_color: "#070a14",
              background_color: "#070a14",
              display: "standalone",
              start_url: ".",
              icons: [
                {
                  src: "icons/icon.svg",
                  sizes: "any",
                  type: "image/svg+xml",
                  purpose: "any",
                },
                // iOS Safari ignores SVG icons for Add-to-Home-Screen. Ship
                // PNGs at the two sizes the spec specifically calls out so
                // a fresh install gets a real tile instead of a blank one.
                {
                  src: "icons/icon-192.png",
                  sizes: "192x192",
                  type: "image/png",
                  purpose: "any",
                },
                {
                  src: "icons/icon-512.png",
                  sizes: "512x512",
                  type: "image/png",
                  purpose: "any maskable",
                },
              ],
            },
            workbox: {
              globPatterns: ["**/*.{js,css,html,woff2,svg,png,ico}"],
              // Strictly local: never fall through to network for missing assets.
              navigateFallback: "index.html",
              runtimeCaching: [],
            },
          }),
      reinjectSecurityMeta(),
    ],
    build: {
      target: "es2020",
      cssCodeSplit: false,
      reportCompressedSize: true,
      assetsInlineLimit: isSingle ? 100000 : 4096,
    },
    server: {
      port: 5173,
      strictPort: false,
      open: false,
    },
  };
});
