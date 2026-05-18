# WAVECRAFT — Code Style Guide

Conventions for the codebase. New code must conform; the design-reviewer and
qa-engineer agents enforce this.

## 1. Language & framework

- React 18, function components + hooks only. No class components.
- ES modules. `.jsx` for files with JSX, `.js` for pure logic.
- Build tool: Vite 5. Tests: Vitest + happy-dom + React Testing Library.

## 2. Audio code

- **All Web Audio nodes live in `useRef`** — never `useState`. Audio state must
  not trigger React re-renders.
- **AudioParam changes use scheduling** — `setTargetAtTime`,
  `linearRampToValueAtTime`, `exponentialRampToValueAtTime`. Never `setTimeout`
  to fake automation.
- **Every `AudioBufferSourceNode` is single-use.** Create a fresh one per play;
  after `stop()`, also `disconnect()` and null the ref.
- **Effects bypass via dry/wet gain pairs**, ramped with `setTargetAtTime`. Never
  disconnect/reconnect a live graph — it clicks.
- The per-deck graph is built once by `buildDeckChain` and stored in `chainRef`.
  Chain-mutating `useEffect`s depend on `chainTick` so they re-apply state when
  the chain is first constructed.
- Lazily create the `AudioContext` on first user gesture via `ensureMasterCtx`;
  resume it there too (iOS autoplay policy).
- Delay feedback is clamped `≤ 0.9`. Do not remove the clamp.

## 3. React patterns

- `useCallback` for any handler passed as a prop or used in another hook's deps.
- `useEffect` for audio-parameter updates, scoped to the specific setting.
- Dependency arrays are exhaustive and honest. If a value is intentionally read
  via a ref to avoid a dep, there is a comment explaining why.
- Components expose imperative APIs (for keyboard shortcuts / MIDI) via
  `forwardRef` + `useImperativeHandle` — see `Deck.jsx`, `SamplePad.jsx`.
- Mutating values consumed inside a `requestAnimationFrame` loop are passed as
  refs, not props, so the loop doesn't restart per render (see `WaveformCanvas`).
- Clean up on unmount: cancel `rAF`, clear intervals/timeouts, disconnect nodes,
  remove event listeners, unsubscribe MIDI.

## 4. Styling

- Inline style objects with template literals for dynamic accent colors.
- Global CSS (`src/index.css`) holds `@font-face`, resets, `@keyframes`, and the
  media queries only (the responsive `max-width` breakpoint and the
  `prefers-reduced-motion` block).
- Deck-scoped components receive a `color` prop and derive every tint from it.
  Never hard-code `#00f5d4` / `#a78bfa` inside them.
- Opacity-suffix tinting (`{color}22`, `{color}66`) is the standard.

## 5. Icons

- Use `<Icon name="..." />`. No emoji, no inline `<svg>` in feature components.
- New glyphs go in `Icon.jsx` (`FILL_PATHS` or `STROKE_PATHS`), authored on a
  24×24 viewBox.

## 6. Safety / privacy invariants (never violate)

- No `fetch`, `XHR`, `WebSocket`, `sendBeacon`, or any outbound request at runtime.
- No `localStorage` / `sessionStorage` / IndexedDB / OPFS for user **content**
  (audio buffers, file-derived data). App *preferences* persistence is a separate,
  explicit policy decision — see ROADMAP.
- No `eval`, `new Function`, or `innerHTML` with non-constant content.
- User files stay as `ArrayBuffer` / `AudioBuffer` in memory. Never transmitted.
- CSP meta tag in `index.html` is the backstop — keep it strict.

## 7. Testing

- Every user story in `USER_STORIES.md` has a test. New features add a story +
  a test in the same change.
- Each `it(...)` is tagged `// @us US##` with the story it covers.
- Pure logic → unit test. Components → RTL render test. Cross-component flows →
  integration test with the Web Audio mock (`test/mocks/webAudioMock.js`).
- `npm test` must be green before any commit. `npm run build` must succeed and
  stay under the 150 KB gzip budget.

## 8. Naming

- Components: `PascalCase.jsx`. Hooks: `useCamelCase.js`. Audio/util modules:
  `camelCase.js`.
- Event handlers: `onX` for props, `handleX` for local handlers.
- Refs holding nodes: `xRef`. Refs mirroring state for closures: `xRef` with a
  sync `useEffect`.

## 9. Comments

- Explain *why*, not *what*. Non-obvious audio-graph decisions, race-condition
  guards, and browser quirks get a comment.
- File headers describe the module's responsibility for anything non-trivial.

## 10. Commits

- Imperative subject line; body explains the why. Group logically.
- `npm test` + `npm run build` green before committing.
- Never commit `node_modules/`, `dist/`, `dist-single/` (gitignored).
