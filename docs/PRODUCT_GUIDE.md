# WAVECRAFT — Product Guide

What the product is, who it's for, and what it does. For positioning detail and
the prioritized backlog, see `ROADMAP.md`.

## 1. What it is

WAVECRAFT is a free, local-only DJ mixing application that runs entirely in a
web browser. Two decks, a crossfader, a full effects chain, looping, sampling,
recording, and MIDI — with zero network calls, no accounts, and no subscription.

## 2. Who it's for

The bedroom DJ / hobbyist / streamer-DJ who mixes locally-stored audio files,
refuses subscriptions, and is privacy-skeptical about uploading their library.
Uses the browser to avoid installer friction. Sometimes records mixes for
SoundCloud/YouTube; sometimes streams.

## 3. Positioning

The pure-browser, local-only, no-account slot is genuinely thin. Mixxx is a
native install; VirtualDJ watermarks free recordings; djay Pro and DJ.Studio
are subscriptions; you.dj is streaming-dependent. WAVECRAFT's wedge: **clean,
free, private, install-free.**

## 4. Feature inventory

### Decks (×2)
- Load any local audio file (MP3, WAV, OGG, FLAC, M4A, AAC) by click or drag-drop.
- Transport: play, pause, stop, loop.
- Volume, speed (0.5×–2.0×), low-pass filter (60 Hz–20 kHz).
- 3-band EQ (low/mid/high, ±12 dB).
- Live waveform + frequency visualization; click the waveform to seek.
- BPM: tap tempo, autocorrelation auto-detect, ÷2 / ×2 nudge.
- Auto key detection (Krumhansl-Schmuckler), shown as a Camelot code.
- Cue points: up to 8 per deck, color-coded, click or keys `1`–`8` to jump.
- Beat sync: match one deck's tempo to the other.
- Bass drop: Standard / Heavy / Wobble presets.
- Per-deck effects rack: reverb, delay, distortion (each dry/wet + params).

### Mixing
- Crossfader with three curves: equal-power (default), linear, constant-3 dB.
- Shared master compressor as a safety-net limiter.
- Master volume.

### Creative tools
- Looper: 4 slots, capture 4/8/16 bars from the master bus, play looped.
- Sample pad: 8 pads, drag-drop or click to load, trigger with `Q W E R / A S D F`.
- Per-deck color themes.

### Output & control
- Record the master mix → download locally (webm/m4a/ogg). Never uploaded.
- PWA: installable, works offline after first load.
- MIDI: Learn mode maps controller CCs to 8 targets (crossfade, master, per-deck
  volume/filter/speed).
- Single-file HTML build for maximum portability.

### Reference
- Camelot Wheel (harmonic mixing), genre BPM guide, DJ tips, keyboard shortcut list.

## 5. Hard product constraints

These are non-negotiable and define the product. A feature that breaks one of
them is not a WAVECRAFT feature:

1. **Free forever.** No paywalls, no "premium" tier, no subscription gates.
2. **Local only.** Zero network calls at runtime. No audio ever leaves the device.
3. **No accounts, no telemetry, no analytics.**
4. **Install-free.** Runs in a browser tab; PWA install is optional.

## 6. Status

P0–P3 of the original roadmap and Wave 1 of the product backlog are shipped.
360+ automated tests across 29 files. See `CLAUDE.md` for the live status
checklist, `BACKLOG.md` for shipped/queued items, and `ROADMAP.md` for what's
next (top items: split-cue bus, opt-in metadata persistence, manual beatgrid,
stems).

## 7. Success criteria for any new feature

Every feature must pass five gates (the Product Lead test):
1. Does it help someone make music they're proud of?
2. Does it stay 100% local with zero network dependency?
3. Does it feel like a DJ table — intuitive, physical, responsive?
4. Can a first-timer use it within 60 seconds?
5. Would a seasoned EDM producer still respect it?
