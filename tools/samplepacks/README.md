# WAVECRAFT sample packs — generators

Two scripts that **synthesize** WAVECRAFT's royalty-free sample packs from
scratch: oscillators, noise, filters and envelopes. Nothing here samples a
recording, so everything they emit is free of licensing strings.

| Script | Output |
|---|---|
| `foundation_kit.py` | 22 files — 10 bar-exact loops (house / techno / acid / trance / DnB / dubstep / hardstyle, plus build + riser + sub drone) and 12 one-shots (909 kit, 808 and hardstyle kicks, hoover, organ stab, FX). All in A minor (Camelot 8A). |
| `club_collection.py` | 12 structured mini-tracks, one per genre, spread across 12 Camelot keys. Band-limited oscillators, DJ-friendly intro/build/drop/breakdown/outro, every track mastered to the same −13 dB RMS. |

## Why they live here

The packs are large binaries; the generators are ~50 KB of text. Keeping the
*source* in the repo means the audio can always be regenerated bit-for-bit,
and CI can render and publish it without any binary ever entering git history.

## Run locally

```bash
pip install numpy scipy soundfile
python tools/samplepacks/foundation_kit.py    # → tools/samplepacks/pack/
python tools/samplepacks/club_collection.py   # → tools/samplepacks/vol2/
```

## Publish

The `Sample packs` workflow (`.github/workflows/samplepacks.yml`) renders both
packs and attaches them to a GitHub Release as zips, so they are downloadable
from the Releases page forever. Trigger it from the Actions tab.

## Design notes worth keeping

- **Loops are bar-exact.** Lengths are computed as `bars × 4 × 60/bpm × SR`, so
  a deck loops them without drift and SYNC locks to the filename's BPM.
- **Labels are verified, not asserted.** Every key in the collection was
  confirmed by blind Krumhansl-Schmuckler detection — the same method the app's
  own AUTO button uses. Three tracks were retuned (root-anchored basslines,
  thirds added to stabs, a root+minor-third drone) until they asserted.
- **BPM auto-detection has known blind spots** on the trance, dubstep and DnB
  tracks: triplet and halftime patterns fool autocorrelation into reporting
  ⅔ or ~1.2× the true tempo. The timing is exact by construction, so trust the
  filename over AUTO on those three.
- **`club_collection.py` uses polyBLEP oscillators**; `foundation_kit.py` uses
  naive ones and always lowpasses afterwards. Both are alias-free in practice,
  but only the former is safe for unfiltered bright leads.
