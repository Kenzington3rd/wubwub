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
| US2 | Play / pause / stop a loaded track — click-free edges: pause / stop / seek / cue fade the outgoing source over ~4 ms on its own per-source gain node (τ = 4 ms / 6, so ≤ −52 dB remains at the scheduled stop) while the next source starts immediately; unmounting mid bite-preview takes the same fade path and releases the fade node; the scheduled stop lands `EDGE_FADE_S + 10 ms` after the fade starts (the margin only guards against a late-scheduled automation shrinking the fade); a main source that ends naturally releases its fade node, its `sourceFades` entry and the deck's reference | I | `test/Deck.test.jsx` |
| US3 | Adjust deck volume (0–1) | I | `test/Deck.test.jsx` |
| US4 | Adjust playback speed (0.5×–2.0×) — a slider drag re-anchors from the live playhead, so the display never freezes and pause/play resumes where the audio is | I | `test/Deck.test.jsx` |
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
| US21 | Master compressor as safety-net limiter (−2 dB threshold; looper taps pre-limiter record tap) | I | `test/App.test.jsx` |
| US22 | Set cue point at current time (up to 8 max) | I | `test/Deck.test.jsx` |
| US23 | Jump to cue point | I | `test/Deck.test.jsx` |
| US24 | Delete cue point | C | `test/CuePanel.test.jsx` |
| US25 | Beat sync (match one deck's tempo to the other's BPM) | I | `test/Deck.test.jsx` |
| US26 | Keyboard shortcuts (Space, arrows, S, C, 1–8, Q W E R / A S D F) | I | `test/App.test.jsx` |
| US27 | Click a deck to focus it; visual outline indicates focus | I | `test/App.test.jsx` |

## P2 — Delight

| ID | Story | Coverage | Test file |
|---|---|---|---|
| US28 | Capture 4/8/16-bar loops from the pre-limiter record tap (the mix before the master limiter) | E | manual (worklet runs in audio thread) |
| US29 | Looper slot plays looped | E | manual |
| US30 | Looper slot volume per slot | E | manual |
| US31 | Load samples into 8 sample pads | E | manual |
| US32 | Trigger sample pads via Q W E R / A S D F | I | `test/App.test.jsx` |
| US33 | Drag-drop audio files onto sample pads | C | `test/SamplePad.test.jsx` |
| US34 | Bass-drop preset (Standard / Heavy / Wobble) — Wobble hands the LPF back to the user's cutoff with a glide, not a jump | U + C + I | `test/data.test.js`, `test/BassDropMenu.test.jsx`, `test/Deck.test.jsx` |
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

## W1 — Harmonic aid, pitch-bend & recording

