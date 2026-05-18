# WAVECRAFT — Design Guide

How the interface should look and behave. Pairs with BRANDING_GUIDE.md (identity)
and STYLE_GUIDE.md (code).

## 1. Design principles

1. **Tactile first.** Every audio control feels like hardware — knobs rotate,
   sliders slide, buttons depress. No flat checkboxes for audio parameters.
2. **Glanceable state.** A DJ should know what's happening on both decks without
   reading text. Color, motion, and position carry meaning first; text second.
3. **Progressive complexity.** The default surface is simple. Depth (effects,
   MIDI, looper) reveals on demand and never blocks the core flow.
4. **Chill, not clinical.** Warm darks, soft neon glows, late-night-studio vibe —
   not enterprise software, not a hospital.
5. **Zero dead ends.** Every empty state has a call to action. Every error has a
   recovery path.

## 2. Layout

- App shell: max-width 1180px, centered, `16px` horizontal padding.
- Cards: `border-radius: 16px`, `20px` padding (deck cards `16px`),
  `1px solid {accent}22` border, `backdrop-filter: blur(10px)`.
- Deck row: two decks flanking a center crossfader column. Gap `12px`.
- **Responsive breakpoint: 720px.** Below it, decks stack vertically and the
  crossfader switches from a vertical native slider to a horizontal one. Driven
  by the `useMatchMedia` hook + the `.wc-deck-row` / `.wc-crossfader-column`
  classes in `index.css` — never duplicate this logic inline.

## 3. Components

- **Knob** — 52px diameter (36px in effect cards), radial-gradient body, 270°
  rotation range, pointer-drag (vertical) interaction, `touch-action: none`.
- **Slider** — native range input, `accentColor` set to the deck color, 4px
  track, 14px thumb. Vertical variant for the desktop crossfader only.
- **Buttons** — two-step radius scale: **large** controls (transport pads, file
  loader, BASS DROP) use `border-radius: 10px`; **small / compact** controls
  (TAP, SYNC, AUTO, cue chips, looper & sample-pad controls, MIDI buttons) use
  `6–8px`. Icon-only controls have a minimum 38×38px hit area (via padding or
  `min-width` / `min-height`) and must carry an `aria-label`. Text buttons use
  Audiowide for primary actions (BASS DROP), Exo 2 elsewhere.
  - **Exemption — color-swatch picker.** The `ThemePicker` accent swatches are
    16×16px and intentionally below the 38×38 minimum: they are a tightly
    packed swatch grid where a full-size hit area would force the row to wrap
    or crowd out the MasterBus controls. They remain accessible — each swatch
    is a real `<button>` with an `aria-label` and keyboard focus. This is the
    only sanctioned exemption from the 38×38 rule.
- **Icon** — see BRANDING_GUIDE §5. Size 10–18px depending on context.
- **Cards / panels** — two container tiers by radius, three by background alpha:
  - **Content cards** — decks, Looper, SamplePad, TheoryPanel — use a **16px**
    radius.
  - **Bars / collapsible panels** — MasterBus, MidiPanel — are slimmer
    container chrome and use a **12px** radius to read as a bar rather than a
    full content card.
  - **Panel-background alpha scale** — the `rgba(15,18,35,α)` fill uses a
    three-tier α to layer depth:
    - **0.7** — decks. The most opaque; they are the primary surface and sit
      over the app gradient with `backdrop-filter: blur(10px)`.
    - **0.6** — secondary content cards (Looper, SamplePad, TheoryPanel,
      MidiPanel body).
    - **0.5** — the MasterBus bar. The most translucent, so the bar recedes
      and reads as chrome rather than content.

## 4. Color usage

- Deck A / Deck B each render in their **user-selected accent color** — every
  control inside a deck derives from the `color` prop. Never hard-code cyan or
  purple inside Deck or its children; thread the prop.
- The master bus is gold (`#f0c040`).
- **The crossfader is a shared control, not Deck B.** Its body (slider track,
  "X-FADE" label, curve selector) is neutral slate (`#8892b0`). Only its `A` and
  `B` end-labels are tinted — with the respective deck's current accent color,
  passed in as `deckAColor` / `deckBColor` props.
- Recording is the only place `--danger` red appears. Error messages also use
  `--danger` (`#f87171`) — never a deck theme color.
- Active/engaged controls glow (`box-shadow: 0 0 12-40px {accent}33-66`); idle
  controls do not.
- No off-palette hue may appear in code. Every color resolves to a
  BRANDING_GUIDE §3 token, an opacity-suffixed accent (`{accent}NN`), or the
  neutral slate scale. (Historic stray: `#7b2fbe` — removed; do not reintroduce.)

## 5. States

Every interactive control defines: **default, hover, active/engaged, disabled.**

- Disabled: `opacity: 0.4–0.5`, `cursor: not-allowed`, dimmed color.
- Engaged (e.g. loop on, effect on, deck focused): accent background tint +
  accent border + glow.
- Empty state: dashed accent border + a CTA ("Drop audio here or click to load").

## 6. Accessibility (enforced)

- **Every icon-only button has an `aria-label`.** The icon SVG itself is
  `aria-hidden` unless it is the sole carrier of meaning.
- Toggle buttons expose `aria-pressed`.
- Decks are `role="region"` with an `aria-label` naming the deck + focus state.
- Keyboard: the whole app is operable without a mouse (see USER_GUIDE.md).
  Focused deck is visually indicated by a stronger border + glow.
- Form inputs are skipped by the global keydown handler so typing never triggers
  shortcuts.
- Contrast: body text `#ccd6f6` on `#070a14` passes WCAG AA, and `--text-muted`
  (`#8892b0`) small copy on `#070a14` also passes AA (≈6.4:1, above the 4.5:1
  small-text minimum). Do not put `--text-dim` (`#4a5580`) on the deep
  background for anything that must be read — at ≈2.7:1 it fails AA, so it is
  for de-emphasized decorative hints only, never live readable copy.
- **New non-essential animation must honor `prefers-reduced-motion`.** Existing
  pulse animations are short and low-amplitude; anything larger needs a guard.

## 7. Anti-patterns (do not do)

- Emoji in the UI. Use `<Icon>`.
- Hard-coded deck colors inside deck-scoped components.
- Inline re-implementation of the responsive breakpoint.
- Text-only state communication where color/position would be glanceable.
- New fonts or hues not registered in BRANDING_GUIDE.md.
- `alert()` for routine feedback (acceptable only for hard file-decode failures
  until a toast component exists — tracked in ROADMAP).
