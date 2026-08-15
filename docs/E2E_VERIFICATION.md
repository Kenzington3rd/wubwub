# WAVECRAFT — End-to-End Verification Matrix

This document is the comprehensive control-coverage matrix produced by the
R23 end-to-end verification pass. Every interactive element across every
screen of the app is enumerated with: source location, expected outcome, and
the test that pins the outcome (or, where a behavioral test isn't applicable,
the structural evidence that stands in).

> **How to read the test refs.** `file:line` always points at the *handler*
> in source. `test:test-name` cites the test that asserts the outcome. The
> `@us US##` tag matches the user-story IDs in [`USER_STORIES.md`](./USER_STORIES.md).

## File / folder / asset existence audit

| Path | Used by | Status |
|---|---|---|
| `src/fonts/Audiowide-Regular.woff2` | imported via `?url` in `src/fonts/index.js` | exists; emitted hashed by Vite (`assets/Audiowide-Regular-*.woff2`); included in PWA precache (13 entries, sw.js) |
| `src/fonts/Exo2-Variable.woff2` | imported via `?url` in `src/fonts/index.js` | exists; emitted hashed; precached |
| `src/worklets/looper-worklet.js` | imported `?raw` in `src/App.jsx:8` | exists; bundled into the JS chunk (Blob URL registration) |
| `public/icons/icon.svg` | `vite.config.js#includeAssets` + manifest | exists; precached |
| `public/icons/icon-192.png` | precache + apple-touch-icon | exists; precached + inlined as data URI in single-file build |
| `public/icons/icon-512.png` | precache + manifest | exists; precached |
| `vite.config.js#includeAssets` | PWA precache extras | three entries, all icons; no stale `fonts/…` or `worklets/…` references (fonts/worklet now flow through Vite's asset pipeline, not `public/`) |

Confirmed by `Grep` across the whole repo: no source/doc/config file still
references `public/fonts/` or `public/worklets/`. The `dist/sw.js` precache
manifest after `npm run build` lists both font files as hashed siblings and
`index.html` + `manifest.webmanifest` + all three icons.

## App shell — `src/App.jsx`

### Global keyboard shortcuts (handler in `src/App.jsx:394-538`)

| Key | Target / outcome | Handler ref | Test |
|---|---|---|---|
| Space | Toggle play on focused deck; defocus button if Space arrived on one (anti-double-trigger) | `App.jsx:424-431` | `App.test.jsx > @us US43: space key with target=button skips re-trigger via blur`; outcome verified by `App.e2e.test.jsx > @us US26: Space toggles play on the focused deck (aria-pressed flips)` |
| ArrowLeft | Crossfade −5% | `App.jsx:432-437` | `App.e2e.test.jsx > @us US26: ArrowLeft nudges the crossfader value backward by ~0.05` |
| ArrowRight | Crossfade +5% | `App.jsx:438-443` | `App.e2e.test.jsx > @us US26: ArrowRight nudges the crossfader value forward by ~0.05` |
| Shift+ArrowLeft | Snap crossfader to 0 | `App.jsx:434` | `App.e2e.test.jsx > @us US26: Shift+ArrowLeft snaps the crossfader to 0 (Deck A solo)` |
| Shift+ArrowRight | Snap crossfader to 1 | `App.jsx:440` | `App.e2e.test.jsx > @us US26: Shift+ArrowRight snaps the crossfader to 1 (Deck B solo)` |
| ArrowUp | Focused-deck volume +5% | `App.jsx:444-448` | `App.e2e.test.jsx > @us US26: ArrowUp on a focused deck raises that deck's volume by ~0.05` + no-op-on-no-focus regression |
| ArrowDown | Focused-deck volume −5% | `App.jsx:449-453` | `App.e2e.test.jsx > @us US26: ArrowDown on a focused deck lowers that deck's volume by ~0.05` |
| `S` (deck focused) | Sync focused deck to other deck's BPM | `App.jsx:455-462` | `App.test.jsx > @us US32: 'S' triggers deck sync when a deck is focused (not sample pad 6)` |
| `S` (no focus) | Trigger sample pad 6 | `App.jsx:413-422` | `App.test.jsx > @us US32: 'S' triggers sample pad 6 when no deck is focused` |
| `C` | Set cue at current position on focused deck | `App.jsx:463-467` | `App.e2e.test.jsx > @us US22 + US26: C key sets a cue on the focused deck once a buffer is loaded` + no-op regression `@us US26: C is a no-op when no deck is focused` |
| `1`–`8` | Jump to cue N on focused deck | `App.jsx:476-480` | `App.e2e.test.jsx > @us US23 + US26: digit keys 1-8 jump to the cue at that index` |
| `M` | Drop a recording cue marker (no-op when not recording) | `App.jsx:471-475` + `onDropMarker` `App.jsx:632-640` | `App.test.jsx > @us US60: M key is a no-op when not recording`; integration `App.e2e.test.jsx > @us US37 + US60 + US26` |
| `,` / `.` | Hold-to-bend ±4% pitch on focused deck | `App.jsx:491-503`, release at `:505-518`, blur-release `:527-529` | `App.test.jsx > @us US59: ',' / '.' keys nudge the focused deck — hold applies, release reverts`; R18 T5/T6 regressions for capture-at-keydown + blur release |
| `Q W E R A D F` (S handled separately) | Sample pad trigger 1–8 (no focus required) | `App.jsx:413-422` | `App.test.jsx > @us US32: sample pad keys (q w e r a s d f) don't throw when pressed` |
| Inside input/textarea/select/contenteditable | Skip global handler | `App.jsx:397-400` | `App.test.jsx > @us US26: keys in <input> fields don't trigger app shortcuts` |

### Imperative APIs (`Deck.jsx:994-1038`)

Exposed via `useImperativeHandle` on the Deck refs and called by the
App-level keyboard / MIDI / crate-quick-load paths:

| Method | Test |
|---|---|
| `togglePlay`, `play`, `pause`, `stop` | `Deck.test.jsx > @us US2`, `@us US26` (Pause/Stop omit aria-pressed) |
| `loadBuffer(buf, name)` | `Deck.test.jsx > @us US63: deck exposes a loadBuffer imperative method` and the no-decode round-trip test |
| `isReady`, `isPlaying`, `getBpm`, `getEffectiveBpm` | `Deck.test.jsx > @us US25 / US45` |
| `nudgeVolume`, `setVolume`, `getVolume` | `Deck.test.jsx > @us US3`; MIDI relative-encoder regression `App.test.jsx > @us US39: relative CC seeds from the live deck value` |
| `setSpeed`, `getSpeed` | `Deck.test.jsx > @us US4` + speed-slider-schedules-via-setTargetAtTime test |
| `setFilterFreq`, `getFilterFreq` | `Deck.test.jsx > @us US19 / US20` |
| `setCue`, `jumpCue` | `Deck.test.jsx > @us US22 / US47`, `App.e2e.test.jsx > @us US22 + US26` |
| `syncTo(otherBpm)` | `Deck.test.jsx > @us US25` |
| `startNudge(dir)`, `endNudge()` | `Deck.test.jsx > @us US59`, App-level `@us US59: keyup releases the bend on the deck that started the hold (R18 T5)` |

## MasterBus — `src/components/MasterBus.jsx`

| Control | Source | Outcome | Test |
|---|---|---|---|
| MASTER volume slider | `MasterBus.jsx:160-168` | App-level `onMasterVolChange` updates state; ramp scheduled on master gain | covered by `App.test.jsx > @us US21 / US37: app renders a record button and master volume` + master-trim topology tests |
| ThemePicker A / B | `MasterBus.jsx:234-235` ↔ `ThemePicker.jsx:24-58` | swatch aria-pressed flips, deck identity color recolors header glow | `ThemePicker.test.jsx > @us US36/US50`; integration `App.e2e.test.jsx > @us US36: clicking a deck color swatch updates aria-pressed` |
| Clip meter | `MasterBus.jsx:181-231` | rAF loop reads peak from `clipAnalyserRef`; title flips between "Clip meter…" and "Clipping…"; inline caption "too hot — lower volume" renders on clip | `MasterBus.test.jsx > @us US61` (calm + clipping + no-live-region) |
| Recorder tap toggle (Clean / Radio) | `MasterBus.jsx:250-286` | calls `onRecordTapModeChange("pre"/"post")`; segments disabled while recording | `MasterBus.test.jsx > @us US61` (4 tests); integration `App.test.jsx > @us US61: recordTapMode 'pre' taps the pre-limiter recordTap` and `@us US61: the tap toggle is disabled while recording is in progress` |
| MARKER button | `MasterBus.jsx:289-335` | disabled when not recording; click calls `onDropMarker`; count badge reflects markerCount | `MasterBus.test.jsx > @us US60` (5 tests); App integration `@us US60: starting a recording enables MARKER and dropping a marker bumps the count` |
| RECORD button | `MasterBus.jsx:337-379` | toggles record via `onToggleRecord`; aria-pressed flips; label shows `REC m:ss` while running; disabled when `!recordSupported` | `App.test.jsx > @us US21/US37`; `@us US60: stopping a recording with markers downloads a .cue.txt alongside the audio`; e2e `@us US37 + US60 + US26: record → drop marker via M key → stop downloads audio + cue sheet` |
| Export Settings | `MasterBus.jsx:395-419` | calls `onExportSettings` → JSON anchor download | `App.test.jsx > @us US62: clicking Export downloads a settings file` |
| Import Settings (hidden file input) | `MasterBus.jsx:388-394` + `:420-444` | reads file via FileReader, validates via `parseSettings`, applies on `ok`, shows inline `role="alert"` on bad input | `App.test.jsx > @us US62: importing a valid settings file applies the config to state` + `importing a malformed file shows an inline error and does not crash`; round-trip `App.e2e.test.jsx > @us US62` |
| Recording live region (`role="status"`) | `MasterBus.jsx:73-90, 460-462` | announces start / stop / marker-dropped | `MasterBus.test.jsx > @us US60: a marker drop is announced` |

## Deck — `src/components/Deck.jsx`

### Header buttons

| Control | Source | Outcome | Test |
|---|---|---|---|
| TAP | `Deck.jsx:1111-1131` + `tapBpm` `:880-898` | average interval over up to 8 taps; clamps to [40, 220] BPM | `Deck.test.jsx > @us US9` (3 tests — 120 BPM, same-ms guard, fast clamp) |
| SYNC | `Deck.jsx:1132-1157` | calls `onSync` prop → App.onSyncDeck → other deck's BPM passed to `syncTo` | `Deck.test.jsx > @us US25` + sync-button disabled-when-empty |
| AUTO | `Deck.jsx:1158-1182` + `runAutoBpm` `:900-953` | runs `detectBpm` + `detectKey` on the buffer; honours manual BPM override; lifts key via `onKeyDetected`; live region "Detected N BPM, key …" | `Deck.test.jsx > @us US40`, `@us US58`, `@us US40 stale auto-detect bails` |
| ÷2 | `Deck.jsx:1183-1207` | `setBpm(b/2)` clamped to 40 | covered by inventory + disabled-state test `@us US25/US45` |
| ×2 | `Deck.jsx:1208-1230` | `setBpm(b*2)` clamped to 220 | inventory + disabled-state test |
| ASSIGN `A` / `THRU` / `B` (W3.8) | `Deck.jsx:1639-1680` | segmented control; `onAssignChange(id, "A"\|"THRU"\|"B")` routes the deck to a crossfader end (`assignGain` A/B legs match `crossfadeGains` verbatim) or bypasses it at exactly 1.0; aria-pressed reflects the active segment | `crossfade.test.js > @us US65` (THRU is exactly 1.0 at every position; A/B legs match the two-deck curves); `App.test.jsx > @us US65`; settings round-trip `settings.test.js > @us US65` |
| File picker (hidden + dressed-up button) | `Deck.jsx:1292-1338`, change handler `:588-592` | `accept="audio/*"`; passes the file to `loadFile`; aria-label flips between "Load audio for Deck A" and "Loaded: <name> — click to replace (Deck A)" | `Deck.test.jsx > @us US44 (X2 R21)` aria-label flip; `@us US1` via drop path; `App.test.jsx > @us US63` quick-load round-trip |
| Drag-drop on deck region | `Deck.jsx:1044-1071`, `:594-611` | `dragover`/`drop` handlers; isDragOver glow; calls `loadFile` | `Deck.test.jsx > @us US44`; integration `App.test.jsx > @us US64`, e2e `App.e2e.test.jsx > @us US22 + US23 + US26 + US44` |
| Inline load error (`role="alert"`) | `Deck.jsx:1340-1355` | wrong file type or decode failure surface inline; cleared on next successful load | `Deck.test.jsx > @us US33` mirror in SamplePad |

### Transport row

| Button | Toggle? | Source | Test |
|---|---|---|---|
| Play | ✓ aria-pressed reflects isPlaying | `Deck.jsx:1393` | `Deck.test.jsx > @us US26: transport buttons have aria-pressed reflecting active state` and `(X1 R21) Pause and Stop omit aria-pressed; Play and Loop carry it` |
| Pause | momentary — no aria-pressed | `Deck.jsx:1394` | `Deck.test.jsx > @us US26 (X1 R21)` |
| Stop | momentary — no aria-pressed | `Deck.jsx:1395` | `Deck.test.jsx > @us US26 (X1 R21)` |
| Loop | ✓ aria-pressed reflects isLooping | `Deck.jsx:1396` | `Deck.test.jsx > @us US26 (X1 R21)`; disabled-when-empty `(X3 R21)` |

### Pitch-bend NUDGE row (`Deck.jsx:1442-1506`)

| Button | Outcome | Test |
|---|---|---|
| NUDGE − / NUDGE + | hold-to-bend ±4%; pointerdown→`startNudge`, pointerup/leave/cancel→`endNudge`; disabled until a file is loaded | `Deck.test.jsx > @us US59` (5 tests covering hold/release, pointerleave, clamping, position re-anchor, pause-mid-bend) |

### VOL / SPD / FLT sliders (`Deck.jsx:1508-1531`)

| Slider | aria-label | Outcome | Test |
|---|---|---|---|
| VOL | `Deck A volume` | volume state ramp on `chain.gain.gain` | `Slider.test.jsx` (component); `Deck.test.jsx > @us US3`; e2e `App.e2e.test.jsx > @us US26: ArrowUp on a focused deck` |
| SPD | `Deck A speed` | live source `playbackRate` via `setTargetAtTime` | `Deck.test.jsx > @us US59 (R18 T2)` |
| FLT | `Deck A filter frequency` | LPF sweep node frequency ramp | `Deck.test.jsx > @us US7: filter change during a bass drop cancel-and-holds the LPF schedule` |

### EQ knobs (`Deck.jsx:1533-1547`)

LOW / MID / HIGH — `Knob` is `role="slider"` with ↑↓←→/Home/End keyboard
contract (`Knob.jsx:54-78`). Outcome ramps the corresponding `BiquadFilter`
gain via `setTargetAtTime`.

| Test |
|---|
| `Deck.test.jsx > @us US6: EQ knob changes schedule via setTargetAtTime (R18 T1)` |
| `Deck.test.jsx > @us US6: EQ change during a bass drop cancel-and-holds the schedule (V5 R19)` |
| `Knob.test.jsx` — keyboard contract |

### EQ KILL buttons (W3.3 — `Deck.jsx:2329-2358`)

One KILL button under each of LOW / MID / HIGH. A kill ramps that band to the
−26 dB `EQ_KILL_DB` floor via `setTargetAtTime` (never an instant assignment);
the kill state lives beside the knob state (`Deck.jsx:306-308, 381-386`), so
killing never moves the knob, un-killing restores the exact prior gain, and
turning a killed band's knob keeps it killed.

| Control | Outcome | Test |
|---|---|---|
| KILL (LOW / MID / HIGH) | aria-pressed flips; the band's `BiquadFilter.gain` ramps to −26 dB and back to the stored knob value | `Deck.test.jsx > @us US66` |

### ISOLATE row (W3.7 — `Deck.jsx:2360-2484`)

Radio-style BASS / VOCAL / INSTR / PERC buttons sitting between the deck gain
and the EQ (dry path ∥ four gated wet paths, `src/audio/chain.js`). OFF is
bit-transparent (dry gain exactly 1.0); all transitions are `setTargetAtTime`
gain ramps — nothing is ever disconnected. Buttons are disabled until a track
is loaded.

| Control | Outcome | Test |
|---|---|---|
| BASS | 24 dB/oct 180 Hz lowpass cascade wet path opens, dry closes | `chain.test.js > @us US68` (topology + bit-transparent OFF); `Deck.test.jsx > @us US68` (aria-pressed, disabled-when-empty) |
| VOCAL | mono mid downmix band-passed 200 Hz–8 kHz | same |
| INSTR | signal + inverted mid (side extraction) | same |
| PERC | side + 6 dB treble tilt | same |

### BITE row (W3.6 — `Deck.jsx:1965-2137`)

| Control | Outcome | Test |
|---|---|---|
| SET IN / SET OUT | marks the region at the playhead; overlay drawn on the waveform; region resets on track change | `Deck.test.jsx > @us US69` |
| ▶ LOOP (preview) | previews the region through the live chain from the bite-preview source path | `Deck.test.jsx > @us US69` |
| → PAD (+ pad `<select>`) | slices with equal-power edge fades (`sliceBuffer`) and hands the buffer to the chosen sample pad via `adoptBuffer` | `Deck.test.jsx > @us US69` |
| → CRATE | sends the slice to the in-memory crate | `Deck.test.jsx > @us US69`; `App.test.jsx > @us US63` for the crate side |
| WAV | `encodeWav` → `downloadBlob('<name>.wav')` — 16-bit PCM, user-initiated, nothing auto-persisted; with an isolation mode engaged the slice renders offline through `renderIsolated` so the saved bite IS the isolated component | `wavEncode.test.js > @us US69` (header/format/round-trip); `Deck.test.jsx > @us US69` |
| ✕ (clear region) | drops IN/OUT and the overlay | `Deck.test.jsx > @us US69` |

### ROLL row (W3.4 — `Deck.jsx:2138-2180`)

| Control | Outcome | Test |
|---|---|---|
| ¼ / ½ / 1 / 2 beats (hold-to-engage) | pointerdown loops the last N beats (at the track's BPM) through the chain while the wall-clock timeline runs underneath; release re-anchors playback at the advanced position; press-time quantized; pause / stop / load mid-roll always kill the roll source; disabled unless playing | `Deck.test.jsx > @us US72` |

### MODE row — VARI / KEYLOCK (W3.1 — `Deck.jsx:2243-2280`)

| Control | Outcome | Test |
|---|---|---|
| VARI (default) | classic varispeed — `playbackRate` on the BufferSource; bit-identical to pre-W3.1 behavior | `Deck.test.jsx > @us US73` |
| KEYLOCK (experimental) | playback streams through the granular stretch worklet: channels posted once per track, transport via port messages, tempo via the `rate` AudioParam (speed + NUDGE bend) with `pitchRatio` pinned at 1; position reports drive drift correction; worklet-unavailable falls back to VARI; mode hops mid-play resume at the same position | `Deck.test.jsx > @us US73`; DSP core `timeStretch.test.js > @us US71`; streaming worklet `stretchWorklet.test.js` |

### PUMP row (W3.5 — `Deck.jsx:2485-2540`)

| Control | Outcome | Test |
|---|---|---|
| PUMP toggle | arms one `setValueCurveAtTime` window per beat on the unity `pumpGain` (filter → pump → effects) ~4 beats ahead; rate re-reads the live effective BPM (detected × speed); free-running phase; OFF cancels the schedule and returns the gain to exactly 1.0 | `chain.test.js > @us US70` (pumpGain in the chain at unity); `Deck.test.jsx > @us US70` |
| DEPTH knob | sets the dip target (instant dip to 1−depth, exponential recovery to 1.0) | `Deck.test.jsx > @us US70` |

### Effects rack (`Deck.jsx:1549-1582` ↔ `EffectCard.jsx`)

| Card | Knobs | Toggle | Tests |
|---|---|---|---|
| Reverb | MIX, SIZE | `EffectCard.jsx:28-59` toggle button with aria-pressed | `EffectCard.test.jsx > @us US18`; `Deck.test.jsx > @us US18` (4 tests: P1 R16 ramp-back, V1 R19 setValue pin, W2 R20 MIX-doesn't-fire-debounce, X4 R21 ramp-back reads live ref, X5 R21 cancelAndHold ordering) |
| Delay | MIX, TIME, FB | toggle | `EffectCard.test.jsx`; delay effect tests in `effects.test.js` + the per-effect useEffect in `Deck.jsx:350-362` (FB clamped ≤ 0.9) |
| Distortion | MIX, DRIVE | toggle | `EffectCard.test.jsx`; `Deck.test.jsx > @us US18 R18 T3` DRIVE ramp-back, `@us US20 V1 R19` setValue pin, `@us US20 X5 R21` MIX-doesn't-fire-debounce |

### BASS DROP row (`Deck.jsx:1584-1623`)

| Control | Outcome | Test |
|---|---|---|
| BASS DROP button | runs the scheduled multi-leg LPF / EQ-low ramp; spawns wobble LFO on the wobble preset; aria-pressed reflects bassDropActive; disabled when no buffer or already active | `Deck.test.jsx > @us US24` (re-entry guard, double-fire no-op, aria-pressed flip, wobble single-LFO), `@us US24/US34` wobble re-entry leak |
| BassDropMenu (preset select) | `BassDropMenu.jsx` — emits `onChange(presetId)` from native select | `BassDropMenu.test.jsx > @us US34` |

### CuePanel — `src/components/CuePanel.jsx`

| Control | Outcome | Test |
|---|---|---|
| + CUE / 8 / 8 | calls `onSet`; disabled at max cues | `CuePanel.test.jsx > @us US22 / US47` |
| Cue chip "N M:SS" | calls `onJump(i)` | `CuePanel.test.jsx > @us US23` |
| Cue chip × | calls `onDelete(id)` | `CuePanel.test.jsx > @us US24` |

### WaveformCanvas — `src/components/WaveformCanvas.jsx`

| Control | Outcome | Test |
|---|---|---|
| Click-to-seek | `handlePointer` `:203-213` → normalized 0–1 to `onSeek` | `WaveformCanvas.test.jsx > @us US14` |
| ←/→ seek ±5s; Home/End jump | `handleKeyDown` `:228-261`; `stopPropagation()` keeps global crossfader shortcut from firing | `WaveformCanvas.test.jsx > @us US64`; integration `App.test.jsx > @us US64: arrow keys on a focused waveform seek the deck, not the crossfader`; e2e `App.e2e.test.jsx > @us US64: an empty deck's waveform canvas is NOT a focusable slider` + `once a deck has a buffer, its waveform canvas exposes role=slider` |
| ↑/↓ on focused canvas | intentionally NOT consumed — bubbles to App for deck-volume nudge | enforced via `App.jsx:444-453` test and the WaveformCanvas keymap explicitly listing only ←/→/Home/End |

## Crossfader — `src/components/Crossfader.jsx`

| Control | Outcome | Test |
|---|---|---|
| Slider | `onChange(value)` with normalized 0–1 | `Crossfader.test.jsx > @us US7` + `App.e2e.test.jsx > @us US26: ArrowLeft / ArrowRight nudges` |
| Curve `<select>` | `onCurveChange(id)` updates App's `crossfadeCurve` | `Crossfader.test.jsx > @us US35`; e2e `App.e2e.test.jsx > @us US35: changing the curve <select> updates the app's curve choice` |
| Mobile horizontal mode | renders horizontally; slider styling check | `Crossfader.test.jsx > @us US17`, `useMatchMedia.test.jsx > @us US17` |

## Crate — `src/components/Crate.jsx`

| Control | Outcome | Test |
|---|---|---|
| Drag-drop on region | calls `onAdd(file)` per file via `ingestFiles`; non-audio surfaces inline `role="alert"` | `Crate.test.jsx > @us US63`; `App.test.jsx > @us US63: dropping a track adds a crate entry`; e2e `App.e2e.test.jsx > @us US63 + US44: crate drag-drop → quick-load → deck shows the track name` and the non-audio-rejection test |
| "Add tracks" button | opens the hidden file input | `Crate.test.jsx > @us US63` |
| "Clear" button | calls `onClear` — wipes the in-memory crate | e2e `App.e2e.test.jsx > @us US63: crate Clear button drops every entry back to the empty state` |
| Per-entry → A / → B | calls `onLoadToDeck(deck, entryId)` → `Deck.loadBuffer` (no re-decode) | `App.test.jsx > @us US63`; `Deck.test.jsx > @us US63: loadBuffer adopts a pre-decoded AudioBuffer without re-decoding` |
| Per-entry × | calls `onRemove(id)` | `App.test.jsx > @us US63: removing the only entry returns the crate to its empty state` |

## Looper — `src/components/Looper.jsx`

| Control | Outcome | Test |
|---|---|---|
| Slot bars `<select>` (4 / 8 / 16) | `setSlot({bars})` | `Looper.test.jsx > @us US28: each slot's bar selector offers 4 / 8 / 16 bars` |
| Capture button | posts `{type:"capture", slot, seconds}` to worklet; pendingSlot state disables retrigger; seconds clamped to ≤ 60 | `Looper.test.jsx > @us US28` (4 tests: disabled-until-ready, enabled, clamp ≤ 60, exactly-60 hard-clamp) |
| Play/Stop button | toggles a buffer source per slot; ensures gain wired to master + record tap | `Looper.test.jsx > @us US61` (tap fan-out + A6 deferred-attach race) |
| Clear button (conditional) | drops the captured buffer + tears down the source | structural — covered by the play-then-stop ensure-no-throw path |
| Slot volume slider | `setVolume(slot, v)` ramps the slot gain via `setTargetAtTime` | structural (component test would just re-prove `Slider` behavior already covered by `Slider.test.jsx`) |

## SamplePad — `src/components/SamplePad.jsx`

| Control | Outcome | Test |
|---|---|---|
| Drag-drop on pad | `loadPad(i, file)` decodes via the master ctx; inline error on decode failure | `SamplePad.test.jsx > @us US33`; the inline-decode-error test |
| Pad "+ Load" / filename button | click loads (when empty) or triggers (when loaded) | `SamplePad.test.jsx > @us US31` + the trigger path |
| Pad × clear button (conditional) | drops the buffer reference, flips pad back to empty | structural — load → drop → load round-trip is exercised in the inline-decode-error test |
| Pad volume slider | `setVolume(i, v)` ramps the pad gain via `setTargetAtTime` | structural |
| `triggerByKey(key)` imperative API | App keyboard shortcut path → trigger pad at index | `SamplePad.test.jsx > @us US32`; integration in `App.test.jsx > @us US32` |
| Tap fan-out / deferred-attach | each pad's gain connects to master + record tap; A6 retry once tap exists | `SamplePad.test.jsx > @us US61` (both tap fan-out and A6 deferred-attach race) |

## VoxRecorder — `src/components/VoxRecorder.jsx` (W3.2)

Local `getUserMedia` only — nothing is transmitted and nothing is persisted.
Music-tuned constraints (echo cancellation / noise suppression / AGC all off).
Permission denial and insecure contexts (`file://`) degrade to inline notices,
never a throw.

| Control | Source | Outcome | Test |
|---|---|---|---|
| ARM | `VoxRecorder.jsx:308` | requests the mic; denial / insecure context renders an inline notice instead of throwing | `VoxRecorder.test.jsx > @us US67` |
| ● RECORD / ■ STOP | `VoxRecorder.jsx:316-320` | records the armed stream, then decodes the take to an in-memory `AudioBuffer` | `VoxRecorder.test.jsx > @us US67` |
| MONITOR | `VoxRecorder.jsx:326-330` | mic → gain → master; off by default | `VoxRecorder.test.jsx > @us US67` |
| ▶ PREVIEW / ■ STOP | `VoxRecorder.jsx:363-364` | plays the take through the master bus; aria-pressed reflects previewing | `VoxRecorder.test.jsx > @us US67` |
| → Deck A / B / C | `VoxRecorder.jsx:371` | routes the take via `Deck.loadBuffer` | `VoxRecorder.test.jsx > @us US67` |
| → CRATE | `VoxRecorder.jsx:377` | adds the take to the in-memory crate | `VoxRecorder.test.jsx > @us US67` |
| → PAD (+ pad `<select>`) | `VoxRecorder.jsx:381-387` | routes the take to the chosen sample pad via `adoptBuffer` | `VoxRecorder.test.jsx > @us US67` |
| Release mic / Discard take | `VoxRecorder.jsx:336`, `:407` | stops the tracks / drops the buffer reference | `VoxRecorder.test.jsx > @us US67` |

## TheoryPanel — `src/components/TheoryPanel.jsx`

| Control | Outcome | Test |
|---|---|---|
| Tabs (Harmonic / BPM / Tips / Shortcuts) | aria-selected flips; tabpanel switches | `TheoryPanel.test.jsx > @us US11 / US12 / US13 / US26` |
| Camelot wheel key buttons | aria-pressed flips; selecting reveals "Compatible keys: …" detail panel | `TheoryPanel.test.jsx > @us US11` |
| Genre BPM cards | static, non-interactive — render check | `TheoryPanel.test.jsx > @us US12` |
| "Next Tip" button | rotates TIPS index | `TheoryPanel.test.jsx > @us US13` |
| Shortcuts table | static `<kbd>` list — render check | `TheoryPanel.test.jsx > @us US26` |
| Live deck-key highlight | the focused-deck key + its compatible neighbours carry titles tied to that deck | `TheoryPanel.test.jsx > @us US58` (4 tests) |

## MidiPanel — `src/components/MidiPanel.jsx`

| Control | Outcome | Test |
|---|---|---|
| Panel collapse toggle | aria-expanded flips | `MidiPanel.test.jsx`; `App.test.jsx > @us US39` |
| Enable / Disable MIDI | `onEnable` resolves `enableMidi(onMidiMessage)` ; `onDisable` unsubscribes | `App.test.jsx > @us US39` MIDI mock end-to-end; `midiMap.test.js` for the lower-level API |
| Per-target Learn button | starts/cancels Learn; row highlight + "twist…" placeholder | `App.test.jsx > @us US39` (Note-On rejection + CC capture flow) |
| Per-target Mode `<select>` (Absolute / Relative 2c / Signed Mag) | `onChangeMode(targetId, mode)` | `App.test.jsx > @us US39: relative CC seeds from the live deck value` and crossfader counterpart |
| Per-target Clear (×) | `onClearMapping(targetId)`; also clears any stale learnHint | `App.test.jsx > @us US39: Clearing a mapping while a learnHint is set clears the hint (W5 R20)` |
| Live learn announcement (`role="status"`) | "Learning …" → "… mapped" | `MidiPanel.test.jsx` |
| Inline note-rejected hint | renders only on the active learn row | `App.test.jsx > @us US39: Note On in Learn does not capture a mapping` |
| Unsupported-browser fallback | message renders when `MIDI_SUPPORTED === false` | `midiMap.test.js`; UI branch checked in `MidiPanel.test.jsx` |

## ThemePicker — `src/components/ThemePicker.jsx`

| Control | Outcome | Test |
|---|---|---|
| Color swatches | `onChange(value)`; aria-pressed flips; aria-label = "Deck <id> color: <name>" | `ThemePicker.test.jsx > @us US36 / US50`; e2e `App.e2e.test.jsx > @us US36` |

## Knob — `src/components/Knob.jsx`

| Behavior | Test |
|---|---|
| Pointer drag (Y-axis) | `Knob.test.jsx > @us US6` |
| Keyboard contract (↑↑←→/Home/End) | `Knob.test.jsx`; pinned by every EffectCard test |
| Disabled state — tabIndex=-1, no-op | `Knob.test.jsx` |

## Slider — `src/components/Slider.jsx`

Native `<input type="range">` thin wrapper. Tested in `Slider.test.jsx` for
`onChange`, min/max/step, vertical orientation, and the optional label.

## Negative paths covered

| Scenario | Where | Test |
|---|---|---|
| Wrong file type to Deck | inline `role="alert"` | `Deck.test.jsx > @us US44` |
| Undecodable file to SamplePad | inline `role="alert"`; no `alert()` | `SamplePad.test.jsx > @us US33` |
| Non-audio file to Crate | inline `role="alert"`; no `alert()` | `App.e2e.test.jsx > @us US63: a non-audio file in the crate surfaces an inline error` |
| Malformed settings JSON | inline `role="alert"`; app stays alive | `App.test.jsx > @us US62: importing a malformed file shows an inline error and does not crash` |
| MIDI on unsupported browser | "Web MIDI isn't available here…" copy in panel | `MidiPanel.test.jsx`; `midiMap.test.js > MIDI_SUPPORTED` |
| Note On during Learn | rejected; learn stays armed; inline hint | `App.test.jsx > @us US39: Note On in Learn does not capture a mapping` |
| Disabled-button click | every disabled control returns `not.toBeDisabled()` flip when prerequisites are met (file loaded, recording active, …); MARKER button is the canonical example | `Deck.test.jsx > @us US26 (X3 R21)` transport disabled-until-loaded; `MasterBus.test.jsx > @us US60` MARKER disabled-when-idle |

## Items that were structural-only — now backed by automated checks (R24)

R24 added an artifact-inspection / source-grep layer so the items below are
no longer "structural evidence only". They are pinned by Vitest assertions
that fail fast if a maintainer regresses the contract.

| Item | Test (added R24) |
|---|---|
| CSS `:focus-visible` ring on every interactive control | `test/focus-rings.test.js` — asserts the `*:focus-visible` rule exists with `outline: 2px solid #ccd6f6; outline-offset: 2px` |
| Beat-pulse animation present and consumed | `test/animations.test.js` — asserts `@keyframes beatPulse` is declared with opacity + transform stops AND at least one component sets `animation: beatPulse …` |
| PWA manifest + service-worker installability | `test/build.test.js` — asserts `dist/manifest.webmanifest` parses with required fields, 192/512 PNGs exist on disk, `sw.js` + `registerSW.js` exist, index.html still ships CSP/Permissions-Policy. Skips gracefully if `dist/` not built; `npm run verify:build` runs the build + tests in one shot |
| Single-file build self-containment | `test/build-single.test.js` — asserts `dist-single/index.html` has NO external `<script src>` / `<link rel=stylesheet>`, fonts inlined as `data:font/woff2;base64`, apple-touch-icon inlined as data: PNG, CSP still pins `connect-src 'none'`, no SW/manifest leak. Skips gracefully; `npm run verify:single` runs build + tests |
| Master compressor configured as a brickwall limiter | `test/limiter.test.jsx` — asserts threshold −9, ratio 20, knee 0, attack 0.003, release 0.1; walks comp → trim → masterGain → destination and asserts exactly ONE compressor on the master bus; loads files into both decks and asserts both deck analysers tap the compressor |
| CSP enforcement | `test/csp.test.js` — parses CSP from `index.html` AND `vite.config.js#CSP_CONTENT` (the canonical re-injection source). Asserts `connect-src 'none'`, `frame-src 'none'`, `object-src 'none'`, `base-uri 'self'`, no `'unsafe-eval'`, `worker-src` permits `blob:` (looper worklet) |
| MIDI adversarial coverage | `test/midiMap.test.js` (Phase B5 block) — 1-byte / 2-byte drops, pitch bend / channel pressure / sysex dropped, all 16 channels round-trip, all 128 CC values round-trip, mid-stream disconnect, stuck-on key |

## Verification commands

| Command | Result (R24 final) |
|---|---|
| `npm test` | **40 files, 511 tests, all passing** |
| `npm run build` | succeeds; multi-file PWA + 13-entry precache manifest |
| `npm run build:single` | succeeds; one-file `dist-single/index.html` |
| `npm run verify:build` | build + Vitest on `test/build.test.js` + `test/csp.test.js` |
| `npm run verify:single` | build:single + Vitest on `test/build-single.test.js` |
| `npm run verify:all` | verify:build + verify:single + full `npm test` |
| `npm run size` | PASS — 85.9 KB / 90 KB gzip JS, 375.4 KB / 400 KB precache |

## Deferred — theoretical traces only (R24)

The three items below cannot be exercised from a headless Vitest environment
no matter how cleverly we extend the mock. For each one we own a rigorous
theoretical trace: (1) the behavior we claim holds, (2) the code path that
implements it (file:line), (3) the explicit chain of reasoning from the code
to the behavior, (4) what would falsify the trace. A reviewer can use these
to check the claim by reading the source or by running the listed manual
acceptance step.

### T1 — Real Web MIDI hardware enumeration end-to-end

**Behavior claimed.** When the user plugs a real DJ controller (e.g. a
Pioneer DDJ-FLX4) into a Chromium-based browser, clicks "Enable MIDI", and
twists a knob:
1. The controller appears as a MIDI input.
2. Each twist surfaces in the live MidiPanel "Last message" line.
3. Mapping the knob to a target via Learn binds it to that target on every
   future twist.
4. Unplugging the controller mid-session does NOT crash the app; replugging
   it later re-binds the same knob without duplicating handlers.

**Code path that implements it.**
- `src/midi/midiMap.js:53-57` calls `navigator.requestMIDIAccess({sysex:false})`.
- `src/midi/midiMap.js:61-112` `subscribeToInput` binds `addEventListener("midimessage")` per input and parses the spec'd status bytes.
- `src/midi/midiMap.js:124-129` listens for `statechange` and re-subscribes / unsubscribes the input as it connects/disconnects.
- `src/App.jsx:766-847` `onMidiMessage` consumes the parsed messages, dispatches in Learn mode (captures the mapping) or runtime mode (applies the CC).
- `src/App.jsx:849-863` `onEnableMidi` wires the unsub returned by `enableMidi` into the cleanup chain.

**Reasoning from code to behavior.**
- (1) follows because the spec'd Web MIDI surface, in the Chromium implementation, populates `access.inputs` with each enumerated device. The for-loop at `midiMap.js:122` subscribes every entry; `subscribeToInput`'s addEventListener call is the only step needed to receive `midimessage` events.
- (2) follows because the App test `App.test.jsx > @us US39: relative CC seeds from the live deck value` already exercises the dispatch path with a fake `MIDIInput`; on real hardware the spec guarantees the same event shape (status, data1, data2). `MidiPanel` reads `inputName` from props which we update on every message at `App.jsx:768`.
- (3) follows because the Learn-capture branch at `App.jsx:786-810` writes `midiMappings[targetId]` on the first CC; the runtime branch at `App.jsx:812-844` matches that exact mapping on every subsequent message.
- (4) follows because `unplug→replug does not double-bind` is asserted in `midiMap.test.js > @us US39: unplug→replug does not double-bind the message handler` using the same statechange machinery the browser would deliver.

**Falsifier.** Plug a controller and click Enable. If: (a) the panel shows "No MIDI inputs" despite the controller being recognised by `chrome://device-log`, OR (b) twisting a knob does not surface in MidiPanel, OR (c) a Learn-capture row maps successfully but the bound parameter never moves on subsequent twists, OR (d) after an unplug→replug cycle the knob fires the bound parameter twice per twist — any of those falsifies the trace.

### T2 — Real PWA install + offline cycle from a fresh browser

**Behavior claimed.** Open the deployed `dist/` build over HTTPS in a fresh Chromium profile, install the PWA via the install prompt, then go offline. The PWA continues to launch, the React tree renders, and you can still load audio files from disk and play them.

**Code path that implements it.**
- `vite.config.js:108-159` wires `VitePWA({ registerType: "autoUpdate", workbox: { globPatterns: ["**/*.{js,css,html,woff2,svg,png,ico}"], navigateFallback: "index.html", runtimeCaching: [] }})`.
- `dist/sw.js` (generated) carries the precache manifest; `test/build.test.js` asserts it parses and references `index.html`.
- `dist/manifest.webmanifest` (generated) carries `name`, `short_name`, `display: standalone`, `start_url: "."`, 192 + 512 PNG icons — every install-prompt prerequisite. `test/build.test.js > manifest references at least one 192x192 PNG AND one 512x512 PNG` enforces that.
- `index.html` carries CSP `connect-src 'none'`; `test/csp.test.js` enforces that — offline cycles cannot trigger a fetch fallback that would silently fail.

**Reasoning from code to behavior.**
- Chromium's install-prompt heuristic requires (a) a valid manifest with name + icons + start_url + display, (b) a service worker registered with a fetch handler. Both prerequisites are present per the tests above.
- Workbox's precache strategy populates the cache on first SW activation; the `navigateFallback: "index.html"` line guarantees an offline navigation resolves to the cached app shell.
- React renders without network access because Vite produces fully self-contained bundles (the `assets/` JS + CSS are precached). Fonts and the worklet are also precached (`globPatterns` includes woff2).
- File-load works offline because deck file pickers operate on the `File` API, no network.

**Falsifier.** Install the PWA; switch the device to airplane mode; reopen the PWA from the home screen. If: (a) the app shell does not load at all, OR (b) it loads but the React tree throws, OR (c) loading an audio file from disk produces a network error / fetch attempt visible in DevTools network tab — any of those falsifies the trace.

### T3 — True audible signal limiting through speakers

**Behavior claimed.** When summed deck output approaches or exceeds 0 dBFS, the master compressor (configured as a brickwall limiter, `test/limiter.test.jsx`) clamps the signal to its threshold so the destination never clips audibly.

**Code path that implements it.**
- `src/App.jsx:182-196` configures threshold −9, knee 0, ratio 20, attack 0.003, release 0.1 — limiter-class parameters.
- `src/App.jsx:202-208` wires comp → trim (0.65) → masterGain → destination.
- `src/audio/chain.js#buildDeckChain` per-deck topology terminates at an AnalyserNode that is connected to the master compressor (asserted in `chain.test.js`).
- `test/limiter.test.jsx > a hot signal scheduled into the chain is delivered to the configured limiter via the deck analyser tap` confirms the path.

**Reasoning from code to behavior.**
- The Web Audio spec defines `DynamicsCompressorNode` with these exact AudioParams. With threshold −9 dB, knee 0, ratio 20, attack 3 ms, release 100 ms, the spec's compressor curve produces a brickwall response: any input sample above the threshold is divided by the ratio after the knee, so a +6 dB transient ends up at roughly threshold + (6/20) ≈ −8.7 dB at the output. The 0.65 trim further reduces the post-limiter output by ~3.7 dB, so the destination sees a peak well below 0 dBFS.
- Because the comp is the *only* compressor in the chain (asserted in `test/limiter.test.jsx > limiter sits between the deck mix and the destination`), there is no downstream stage that could undo the limiting.

**Falsifier.** Load two loud-mastered tracks on Decks A and B at full volume + full crossfade balance, play both, watch the clip meter and listen. If: (a) the clip meter latches on, OR (b) audible clipping (square-wave crunch on transients) is present at the speakers, OR (c) the destination is verifiably at full scale via a tap into a `MediaStreamDestination` + manual VU read — any of those falsifies the trace and indicates the compressor params or the trim factor have drifted from spec.

### Out of scope for any automated layer (remains a manual pass)

- **Real audio listening tests** — `webAudioMock.js` does not execute the compressor curve; final audible verification still needs a manual pass in Chromium / Firefox / Safari.
- The traces above stand in for what Vitest cannot run; the manual acceptance steps are the listed Falsifier rows.

---

## Standing interaction coverage (WC-COVER)

The matrix above is a point-in-time audit. It is now backed by two test files
that keep it true automatically, so coverage can't silently rot between passes.

### `test/interaction-census.test.jsx`

Renders the app in its widest state — all three decks loaded, a bite region
marked on each, a cue set, every tab visited, VOX's secure-context gate
satisfied — then enumerates every `button` / `input` / `select` /
`[role="slider"]` / `[role="tab"]` in the live DOM and enforces:

| Guarantee | Why it matters |
|---|---|
| Every control has an accessible name | An unnamed control can't be reached by a screen reader **or** by `getByRole({ name })` — it is untestable by construction. |
| No two controls share a name | Three decks × the same knob caption meant `LOW` named three different controls. Any test querying it silently asserted against Deck A only. |
| The inventory matches a checked-in manifest | Catches drift in both directions: a new untested control, and a whole panel that stopped rendering. |
| Every button clicked **twice** | The second click is where one-way toggles (`start → started`) throw. |
| Every slider driven to min / max / midpoint | Extremes are where clamping and divide-by-zero live. |
| Every select set to every one of its own options | Options that no handler branch covers. |
| Momentary controls pressed without release, plus orphan releases | ROLL / NUDGE stuck permanently engaged is the failure mode; the test asserts every deck's speed returns to rest. |
| Every deck control operated on an **empty** deck | The null-buffer dereference path. |

### `test/process-e2e.test.jsx`

Traces each pipeline from first click to terminal artifact, intercepting the
`<a download>` click that is the app's only egress point:

| Process | End state asserted |
|---|---|
| load → play → record → stop | An audio Blob downloaded with a real extension |
| record + markers → stop | A `.cue.txt` whose header, marker count and base filename all agree with the audio file |
| marker pressed while **not** recording | No download at all (negative) |
| bite → WAV | A downloaded file whose bytes actually begin `RIFF`…`WAVE` |
| bite → PAD | Pad 1 stops advertising itself as an empty slot |
| bite → CRATE | A crate row offering `Load "…" to deck A` |
| bite → CLEAR | Send controls removed, nothing exported (negative) |
| settings export → import | Exported JSON re-applied over changed state restores curve + deck accent |
| malformed settings import | Rejected inline, state unchanged, app still mounted (negative) |
| crate → deck C | Deck C's load button reports a loaded track |
| looper capture → play | Loop 1's play control and volume slider armed |
| full three-deck session | assign + play ×3 + EQ kill + isolate + pump + fader ride + record → file, with every applied state still set afterwards |

### Findings from the pass that added these

Building the census surfaced defects the per-control tests could not:

1. **43 controls shared 15 accessible names** — every EQ knob (`LOW`/`MID`/
   `HIGH`), every effect toggle (`Reverb effect off` ×3), every effect knob
   (`MIX` ×9, `SIZE`/`TIME`/`FB`/`DRIVE` ×3), `BASS DROP`, `Bass drop preset`,
   `DEPTH`, and `Add cue at current position`. Fixed by adding a `scope` /
   `deckId` / `ariaLabel` prop through `Knob`, `EffectCard`, `BassDropMenu`
   and `CuePanel`. Thirteen existing `Deck.test.jsx` assertions had been
   resolving by first-match and were updated to address their deck explicitly.
2. **`Send the bite to sample pad N` was unscoped** across all three decks —
   invisible to the first census run because the BITE send row only renders
   once a region is marked, which is why the census now drives the app into
   its conditional states before counting.
