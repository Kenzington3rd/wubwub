# WAVECRAFT — Roadmap & Research Findings

> Synthesis of market research (browser DJ landscape, 2026-05-11) + product backlog for future iterations. All features below respect the hard local-only / no-subscription constraints.

## Position in the market

WAVECRAFT occupies a genuinely thin slot: **pure-browser, local-only, no-account, no-subscription**. The only adjacent player is `you.dj`, which is streaming-dependent (locks local-file uploads behind a paywall). The other competitive lanes are:

| Tool | Why we differ |
|---|---|
| **Mixxx** (free, OSS desktop) | Native install required; we run in a tab |
| **VirtualDJ** (freemium) | Free tier has [audio name-drop watermark](https://virtualdj.com/forums/266529/General_Discussion/Virtual_DJ_name_drop_TURN_OFF!.html) on recordings; ours is clean |
| **djay Pro** ($6.99/mo) | Subscription-only past trial; we're free |
| **DJ.Studio** ($199–$499) | Expensive timeline-based mix planner with [Trustpilot user complaints](https://www.trustpilot.com/review/dj.studio); we're a live tool |
| **rave.dj** (free, ad-supported) | Render-only AI mashup, not a real DJ tool ([AlternativeTo](https://alternativeto.net/software/ravedj/)) |

## Recurring pain points (cited)

1. **Beatgrid is wrong, no manual fix** — Mixxx specifically criticized: "Lacks anchors for correcting difficult beatgrids" ([DeeJay Plaza Mixxx review](https://www.deejayplaza.com/en/articles/mixxx-review)). Also a recurring complaint in [Serato](https://serato.com/forum/discussion/898313) and [Pioneer Rekordbox](https://forums.pioneerdj.com/hc/en-us/community/posts/17535109558809-Rekordbox-Hot-Cue-Loop-memory-issue) forums.
2. **Pre-cue / split-cue without a 2-output interface** — Top streaming-DJ pain: ["OBS is streaming both the selected audio and the pre-cue"](https://obsproject.com/forum/threads/help-with-dj-streaming-obs-is-streaming-both-selected-audio-and-the-pre-cue.126308/). DIY workarounds exist for [hardware mixers](https://djtechtools.com/2020/01/29/how-to-make-a-diy-split-cue-in-almost-any-mixer/) but software with a built-in L/R split is rare. **No free browser DJ app does this.**
3. **State loss on reload** — cues, BPM, gain are forgotten. Mixxx persists silently to SQLite users can't see; we explicitly persist nothing.
4. **Watermarked / crippled "free" tier output** — VirtualDJ's name-drop kills shareable mixes. We're already clean here.
5. **Stems are table-stakes now** — djay Pro AI, VDJ, Mixxx 2.6 all have stems ([Mixxx GSoC 2024 stems post](https://mixxx.org/news/2024-08-26-stem-mixing/)). Browser-native is feasible: [ONNX-Demucs running fully in a browser tab](https://earezki.com/ai-news/2026-04-24-i-ran-a-neural-network-in-a-browser-tab-to-split-a-song-into-stems/) (Apr 2026).
6. **Mobile/touch ergonomics weak in free tools** — Cross DJ called ["fun for messing around, doesn't compete"](https://www.techjockey.com/alternatives/cross-dj); Mixxx hot-cue buttons "too small."
7. **Accessibility is an afterthought** — only VirtualDJ has serious blind/low-vision support, [via a 3rd-party project](https://virtualdjaccessibility.com/). [Drake Music's disability research](https://www.drakemusic.org/blog/nickevans/part-2-research-report-djing-and-disability/) shows disabled DJs remap to keyboards / Launchpads.
8. **Library / smart-crate management** — paywalled moat across competitors.
9. **Key detection paywalled** — Mixed-In-Key is the gold standard; DJ.Studio bundles it for extra $80 CAD. ✅ **WAVECRAFT now ships free auto-key detection (this iteration).**

## Prioritized next iteration

Each item below has a cost estimate (effort), a citation back to a pain point, and a feasibility note vs the local-only constraint.

### P1 — Highest leverage, smallest effort

#### 1. **Split-cue / pre-cue bus** (pain #2)
- **Effort:** medium. Add a "headphone monitor" toggle per deck; a master "Split Cue" toggle; new audio nodes: per-deck cue tap + ChannelMergerNode that routes master to right channel and cue bus to left channel (for users without a second output device).
- **Differentiator:** zero free browser apps offer this. Streamers + DJs without USB interfaces benefit instantly.
- **Files:** `src/audio/chain.js` (insert cue tap), `src/App.jsx` (split routing), new `src/components/CueMonitorPanel.jsx`.
- **Feasibility:** 100% local. Optional `setSinkId()` for users with a second output device.

#### 2. **Optional OPFS-backed metadata persistence** (pain #3)
- **Effort:** medium. Hash the file content (SHA-256 of first ~256KB), store `{ cues, bpm, key, eqDefaults }` keyed by hash in OPFS/IndexedDB. Big "Forget everything" button in settings.
- **Note on policy:** the CLAUDE.md rule "no localStorage for user content" was meant to protect against persisting audio buffers without consent. Persisting *metadata only*, opt-in, with one-click wipe, is consistent with the privacy promise. Make the trade-off explicit in onboarding.
- **Files:** new `src/storage/trackMemory.js`, hook into Deck on file load.

#### 3. **Recorder broadcast-bus toggle** (pain related to streaming)
- **Effort:** small. Currently the MediaRecorder always taps post-master-compressor. Streamers may want pre-limiter (clean) or post-limiter (radio-ready). Add a 2-position toggle in MasterBus + a tiny clip meter.
- **Files:** `src/audio/recorder.js`, `src/components/MasterBus.jsx`.

### P2 — Medium effort, high impact

#### 4. **Manual beatgrid anchors with snap-to-transient** (pain #1)
- **Effort:** medium-high. Drag a "downbeat" marker on the waveform; the rest of the grid is derived from BPM. Optional snap to detected onsets (~6 lines using `bpmDetect.js`'s envelope).
- **Differentiator:** closes Mixxx's most-cited weakness.
- **Files:** `src/audio/bpmDetect.js` (expose onsets), `src/components/WaveformCanvas.jsx` (draggable grid), Deck state for anchor position.

#### 5. **Accessibility pass — high-contrast theme, big-button mode, one-hand keyboard remap** (pain #7)
- **Effort:** small (each piece). High-contrast = pure black BG + max-saturation accents. Big-button mode = a CSS `--ui-scale` variable that bumps knob/slider/button sizes 1.5×. One-hand mode = remap shortcuts to one half of keyboard (e.g. `qwer` + `1-4`).
- **Differentiator:** [Drake Music's research](https://www.drakemusic.org/blog/nickevans/part-2-research-report-djing-and-disability/) documents one-hand DJ workflows that competitors ignore.
- **Files:** `src/index.css` (theme + scale variables), settings panel, `src/App.jsx` keyboard handler.

### P3 — Large effort, transformative impact

#### 6. **Browser-native stem separation via ONNX-Demucs** (pain #5)
- **Effort:** large but proven. Aral Roca's [browser Demucs demo](https://earezki.com/ai-news/2026-04-24-i-ran-a-neural-network-in-a-browser-tab-to-split-a-song-into-stems/) shows it works in a tab via ONNX + WebAssembly. Ship the model as an optional one-time download (cached in OPFS); base bundle stays small; local-only promise holds.
- **Differentiator:** singlehanded leapfrog of every other browser DJ app.
- **Unknowns:** perf on mid-range laptops (target <2× realtime). Prototype required before committing.
- **Files:** new `src/stems/` module, integration into Looper / SamplePad as live-extractable sources.

### P4 — Reposition existing surfaces

#### 7. **Unify Looper + SamplePad + (future) Stems as a "Live Remix" suite**
- **Effort:** small once stems land. Currently Looper and SamplePad are separate panels; semantically they're all "play a captured audio fragment, loop or one-shot." Treat them as 3 tabs of one panel: Loops / Samples / Stems.

#### 8. **Reactive Camelot Wheel** (in TheoryPanel)
- **Effort:** small. Now that auto-key detection ships, the existing wheel can highlight the focused deck's detected key and its compatible neighbors automatically — no clicking required. Make the wheel a real harmonic-mixing aid instead of decorative.
- **Files:** `src/components/TheoryPanel.jsx` (accept detected-key prop), `src/App.jsx` (lift detected key state).

## Confidence notes / unknowns

- Reddit primary mining was rate-limited during research; pain-point *frequency* numbers come from forum/aggregator citations, not Reddit directly. Spot-check r/Beatmatch, r/DJs, r/Mixxx before betting big on any item.
- Discord communities for Mixxx, djay, DJ TechTools are not web-indexed — likely-rich pain-point signal is invisible.
- ONNX-Demucs performance on mid-range hardware is a single data point — prototype before committing to P3 #6.
- OPFS quota behavior on iOS Safari has [known quirks](https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/); verify before promising persistent state on iPad PWA.

## What landed in this iteration (2026-05-11 mid-day, post bug-review)

- 9 bug fixes (spacebar double-trigger, waveform RAF restart, looper listener attach, iOS unlock pre-warm, PWA icons, eqHighBoost rename, wobble math, ensureMasterCtx churn, Uint8Array pre-allocation)
- CSP meta tag (defense-in-depth for local-only promise)
- Drag-and-drop file loading on Decks
- ½× / 2× BPM nudge buttons (fixes half-time / double-time detection)
- Cue limit UX (`8 / 8` indicator when full)
- Dashed-border loop indicator on the waveform
- ARIA labels + `aria-pressed` on transport
- **Auto-key detection** — research recommendation #6 (Krumhansl-Schmuckler chroma correlation, runs alongside auto-BPM)
- PWA icon (SVG, single asset, used at all sizes)
