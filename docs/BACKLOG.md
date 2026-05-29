# WAVECRAFT — Product Backlog

> Built from market research (browser DJ landscape, 2026-05-18) and vetted for
> feasibility against the actual codebase by an architecture review. Supersedes
> nothing in `ROADMAP.md` — this is the actionable, code-verified worklist.
> Every item respects the hard constraints: zero runtime network, nothing leaves
> the device, no persistence of user *audio content*, install-free.

## Status legend
`LEGIT` build-ready · `NEEDS-SPIKE` prototype first · `REJECT` not worth it ·
`DONE` shipped this iteration.

---

## Wave 1 — high-value, low-risk, constraint-safe (in progress)

| # | Item | Size | Notes |
|---|---|---|---|
| W1.1 | Reactive harmonic key suggestions | S | Surfaces compatible Camelot keys from the already-shipped key detector; makes the Camelot wheel a live mixing aid. Merges new-research B4 + ROADMAP #8. |
| W1.2 | Tempo-match / pitch-bend nudge controls | S | Momentary ±pitch-bend buttons + one-tap tempo match; reuses Deck's `setSpeed`/`syncTo`. |
| W1.3 | Recording markers → cue-sheet export | S | Drop timestamped markers while recording; export a `.txt` cue sheet alongside the audio. Merges B7 + E13. |
| W1.4 | Settings export / import (`.json`) | S | `DONE` — versioned JSON of themes, crossfade curve, MIDI mappings, recorder tap mode; downloaded/read from the user's own disk. Config, not audio. Malformed input rejected with an inline error. Makes MIDI maps survive a reload. |
| W1.5 | Session crate panel (in-memory) | M | `DONE` — `Crate.jsx`: non-persistent list of decoded tracks, drag-drop / file-pick to add, one-click load to either deck via `Deck.loadBuffer`. The standout differentiator vs free competitors. (BPM/key columns ready; auto-analysis pipeline deferred.) |
| W1.6 | Bundle-size budget check | S | npm script that fails if the build crosses a gzip threshold — protects the portable-HTML / PWA-precache promise. |
| W1.7 | Recorder pre/post-limiter toggle | S | Choose a clean (pre-compressor) or radio-ready (post) recording tap + a clip meter. From ROADMAP #3. |

## Wave 2 — valuable, more work (deferred)

