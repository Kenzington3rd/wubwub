# WAVECRAFT — User Guide

How to use the app. WAVECRAFT runs in your browser; nothing you load or record
ever leaves your device.

## Getting started

1. Open the app (`npm run dev`, then the printed URL — usually
   http://localhost:5173 — or your hosted build).
2. On **Deck A**, click "Drop audio here or click to load" and pick a track, or
   drag an audio file straight onto the deck. Supported: MP3, WAV, OGG, FLAC,
   M4A, AAC.
3. Press **Play**. Do the same on **Deck B** with a second track.
4. Drag the **crossfader** between the decks to blend them.

## The deck

| Control | What it does |
|---|---|
| Play / Pause / Stop | Transport. Stop resets to the start. |
| Loop | When lit, the track repeats. The waveform border goes dashed. |
| Waveform | Live view. **Click anywhere on it to jump** to that point. Or focus it with `Tab` and seek with the keyboard (see Keyboard shortcuts). |
| VOL / SPD / FLT | Volume, playback speed (0.5×–2.0×), low-pass filter sweep. |
| LOW / MID / HIGH | 3-band EQ knobs — drag up/down. ±12 dB. |
| KILL (under each EQ knob) | One-tap band kill — silences that band without moving the knob; tap again to restore the exact knob value. The bass-swap button. |
| TAP | Tap in time with the music 4+ times to set BPM by ear. |
| AUTO | Auto-detects BPM **and** musical key from the loaded track. |
| ÷2 / ×2 | Halve or double the BPM — fixes half-time / double-time detection. |
| SYNC | One-tap tempo match — sets this deck's speed to land on the other deck's BPM. |
| NUDGE − / NUDGE + | **Hold** to momentarily bend the pitch ±4% — slide a track into phase by ear. Releasing returns to your set speed; the speed slider is untouched. |
| Camelot badge | After AUTO, shows the detected key as a Camelot code (e.g. 8B). |
| mix → … | Next to the badge: the three harmonically compatible keys to mix into (relative key, +1, −1). |

## Cue points

- Click **+ CUE** to drop a cue at the current position (up to 8). Cues appear as
  numbered, colored markers on the waveform.
- Click a cue chip — or press number keys `1`–`8` — to jump to it.
- Click the **×** on a chip to delete it.
- Cues are session-only: they reset when you load a new file or reload the page.

## Effects rack

Each deck has Reverb, Delay, and Distortion. Click an effect's title to toggle it
on. Knobs:
- **Reverb** — MIX, SIZE (room length).
- **Delay** — MIX, TIME, FB (feedback; capped at 90% so it can't run away).
- **Distortion** — MIX, DRIVE.

## Bass drop

Pick a preset (Standard / Heavy / Wobble) from the dropdown, then hit **BASS
DROP**. It runs an automated filter sweep + EQ kick. Wobble adds an LFO wobble
on the filter after the drop.

## Three decks

WAVECRAFT has three full decks — A (cyan), B (purple), and C (green by
default). All three have the identical feature set: transport, EQ, effects,
cues, bass drop, NUDGE, BPM/key detection. On wide screens they sit in one
row (C wraps below at mid widths; on mobile everything stacks).

With three decks, **SYNC** targets the *dominant playing* deck — the other
deck that's currently audible loudest through the crossfader. If nothing else
is playing, it falls back to any deck with a track loaded.

## Crossfader & assign

The crossfader is still a two-ended control. Each deck header carries a small
3-position **assign** switch — `A · — · B` — that decides how that deck
relates to it:

- **A** — the deck follows the crossfader's A side (fades out as you push right).
- **B** — the deck follows the B side (fades in as you push right).
- **—** (THRU) — the deck ignores the crossfader completely and plays at its
  volume fader. Perfect for an acapella or texture riding on Deck C while you
  blend beats between A and B.

Defaults are A→A, B→B, C→THRU, which behaves exactly like the classic
two-deck setup until you touch the switches. Assigns are saved by Settings
Export.

The dropdown under the fader picks the curve:
- **Equal Power** (default) — constant loudness through the blend.
- **Linear** — even amplitude; good for stems of the same track.
- **Constant 3 dB** — brighter, present.

## Looper

Four slots. Pick a bar count (4 / 8 / 16); **Capture** grabs a fixed-length
window of whatever is playing on the master bus, sized from bars × BPM at the
moment you press it. Because it's a BPM snapshot, the captured loop won't be
exactly N bars if the tempo drifts afterward. Click **Capture**, then **Play**
to loop it. The volume slider sets the loop's level.

## Sample pad

Eight pads. Drag an audio file onto a pad (or click **+ Load**). Trigger pads by
clicking, or with the keys `Q W E R` (top row) and `A S D F` (bottom row).

## Session crate

The **CRATE** panel is a quick-access shelf for the tracks you're working with.
Drop one or more audio files onto the panel — or click **Add tracks** — and each
one is decoded and added to the list. Then, on any crate row:

- **→ A** loads that track onto Deck A.
- **→ B** loads it onto Deck B.

Because the crate already decoded the file, loading it to a deck is instant — no
waiting. Remove a single track with its **×**, or empty the whole shelf with
**Clear**. Removing a track that a deck is currently playing is fine — the deck
keeps playing; only the crate's copy is dropped.

The crate is **session-only**: it lives in memory and is empty every time you
reload. Nothing in it is ever saved to disk. (Each row has BPM and key columns;
they fill in only if that data is already known.)

## Recording your mix

Click **RECORD** in the master bar. Mix as long as you like, then click it again —
the recording downloads to your computer as an audio file. It is never uploaded.

### Clean / Radio tap

Next to the record controls is a two-position toggle that picks *where* the
recorder taps the audio:

- **Radio** (default) — records the signal **after** the master limiter, the
  same loud, punchy sound you hear. Good for a ready-to-share mix.
- **Clean** — records the summed deck signal **before** the limiter, with more
  dynamic range and headroom. Good if you want to master the mix yourself later.

The toggle is locked while a recording is running — you can't switch the tap
mid-record. Choose it before you hit RECORD.

### Cue markers and the cue sheet

While recording, the **MARKER** button (and the `M` key) drops a timestamped
marker — use it to flag a drop, a transition, or a track change. A small count
next to the button shows how many you've dropped. Markers live in memory only
and reset when you start a new recording.

When you stop, if you dropped any markers, a plain-text **cue sheet** downloads
alongside the audio file — same base name, `.cue.txt` extension (e.g.
`wavecraft-mix-….webm` + `wavecraft-mix-….cue.txt`). It lists each marker as a
`MM:SS — Marker N` line so you can find your moments again.

### Clip meter

The **CLIP** dot in the master bar lights red whenever the master signal is
clipping (peaking too hot). It's live whenever audio is playing, not only while
recording. If it lights up, pull down a deck or the master volume.

## Keyboard shortcuts

Click a deck first to "focus" it (it gets a brighter glow).

| Key | Action |
|---|---|
| `Space` | Play / pause the focused deck |
| `←` / `→` | Crossfade by 5% |
| `Shift` + `←` / `→` | Snap the crossfader fully to A / B |
| `↑` / `↓` | Focused deck volume ±5% |
| `S` | Sync the focused deck to the other |
| `C` | Set a cue on the focused deck |
| `1`–`8` | Jump to cue N on the focused deck |
| `M` | Drop a recording cue marker (only while recording) |
| `,` / `.` | **Hold** to nudge the focused deck's pitch ±4% (momentary; release returns to set speed) |
| `Q W E R` / `A S D F` | Trigger sample pads 1–8 |

`S` does double duty: with a deck focused it syncs that deck; with no deck
focused it triggers sample pad 6. Click empty space to un-focus if you want the
pad. The other pad keys always trigger their pad.

### Seeking the waveform by keyboard

Press `Tab` until a deck's waveform is focused (it gets a focus outline). With
the waveform focused:

| Key | Action |
|---|---|
| `←` / `→` | Seek that track 5 seconds back / forward |
| `Home` | Jump to the start of the track |
| `End` | Jump to the end of the track |
| `↑` / `↓` | **Pass through** — the canvas does NOT consume these. They still nudge the focused deck's volume per the global shortcut. |

While the waveform is focused, the `←` / `→` keys seek *it* — the crossfader
arrow shortcut above is paused so the same press can't do two things. `Tab`
away from the waveform to use the crossfader arrows again. `↑` / `↓` are
intentionally let through so volume can still be tweaked without leaving the
waveform. (An empty deck with no track loaded isn't focusable — there's
nothing to seek.)

## MIDI controllers

Open the **MIDI** panel at the bottom (Chrome / Edge / Opera). Click **Enable
MIDI**, then **Learn** next to a target and twist a knob/fader on your hardware
to map it. Supported: crossfader, master volume, and per-deck volume / filter /
speed. Mappings reset on reload — but you can keep them with **Export Settings**
(see below).

## Saving your settings

In the master bar, **Export** and **Import** let you save and restore your
*setup* — deck accent colors, the crossfade curve, your MIDI mappings, and the
recorder Clean/Radio tap mode.

- **Export** downloads a small `wavecraft-settings-<timestamp>.json` file to your
  computer.
- **Import** opens that file back up and applies it.

This is config only — it never includes your audio, track names, or cue points,
and nothing is uploaded; the file is written to and read from your own disk by
your choice. If you pick a file that isn't a valid WAVECRAFT settings file, a
short error appears and nothing changes.

Handy side effect: since MIDI mappings reset every reload, exporting your
settings once means you can re-import them after a reload (or on another
machine) instead of re-learning every control.

## Harmonic mixing

The **Harmonic Mixing** tab shows the Camelot Wheel. Click a key to highlight the
keys that mix well with it.

The wheel is also **live**: once you run AUTO on a deck, the focused deck's
detected key — and its compatible neighbours — light up on the wheel in that
deck's accent color, with a caption naming the deck and key. Click a deck to
switch which deck's key the wheel tracks. On the deck itself, the detected-key
badge is followed by a `mix → 8A · 9B · 7B` hint listing the safe targets, so
you can pick your next track without leaving the decks.

## Install it (PWA)

In a Chromium browser, use the install icon in the address bar. Once installed,
WAVECRAFT works fully offline.

## Privacy

Everything stays on your device. No account, no tracking, no uploads. The only
files that ever leave are the mix recordings *you* choose to download.

## Troubleshooting

- **No sound?** Browsers block audio until you interact — click Play or any
  control once to unlock it.
- **BPM looks wrong?** Use ÷2 / ×2 — auto-detect often picks half/double tempo on
  syncopated genres.
- **Looper says "Initializing audio worklet…"** — interact with the app once
  (load a track, click anything) to start the audio engine.
- **MIDI panel says "not supported"** — use Chrome, Edge, or Opera; Firefox/Safari
  don't ship Web MIDI.
- **State lost on reload?** Cues, loops, and MIDI maps are intentionally
  session-only — nothing is persisted, by design.
