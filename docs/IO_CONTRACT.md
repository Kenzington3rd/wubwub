# WAVECRAFT — I/O Contract Matrix

This is the complete contract for everything that crosses the WAVECRAFT
boundary. Two big tables: **Outputs** (everything the app emits) and
**Inputs** (everything the app accepts). For every row:

- `where` — the file:line that generates the output / accepts the input
- `affordance` — the UI control (or external surface) the user / device acts on
- `validation` — what the app does before accepting the input (inputs only)
- `target state` — where an accepted input ends up (inputs only)
- `test` — the file + name of the test that pins the contract

Companion docs: [`E2E_VERIFICATION.md`](./E2E_VERIFICATION.md) holds the
per-element control coverage matrix. This one is organised by I/O direction
so the audit "every output has a UI source, every input has a UI sink" is
verifiable at a glance.

The privacy constraint is end-to-end: every output is local-only (anchor
download, AudioContext.destination, the DOM); every input is local-only
(File picker, drag-drop, keyboard, MIDI, pointer). No URL parameters, no
hash routing, no fetch, no XHR, no WebSocket, no sendBeacon.

---

## OUTPUTS — every artifact the app produces

### Audible audio (AudioContext.destination)

| Output | Generated at | UI affordance to trigger | Test |
|---|---|---|---|
| Deck A playback (audible) | `Deck.jsx:1393` PLAY button → `togglePlay` → `src.connect(chain.gain)` ultimately reaches `AudioContext.destination` via `App.jsx:208` `gain.connect(ctx.destination)` | PLAY button on Deck A (or `Space` while focused) | `Deck.test.jsx > @us US2`; e2e `App.e2e.test.jsx > @us US26: Space toggles play` |
| Deck B playback (audible) | same as Deck A through Deck B's chain | PLAY button on Deck B (or `Space` while focused) | `Deck.test.jsx > @us US2` |
| Looper slot playback | `Looper.jsx` Play button per slot → `BufferSource → slotGain → masterCompressor → … → destination` | Play / Stop button per slot in Looper | `Looper.test.jsx > @us US61` |
| Sample pad trigger | `SamplePad.jsx` pad → `BufferSource → padGain → masterCompressor → … → destination` | Pad click (or `Q W E R A S D F`) | `SamplePad.test.jsx > @us US31 / US32` |
| Bass-drop automated sweep | `Deck.jsx` bassDrop scheduling on `chain.filter.frequency` + `chain.eqLow.gain` AudioParams | BASS DROP button per deck | `Deck.test.jsx > @us US24` |
| Wobble LFO (Wobble preset) | `Deck.jsx` spawns an `OscillatorNode → eqLow.gain` modulator | BASS DROP button + wobble preset in BassDropMenu | `Deck.test.jsx > @us US24/US34` |
| Master compressor / brickwall limiter | `App.jsx:191-209` configured DynamicsCompressor with threshold -9, ratio 20, knee 0, attack 0.003, release 0.1 | Always-on safety net; not user-toggleable | `test/limiter.test.js` (new — Phase B4) + `chain.test.js > @us US55` (topology) |

### Downloads (anchor click → user disk)

| Output | Format | Generated at | UI affordance to trigger | Test |
|---|---|---|---|---|
| Mix recording | `audio/webm` (preferred) / `audio/mp4` / `audio/ogg` per `pickMime` | `App.jsx:570-577` `downloadBlob(blob, '${base}.${ext}')` after `MediaRecorder.stop()` | RECORD button in MasterBus toggles on/off | `App.test.jsx > @us US21/US37`; e2e `App.e2e.test.jsx > @us US37 + US60 + US26` |
| Cue sheet pairing the recording | `.cue.txt` plain text | `App.jsx:580-585` `downloadBlob(new Blob([cueText], 'text/plain'), '${base}.cue.txt')` | Triggered automatically when a recording stops AND ≥1 marker was dropped (via MARKER button OR `M` key) | `MasterBus.test.jsx > @us US60`; e2e `App.e2e.test.jsx > @us US37 + US60 + US26` |
| Settings export | `application/json` versioned config | `App.jsx:943-960` `serializeSettings` → `downloadBlob` | EXPORT button in MasterBus | `App.test.jsx > @us US62: clicking Export downloads a settings file` |
| Sound-bite slice (W3.6) | 16-bit PCM `audio/wav` | `Deck.jsx:479` `downloadBlob(encodeWav(bitePkg.buffer), '<name>.wav')` — `encodeWav` in `src/audio/wavEncode.js`; with an isolation mode engaged the slice is first rendered offline through `renderIsolated` | WAV button in the deck's BITE row (user-initiated; the region must be marked with SET IN / SET OUT first) | `wavEncode.test.js > @us US69`; `Deck.test.jsx > @us US69` |

