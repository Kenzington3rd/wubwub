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

## Wave 3 — EDM remix batch (planned; single implementation run end of August 2026)

> Origin: user goal — build an EDM bootleg remix of a ~105 BPM country vocal
> track ("(I Never Promised You a) Rose Garden") inside WAVECRAFT. The app is
> already qualified for the *varispeed* version of this workflow (0.5–2.0x deck
> speed, sync, cues, looper, bass drop, sample pads, recorder). These tickets
> close the remaining gaps. All five are scoped for one batched implementation
> run (implementation + tests + docs + a single push/PR) to minimize CI/Git
> activity. Ranked by value to the use case.

### W3.1 — Pitch-preserving time-stretch ("KEYLOCK" mode) · Size L · `LEGIT`

**Problem.** Deck tempo is varispeed-only (`AudioBufferSource.playbackRate`,
clamped 0.5–2.0 in `Deck.jsx`). Taking a ~105 BPM vocal to 128 BPM raises the
vocal ~3 semitones. Users who want the original vocal pitch over an EDM-tempo
beat have no option.

**Scope.**
- New AudioWorklet time-stretcher (WSOLA/granular class, NOT a phase vocoder —
  CPU headroom on mobile is the binding constraint). Follows the existing
  looper-worklet pattern: source in `src/worklets/`, imported `?raw`,
  registered via Blob URL (danger-zone rule: no static worklet paths).
- Per-deck `VARI / KEYLOCK` toggle. In KEYLOCK, tempo changes route through
  the stretcher at rate `speed` with pitch ratio 1; in VARI, behavior is
  exactly today's (`playbackRate`), bit-for-bit unchanged.
- Free byproduct: independent key-shift control (± semitones at constant
  tempo) — stretch ratio and pitch ratio are separate knobs in the same
  algorithm. Integrates with the Camelot panel (shift to a compatible key).
- Signal-chain position: the stretcher replaces/wraps the buffer source at
  the head of the per-deck chain; everything downstream (EQ → effects →
  analyser → master) is untouched. **Requires Audio Engine Architect review**
  per CLAUDE.md danger zones.
- NUDGE pitch-bend, sync, seek/cue re-anchoring, and effective-BPM math must
  all keep working in both modes (the `speed + bend` clamp logic in Deck.jsx
  currently assumes playbackRate semantics — audit every call site).

**Out of scope.** Formant preservation; stretch quality knobs; offline
render-ahead.

**Acceptance.** A 105 BPM track at 1.22x in KEYLOCK plays at ~128 BPM with
unchanged perceived pitch; VARI mode is behaviorally identical to today;
`verify:all` green; bundle budget respected (worklet is small, pure JS).

### W3.2 — Voice / mic recording into decks, crate, and sample pads · Size M · `LEGIT`

**Problem.** The user wants to record *their own voice* performing the lyrical
parts, then speed the vocal up (varispeed today, KEYLOCK once W3.1 lands) and
mix it over the EDM bed. There is currently no audio *input* path — every
buffer comes from a file on disk.

**Scope.**
- Mic capture via `getUserMedia({ audio })`. This is a **local device API,
  not a network call** — it does not violate the zero-network rule, but the
  constraint doc rules still apply: captured audio lives only in
  `AudioBuffer`s in memory, is never persisted and never transmitted
  (same contract as file loads).
- Capture constraints tuned for music, not calls:
  `echoCancellation: false, noiseSuppression: false, autoGainControl: false`.
- New `VoxRecorder` panel: ARM (requests permission) → optional count-in at
  the synced BPM → RECORD → STOP → preview → **Send to** Deck A / Deck B /
  Crate / Sample Pad N. Reuses the existing adoption paths: `Deck.loadBuffer`
  (already built for the crate), crate add, pad assign — no new plumbing.
- Capture implementation: `MediaStreamAudioSourceNode` → recorder tap
  (worklet or `MediaRecorder`+decode); decoded to a plain `AudioBuffer` so
  BPM/key detection and all deck features work on the take.
