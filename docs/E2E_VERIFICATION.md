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

## Structural-evidence items (no Vitest assertion required)

| Item | Why structural | Evidence |
|---|---|---|
| CSS `:focus-visible` ring on every interactive control | Visual / SR-only; cannot be exercised under happy-dom | `src/index.css` global rule; manual QA per `DESIGN_GUIDE` §6 |
| Beat-pulse animation duration on the deck dot | Driven by inline `style.animation = 'beatPulse Ns infinite ease-in-out'`; the animation engine itself is the browser's | `Deck.jsx:1104-1106` + manual visual check |
| PWA installability + offline behavior | requires a real service worker registration in a real browser | `dist/sw.js` precache manifest contents printed during `npm run size`; manual install + offline-load |
| Master compressor sounds right in real audio | requires real audio output | architecture review of `App.jsx:191-227` + `chain.test.js` topology test |
| Single-file build runs from `file://` | requires opening the artifact in a real browser | manual: `npm run build:single` + open `dist-single/index.html` |
| Self-hosted fonts load from `data:` URIs in the single-file build | Vite asset pipeline | structural: `src/fonts/index.js` uses `?url`; covered by the asset existence audit + single-file manual verification |

## Verification commands

| Command | Result (R23 final) |
|---|---|
| `npm test` | **30 files, 383 tests, all passing** |
| `npm run build` | succeeds; multi-file PWA + 13-entry precache manifest |
| `npm run size` | PASS — 75.5 KB / 90 KB gzip JS, 342.3 KB / 400 KB precache |

## Deferred (intentional)

- **Real audio listening tests** are out of scope for the headless test runner;
  every audio-graph assertion goes through the deterministic `webAudioMock.js`
  AudioContext stand-in. The MediaRecorder is also mocked. Final audible
  verification still needs a manual pass in Chromium / Firefox / Safari.
- **Browser MIDI hardware tests** require a real Web MIDI implementation +
  a connected controller — the in-test mock covers the message handling and
  panel UI, but the bind-on-statechange path is exercised structurally.
- **PWA install / offline cache** is covered by structural evidence
  (sw.js precache manifest content) and a manual install pass.
