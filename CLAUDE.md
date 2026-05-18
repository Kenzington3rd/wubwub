# WAVECRAFT — Free Local DJ Mix Deck

## Quick Facts
- **Stack**: React 18 + Vite 5, Web Audio API, Canvas 2D, inline-style components
- **Audio**: AudioContext, BiquadFilter, GainNode, AnalyserNode, ConvolverNode, DelayNode, WaveShaperNode, DynamicsCompressorNode (master), AudioWorkletNode (looper)
- **Visualization**: Canvas 2D with requestAnimationFrame
- **Target**: Browser-only, zero backend, zero network calls at runtime
- **Distribution**:
  - `npm run build` → multi-file PWA bundle in `dist/` (precached for offline)
  - `npm run build:single` → one self-contained `index.html` in `dist-single/` (max portability)
- **Fonts**: self-hosted `.woff2` (Audiowide + Exo 2 variable) in `public/fonts/`
- **License**: MIT — free, open, no subscriptions

## Mission
WAVECRAFT is a free, local-only DJ mixing application. **Nothing leaves the device.** No analytics, no telemetry, no CDN dependencies at runtime, no subscriptions, no accounts.

## Architecture

### Audio Signal Chain

Per-deck:
```
AudioBufferSource → Gain (volume × crossfade)
  → BiquadFilter (Low Shelf, 200 Hz)
  → BiquadFilter (Peaking,  1.5 kHz, Q=0.7)
  → BiquadFilter (High Shelf, 6 kHz)
  → BiquadFilter (Lowpass sweep, 60–20 kHz)
  → Reverb        (dry/wet, ConvolverNode + synth IR)
  → Delay         (dry/wet, DelayNode + clamped feedback loop)
  → Distortion    (dry/wet, WaveShaperNode + soft-clip curve)
  → AnalyserNode  (FFT 2048, viz tap)
  → MasterCompressor (shared safety-net limiter)
  → MasterGain
  → AudioContext.destination
```

The master compressor is **shared** across decks (acts as a safety-net limiter against summed clipping). It also serves as the **tap point** for the looper AudioWorklet and the MediaRecorder.

### File layout

```
src/
├── main.jsx                  # React entry
├── App.jsx                   # Orchestrator
├── index.css                 # @font-face, resets, keyframes, mobile media query
├── data.js                   # CAMELOT_WHEEL, GENRE_BPM, TIPS, themes, presets, keys
├── hooks/useMatchMedia.js
├── audio/
│   ├── chain.js              # buildDeckChain + disconnectChain
│   ├── effects.js            # reverb IR + distortion curve + rampGain + clamp
│   ├── crossfade.js          # equal-power / linear / constant-power
│   ├── bpmDetect.js          # autocorrelation BPM detector
│   ├── keyDetect.js          # Krumhansl-Schmuckler chroma key detector (Camelot)
│   └── recorder.js           # MediaRecorder wrapper + downloadBlob
├── midi/
│   └── midiMap.js            # MIDI access + CC mapping
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
    └── TheoryPanel.jsx       # camelot wheel + genre BPM + tips + shortcuts

public/
├── fonts/
│   ├── Audiowide-Regular.woff2
│   └── Exo2-Variable.woff2
└── worklets/
    └── looper-worklet.js     # AudioWorkletProcessor ring buffer
```

### State Management
- **Audio nodes**: `useRef` (no re-renders on audio state)
- **Per-deck graph**: built once via `buildDeckChain(ctx, masterCompressor)`, stored in `chainRef`
- **UI state**: `useState` (volume, EQ, speed, transport, cues, effects)
- **Imperative API**: each Deck uses `forwardRef` + `useImperativeHandle` to expose `togglePlay`, `setVolume`, `syncTo`, `setCue`, `jumpCue`, etc. for keyboard shortcuts and MIDI

## Conventions
- Functional React components with hooks; no class components
- `useRef` for all Web Audio nodes and non-rendering state
- `useCallback` for stable handler refs
- `useEffect` for audio parameter updates, scoped to the specific setting
- Inline styles with template literals for dynamic accent colors
- All AudioParam changes use `setTargetAtTime` or scheduled ramps — never `setTimeout` for audio
- Equal-power crossfade is the default; linear and constant-power-3dB are user-selectable
- Effects bypass via dry/wet gain pairs — never disconnect/reconnect

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
| `Q W E R A S D F` | Trigger sample pad 1–8 |

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
| Worklet path | `public/worklets/looper-worklet.js` is referenced as `/worklets/looper-worklet.js`. Keep both in sync. |
| Single-file build | `vite-plugin-singlefile` and `vite-plugin-pwa` are mutually exclusive in the same build. Use `--mode single` to pick singlefile. |

## Current Status

### Implemented (P0–P3)
- [x] **P0** — Dual deck playback, file decode, 3-band EQ, volume/speed/filter, equal-power crossfade, bass drop, waveform + freq viz, BPM tap, loop toggle, Camelot Wheel, Genre BPM, DJ Tips
- [x] **P1a** — `seekTo` primitive, click-to-seek waveform, beat indicator, mobile responsive
- [x] **P1b** — Effects rack (reverb/delay/distortion + master compressor), cue points (up to 8), beat sync button, keyboard shortcuts with focus model
- [x] **P2** — Looper (4 slots, 4/8/16-bar capture from master), sample pad (8 pads w/ key bindings), bass drop presets (Standard/Heavy/Wobble), crossfade curve selector, deck color themes
- [x] **P3** — Mix recording (MediaRecorder, local download), PWA with offline precache, MIDI controller mapping with Learn mode (Chrome/Edge/Opera), autocorrelation auto-BPM, single-file build target (`npm run build:single`)

### Deferred
- Electron wrapper (separate distribution concern; web app is complete)
- Real-time beat-phase detection for fully synced beat indicators (current behavior: BPM-rate pulse, free-running phase)
- Worker offload for auto-BPM detection on very long tracks
