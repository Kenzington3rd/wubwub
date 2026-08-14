# WAVECRAFT — Free Local DJ Mix Deck

## Quick Facts
- **Stack**: React 18 + Vite 5, Web Audio API, Canvas 2D, inline-style components
- **Audio**: AudioContext, BiquadFilter, GainNode, AnalyserNode, ConvolverNode, DelayNode, WaveShaperNode, DynamicsCompressorNode (master), AudioWorkletNode (looper)
- **Visualization**: Canvas 2D with requestAnimationFrame
- **Target**: Browser-only, zero backend, zero network calls at runtime
- **Distribution**:
  - `npm run build` → multi-file PWA bundle in `dist/` (precached for offline)
  - `npm run build:single` → one self-contained `index.html` in `dist-single/` (max portability)
  - `npm run verify:build` → build + run build-artifact tests (manifest, sw.js, CSP)
  - `npm run verify:single` → build:single + run single-file artifact tests
  - `npm run verify:all` → verify:build + verify:single + full Vitest suite
- **Fonts**: self-hosted `.woff2` (Audiowide + Exo 2 variable) in `src/fonts/`, injected at boot via `src/fonts/index.js` (each woff2 is imported with Vite's `?url` so the multi-file build keeps them as hashed siblings and the single-file build inlines them as `data:` URIs)
- **License**: MIT — free, open, no subscriptions

## Mission
WAVECRAFT is a free, local-only DJ mixing application. **Nothing leaves the device.** No analytics, no telemetry, no CDN dependencies at runtime, no subscriptions, no accounts.

## Architecture

### Audio Signal Chain

Per-deck:
```
AudioBufferSource → Gain (volume × crossfade)
  → Isolation stage (W3.7 — dry ∥ bass/vocal/instr/perc gates, dry/wet bypass)
  → BiquadFilter (Low Shelf, 200 Hz)
  → BiquadFilter (Peaking,  1.5 kHz, Q=0.7)
  → BiquadFilter (High Shelf, 6 kHz)
  → BiquadFilter (Lowpass sweep, 60–20 kHz)
  → PumpGain (W3.5 — beat-rate ducking, idle 1.0)
  → Reverb        (dry/wet, ConvolverNode + synth IR)
  → Delay         (dry/wet, DelayNode + clamped feedback loop)
  → Distortion    (dry/wet, WaveShaperNode + soft-clip curve)
  → AnalyserNode  (FFT 2048, viz tap)
  → MasterCompressor (shared safety-net limiter)
  → MasterGain
  → AudioContext.destination
```

The master compressor is **shared** across decks (acts as a safety-net limiter against summed clipping). It serves as the **tap point** for the looper AudioWorklet and is the default ("Radio") tap for the MediaRecorder.

A parallel **record tap** GainNode also exists: every deck's analyser fans out into it *in addition to* the master compressor. It carries the summed deck signal **before** the limiter and has no downstream connection (it is only a source for the recorder's `MediaStreamDestination`). The recorder tap toggle ("Clean" pre-limiter / "Radio" post-limiter) selects which node the recorder connects from; it is locked while a recording is in progress. A small `AnalyserNode` on the master gain feeds the clip meter.

### File layout

