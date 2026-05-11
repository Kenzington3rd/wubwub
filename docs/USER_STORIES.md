# WAVECRAFT — User Stories & Test Coverage

Each story has a unique ID and a test-coverage assignment:

- **U** = covered by a unit test (cited file)
- **C** = covered by a React component test
- **I** = covered by an integration test (Deck/App + mocked Web Audio)
- **E** = end-to-end / manual QA (out of unit-test scope; needs real audio + browser)
- **D** = pure documentation / promise (no executable test possible)

Persona: bedroom DJ who mixes local files in the browser. Sometimes streams, sometimes records, never wants to log in.

---

## P0 — Core playback

| ID | Story | Coverage | Test file |
|---|---|---|---|
| US1 | Load an audio file (MP3/WAV/OGG/FLAC/M4A/AAC) and decode it | E | manual: "Try this" steps in README |
| US2 | Play / pause / stop a loaded track | I | `test/Deck.test.jsx` |
| US3 | Adjust deck volume (0–1) | I | `test/Deck.test.jsx` |
| US4 | Adjust playback speed (0.5×–2.0×) | I | `test/Deck.test.jsx` |
| US5 | Sweep low-pass filter (60 Hz–20 kHz) | I | `test/Deck.test.jsx` |
| US6 | 3-band EQ (Low/Mid/High ±12 dB) | I | `test/Deck.test.jsx` |
| US7 | Crossfade between decks with equal-power curve by default | U | `test/crossfade.test.js` |
| US8 | Toggle loop mode | I | `test/Deck.test.jsx` |
| US9 | Tap BPM by ear | I | `test/Deck.test.jsx` |

## P0 — Visualization

| ID | Story | Coverage | Test file |
|---|---|---|---|
| US10 | Live waveform + FFT bars show the playing track | E | manual |
| US11 | Browse Camelot Wheel; click a key to highlight compatibles | C | `test/TheoryPanel.test.jsx` |
| US12 | Browse Genre BPM Guide | C | `test/TheoryPanel.test.jsx` |
| US13 | Read DJ tips, advance with "Next Tip" | C | `test/TheoryPanel.test.jsx` |

## P1a — Foundation refactor

| ID | Story | Coverage | Test file |
|---|---|---|---|
| US14 | Click anywhere on the waveform to seek | C | `test/WaveformCanvas.test.jsx` |
| US15 | Playhead reflects current time | E | manual |
| US16 | Beat indicator pulses at BPM rate | E | manual (CSS animation duration set inline) |
| US17 | Mobile: decks stack, crossfader rotates horizontal | C | `test/Crossfader.test.jsx` |

## P1b — Effects, cues, sync, shortcuts

| ID | Story | Coverage | Test file |
|---|---|---|---|
| US18 | Reverb (dry/wet, size) — IR generated locally, no network | U | `test/effects.test.js` |
| US19 | Delay (dry/wet, time, feedback clamped ≤ 0.9) | I + U | `test/Deck.test.jsx`, `test/effects.test.js` |
| US20 | Distortion (dry/wet, drive curve) | U | `test/effects.test.js` |
| US21 | Master compressor as safety-net limiter | I | `test/App.test.jsx` |
| US22 | Set cue point at current time (up to 8 max) | I | `test/Deck.test.jsx` |
| US23 | Jump to cue point | I | `test/Deck.test.jsx` |
| US24 | Delete cue point | C | `test/CuePanel.test.jsx` |
| US25 | Beat sync (match one deck's tempo to the other's BPM) | I | `test/Deck.test.jsx` |
| US26 | Keyboard shortcuts (Space, arrows, S, C, 1–8, Q W E R / A S D F) | I | `test/App.test.jsx` |
| US27 | Click a deck to focus it; visual outline indicates focus | I | `test/App.test.jsx` |

## P2 — Delight

| ID | Story | Coverage | Test file |
|---|---|---|---|
| US28 | Capture 4/8/16-bar loops from master bus | E | manual (worklet runs in audio thread) |
| US29 | Looper slot plays looped | E | manual |
| US30 | Looper slot volume per slot | E | manual |
| US31 | Load samples into 8 sample pads | E | manual |
| US32 | Trigger sample pads via Q W E R / A S D F | I | `test/App.test.jsx` |
| US33 | Drag-drop audio files onto sample pads | C | `test/SamplePad.test.jsx` |
| US34 | Bass-drop preset (Standard / Heavy / Wobble) | U + C | `test/data.test.js`, `test/BassDropMenu.test.jsx` |
| US35 | Crossfade curve (equal-power / linear / constant-3dB) | U | `test/crossfade.test.js` |
| US36 | Deck color themes | C | `test/ThemePicker.test.jsx` |

## P3 — Future-now

| ID | Story | Coverage | Test file |
|---|---|---|---|
| US37 | Record master mix locally; download as webm/m4a/ogg | U | `test/recorder.test.js` |
| US38 | App works offline (PWA precache) | E | manual (build + load offline) |
| US39 | MIDI Learn mode: any CC → mapped param | U + I | `test/midiMap.test.js`, `test/App.test.jsx` |
| US40 | Auto-detect BPM from track (autocorrelation) | U | `test/bpmDetect.test.js` |
| US41 | Auto-detect key (Krumhansl-Schmuckler chroma correlation) | U | `test/keyDetect.test.js` |
| US42 | Single-file HTML build target | E | manual (`npm run build:single`) |

## Cross-cutting

| ID | Story | Coverage | Test file |
|---|---|---|---|
| US43 | Spacebar doesn't double-trigger after clicking a transport button | I | `test/App.test.jsx` |
| US44 | Drag-and-drop onto deck card (not just sample pads) | C | `test/Deck.test.jsx` |
| US45 | ½× / 2× BPM nudge buttons | I | `test/Deck.test.jsx` |
| US46 | Visual loop indicator on waveform | C | `test/WaveformCanvas.test.jsx` |
| US47 | Cue button shows `8/8` at limit | C | `test/CuePanel.test.jsx` |
| US48 | PWA installable (icon in manifest) | E | manual |
| US49 | CSP enforced at meta level | E | manual (DevTools network check) |
| US50 | Screen readers can navigate via ARIA labels | C | spot-checked across component tests |

## Useful utilities

| ID | Story | Coverage | Test file |
|---|---|---|---|
| US51 | `useMatchMedia` hook tracks viewport size | C | `test/useMatchMedia.test.jsx` |
| US52 | `mapCcToValue` clamps + scales MIDI CC by target | U | `test/midiMap.test.js` |
| US53 | `clamp` helper bounds values correctly | U | `test/effects.test.js` |
| US54 | `extensionForMime` returns sensible defaults | U | `test/recorder.test.js` |
| US55 | `buildDeckChain` wires nodes per the documented signal chain | I | `test/chain.test.js` |

## Privacy / policy promises (D — not executable but worth listing)

- **D1** — Zero network calls at runtime
- **D2** — No localStorage or persistent storage of user audio
- **D3** — No accounts, no telemetry, no analytics
- **D4** — User files never leave the device

These are enforced architecturally (CSP meta tag, code review) rather than via tests. The closest "test" is the network audit during build verification: `dist/` should reference no external origins.
