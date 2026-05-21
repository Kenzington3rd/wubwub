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
  `backdrop-filter: blur(10px)`.
- **Card borders.** Two rules by card type:
  - **Deck cards** use an **accent border** derived from the deck's
    user-selected color: `1px solid {accent}22` at rest, brightening to
    `{accent}88` when focused and to the full accent on drag-over.
  - **Shared, non-deck panels** (MasterBus, Looper, SamplePad, Crate,
    MidiPanel, TheoryPanel) use a **neutral** `1px solid rgba(255,255,255,0.04)`
    border — they carry their identity accent on the heading only, never on
    the panel border (see §4). A panel's drag-over / active state brightens
    that neutral border (e.g. the Crate's `rgba(255,255,255,0.35)`), it does
    not switch to an accent.
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
  `min-width` / `min-height`) and must carry an `aria-label`. **All interactive
  text buttons have a minimum 38×38px hit area, regardless of label size or
  context.** Sanctioned exceptions:
  - **ThemePicker swatches** — 24×24 hit area (compact packed targets, see
    existing §3 note below).
  - **Native `<select>` elements** in tight inline rows paired with full-size
    buttons (BassDropMenu, Looper bars) — 30px high (vertical layout
    constraint).
  Text buttons use Audiowide for primary actions (BASS DROP), Exo 2 elsewhere.
  - **ThemePicker swatches.** The accent swatches are visually 16×16px chips,
    but the `<button>` carrying each one adds 4px symmetric padding around
    the chip so the actual pointer hit area is **≥ 24×24** — meeting
    WCAG 2.5.8 (Target Size — Minimum) without changing how the swatches
    look. This is NOT an exemption from the 38×38 rule for full-size
    controls; it is a deliberate compact target at the WCAG minimum, used
    here because a full-size swatch row would crowd out the MasterBus
    controls.
- **Icon** — see BRANDING_GUIDE §5. Size 10–18px depending on context.
- **Segmented two-option toggle** — a pair of joined buttons sharing one
  rounded border (e.g. the MasterBus recorder Clean/Radio tap toggle). The
  active segment is tinted with the **host surface's accent** (gold on the
  MasterBus), not a deck color; the inactive segment stays neutral slate.
- **CLIP meter** — the MasterBus clip indicator is a **non-announcing,
  visual-only** status indicator: a dot that lights `--danger` when the master
  signal clips, with a `title` for pointer users. It carries no `role="status"`
  / live region — a hot signal toggles many times a second and would flood a
  polite announcer.
- **Cards / panels** — two container tiers by radius, three by background alpha:
  - **Content cards** — decks, Looper, SamplePad, TheoryPanel, Crate — use a
    **16px** radius.
  - **Bars / collapsible panels** — MasterBus, MidiPanel — are slimmer
    container chrome and use a **12px** radius to read as a bar rather than a
    full content card.
  - **Panel-background alpha scale** — the `rgba(15,18,35,α)` fill uses a
    three-tier α to layer depth:
    - **0.7** — decks. The most opaque; they are the primary surface and sit
      over the app gradient with `backdrop-filter: blur(10px)`.
    - **0.6** — secondary content cards (Looper, SamplePad, TheoryPanel, Crate,
      MidiPanel body).
    - **0.5** — the MasterBus bar. The most translucent, so the bar recedes
      and reads as chrome rather than content.

## 4. Color usage

- Deck A / Deck B each render in their **user-selected accent color** — every
  control inside a deck derives from the `color` prop. Never hard-code cyan or
  purple inside Deck or its children; thread the prop.
- The master bus is gold (`#f0c040`).
- Shared, non-deck panels use **neutral slate chrome** — the Crate, like Looper
  and SamplePad, takes neutral-slate panel borders / glow / empty-state
  affordances, never a deck accent. (The Crate's per-entry "→ A" / "→ B" load
  buttons are the exception: they are deck-scoped and tint with each deck's
  current accent, threaded in as `deckAColor` / `deckBColor` props.)
- **Panel-heading accent pattern.** Each shared non-deck panel carries **one
  fixed identity accent, used for its HEADING TEXT only** — it labels the panel
  at a glance without painting the whole surface. The panel **body** (borders,
  glow, buttons, icons, empty-state affordances) stays **neutral slate**
  (`#8892b0` and the neutral chrome scale). The registered headings are:
  - **Looper** — purple `#a78bfa`
  - **SamplePad** — cyan `#00f5d4`
  - **Crate** — green `#4ade80`
  - **TheoryPanel** — orange `#fb923c` (heading + tabs + active-tab state +
    the click-selected Camelot-key highlight; the panel body is otherwise
    neutral slate)
  - **MidiPanel** — blue `#60a5fa` (disclosure heading + chevron + the
    enabled/learning active tints; the mapping grid is otherwise neutral slate)
  Any new shared panel picks one fixed accent from the registered palette,
  distinct from the others, for its heading. This is independent of the
  deck-color system: deck-scoped components (Deck and its children, plus the
  Crate's deck-load buttons) still thread the `color` prop and never use a
  fixed accent. The MasterBus is gold per the rule above.
  - **SamplePad body is neutral slate.** Only the SAMPLES heading carries the
    cyan identity accent. Each pad's body — loaded-state background, border,
    trigger button, volume slider, key-binding hint — uses the neutral slate
    scale (`#8892b0` text, `rgba(255,255,255,…)` tints), the same treatment
    the Crate panel uses for its entries.
  - **Sanctioned exception — the Looper slot palette.** The Looper's 4 slots
    are colored with a fixed 4-color palette (`SLOT_COLORS`: cyan `#00f5d4`,
    purple `#a78bfa`, gold `#f0c040`, pink `#f472b6`) applied to each slot's
    body — capture button, play button, border, volume slider. This is an
    **intentional functional palette**: like the 8-color cue-point palette
    (BRANDING_GUIDE §3), the colors exist to make the four otherwise-identical
    slots individually identifiable at a glance. It is an explicit, sanctioned
    exception to the neutral-body rule above — the Looper slot bodies are
    deliberately NOT neutral slate, and `Looper.jsx` must not be repainted to
    the neutral scale. The LOOPER heading still uses the registered purple.
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
  Focused deck is visually indicated by a stronger border + glow. The
  waveform `<canvas>` is no exception — once a track is loaded it is a
  `role="slider"` seek control (`tabIndex={0}`, arrow / Home / End keys seek);
  it consumes `←/→/Home/End` (`stopPropagation`) so the global crossfader
  arrow shortcuts do not double-fire while it is focused. `↑/↓` are NOT
  consumed by the canvas — they bubble to the global handler and adjust the
  focused deck's volume, matching the documented global ↑/↓ behavior.
- **Focus ring.** The global `*:focus-visible` outline is `2px solid #ccd6f6`
  (text-primary, the registered neutral). Using a deck accent (e.g. cyan)
  would camouflage focus on a same-accent control and clash with every other
  deck-color context. `#ccd6f6` on `#070a14` exceeds the 3:1 non-text contrast
  requirement and stays visible on any accent-tinted background.
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
