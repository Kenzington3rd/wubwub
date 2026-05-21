# Contributing to WAVECRAFT

WAVECRAFT is a free, local-only DJ mixing app. **Nothing leaves the device** —
that constraint is the entire point of the project, and every contribution has
to honor it. This file orients you on what to read, how to build / test, and
the few hard rules that aren't negotiable.

## TL;DR

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # vitest, run once
npm run test:watch     # vitest, watch mode
npm run build          # multi-file PWA → dist/
npm run build:single   # one self-contained HTML → dist-single/index.html
npm run size           # build + bundle-size budget guard
```

CI (`.github/workflows/ci.yml`) runs `npm ci && npm test && npm run size && npm run build`
on every push and PR. Aim for green locally before pushing.

## Where to find work

- [`docs/ROADMAP.md`](docs/ROADMAP.md) — long-term direction.
- [`docs/BACKLOG.md`](docs/BACKLOG.md) — vetted, code-verified worklist (`LEGIT` / `NEEDS-SPIKE` / `REJECT`). Pick from `LEGIT`.
- [`docs/USER_STORIES.md`](docs/USER_STORIES.md) — every user story has a `USxx` id; tests are tagged to those ids (see below).
- GitHub Issues — bugs and small enhancements. Use the bug / feature templates.

## Repo orientation

The full file map lives in [`CLAUDE.md`](CLAUDE.md). Short version:

```
src/
├── App.jsx                 # orchestrator
├── audio/                  # chain, effects, crossfade, BPM, key, recorder
├── components/             # Deck, Crossfader, MasterBus, Looper, SamplePad, ...
├── midi/midiMap.js         # MIDI Learn + CC mapping
├── settings.js             # versioned settings export/import (config only — no audio)
├── fonts/                  # .woff2 + injectFonts()
└── worklets/looper-worklet.js
test/                       # vitest suite, mirrors src/ structure
docs/                       # long-form spec, guides, stories
```

## Danger zones — these rules don't bend

If your patch touches any of these, expect extra scrutiny.

| Path / Area | Rule |
|---|---|
| **Network calls** | **NEVER** add `fetch`, `XHR`, `WebSocket`, `sendBeacon`, RTCPeerConnection, EventSource, navigator.sendBeacon, or anything that opens a socket. The PWA service worker must not touch external origins. CSP enforces this with `connect-src 'none'`. |
| **User audio data** | Files stay in `ArrayBuffer` / `AudioBuffer` in memory. **Never** persist user audio to `localStorage`, IndexedDB, OPFS, the Cache API, cookies, or any disk. The settings export / import in `src/settings.js` is config-only (themes, MIDI maps, curve) and never includes audio. |
| **Audio parameter changes** | Use `setTargetAtTime` or scheduled ramps. **Never `setTimeout`** for audio — it drifts off the audio clock and breaks bass drop / EQ automation. |
| **Delay feedback** | Clamped `≤ 0.9`. Removing the clamp causes runaway feedback and ear damage. |
| **Audio signal chain order** | Don't reorder without the Audio Engine Architect's review. The chain order in `src/audio/chain.js` is load-bearing for tonal coherence. |
| **Bass drop automation** | AudioParam scheduling only. The wobble preset re-entry path has a `Deck.test.jsx` test covering oscillator leaks — keep it green. |
| **Worklet path** | The looper worklet is imported as `?raw` from `src/worklets/looper-worklet.js` and registered via a Blob URL — works in dev, the PWA build, the single-file build, and from `file://`. Don't switch back to a public-path `addModule`. |
| **Single-file build** | `vite-plugin-singlefile` and `vite-plugin-pwa` are mutually exclusive in one build. Use `--mode single` to pick singlefile. Verify `dist-single/index.html` is genuinely standalone. |
| **CSP** | Re-injected by a `transformIndexHtml` hook in `vite.config.js` (the PWA plugin strips it otherwise). Keep `connect-src 'none'`; if you add a feature that legitimately needs more, document why. |

## Test convention — `@us USxx` tags

Every test is tagged with the user-story id it covers. Example:

```js
it("@us US27: App renders both decks with focus indicators", () => {
  render(<App />);
  expect(screen.getByText("DECK A")).toBeInTheDocument();
  expect(screen.getByText("DECK B")).toBeInTheDocument();
});
```

The id (`US27`, here) maps to a row in [`docs/USER_STORIES.md`](docs/USER_STORIES.md).
When you add a feature, add the user story to the stories doc first, then
reference it in the test name. When you add a regression test for a bug, tag
it with the user story the bug breaks.

If the test doesn't fit any existing story, add one. The tags exist so a future
reader can ask "what test covers user-visible behavior X?" and get an answer
with grep.

## Bundle-size budget

`npm run size` runs after every CI build. Budgets live in
[`scripts/check-bundle-size.mjs`](scripts/check-bundle-size.mjs). If a change
trips the budget:

1. First instinct: tree-shake, drop the regression. The constraint exists for
   a reason — this app ships as a single HTML file.
2. If the growth is justified, raise the budget *deliberately* in the script
   and explain why in the PR description. Never silence the failure to land
   the change.

## Branching + commits

- Branch from `main`. Feature branches named `<area>/<short-desc>` (e.g. `looper/clip-meter`).
- Squash to `main` on merge — keeps history readable.
- Commit messages: imperative present tense, scope-prefixed. Examples:
  - `fix(looper): clamp capture seconds to ≤ 60`
  - `feat(crate): drag-drop tracks into the session crate`
  - `chore(ci): add GitHub Actions workflow`
- PRs go through the [pull-request template](.github/PULL_REQUEST_TEMPLATE.md)
  — it's a checklist, not a barrier. Tick what applies.

## Icon regeneration

If you change `public/icons/icon.svg`, regenerate the PNGs that iOS Safari uses
for Add-to-Home-Screen:

```bash
node scripts/render-pwa-icons.mjs
```

The script uses `sharp` (devDependency). Commit the regenerated PNGs alongside
the SVG change.

## A few things we deliberately don't have

- **No telemetry, no error reporting service, no Sentry.** If you want to know
  what's broken, run the app yourself.
- **No remote feature flags.** Static configuration only.
- **No "register to save your mixes" prompt, ever.** There is no server. There
  will never be a server.

Welcome aboard.
