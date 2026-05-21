# WAVECRAFT — Branding Guide

The single source of truth for brand identity. Anything user-facing — copy, color,
type, iconography — must conform to this document.

## 1. Brand essence

- **Name:** WAVECRAFT (always all-caps in display contexts; "Wavecraft" is
  acceptable in running prose).
- **Tagline:** *Make music, not payments.*
- **One-liner:** A free, local-only DJ mixing app that runs entirely in your browser.
- **Promise:** Free forever. Nothing leaves your device. No accounts, no telemetry,
  no subscriptions.

## 2. Voice & tone

| Trait | Do | Don't |
|---|---|---|
| Chill, not clinical | "Match BPMs before crossfading for seamless transitions" | "Configure tempo synchronization parameters" |
| Encouraging | "This will sound fire" | "Suboptimal harmonic selection detected" |
| Plain-spoken | "Drop the bass after 8 or 16 bars" | "Trigger the low-frequency emphasis subroutine" |
| Honest about limits | "Auto-BPM stumbles on syncopated genres — use ÷2 / ×2 to fix" | Overpromising accuracy |

Microcopy is lowercase-friendly and short. Button labels are UPPERCASE for
controls (PLAY, BASS DROP, RECORD) and Title Case for navigation/tabs.

## 3. Color

The palette is fixed. Do not introduce new hues without updating this guide.

The `Name` column is a **palette name for reference only** — these are *not* CSS
custom properties. The codebase has no `:root` variable block; every value below
appears as a literal hex (or `rgba()`) string inside inline-style template
literals. This is deliberate: deck accent colors are dynamically user-selected,
so colors flow as props/state rather than static CSS variables.

| Name | Hex | Use |
|---|---|---|
| bg-deep | `#070a14` | Darkest background, theme color |
| Background gradient | `160deg, #070a14 → #0d1225 → #0f0a20 → #080c18` | App shell |
| bg-card | `rgba(15,18,35,0.7)` | Cards / panels (with `backdrop-filter: blur(10px)`) |
| text-primary | `#ccd6f6` | Main text |
| text-muted | `#8892b0` | Labels, secondary text |
| text-dim | `#4a5580` | Hints, inactive, decorative dividers — **never live copy** |
| accent-a | `#00f5d4` (cyan) | Deck A default; primary brand accent |
| accent-b | `#a78bfa` (purple) | Deck B default |
| accent-master | `#f0c040` (gold) | Master controls |
| danger | `#f87171` | Recording state, destructive affordances |

Deck accent colors are **user-selectable** (see `COLOR_THEMES` in `src/data.js`):
cyan, purple, gold, pink (`#f472b6`), green (`#4ade80`), orange (`#fb923c`).
Any new theme color must be added there *and* listed here.

**Cue marker palette** — cue points cycle through a fixed 8-color palette
(`CUE_PALETTE` in `src/components/Deck.jsx`) so each cue is visually distinct on
the waveform. It reuses the six theme accents plus two extras:
cyan `#00f5d4`, purple `#a78bfa`, gold `#f0c040`, pink `#f472b6`,
green `#4ade80`, orange `#fb923c`, blue `#60a5fa`, yellow `#fde047`.
Any change to cue count or marker colors must update both `CUE_PALETTE` and this
list.

**Opacity suffixes** are the standard way to derive tints from an accent:
`{accent}11`–`{accent}33` for backgrounds, `{accent}44`–`{accent}88` for borders,
`{accent}aa`–`{accent}ff` for glows/strong states.

### Structural chrome

A small set of dark-slate hues sit purely as **decorative chrome** — never
carry information, never appear as live readable copy. They are listed here so
any reader of this guide can see they're registered (and so a sweep can flag
anything else off-palette).

| Name | Hex | Use |
|---|---|---|
| scrollbar-track | `#1e2440` | `::-webkit-scrollbar-thumb` + Firefox `scrollbar-color` in `src/index.css` |
| knob-body-light | `#2a2f45` | Inner stop of the `Knob.jsx` radial-gradient body |
| knob-body-dark | `#12152a` | Outer stop of the `Knob.jsx` radial-gradient body |
| option-bg | `#0d1225` | Native `<select>` option dropdown background to override browser default light (`BassDropMenu.jsx`, `Crossfader.jsx`, `Looper.jsx`) |

`#4a5580` (text-dim) remains reserved for de-emphasized decorative hints only
(e.g. an em-dash placeholder) — never on a live affordance or anything that must
be read.

## 4. Typography

- **Display** — `Audiowide` (single weight 400). App title, deck IDs, BASS DROP
  button, genre names, panel headings.
- **Body** — `Exo 2` (variable, weights 300–700). All controls, labels, values,
  body copy.
- Both are **self-hosted** in `src/fonts/` as `.woff2` (injected at boot via
  `src/fonts/index.js`, which imports each file with Vite's `?url` so the
  single-file build inlines them as `data:` URIs and the multi-file build emits
  hashed siblings). Never load fonts from a CDN — that would break the
  zero-network promise.
- **Label size:** 9px, uppercase, `letter-spacing: 1px`, color `--text-muted`.
- **Value size:** 10–12px, accent color, weight 600–700.

## 5. Iconography

- **No emoji.** Ever. Emoji render inconsistently across platforms and clash with
  the brand. All glyphs come from the in-house `<Icon>` component
  (`src/components/Icon.jsx`).
- Icons are hand-drawn inline SVG on a 24×24 viewBox, no icon font, no network.
- Two styles: **fill** (play, pause, stop, bolt, record) and **stroke**
  (loop, close, plus, chevron, music, bulb, keyboard, speaker, flag, download,
  upload), 2px round strokes. `flag` is a pennant-on-a-pole used for the
  recording cue-marker button. `download` / `upload` are tray-with-arrow
  glyphs used by the settings export / import buttons.
- Add a new icon by extending `FILL_PATHS` / `STROKE_PATHS` in `Icon.jsx`. Update
  `ICON_NAMES` and the icon test automatically covers it.
- Decorative icons next to a text label: omit `title`, the SVG is `aria-hidden`.
  Icon-only buttons: the *button* carries `aria-label`; the icon stays hidden.
- Typographic arrows (`← → ↑ ↓`) used to **name keyboard keys** are text, not
  icons — they represent literal keycaps. The `±`, `×`, `÷` math symbols in
  control labels (`±12dB`, `×2`, `÷2`) are likewise text.

## 6. Logo / app icon

`public/icons/icon.svg` — a dark-gradient square with a cyan→purple twin
waveform and a gold center dot. Used for the PWA manifest at all sizes. Any
re-draw keeps: the dark background, the cyan→purple wave gradient, the gold
accent dot.

## 7. Motion

- Transitions: `0.15s–0.3s ease`.
- Knob drag: immediate, no transition.
- Beat indicator: `beatPulse` keyframe, duration = `60 / bpm` seconds.
- Bass drop: `pulse` keyframe, 0.15s infinite alternate.
- Record dot: `pulse` keyframe, 0.8s infinite alternate (slower, calmer pulse
  than the bass-drop button — signals an ongoing recording, not a transient hit).
- Respect the spirit of `prefers-reduced-motion` for any *new* non-essential
  animation (see DESIGN_GUIDE.md §Accessibility).

## 8. Naming

- Files mirroring the brand stay as `WAVECRAFT-*` (the original spec docs).
- The npm package is `wavecraft` (lowercase).
- Mix exports are named `wavecraft-mix-<timestamp>.<ext>`.
