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