All four downloads share the `downloadBlob` helper in `src/audio/recorder.js:110-119`,
which creates an `<a>` element with `download="…"`, clicks it, removes it, and
revokes the object URL — no network round-trip ever.

### Visual outputs (DOM / Canvas)

| Output | Generated at | UI affordance to trigger | Test |
|---|---|---|---|
| Waveform render (live time-domain trace) | `WaveformCanvas.jsx:125-145` `analyser.getByteTimeDomainData` → 2D path | Always rendered (per-deck canvas) | `WaveformCanvas.test.jsx > @us US14` (analyser data drives the draw) |
| Frequency bars (live FFT) | `WaveformCanvas.jsx:148-160` `analyser.getByteFrequencyData` → 48 bars | Always rendered | `WaveformCanvas.test.jsx` |
| Cue markers on waveform | `WaveformCanvas.jsx:163-181` | Set via CuePanel `+ CUE` (or `C` key) | `WaveformCanvas.test.jsx > @us US14`; `Deck.test.jsx > @us US22` |
| Playhead (dashed line) | `WaveformCanvas.jsx:184-194` | Always rendered (animated by RAF loop) | `WaveformCanvas.test.jsx` |
| Beat pulse animation | `Deck.jsx:1104-1106` inline `animation: beatPulse Ns infinite ease-in-out` driven by detected BPM | Auto-runs while deck is playing | `test/animations.test.js` (new — Phase B6/B7) |
| Clip indicator | `MasterBus.jsx:181-231` rAF reads peak from `clipAnalyserRef` → flips `setClipping` | Always-on on master output | `MasterBus.test.jsx > @us US61` |
| ARIA live-region: deck BPM/key detected | `Deck.jsx` `setBpmAnnounce` writes into a `role="status"` live region | Auto-fires when AUTO completes | `Deck.test.jsx > @us US40 / US58` |
| ARIA live-region: record start / stop / marker | `MasterBus.jsx:73-90, 460-462` `role="status"` | RECORD button transitions; MARKER button / `M` key drops | `MasterBus.test.jsx > @us US60` |
| ARIA live-region: MIDI learn / mapped | `MidiPanel.jsx` `role="status"` | Per-target Learn button | `MidiPanel.test.jsx` |
| Focus rings on focused controls | `src/index.css:21-24` `*:focus-visible { outline: 2px solid #ccd6f6; outline-offset: 2px; }` | Browser-driven on keyboard navigation | `test/focus-rings.test.js` (new — Phase B6) |
| Inline `role="alert"` errors | `Deck.jsx:1340-1355`, `SamplePad.jsx`, `Crate.jsx`, `MasterBus.jsx:447-458` | Bad file drop, bad decode, malformed settings JSON | `Deck.test.jsx > @us US44`; `SamplePad.test.jsx > @us US33`; `App.test.jsx > @us US62` |

### MIDI output

| Output | Status | Where (or N/A) |
|---|---|---|
| MIDI out from app to external device | **None — verified absent.** | `src/midi/midiMap.js` only calls `requestMIDIAccess({sysex:false})`, iterates `access.inputs`, and binds `addEventListener("midimessage", …)`. No call to `access.outputs`, no `output.send(...)`, no other MIDI-out emission anywhere in the source tree. |

### Network output

| Output | Status |
|---|---|
| fetch / XHR / WebSocket / sendBeacon | **None.** Defense-in-depth enforced by CSP `connect-src 'none'` (Phase B3). The PWA service worker only `precache`s app-shell assets, never proxies. |

---

## INPUTS — every external thing the app accepts

### Audio file inputs