- Looper / sample-pad WAV export (M — needs a small `AudioBuffer`→WAV encoder)
- Audio-engine perf HUD + configurable `latencyHint` (S+S, build together)
- Contributor architecture doc + audio-graph diagram (S)
- Browser / Web Audio compatibility matrix + consolidated feature detection (S)
- Accessibility pass — high-contrast theme, big-button mode, one-hand remap (ROADMAP #5)
- Split-cue / pre-cue monitor bus (ROADMAP #1)
- Practice-mode prompts (S)

## Spike before committing

- **Browser-native stem separation** (ONNX/Demucs). Bundle-size + perf risk;
  must be an offline pre-separation with a lazy-loaded, OPFS-cached model — never
  a network fetch. Prototype before roadmapping.

## Rejected / deferred indefinitely

- Plugin/effect module API — over-engineering for a 2-dependency app.
- Post-mix "transition score" — requires beat-phase data the app does not capture.
- MIDI latency diagnostics — niche; Web MIDI timestamps are coarse.
- Visual-regression CI / dedicated a11y CI infra — disproportionate to the repo.
- Batch folder load — there are only two decks; the real value (queued analysis)
  is folded into the crate panel (W1.5).

---

## Already shipped — do not rebuild

Auto-BPM + auto-key detection, ½×/2× BPM nudge, drag-and-drop load, cue points,
MIDI mapping with learn mode, mix recording, three crossfade curves, looper,
sample pad, PWA + single-file builds.

---

## R23 — end-to-end verification pass (`DONE`)

Full interactive-element inventory across every screen, file-path / asset
existence audit, and behavior assertions for every keyboard shortcut that
previously only had "does not throw" coverage. Outcome:

- New `test/App.e2e.test.jsx` adds 22 integration tests covering keyboard
  shortcut outcomes (ArrowUp/Down deck volume, Shift+Arrow snap, C-cue,
  digit-key jump, Space play toggle, M-key marker), the crossfade curve and
  theme picker reaching state, the record → drop-marker → stop download flow,
  the settings export → import round-trip, the crate drag-drop → quick-load
  flow, the empty-vs-loaded waveform slider transition, and deck focus.
- The complete control-coverage matrix is in `docs/E2E_VERIFICATION.md`.
- File-path verification: every static reference (`src/fonts/*.woff2`,
  `src/worklets/looper-worklet.js`, `public/icons/*`) was confirmed against the
  filesystem and the production `dist/sw.js` precache manifest (13 entries,
  342 KiB raw); no stale `public/fonts/` or `public/worklets/` references
  anywhere in the repo. `vite.config.js`'s `includeAssets` is already correct.
- Bundle-size budgets remain green (75.5 KB gzip JS / 90 KB budget,
  342.3 KB precache / 400 KB budget). Test count went from 361 → 383.

## R24 — I/O contract + close the verification gap (`DONE`)

Closes the "structural-evidence only" rows from R23's matrix into automated
checks wherever it's reasonable from a headless test environment.

- `docs/IO_CONTRACT.md` — full output/input matrix. Every output the app
  produces is paired with the UI affordance that triggers it; every input is
  paired with the UI surface that accepts it. Every row links a test.
- `test/build.test.js` — Phase B1. Validates `dist/manifest.webmanifest`
  parses as JSON with all required fields; asserts 192/512 PNGs exist on
  disk; asserts `dist/sw.js` and `dist/registerSW.js` are present; asserts
  the built `index.html` retains the CSP + Permissions-Policy meta tags and
  no `<script src>` / `<link rel=stylesheet>` references an external URL.
- `test/build-single.test.js` — Phase B2. Validates `dist-single/index.html`
  exists with NO external `<script src>` or `<link rel=stylesheet>`; fonts
  are inlined as `data:font/woff2;base64`; apple-touch-icon is inlined as
  `data:image/png;base64`; CSP still pins `connect-src 'none'`; no
  registerSW / manifest leak in single-file mode.
- `test/csp.test.js` — Phase B3. Parses CSP from both `index.html` AND
  `vite.config.js#CSP_CONTENT` (canonical source) and asserts every
  directive: `connect-src 'none'`, `frame-src 'none'`, `object-src 'none'`,
  `base-uri 'self'`, `form-action 'none'`, no `'unsafe-eval'` in
  `script-src`, `worker-src` includes `blob:` (the looper worklet).
- `test/limiter.test.jsx` — Phase B4. Asserts the App.jsx-built master
  compressor is configured with brickwall limiter-class params
  (threshold −9, ratio 20, knee 0, attack 0.003, release 0.1), confirms
  the topology delivers every deck's analyser tap to the compressor, and
  walks the path comp → trim → masterGain → destination to confirm there
  is exactly ONE limiter on the master bus.
- `test/midiMap.test.js` (extended) — Phase B5. Adversarial coverage: 1-byte
  message drop, 2-byte Note Off / Note On drop (strict 3-byte guard),
  pitch-bend (0xE0) drop, channel pressure (0xD0) drop, sysex (0xF0)
  rejection (with `requestMIDIAccess({sysex:false})` asserted), CCs across
  all 16 channels, CC values 0-127, mid-stream disconnect, learn-mode
  stuck-on key, every unhandled kind-nibble.
- `test/focus-rings.test.js` — Phase B6. Asserts `src/index.css` declares a
  `*:focus-visible` rule with the documented #ccd6f6 outline + 2px offset
  token and that `:focus` is not used as a fallback.
- `test/animations.test.js` — Phase B7. Asserts `@keyframes beatPulse` is
  declared with opacity + transform stops AND at least one component sets
  `animation: beatPulse …`. Also asserts the `prefers-reduced-motion`
  override is in place.
- New npm scripts: `verify:build`, `verify:single`, `verify:all`.
- Final tally: 36 test files / 435 tests, all passing. Build still 75.5 KB
  gzip JS / 90 KB budget. `npm run size` PASS.