| ID | Story | Coverage | Test file |
|---|---|---|---|
| US58 | Reactive harmonic key suggestions — deck shows `mix → …` compatible keys; Camelot wheel highlights the focused deck's detected key + neighbours | U + C + I | `test/data.test.js`, `test/TheoryPanel.test.jsx`, `test/Deck.test.jsx` |
| US59 | Momentary pitch-bend NUDGE −/+ — held button applies a temporary ±4% offset, reverts on release; disabled with no file | I | `test/Deck.test.jsx` |
| US60 | Recording cue markers → cue-sheet export — `M` key / MARKER button drops timestamped markers while recording; live count shown; on stop a `<base>.cue.txt` cue sheet (MM:SS — Marker N) downloads alongside the audio; markers reset between recordings (W1.3) | U + C + I | `test/recorder.test.js`, `test/MasterBus.test.jsx`, `test/App.test.jsx` |
| US61 | Recorder pre/post-limiter tap toggle + clip meter — Clean (pre-limiter parallel tap) vs Radio (post-limiter) selector, locked while recording; master clip indicator lights in `--danger` above the ~0.99 clip threshold (W1.7) | C + I | `test/chain.test.js`, `test/MasterBus.test.jsx`, `test/App.test.jsx` |
| US62 | Settings export / import — Export downloads a versioned `wavecraft-settings-<ts>.json` (deck themes, crossfade curve, MIDI mappings, recorder tap mode — config only, no audio); Import parses + validates it (checks the `app: "WAVECRAFT"` marker + `version`, drops unknown/malformed fields, never throws, shows an inline `--danger` error on bad input) and applies the valid config to state. Also lets MIDI maps survive a reload (W1.4) | U + C + I | `test/settings.test.js`, `test/App.test.jsx` |
| US63 | Session crate panel — in-memory list of decoded tracks; add via drag-drop onto the panel or a file-picker (decoded once, validated, decode errors caught inline); each entry quick-loads to Deck A/B via the deck's `loadBuffer` imperative method (pre-decoded buffer, no re-decode); entries removable individually + a Clear-all; never persisted, empty on every fresh load. BPM/key columns rendered but auto-analysis deferred (W1.5) | C + I | `test/Crate.test.jsx`, `test/Deck.test.jsx`, `test/App.test.jsx` |
| US64 | Keyboard-operable waveform seek — once a track is loaded the waveform `<canvas>` is a `role="slider"` (`tabIndex={0}`, `aria-valuemin/max/now/text`); ←/→/↑/↓ seek ±5 s, Home/End jump to track ends, calling `onSeek` with the same normalized 0–1 contract as click-to-seek. The canvas `stopPropagation()`s the keys it consumes so the global crossfader/volume arrow shortcuts don't also fire; an empty deck's canvas is not a focusable seek control (DESIGN_GUIDE §6) | C + I | `test/WaveformCanvas.test.jsx`, `test/App.test.jsx` |

## W3.8 — Three decks

| ID | Story | Coverage | Test file |
|---|---|---|---|
| US65 | Third deck (Deck C) with crossfader assign — three full-featured decks; each carries an `A / THRU / B` assign segmented control (aria-pressed). Assigned decks follow the existing crossfade curves (`assignGain` A/B legs match `crossfadeGains` verbatim); THRU is exactly 1.0 at every fader position. Defaults (A→A, B→B, C→THRU) reproduce two-deck behavior. Crate quick-loads to C; settings v3 round-trips `deckCColor` + `deckAssigns` (v1/v2 files still import; malformed assigns dropped); SYNC targets the dominant playing deck | U + C + I | `test/crossfade.test.js`, `test/settings.test.js`, `test/App.test.jsx` |

## W3 — EDM remix batch