| Input | Source | UI affordance | Validation | Target state | Test |
|---|---|---|---|---|---|
| Deck audio file (picker) | `<input type="file" accept="audio/*">` | "Load audio" button on each Deck (`Deck.jsx:1292-1338`) | `accept="audio/*"` + `decodeAudioData` failure → inline `role="alert"` | `Deck` `bufferRef`, `fileName` state, `chain.gain` upstream source | `Deck.test.jsx > @us US44`; `App.test.jsx > @us US63` |
| Deck audio file (drag-drop) | `dragover`/`drop` on deck region (`Deck.jsx:1044-1071`) | The whole deck card is a drop target | Same `loadFile` decode path | Same | `Deck.test.jsx > @us US44`; e2e `App.e2e.test.jsx > @us US22 + US23 + US26 + US44` |
| Sample pad audio file (picker) | `<input type="file" accept="audio/*">` per pad | `+ Load` button on each empty pad (`SamplePad.jsx`) | Same `decodeAudioData` failure → inline `role="alert"` | `padBuffersRef[i]`, pad UI flips to "filled" | `SamplePad.test.jsx > @us US33` |
| Sample pad audio file (drag-drop) | `drop` on pad | Each pad is a drop target | Same | Same | `SamplePad.test.jsx > @us US33` |
| Crate audio file (picker) | `<input type="file" accept="audio/*" multiple>` | "Add tracks" button in Crate (`Crate.jsx`) | `ingestFiles` filters non-audio + surfaces inline `role="alert"` | `crate` state + `crateBuffersRef` map | `Crate.test.jsx > @us US63`; `App.test.jsx > @us US63` |
| Crate audio file (drag-drop) | `drop` on crate region | The whole crate panel is a drop target | Same | Same | e2e `App.e2e.test.jsx > @us US63 + US44` |

### Microphone input (W3.2)

| Input | Source | UI affordance | Validation | Target state | Test |
|---|---|---|---|---|---|
| Voice take | `navigator.mediaDevices.getUserMedia({ audio })` — local device API, zero network; requires a secure context (PWA / https / localhost; unavailable from `file://`) | VOX panel: ARM MIC → RECORD → STOP (`src/components/VoxRecorder.jsx`) | Capability-gated (`micCapability()`); permission denial → inline `role="alert"`; decode failure → inline error; capture constraints pin `echoCancellation/noiseSuppression/autoGainControl` to `false` | In-memory `AudioBuffer` only → user-routed to Deck A/B/C (`loadBuffer`), crate entry, or sample pad (`adoptBuffer`); never persisted, never transmitted | `test/VoxRecorder.test.jsx > @us US67` |

### Settings JSON input

| Input | Source | UI affordance | Validation | Target state | Test |
|---|---|---|---|---|---|
| Import Settings JSON | `<input type="file" accept="application/json,.json">` | IMPORT button in MasterBus (`MasterBus.jsx:420-444`) | `parseSettings` validates version + drops unknown keys + never throws; bad input → inline `role="alert"` | `deckAColor`, `deckBColor`, `crossfadeCurve`, `recordTapMode`, `midiMappings` (App state) | `App.test.jsx > @us US62: importing a valid settings file applies the config to state`; `importing a malformed file shows an inline error and does not crash` |

### Keyboard input (every shortcut)

| Key | Action | Handler ref | Test |
|---|---|---|---|
| `Space` | Play/pause focused deck | `App.jsx:424-431` | `App.test.jsx > @us US43`; e2e `@us US26` |
| `←` | Crossfade −5% (global) / Seek −5s (waveform-focused) | `App.jsx:432-437` / `WaveformCanvas.jsx:236-238` | `App.e2e.test.jsx > @us US26`; `WaveformCanvas.test.jsx > @us US64` |
| `→` | Crossfade +5% / Seek +5s | `App.jsx:438-443` / `WaveformCanvas.jsx:239-241` | same |
| `Shift+←` | Crossfade snap to 0 | `App.jsx:434` | `App.e2e.test.jsx > @us US26` |
| `Shift+→` | Crossfade snap to 1 | `App.jsx:440` | `App.e2e.test.jsx > @us US26` |
| `↑` | Focused-deck volume +5% | `App.jsx:444-448` | `App.e2e.test.jsx > @us US26` |
| `↓` | Focused-deck volume −5% | `App.jsx:449-453` | `App.e2e.test.jsx > @us US26` |
| `Home` | Seek to 0 (waveform-focused) | `WaveformCanvas.jsx:242-244` | `WaveformCanvas.test.jsx > @us US64` |
| `End` | Seek to track end | `WaveformCanvas.jsx:245-249` | `WaveformCanvas.test.jsx > @us US64` |
| `S` (deck focused) | Sync focused deck to other's BPM | `App.jsx:455-462` | `App.test.jsx > @us US32` |
| `S` (no focus) | Sample pad 6 | `App.jsx:413-422` | `App.test.jsx > @us US32` |
| `C` | Set cue at current position on focused deck | `App.jsx:463-467` | `App.e2e.test.jsx > @us US22 + US26` |
| `M` | Drop a recording cue marker | `App.jsx:471-475` → `App.jsx:632-640` | `App.test.jsx > @us US60`; e2e `App.e2e.test.jsx > @us US37 + US60 + US26` |
| `1`-`8` | Jump to cue N on focused deck | `App.jsx:476-480` | `App.e2e.test.jsx > @us US23 + US26` |
| `,` / `.` (hold) | Pitch-bend focused deck ±4% (momentary) | `App.jsx:491-503`, release `:505-518`, blur `:527-529` | `Deck.test.jsx > @us US59`; `App.test.jsx > @us US59` |
| `Q W E R A D F` | Sample pad triggers (always available) | `App.jsx:413-422` | `App.test.jsx > @us US32` |

