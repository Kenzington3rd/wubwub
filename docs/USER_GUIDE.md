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
| Waveform | Live view. **Click anywhere on it to jump** to that point. |
| VOL / SPD / FLT | Volume, playback speed (0.5×–2.0×), low-pass filter sweep. |
| LOW / MID / HIGH | 3-band EQ knobs — drag up/down. ±12 dB. |
| TAP | Tap in time with the music 4+ times to set BPM by ear. |
| AUTO | Auto-detects BPM **and** musical key from the loaded track. |
| ÷2 / ×2 | Halve or double the BPM — fixes half-time / double-time detection. |
| SYNC | Matches this deck's speed to the other deck's BPM. |
| Camelot badge | After AUTO, shows the detected key as a Camelot code (e.g. 8B). |

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

## Crossfader

The center column. Drag to blend Deck A ↔ Deck B. The dropdown picks the curve:
- **Equal Power** (default) — constant loudness through the blend.
- **Linear** — even amplitude; good for stems of the same track.
- **Constant 3 dB** — brighter, present.

## Looper

Four slots. Each captures the **last N bars (4 / 8 / 16)** of whatever is playing
on the master bus. Click **Capture**, then **Play** to loop it. The volume slider
sets the loop's level.

## Sample pad

Eight pads. Drag an audio file onto a pad (or click **+ Load**). Trigger pads by
clicking, or with the keys `Q W E R` (top row) and `A S D F` (bottom row).

## Recording your mix

Click **RECORD** in the master bar. Mix as long as you like, then click it again —
the recording downloads to your computer as an audio file. It is never uploaded.

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
| `Q W E R` / `A S D F` | Trigger sample pads 1–8 |

## MIDI controllers

Open the **MIDI** panel at the bottom (Chrome / Edge / Opera). Click **Enable
MIDI**, then **Learn** next to a target and twist a knob/fader on your hardware
to map it. Supported: crossfader, master volume, and per-deck volume / filter /
speed. Mappings reset on reload.

## Harmonic mixing

The **Harmonic Mixing** tab shows the Camelot Wheel. Click a key to highlight the
keys that mix well with it. Combine with the AUTO key badge on each deck to mix
in key.

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
