# WAVECRAFT

> Free, local-only, no-subscription DJ mixing application.
> **Make music, not payments.**

Runs entirely in the browser. Nothing leaves the user's device — no network calls at runtime, no analytics, no telemetry, no accounts.

## Stack
- React 18 + Vite 5
- Web Audio API (BiquadFilter / GainNode / AnalyserNode / ConvolverNode / DelayNode / WaveShaperNode / DynamicsCompressorNode)
- Canvas 2D for visualization
- Self-hosted fonts (Audiowide + Exo 2)
- Zero runtime dependencies beyond `react` and `react-dom`

## Run locally

```bash
npm install
npm run dev
```

Open the URL printed by Vite (usually http://localhost:5173).

## Build

```bash
npm run build      # static site -> dist/
npm run preview    # serve the built site locally
```

The `dist/` output is a static-site bundle suitable for GitHub Pages, Netlify, or any HTTP server.

## Project layout

```
wubwub/
├── CLAUDE.md                # canonical project reference (loaded by Claude Code)
├── docs/                    # long-form spec + agent-team playbook
├── public/fonts/            # self-hosted .woff2 files
├── src/
│   ├── main.jsx
│   ├── index.css            # @font-face, resets, keyframes, responsive
│   └── DJMixDeck.jsx        # the entire app (single file by design — P1)
├── index.html
├── package.json
└── vite.config.js
```

## Feature roadmap

See `CLAUDE.md` for the canonical status. P0 features (dual deck, EQ, crossfade, bass drop, BPM tap, theory panel) are complete. P1a (foundational seekTo refactor, waveform click-to-seek, beat indicator, mobile responsive) ships in this iteration.

## License

MIT.