| ID | Story | Coverage | Test file |
|---|---|---|---|
| US67 | Voice / mic recording (VOX panel) — `getUserMedia` with music-tuned constraints (no echo cancellation / noise suppression / AGC); ARM → RECORD → STOP decodes the take to an in-memory `AudioBuffer`; PREVIEW plays through the master bus; the take routes to Deck A/B/C (`loadBuffer`), the crate, or a chosen sample pad (`adoptBuffer`); optional MONITOR (mic → gain → master, off by default); permission denial and insecure contexts (file://) degrade to inline notices — never a throw; nothing persisted, nothing transmitted (W3.2) | U + C | `test/VoxRecorder.test.jsx` |
| US73 | KEYLOCK playback mode — per-deck VARI/KEYLOCK toggle (experimental, session-only, VARI default and bit-identical). KEYLOCK streams playback through the WSOLA stretch worklet: buffer channels posted once per track (transferred copies), play/pause/seek via port messages, tempo via the `rate` AudioParam (speed + NUDGE bend — tempo bend at constant pitch), `pitchRatio` untouched at 1; position reports drive drift correction; worklet-unavailable falls back to VARI; mode hops mid-play resume at the same position (W3.1). The worklet's resident state (channels / playing / offset) is asserted across every transport path — pause, stop, seek, EJECT, track replace, `ended` with loop on/off, `position` reports (honoured in KEYLOCK, ignored in VARI), `looped`, Loop toggle, roll hold/release/pause-mid-roll, unmount teardown, module-load failure → VARI fallback — via a mock processor that mirrors the real port protocol (resident state incl. `loop`; a `load` without `loop` clears it, as the processor does). The inline KEYLOCK hint reads “experimental — flip to VARI if it smears”. The worklet owns the loop wrap: Loop toggles post `setLoop`, `load` carries `loop`, every KEYLOCK play posts `setLoop` first; a `looped {seconds}` report re-anchors the timeline with no host `play`, and `ended` (sent only with no loop) stops the deck — the host never re-posts `play`. A ROLL in KEYLOCK is a loop region inside the worklet (constant pitch, no BufferSource); toggling Loop while it is held does not overwrite the region (the new state applies on release). `position` / `looped` reports carrying `at` (worklet clock: the end-of-quantum time the reported sample is heard) anchor the timeline to it; without `at` the arrival time is used. `looped` carries `{seconds (audible), regionStart, at, epoch}`. The host bumps a transport epoch on every `load` / `play` / `seek` and on the roll start / release `setLoop` + `seek` pairs; the worklet stores it on load / play / seek (not setLoop, so a quantum rendered between a roll-release pair's messages still reports the previous epoch) and echoes it in every report, and reports from a previous transport epoch are dropped (epoch-less reports fall back to `at`: one heard at or before the last host re-anchor — transport, speed change or bend — is dropped). The mock processor ignores degenerate `setLoop` regions (end ≤ start, or under one 512-frame hop) exactly as the real one does. The real worklet loops in place — `setLoop {enabled, start?, end?}` (seconds; whole track when start/end are omitted; regions shorter than one hop or with end ≤ start are ignored) and `load {loop:true}` wrap the read position inside `synthesizeBlock` so grains stay continuous across the seam, with one `looped {seconds (audible), regionStart, at, epoch}` per audible wrap and `ended` only when no loop is set and the audible position reaches the track end; `position` reports the audible playhead (within one render quantum), not the synthesis write head; buffers at a non-context sample rate keep their pitch and tempo; the alignment search radius is half the period of 40 Hz at the context rate, so sub-bass stays keylocked at 44.1 / 48 / 96 kHz contexts (on dense material the alignment may favour mid-range over bass — normal WSOLA); a cold play rises no faster than the explicit 4 ms linear fade-in | U + I | `test/timeStretch.test.js`, `test/stretchWorklet.test.js`, `test/Deck.test.jsx` |
| US71 | WSOLA time-stretch DSP core — the pure-math engine behind KEYLOCK (`src/audio/timeStretch.js` + `src/worklets/stretch-worklet.js`): 2048-sample periodic-Hann grains at 75% overlap sum to exactly unity (no OLA ripple); each grain is aligned (±12.5 ms = half the period of 40 Hz — `searchRadius(sampleRate)`: 552 / 600 / 1200 samples at 44.1 / 48 / 96 kHz, normalized cross-correlation) to the natural continuation of the previous one, so bass stays keylocked down to ~40 Hz at any sample rate (41 Hz @ 44.1 kHz, 49 Hz @ 48 kHz, 90 / 49 Hz @ 96 kHz: f0 within 0.5 dB, < −20 dB at f0 × rate), a 440 Hz sine stays flat (AM ≤ 0.5 dB at rates 1.02 / 1.12 / 2.0, pitch within 1%), a click train keeps one peak per click (no transient doubling), and rate 1 / pitch 1 is bit-exact; `semitonesToRatio` maps 0/+12/−12 → 1/2/0.5, `readGrain` resamples with linear interpolation and zero-pads out of range, output length scales inversely with `rate` (tempo without pitch) while `pitchRatio` changes in-grain content speed at constant length. The worklet source registers `stretch-processor` with `rate` + `pitchRatio` AudioParams and is loaded `?raw` + Blob URL like the looper (W3.1) | U | `test/timeStretch.test.js` |
| US72 | Momentary loop roll — per-deck ROLL row (¼ ½ 1 2 beats, hold-to-engage): the last N beats (at the track's BPM, ending at the LIVE playhead — not the up-to-100 ms-stale display position) loop through the chain while the deck's wall-clock timeline keeps running underneath; release re-anchors playback at the advanced live wall-clock position; pause/stop/seek/load mid-roll always kill the roll source with an edge fade; a NUDGE held — or a speed change made — mid-roll re-anchors the running timeline at the new rate and bends/retargets the roll source in step; buttons disabled unless playing (W3.4, built per the spike findings — press-time quantized). Roll edges fade over ~4 ms (no click); in KEYLOCK the roll runs as a worklet loop region so it keeps the deck's pitch, ending at the live playhead and never shorter than 0.02 s (the worklet ignores a sub-hop region) | I | `test/Deck.test.jsx` |
| US70 | PUMP sidechain-style ducking — per-deck toggle + DEPTH knob; a unity `pumpGain` (filter → pump → effects) driven by one `setValueCurveAtTime` window per beat (starts at exactly 1.0, a few-ms linear dip to 1−depth, exponential recovery to 1.0 — no per-beat gain step), armed ~4 beats ahead by a re-arming interval so long sessions never pile up schedule; rate re-reads the live effective BPM (detected × speed) each pass; free-running phase; OFF cancel-and-holds the schedule and glides the gain to exactly 1.0, never throwing (W3.5) | U + I | `test/chain.test.js`, `test/Deck.test.jsx` |
| US69 | Sound-bite extraction — per-deck BITE row: SET IN / SET OUT mark a region at the playhead (drawn on the waveform), ▶ LOOP previews it through the live chain, then the slice (equal-power edge fades, `sliceBuffer`) routes to a chosen sample pad, the crate, or a 16-bit WAV download (`encodeWav` → `downloadBlob`, user-initiated, no auto-persistence). With an isolation mode engaged the slice renders offline through the same isolation path (`renderIsolated`) so the saved bite IS the isolated component. Region resets on track change (W3.6, folds in the Wave 2 WAV-encoder item) | U + I | `test/wavEncode.test.js`, `test/Deck.test.jsx` |
| US68 | Component isolation mode — per-deck ISOLATE row (BASS / VOCAL / INSTR / PERC) built from pure Web Audio: dry path + four gated wet paths between the deck gain and the EQ (bass = 24 dB/oct 180 Hz lowpass cascade; vocal = mono mid downmix band-passed 200 Hz–8 kHz; instrumental = signal + inverted mid = side extraction; drums = side + 6 dB treble tilt). Radio-style buttons (aria-pressed, disabled until loaded); OFF is bit-transparent (dry gain exactly 1.0); all transitions via `setTargetAtTime` gain ramps, never disconnect. Honest-limits copy: EQ/phase math, not ML stems — bleed expected (W3.7) | U + I | `test/chain.test.js`, `test/Deck.test.jsx` |
| US66 | EQ kill switches — one-tap KILL button under each EQ knob ramps that band to the −26 dB kill floor via `setTargetAtTime` (never instant); kill state is separate from knob state (killing doesn't move the knob; un-kill restores the exact prior gain; turning a killed band's knob keeps it killed); aria-pressed reflects state (W3.3) | I | `test/Deck.test.jsx` |

## W4 — Desktop app

| ID | Story | Coverage | Test file |
|---|---|---|---|
| US74 | Standalone desktop app — an Electron shell wrapping the same `dist-single/index.html` the web build produces (no forked UI). Serves it from a custom `wavecraft://` scheme registered `secure: true`, so the page is a **secure context** and the VOX mic panel works offline — which `file://` cannot do. Danger-zone parity with the web build: all non-app requests cancelled at the session level, no auto-updater/telemetry/crash reporting, renderer gets `nodeIntegration: false` + `contextIsolation: true` + `sandbox: true`, external links open in the real browser. Packaged per-OS (AppImage / portable .exe / .dmg) by a CI matrix, since Electron isn't cross-compilable (W4.1) | U | `test/desktop.test.js` |
| US75 | Full interaction coverage — every control in the app is enumerated from the live DOM (in its fully-loaded state, with conditional surfaces like the BITE send row reached first) and held to five standing guarantees: every control has an accessible name, no two controls share one, the load-bearing inventory matches a checked-in manifest, and every button / slider / select / momentary control is actually driven — clicked twice, taken to both extremes, pressed without release — on both a loaded and an empty deck — and keyboard focus never strands: activating any button leaves focus on a connected, enabled control (the class rule the EJECT focus bug grew out of; it also caught the looper Capture button disabling itself mid-capture). Complemented by process-level runs that trace each pipeline to its terminal artifact (recording → audio file + `.cue.txt`, bite → RIFF WAV / pad / crate, settings → JSON round-trip, crate → deck, looper capture → playback, and a full three-deck mix session) | I + E2E | `test/interaction-census.test.jsx`, `test/process-e2e.test.jsx` |
| US76 | App icon — a negative-space waveform cut out of a vinyl disc, serving as favicon, PWA/home-screen icon and the Windows/macOS/Linux desktop app icon. Square viewBox-scaled SVG with no external references or raster embeds (it is service-worker precached and inlined into the single-file build), artwork inside the 80% maskable safe zone, and the committed PNGs pinned in sync with the SVG they are generated from | U | `test/app-icon.test.js` |
| US77 | Eject — every deck has an EJECT control beside the load slot: stops playback, clears the buffer, cues, bite region and detected BPM/key, and returns the deck to its empty "Drop audio here" state so a new track can be loaded. Mixer state (EQ, effects, volume, crossfader assign) deliberately survives, matching a hardware channel strip. Disabled (inert) while the deck is empty (W4.3, from desktop field testing) | I + E2E | `test/process-e2e.test.jsx`, `test/interaction-census.test.jsx` |
| US78 | Drop safety — a file dropped anywhere that is not a drop zone (or rejected by one) can never navigate the page away and destroy the session: an app-level dragover/drop guard cancels the browser default, deck zones reject non-audio and undecodable files with an inline `role="alert"` error, and the deck remains loadable afterwards (W4.3, from desktop field testing — an unaccepted drop previously replaced the whole app with the dropped file) | I + E2E | `test/process-e2e.test.jsx` |

## Useful utilities

| ID | Story | Coverage | Test file |
|---|---|---|---|
| US51 | `useMatchMedia` hook tracks viewport size | C | `test/useMatchMedia.test.jsx` |
| US52 | `mapCcToValue` clamps + scales MIDI CC by target | U | `test/midiMap.test.js` |
| US53 | `clamp` helper bounds values correctly | U | `test/effects.test.js` |
| US54 | `extensionForMime` returns sensible defaults | U | `test/recorder.test.js` |
| US55 | `buildDeckChain` wires nodes per the documented signal chain | I | `test/chain.test.js` |
| US56 | `Icon` component renders the hand-drawn SVG set (no emoji, no network) | C | `test/Icon.test.jsx` |
| US57 | The UI contains zero emoji — all glyphs come from `<Icon>` (BRANDING_GUIDE §5) | U | `test/Icon.test.jsx` |

## Privacy / policy promises (D — not executable but worth listing)

- **D1** — Zero network calls at runtime
- **D2** — No localStorage or persistent storage of user audio
- **D3** — No accounts, no telemetry, no analytics
- **D4** — User files never leave the device

These are enforced architecturally (CSP meta tag, code review) rather than via tests. The closest "test" is the network audit during build verification: `dist/` should reference no external origins.

---

## R23 end-to-end verification pass

The R23 verification pass produced [`E2E_VERIFICATION.md`](./E2E_VERIFICATION.md),
a per-control matrix covering every interactive element across every screen
with `file:line` source pointers and the specific test that pins the outcome.
That document is the canonical answer to "is this button verified to work?"
and is regenerated whenever a control's contract changes.

The R23 work added `test/App.e2e.test.jsx` — 22 multi-step integration
tests that close the "does not throw → asserts the outcome" gap on every
global keyboard shortcut (ArrowUp/Down deck volume, Shift+Arrow snap, C-cue,
digit-key jump, Space play toggle, M-key marker), plus full record → marker
→ stop, settings export → import round-trip, crate drag-drop → quick-load,
and the empty-vs-loaded waveform slider transition.

Total suite at the end of R23: 30 test files, 383 tests, all passing.