```
src/
├── main.jsx                  # React entry
├── App.jsx                   # Orchestrator
├── index.css                 # @font-face, resets, keyframes, mobile media query
├── data.js                   # CAMELOT_WHEEL, GENRE_BPM, TIPS, themes, presets, keys
├── settings.js               # config export/import — versioned JSON serialize + validate
├── hooks/useMatchMedia.js
├── audio/
│   ├── chain.js              # buildDeckChain + disconnectChain
│   ├── effects.js            # reverb IR + distortion curve + rampGain + clamp
│   ├── crossfade.js          # equal-power / linear / constant-power
│   ├── bpmDetect.js          # autocorrelation BPM detector
│   ├── keyDetect.js          # Krumhansl-Schmuckler chroma key detector (Camelot)
│   ├── recorder.js           # MediaRecorder wrapper + downloadBlob
│   ├── wavEncode.js          # 16-bit WAV encoder + sliceBuffer (W3.6 bite export)
│   ├── isolationRender.js    # offline re-render of a slice through the isolation path (W3.7)
│   └── timeStretch.js        # granular Hann-OLA time-stretch DSP core (W3.1 KEYLOCK)
├── midi/
│   └── midiMap.js            # MIDI access + CC mapping
├── fonts/
│   ├── index.js              # injectFonts() — @font-face injected at boot
│   ├── Audiowide-Regular.woff2
│   └── Exo2-Variable.woff2
├── worklets/
│   ├── looper-worklet.js     # imported `?raw`, registered via Blob URL
│   └── stretch-worklet.js    # streaming granular time-stretch, same `?raw` + Blob URL contract
└── components/
    ├── Knob.jsx
    ├── Slider.jsx
    ├── WaveformCanvas.jsx    # live FFT + cues + click-to-seek
    ├── EffectCard.jsx        # generic effect UI w/ on/off + N knobs
    ├── CuePanel.jsx          # cue points list + set/jump/delete
    ├── BassDropMenu.jsx      # standard / heavy / wobble preset selector
    ├── ThemePicker.jsx       # accent color swatches per deck
    ├── Deck.jsx              # forwardRef component with imperative API
    ├── Crossfader.jsx        # vertical (desktop) / horizontal (mobile) + curve select
    ├── MasterBus.jsx         # master volume + record + theme pickers
    ├── Looper.jsx            # 4 slots, captures from master worklet tap
    ├── SamplePad.jsx         # 8 pads, drag-drop or click-to-load, keys QWER/ASDF
    ├── MidiPanel.jsx         # learn-mode mapping UI
    ├── Crate.jsx             # session crate — in-memory decoded-track list, quick-load to a deck
    ├── VoxRecorder.jsx       # VOX mic panel — local getUserMedia take → deck / crate / pad (W3.2)
    └── TheoryPanel.jsx       # camelot wheel + genre BPM + tips + shortcuts

public/
└── icons/                    # PWA / apple-touch-icon (SVG + 192/512 PNG)
```

Fonts and the looper worklet no longer live in `public/` — they're imported
through Vite's asset pipeline from `src/fonts/` (each `.woff2` via `?url`) and
`src/worklets/looper-worklet.js` (as a `?raw` string, wrapped in a `Blob`,
registered via `URL.createObjectURL` and revoked once `addModule` resolves).
This is what lets the single-file build run from `file://` with no sibling
fetches and also what lets the PWA build work under a non-root subpath.

### State Management
- **Audio nodes**: `useRef` (no re-renders on audio state)
- **Per-deck graph**: built once via `buildDeckChain(ctx, masterCompressor)`, stored in `chainRef`
- **UI state**: `useState` (volume, EQ, speed, transport, cues, effects)
- **Imperative API**: each Deck uses `forwardRef` + `useImperativeHandle` to expose `togglePlay`, `setVolume`, `syncTo`, `setCue`, `jumpCue`, `loadBuffer`, etc. for keyboard shortcuts, MIDI, and crate quick-load
- `Deck.loadBuffer(audioBuffer, name)` — adopt a pre-decoded `AudioBuffer` directly (used by the session crate). `loadFile` decodes a raw `File`, then both share the internal `adoptBuffer` (resets transport/cues/detected metadata for the new track)

## Conventions
- Functional React components with hooks; no class components
- `useRef` for all Web Audio nodes and non-rendering state
- `useCallback` for stable handler refs
- `useEffect` for audio parameter updates, scoped to the specific setting
- Inline styles with template literals for dynamic accent colors
- All AudioParam changes use `setTargetAtTime` or scheduled ramps — never `setTimeout` for audio
- Equal-power crossfade is the default; linear and constant-power-3dB are user-selectable
- Three decks share the two-ended crossfader via per-deck **assign** (`A / THRU / B`); the A/B curve math in `crossfadeGains` is unchanged and `THRU` is exactly 1.0
- Effects bypass via dry/wet gain pairs — never disconnect/reconnect

## WC-PREC — WAVECRAFT rule precedence

> **Scope: this project only.** `WC-PREC` is WAVECRAFT/wubwub's own precedence
> rule, not a global policy. Other repos — and other concurrent sessions
> working elsewhere — may define their own, under their own name; nothing here
> claims authority over them. Cite this one as **WC-PREC** so it is
> unambiguous which project's rule is being applied, and do not rename or
> duplicate it under a generic heading (a second "Rule Precedence" section
> added by another session is a merge conflict, not a second rule).

An assistant-behavior plugin may be active in a session — e.g.
[ponytail](https://github.com/Kenzington3rd/ponytail) ("lazy senior dev mode":
YAGNI, reuse before writing, stdlib before dependencies, shortest diff that
works). That guidance suits this codebase and should be followed for *how* to
pick an implementation.

**Where any such plugin conflicts with this file, this file wins — inside this
repo.** The collisions worth naming:

| Plugin guidance | This project instead |
|---|---|
| "One runnable check. No frameworks, no fixtures. YAGNI applies to tests too." | Every user story gets a `@us USxx`-tagged Vitest test listed in `docs/USER_STORIES.md`. `test/mocks/webAudioMock.js` is a required fixture — Web Audio can't be exercised headlessly without it — not over-engineering. |
| "Fewest files. Deletion over addition." | Per-feature doc updates (`USER_STORIES.md`, `IO_CONTRACT.md`, `E2E_VERIFICATION.md`, `USER_GUIDE.md`) are part of the change, not padding. |
| Any relaxation of a Danger Zone below | Danger Zones are absolute regardless of diff size. |

This is consistent with ponytail's own carve-out for "anything explicitly
requested" — this file is the request. A new comment marker the plugin
introduces (e.g. `ponytail:` for a deliberate simplification with a known
ceiling) is fine to use; it satisfies the STYLE_GUIDE rule that comments
explain *why*.

## Keyboard Shortcuts
| Key | Action |
|---|---|
| Click a deck | Focus it |
| `Space` | Play/pause focused deck |
| `←/→` | Crossfade ±5% |
| `Shift+←/→` | Snap crossfader to 0/1 |
| `↑/↓` | Focused deck volume ±5% |
| `S` | Sync focused deck to the other (see note below) |
| `C` | Set cue at current position |
| `1`–`8` | Jump to cue N on focused deck |
| `M` | Drop a recording cue marker (no-op unless recording) |
| `,` / `.` | Hold to nudge focused deck pitch ±4% (momentary, releases on keyup) |
| `Q W E R A S D F` | Trigger sample pad 1–8 |
| `←/→` *(waveform focused)* | Seek the focused waveform ±5 s |
| `Home/End` *(waveform focused)* | Seek the focused waveform to start / end |

> **Waveform seek vs. global arrows:** the waveform `<canvas>` is a
> `role="slider"` seek control once a track is loaded. While it has keyboard
> focus, `←/→/↑/↓/Home/End` seek that track and the canvas calls
> `stopPropagation()`, so the global crossfader/volume arrow shortcuts do not
> also fire. Tab away from the canvas to use the global arrow shortcuts again.

> **`S` collision:** `S` is both sample pad 6 and the deck-sync shortcut.
> Resolution: when a deck is **focused**, `S` syncs that deck; sample pad 6 is
> reachable by pressing `S` with **no deck focused**. The other pad keys
> (`Q W E R A D F`) are not deck shortcuts, so they always trigger their pad.

## Danger Zones
| Path / Area | Rule |
|---|---|
| Audio signal chain order | Don't reorder without Audio Engine Architect review |
| Crossfade math | Equal-power is the default; other curves are opt-in |
| Bass drop automation | Uses AudioParam scheduling — never `setTimeout` |
| Delay feedback | Clamped ≤ 0.9. Don't remove the clamp. |
| Network calls | **NEVER** add `fetch`, `XHR`, `WebSocket`, `sendBeacon`. PWA service worker must not touch external origins. |
| User file data | Files stay in `ArrayBuffer`/`AudioBuffer` in memory. Never persisted (no localStorage for user content), never transmitted. |
| Worklet path | Looper worklet source is `src/worklets/looper-worklet.js`, imported `?raw` and registered via a Blob URL in `src/App.jsx`. Don't re-introduce a static `/worklets/…` path — the Blob-URL registration is required for `file://` and PWA-subpath builds. |
| Single-file build | `vite-plugin-singlefile` and `vite-plugin-pwa` are mutually exclusive in the same build. Use `--mode single` to pick singlefile. |

## Current Status

