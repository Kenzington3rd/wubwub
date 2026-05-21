# WAVECRAFT

> Free, local-only, no-subscription DJ mixing application.
> **Make music, not payments.**

WAVECRAFT is a dual-deck DJ mixing app that runs entirely in your browser. **Nothing leaves the device** — no analytics, no telemetry, no CDN dependencies at runtime, no subscriptions, no accounts. Drop a couple of audio files in, mix, record, download. That's it.

## Quick start

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # vitest, 330+ tests
npm run build          # → dist/ (multi-file PWA, precached for offline)
npm run build:single   # → dist-single/index.html (one self-contained file)
npm run size           # build + bundle-size budget check (reruns the build internally)
npm run preview        # serve the production build locally
```

`npm run size` runs `vite build` internally before checking the bundle budget,
so `npm run build && npm run size` will build twice — use `npm run size` on
its own when you want both.

The single-file build is a literal one-file artifact. Open `dist-single/index.html`
directly from your hard drive (or email it, or stick it on a USB stick) and the
whole app runs from `file://`. Fonts and the audio worklet are inlined as data
URIs / blob URLs.

## Stack

- React 18 + Vite 5
- Web Audio API (BiquadFilter, GainNode, AnalyserNode, ConvolverNode, DelayNode, WaveShaperNode, DynamicsCompressorNode, AudioWorkletNode for the looper)
- Canvas 2D for waveform / spectrum visualization
- Self-hosted fonts (Audiowide + Exo 2 variable)
- Zero runtime dependencies beyond `react` and `react-dom`

## Project layout

```
wubwub/
├── CLAUDE.md                       # canonical project reference
├── docs/                           # ROADMAP, BACKLOG, USER_STORIES, guides
├── public/icons/                   # PWA icons (SVG + PNG)
├── src/
│   ├── main.jsx                    # entry + font injection
│   ├── App.jsx                     # orchestrator (decks, master bus, recorder, MIDI)
│   ├── index.css                   # resets, focus ring, mobile media query
│   ├── data.js                     # Camelot wheel, genre BPMs, presets, themes
│   ├── settings.js                 # versioned settings export / import
│   ├── audio/                      # chain, effects, crossfade, BPM, key, recorder
│   ├── midi/                       # MIDI controller mapping + Learn mode
│   ├── components/                 # Deck, Crossfader, MasterBus, Looper, etc.
│   ├── fonts/                      # .woff2 files + injectFonts()
│   └── worklets/                   # looper AudioWorklet (imported as ?raw)
├── test/                           # vitest suite, @us USxx tags map to USER_STORIES
├── scripts/
│   ├── check-bundle-size.mjs       # build-size budget guard
│   └── render-pwa-icons.mjs        # regenerate PNG icons from icon.svg
├── index.html
├── vite.config.js
└── package.json
```

## Keyboard shortcuts

| Key | Action |
|---|---|
| Click a deck | Focus it |
| `Space` | Play/pause focused deck |
| `←/→` | Crossfade ±5% |
| `Shift+←/→` | Snap crossfader to 0/1 |
| `↑/↓` | Focused deck volume ±5% |
| `S` | Sync focused deck to the other (sample pad 6 when no deck focused) |
| `C` | Set cue at current position |
| `1`–`8` | Jump to cue N on focused deck |
| `M` | Drop a recording cue marker |
| `Q W E R A S D F` | Trigger sample pad 1–8 |
| `←/→` *(waveform focused)* | Seek that waveform ±5 s |
| `Home/End` *(waveform focused)* | Seek to start / end |

## Feature status

- **P0** dual deck, file decode, 3-band EQ, volume/speed/filter, crossfade, bass drop, waveform + freq viz, BPM tap, loop, Camelot wheel, genre BPM, DJ tips.
- **P1a** seekTo primitive, click-to-seek waveform, beat indicator, mobile responsive.
- **P1b** effects rack (reverb / delay / distortion + master compressor), 8 cue points, beat sync, keyboard shortcuts with focus model.
- **P2** looper (4 slots, master-tap capture), 8-pad sampler, bass drop presets, crossfade curves, deck color themes.
- **P3** mix recording (MediaRecorder + local download), PWA + offline precache, MIDI Learn (Chrome/Edge/Opera), autocorrelation BPM, single-file build.
- **W1** harmonic key suggestions, momentary pitch-bend NUDGE, recording cue markers + `.cue.txt`, settings export/import, session crate, recorder pre/post-limiter tap.

Full status, longer-form mission, danger-zones list: see [`CLAUDE.md`](CLAUDE.md).
Roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md). Worklist: [`docs/BACKLOG.md`](docs/BACKLOG.md).

## Contributing

Start with [`CONTRIBUTING.md`](CONTRIBUTING.md). Highlights:

- Tests use a `@us USxx` tag convention that maps each test to a user story in [`docs/USER_STORIES.md`](docs/USER_STORIES.md). Add the tag to anything new.
- **Danger zones** — no network calls, no audio persistence, all AudioParam changes via `setTargetAtTime` (never `setTimeout`), keep the delay feedback clamp. See `CONTRIBUTING.md` for the full list.
- Run `npm test && npm run size` before opening a PR; the CI workflow (`.github/workflows/ci.yml`) runs the same on push and PR.
- Security / privacy concerns: open a GitHub Issue tagged `security`. See [`SECURITY.md`](SECURITY.md).

## License

MIT. See [`LICENSE`](LICENSE).
