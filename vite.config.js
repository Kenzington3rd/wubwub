import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { viteSingleFile } from "vite-plugin-singlefile";

// Two build modes:
//   default → multi-file static site + PWA (precached for offline)
//   --mode single → one self-contained index.html (no SW), for max portability
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
            includeAssets: [
              "fonts/Audiowide-Regular.woff2",
              "fonts/Exo2-Variable.woff2",
              "worklets/looper-worklet.js",
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
              icons: [],
            },
            workbox: {
              globPatterns: [
                "**/*.{js,css,html,woff2,svg,png,ico}",
                "worklets/*.js",
              ],
              // Strictly local: never fall through to network for missing assets.
              navigateFallback: "index.html",
              runtimeCaching: [],
            },
          }),
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