### Implemented (P0–P3)
- [x] **P0** — Dual deck playback, file decode, 3-band EQ, volume/speed/filter, equal-power crossfade, bass drop, waveform + freq viz, BPM tap, loop toggle, Camelot Wheel, Genre BPM, DJ Tips
- [x] **P1a** — `seekTo` primitive, click-to-seek waveform, beat indicator, mobile responsive
- [x] **P1b** — Effects rack (reverb/delay/distortion + master compressor), cue points (up to 8), beat sync button, keyboard shortcuts with focus model
- [x] **P2** — Looper (4 slots, 4/8/16-bar capture from master), sample pad (8 pads w/ key bindings), bass drop presets (Standard/Heavy/Wobble), crossfade curve selector, deck color themes
- [x] **P3** — Mix recording (MediaRecorder, local download), PWA with offline precache, MIDI controller mapping with Learn mode (Chrome/Edge/Opera), autocorrelation auto-BPM, single-file build target (`npm run build:single`)
- [x] **W1** — Reactive harmonic key suggestions (per-deck `mix → …` compatible-key hint + live Camelot-wheel highlight; deck key lifted to App via the `onKeyDetected` prop, fed to `TheoryPanel`), momentary pitch-bend NUDGE −/+ controls (held pointer applies a ±4% offset on top of base speed, never mutating the speed state). Camelot compatibility helper: `camelotCompatible()` in `src/data.js`. **W1.3** — recording cue markers (`M` key or MARKER button drop timestamped markers during a recording; on stop a `<base>.cue.txt` cue sheet downloads alongside the audio). **W1.4** — settings export/import (versioned JSON of deck themes, crossfade curve, MIDI mappings, recorder tap mode; downloaded / read from the user's own disk — config only, no audio; malformed input is rejected with an inline error, never throws; also lets MIDI maps survive a reload). **W1.5** — session crate panel (`Crate.jsx`): an in-memory list of decoded tracks, drag-drop or file-pick to add, one-click quick-load to either deck via the new `Deck.loadBuffer` imperative method; never persisted. **W1.7** — recorder pre/post-limiter tap toggle (Clean/Radio, idle-only) + master clip meter.
- [x] **W3.8** — third deck (Deck C, default green, full feature parity) with per-deck **crossfader assign** (`A / THRU / B` segmented control in each deck header). Assigned decks follow the existing two-ended crossfade curves via `assignGain()` in `src/audio/crossfade.js`; `THRU` bypasses the fader (multiplier exactly 1.0). Defaults (A→A, B→B, C→THRU) reproduce the two-deck behavior bit-for-bit. SYNC now targets the *dominant playing* deck (highest assign-side gain; falls back to any loaded deck). Crate gained `→ C`; MIDI gained `deckC.*` targets; settings bumped to v3 (`deckCColor`, `deckAssigns` — v1/v2 files still import); app shell widened to 1560px with a 320px deck wrap floor (2+1 at mid widths).
- [x] **W3 batch (partial, 2026-08-09)** — **W3.3** EQ kill switches (−26 dB kill floor, kill state separate from knob state). **W3.2** VOX voice/mic recording panel (`VoxRecorder.jsx`: local `getUserMedia`, music-tuned constraints, take → Deck/Crate/SamplePad via `adoptBuffer`, monitor toggle, secure-context gating; Permissions-Policy `microphone=(self)`). **W3.7** component isolation (ISOLATE row: BASS/VOCAL/INSTR/PERC — dry + four gated wet paths between deck gain and EQ, bit-transparent when off). **W3.6** sound-bite extraction (BITE row: IN/OUT region + waveform overlay, loop preview, slice → pad/crate/WAV via `wavEncode.js`; isolation-aware offline render via `isolationRender.js`; `Deck.seekTo` exposed). **W3.5** PUMP ducking (`pumpGain` post-filter, per-beat `setValueCurveAtTime` windows armed ~4 beats ahead, tracks effective BPM). **W3.1** DONE (experimental) — granular time-stretch DSP core (`audio/timeStretch.js`) + `worklets/stretch-worklet.js`, integrated as an opt-in per-deck VARI/KEYLOCK toggle: KEYLOCK streams through the stretch worklet (rate = speed + bend at constant pitch, port-message transport, position-report drift correction, VARI fallback if worklets unavailable); VARI remains the bit-identical default. **W3.4** DONE — momentary loop roll (¼/½/1/2 beats, hold-to-engage on the bite-preview source path; the wall-clock timeline runs underneath and release re-anchors; press-time quantized).
- [x] **IO Contract (Phase B)** — full I/O matrix in [`docs/IO_CONTRACT.md`](docs/IO_CONTRACT.md). Adds `test/build.test.js` (PWA manifest + sw.js + registerSW.js validation), `test/build-single.test.js` (single-file self-containment + inlined fonts), `test/csp.test.js` (CSP enforcement from source AND from `vite.config.js#CSP_CONTENT`), `test/limiter.test.jsx` (master brickwall limiter parameters + topology trace), `test/focus-rings.test.js` (CSS `*:focus-visible` rule with the correct token), `test/animations.test.js` (`@keyframes beatPulse` plus a component-side consumer), and adversarial Web MIDI cases extended in `test/midiMap.test.js` (every kind-nibble branch, every channel, mid-stream disconnect, sysex rejection).

### Deferred
- Electron wrapper (separate distribution concern; web app is complete)
- Real-time beat-phase detection for fully synced beat indicators (current behavior: BPM-rate pulse, free-running phase)
- Worker offload for auto-BPM detection on very long tracks