Modifier guards: `e.ctrlKey` / `e.metaKey` / `t` inside `<input>`/`<textarea>`/`<select>`/`contenteditable` short-circuit the handler at `App.jsx:397-400`.

### MIDI input

| Input | Source | UI affordance to enable / map | Validation | Target state | Test |
|---|---|---|---|---|---|
| MIDI access | `navigator.requestMIDIAccess({sysex:false})` | "Enable MIDI" button in MidiPanel | Feature-detected via `MIDI_SUPPORTED`; fallback message when absent | `midiUnsubRef` + `midiEnabled` state | `App.test.jsx > @us US39`; `midiMap.test.js > MIDI_SUPPORTED` |
| CC message (`0xB0`) | Web MIDI `midimessage` event | Per-target Learn button (captures) + the live runtime mapping | Channel 0-15, CC 0-127, value 0-127; under-3-byte CC dropped; non-CC/non-Note statuses dropped | `midiMappings[targetId]` + dispatched to crossfade / masterVol / deck setVolume / setFilterFreq / setSpeed | `midiMap.test.js > @us US39`; adversarial cases added in Phase B5 |
| Note On (`0x90`) | Web MIDI `midimessage` | Sample-pad bindings (deferred runtime routing — debug-log only); during Learn, rejected with inline hint | velocity 0 → normalised to noteoff; <3 bytes dropped | `console.debug` only (note runtime routing deferred); `learnHint` inline message during Learn | `midiMap.test.js > bug C2`; `App.test.jsx > @us US39: Note On in Learn does not capture` |
| Note Off (`0x80`) | Web MIDI `midimessage` | (not user-mappable yet) | <3 bytes dropped | Ignored at App level (no value-affecting action) | `midiMap.test.js > bug C2` |
| sysex (`0xF0`) | Disabled at `requestMIDIAccess({sysex:false})` | N/A — feature off | Browser-enforced (never delivered) | None | Phase B5 adversarial test confirms even if injected directly, the handler drops it (`status & 0xF0` doesn't match any handled case) |
| Pitch bend (`0xE0`) / Program change (`0xC0`) / Channel pressure (`0xD0`) | Web MIDI `midimessage` | N/A | Dropped silently at `midiMap.js` (only `0xB0`/`0x90`/`0x80` matched) | None | `midiMap.test.js > @us US39: short messages and unrecognised statuses are ignored`; extended in Phase B5 |
| Device statechange (connect / disconnect) | `access.addEventListener("statechange", …)` | None — automatic | `e.port.type === "input"` gate | Subscribes / unsubscribes the `midimessage` handler per input | `midiMap.test.js > @us US39: unplug→replug does not double-bind`; Phase B5 mid-stream disconnect case |

### Pointer / touch input

Every clickable / draggable surface delegates to handlers that are also reachable by keyboard. The full list lives in `E2E_VERIFICATION.md`. Categorically:

| Surface | Handler | Test |
|---|---|---|
| Buttons (PLAY, PAUSE, STOP, LOOP, TAP, SYNC, AUTO, ÷2, ×2, BASS DROP, NUDGE −/+, RECORD, MARKER, Clean/Radio, Export, Import, Add tracks, Clear, → A, → B, ×, Cue chip, Cue ×, Learn, Mode select, Enable MIDI, Theme swatch, BassDrop preset, Next Tip, Tab, Camelot wheel key) | `onClick` per component | covered per row in `E2E_VERIFICATION.md` |
| Sliders (Master vol, Deck VOL/SPD/FLT, Crossfader, Looper slot vol, Sample pad vol) | `<input type="range" onChange>` | `Slider.test.jsx`; per-component tests |
| Knobs (EQ LOW/MID/HIGH, Reverb MIX/SIZE, Delay MIX/TIME/FB, Distortion MIX/DRIVE) | Pointer drag (Y-axis) + keyboard contract on the same `role="slider"` element | `Knob.test.jsx > @us US6` |
| Drag-drop targets (Deck, Sample pad, Crate) | `onDragOver` / `onDrop` per region | `Deck.test.jsx > @us US44`; `SamplePad.test.jsx > @us US33`; `Crate.test.jsx > @us US63` |
| Waveform click-to-seek | `onPointerDown` on canvas | `WaveformCanvas.test.jsx > @us US14` |
| Pointer-released unlock (iOS audio unlock) | `window.addEventListener("pointerdown", kick, {once:true})` (`App.jsx:309`) | side-effect; covered structurally |

### URL parameters / hash routing

| Input | Status |
|---|---|
| URL search params (`?…`) | **None read.** No `window.location.search` / `URLSearchParams` reads anywhere in the source. |
| URL hash (`#…`) | **None read.** No `window.location.hash` reads anywhere in the source. |
| Routing | **None.** Single-page app, no router. |

Verified by `Grep` over `src/`: no `window.location.search`, no `URLSearchParams`, no `window.location.hash` usage in app code. (Vite dev-server HMR uses `import.meta.hot`, not URL state.)

### Sources NOT accepted (by design)

| Source | Status | Why |
|---|---|---|
| `fetch` / XHR / WebSocket / sendBeacon | absent + CSP-blocked | Local-only promise |
| `localStorage` / `sessionStorage` for user audio | unused for audio | Settings JSON is user-driven download/upload only |
| `IndexedDB` | unused | same |
| Clipboard | not read | not needed |
| Geolocation / Camera / USB / Serial / HID / Bluetooth | blocked by Permissions-Policy in `index.html` | Defense-in-depth |
| Microphone | **accepted since W3.2** — Permissions-Policy scoped to `self`; local capture only (see the Microphone input section above) | Voice takes; in-memory, never persisted/transmitted |

---

## Tests added in Phase B (per the directive)

| Phase | Coverage | Test file |
|---|---|---|
| B1 | PWA manifest + sw.js + registerSW.js + icons exist on disk and validate | `test/build.test.js` |
| B2 | Single-file build has zero external scripts/styles; fonts inlined as data: URIs; CSP meta still present | `test/build-single.test.js` |
| B3 | CSP forbids `connect-src` external, `frame-src 'none'`, `object-src 'none'`, `base-uri 'self'`, no `'unsafe-eval'` | `test/csp.test.js` |
| B4 | Master compressor configured with limiter-class params (threshold, ratio, knee, attack, release) | `test/limiter.test.js` |
| B5 | Adversarial MIDI cases (1-byte, pitch bend, channel pressure, sysex injection, all 16 channels, mid-stream disconnect, learn-mode stuck-on key) | extended in `test/midiMap.test.js` |
| B6 | `:focus-visible` rule present in `src/index.css` with correct color token | `test/focus-rings.test.js` |
| B7 | `@keyframes beatPulse` present in `src/index.css` and consumed by at least one component | `test/animations.test.js` |

## Defects found while drafting

None. Every output above has a UI affordance that triggers it; every input
above has a UI sink that accepts it. The IO matrix is fully closed —
no orphan outputs, no orphan inputs.

## Verification commands

| Command | Purpose |
|---|---|
| `npm test` | Run every Vitest spec — must include the Phase B suites |
| `npm run build` | Multi-file PWA bundle (required input for `verify:build`) |
| `npm run build:single` | Single-file portable bundle (required input for `verify:single`) |
| `npm run verify:build` | Run the build-artifact tests against `dist/` (skips if absent) |
| `npm run verify:single` | Run the single-file artifact tests against `dist-single/` |
| `npm run verify:all` | The full pipeline: build → build:single → test |
| `npm run size` | Bundle-size budget check (75.5 KB / 90 KB gzip JS) |