- Monitoring OFF by default (open-speaker feedback risk); optional monitor
  toggle routed pre-master with a warning.
- Graceful degradation: `getUserMedia` requires a **secure context** — it
  works in the PWA build (https / localhost) but is unavailable from
  `file://`, i.e. the single-file build opened from disk. The panel must
  detect this and show an inline "mic requires the PWA / a local server"
  notice instead of throwing. Document in `docs/IO_CONTRACT.md` (this is a
  brand-new input row) and `USER_GUIDE.md`.
- Permissions-Policy meta tag currently in `index.html` may deny
  `microphone` — audit and scope it to `self` for the capture to work.

**Out of scope.** Multi-take comping; overdub loops; any persistence of
recordings (explicitly forbidden); noise reduction.

**Acceptance.** In a secure context: arm → record a take → send to Deck B →
speed it to 1.2x → it plays through the full deck chain and appears in
BPM/key detection. On `file://`: panel renders the capability notice, app
otherwise unaffected. New IO_CONTRACT row + tests (mock `getUserMedia`,
denial path, insecure-context path). CSP: `connect-src 'none'` unchanged.

### W3.3 — EQ kill switches · Size S · `LEGIT`

**Problem.** The bass-swap on a drop is the most common EDM mixing move;
twisting the LOW knob to zero mid-performance is clumsy.

**Scope.** One-tap LOW / MID / HIGH kill buttons per deck above the existing
EQ knobs. Kill = ramp the shelf/peaking gain to its floor via
`setTargetAtTime` (never instant, never `setTimeout`); un-kill restores the
knob's prior value (kill state is separate from knob state). Keyboard: none
initially (the shortcut map is crowded); MIDI-learnable like other controls.

**Acceptance.** Toggling kill does not move the knob position; restore
returns the exact prior gain; no zipper noise; tests for the state
separation.

### W3.4 — Beat-synced loop roll · Size M · `NEEDS-SPIKE` (quantization feel)

**Problem.** The existing looper captures 4/8/16 bars from the master — it is
capture-oriented. EDM performance wants momentary ¼/½/1/2-beat rolls on a
deck that release back to the un-rolled timeline.

**Scope.** Per-deck momentary roll buttons (¼, ½, 1, 2 beats), length derived
from detected BPM × speed. While held, loop a slice ending at the press
point; on release, playback resumes where it *would have been* (timeline
keeps running underneath). Buffer-slice looping via the existing source
re-anchor machinery in Deck.jsx.

**Spike first.** Free-running beat phase (a known deferred limitation) means
rolls quantize to press time, not to the bar grid. Prototype whether
press-time quantization feels good enough before building the full UI.

**Acceptance (post-spike).** Roll engages ≤ one buffer quantum after press;
release resumes the running timeline position; works in VARI and (if W3.1
lands first) KEYLOCK.

### W3.5 — Sidechain-style ducking ("PUMP") · Size M · `LEGIT` (stretch goal)

**Problem.** The instantly recognizable EDM "pump" (bed ducking under the
kick) is impossible today without manual volume riding.

**Scope.** Per-deck PUMP toggle + depth knob: an LFO at the *synced* BPM
(period = one beat) modulating the deck's post-EQ gain with a fast-dip /
exponential-recover shape, scheduled with `setValueCurveAtTime` windows —
no live envelope follower, no beat-phase detection needed (consistent with
the deferred-items list; phase is free-running, matching the beat
indicator's behavior). Depth 0 = bypass (gain exactly 1.0).

**Acceptance.** Pump rate tracks effective BPM including speed changes;
disabling leaves gain at exactly 1.0; no scheduling pile-up on long
sessions (curve windows re-armed in bounded chunks).

**Batch-run order.** W3.3 → W3.2 → W3.1 → W3.5 → W3.4 (small/independent
first, spike-gated last). Commit per ticket, one push, one PR at the end.

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
