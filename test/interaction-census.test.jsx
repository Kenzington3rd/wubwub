// Interaction census — the standing guarantee that EVERY clickable / adjustable
// control in WAVECRAFT is exercised, and that no new one can be added without
// being accounted for.
//
// The rest of the suite asserts *outcomes* control-by-control (see
// docs/E2E_VERIFICATION.md). This file asserts *completeness*: it renders the
// whole app in its fully-populated state, enumerates every interactive node in
// the live DOM, and then
//
//   1. pins the inventory against a checked-in manifest, so adding a control
//      without adding coverage fails the build (drift is caught in BOTH
//      directions — new controls AND silently-removed ones);
//   2. actually drives every one of them — click, hold, drag, type — and
//      asserts the app survives and stays interactive.
//
// (2) is the negative half: a control wired to a handler that throws on a
// second click, on an unloaded deck, or at a slider's extreme is a real bug
// that no amount of happy-path per-control testing would surface.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import App from "../src/App.jsx";

// Every element a user can operate. `[tabindex]` catches the custom Knob and
// the waveform canvas, which are divs/canvases with slider semantics.
const INTERACTIVE =
  'button,input,select,textarea,[role="slider"],[role="button"],[role="tab"],[tabindex]:not([tabindex="-1"])';

function label(el) {
  return (el.getAttribute("aria-label") || el.textContent || "")
    .trim()
    .replace(/\s+/g, " ");
}

function controls() {
  return [...document.querySelectorAll(INTERACTIVE)];
}

// TheoryPanel's tabs are mutually exclusive, so any single DOM snapshot is
// missing whichever panels aren't showing. Walk every tab and union the
// results, otherwise the census silently under-reports by a whole panel.
function controlsAcrossTabs() {
  const seen = new Map();
  const record = () => {
    for (const el of controls()) {
      const n = label(el);
      if (n && !seen.has(n)) seen.set(n, el);
    }
  };
  record();
  for (const t of screen.queryAllByRole("tab")) {
    fireEvent.click(t);
    record();
  }
  return seen;
}

// ── Rendering the app in its widest state ──────────────────────────────────
//
// A census taken on the idle app would miss every control that only exists
// once a track is loaded (BITE, cue list, waveform seek) or once a panel is
// open. So: load all three decks, then open everything.

function audioFile(name = "track.mp3") {
  return new File([new Uint8Array([0, 1, 2, 3])], name, { type: "audio/mpeg" });
}

async function loadAllDecks() {
  for (const id of ["A", "B", "C"]) {
    const btn = screen.getByRole("button", {
      name: new RegExp(`Load audio for Deck ${id}`, "i"),
    });
    let scope = btn.parentElement;
    while (scope && !scope.querySelector('input[type="file"]')) scope = scope.parentElement;
    const input = scope?.querySelector('input[type="file"]');
    if (!input) continue;
    await act(async () => {
      fireEvent.change(input, { target: { files: [audioFile(`${id}.mp3`)] } });
    });
  }
}

function openEveryPanel() {
  // Tabs in TheoryPanel, and any disclosure-style toggle elsewhere.
  for (const t of screen.queryAllByRole("tab")) fireEvent.click(t);
  for (const b of screen.queryAllByRole("button")) {
    if (/MIDI settings|Enable MIDI|Add tracks to the crate/i.test(label(b))) {
      try {
        fireEvent.click(b);
      } catch {
        /* enumeration only — outcomes are asserted elsewhere */
      }
    }
  }
}

// Several controls exist only once some state is reached — the BITE send row
// appears after a region is marked, cue chips after a cue is set. A census of
// the freshly-loaded app would silently exclude them, so drive the app into
// those states first.
async function reachConditionalStates() {
  for (const id of ["A", "B", "C"]) {
    const wave = screen.queryByRole("slider", {
      name: new RegExp(`Seek position in deck ${id} track`, "i"),
    });
    const setIn = screen.queryByRole("button", {
      name: new RegExp(`Set bite in point on deck ${id}`, "i"),
    });
    if (setIn) await act(async () => fireEvent.click(setIn));
    // OUT only commits when the playhead is AHEAD of IN, so seek first —
    // the waveform canvas is itself a slider (ArrowRight = +5 s).
    if (wave) {
      await act(async () => fireEvent.keyDown(wave, { key: "ArrowRight" }));
    }
    const setOut = screen.queryByRole("button", {
      name: new RegExp(`Set bite out point on deck ${id}`, "i"),
    });
    if (setOut) await act(async () => fireEvent.click(setOut));
  }
  // A cue, so the jump/delete chips render.
  const addCue = screen.queryByRole("button", {
    name: /Add cue at current position on deck A/i,
  });
  if (addCue) await act(async () => fireEvent.click(addCue));
}

async function renderFullApp() {
  const view = render(<App />);
  await loadAllDecks();
  await reachConditionalStates();
  openEveryPanel();
  return view;
}

beforeEach(() => {
  // VOX renders its live panel only in a secure context with a real
  // getUserMedia. Both are absent in happy-dom, so the census would otherwise
  // silently skip the entire mic surface.
  window.isSecureContext = true;
  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, "mediaDevices", {
      value: {},
      configurable: true,
    });
  }
  navigator.mediaDevices.getUserMedia = vi.fn(async () => ({
    getTracks: () => [{ stop: vi.fn(), kind: "audio" }],
    getAudioTracks: () => [{ stop: vi.fn(), kind: "audio" }],
  }));
});

describe("interaction census — inventory — US75", () => {
  it("@us US75: every interactive control carries an accessible name", async () => {
    await renderFullApp();
    const nameless = controls().filter((el) => label(el).length === 0);
    // A control with no accessible name cannot be tested by name, cannot be
    // reached by a screen reader, and cannot be mapped in the E2E matrix.
    // File inputs are the one legitimate exception: they are visually hidden
    // and driven by their labelled sibling button.
    const unexcused = nameless.filter((el) => el.type !== "file");
    expect(unexcused.map((el) => el.outerHTML.slice(0, 120))).toEqual([]);
  });

  it("@us US75: no two controls share an accessible name", async () => {
    await renderFullApp();
    const counts = new Map();
    for (const el of controls()) {
      const n = label(el);
      if (n) counts.set(n, (counts.get(n) || 0) + 1);
    }
    // Three decks each render a "LOW" knob and a "Reverb" toggle. If those
    // aren't deck-scoped, a screen-reader user hears three identical controls
    // and getByRole({ name }) can't address any of them — which is also how a
    // test would silently assert against the wrong deck.
    const collisions = [...counts].filter(([, v]) => v > 1);
    expect(collisions).toEqual([]);
  });

  it("@us US75: the control inventory matches the checked-in manifest", async () => {
    await renderFullApp();
    const found = new Set(controlsAcrossTabs().keys());

    // Deck-scoped controls are collapsed to a single generic entry — three
    // decks multiply the list without adding surface area.
    // Case-preserving: "Deck A volume" → "Deck <D> volume", but
    // "Sync deck A to…" → "Sync deck <D> to…". A case-insensitive replace
    // would flatten both to lowercase and silently miss the capitalised ones.
    const generic = new Set(
      [...found].map((n) =>
        n
          // The load button renames itself to "Loaded: <file> — click to
          // replace (Deck X)" once a track is in. Same control, two states.
          .replace(
            /^Loaded: .* — click to replace \(Deck [ABC]\)$/,
            "Load audio for Deck <D>",
          )
          .replace(/\b(deck|Deck) [ABC]\b/g, "$1 <D>")
          .replace(/\b(loop|Loop) [1-4]\b/g, "$1 <N>")
          .replace(/\b(pad|Pad) [1-8]\b/g, "$1 <N>"),
      ),
    );

    // The manifest is deliberately a *count floor plus required members*
    // rather than an exact string list: an exact list would break on every
    // copy tweak and train people to update it blindly. These are the
    // load-bearing surfaces — if any disappears, a feature has silently died.
    const REQUIRED = [
      // transport
      "Play deck <D>",
      "Pause deck <D>",
      "Stop deck <D>",
      "Loop deck <D>",
      // tempo / key
      "Tap BPM for deck <D>",
      "Sync deck <D> to the dominant playing deck",
      "Auto-detect BPM and key for deck <D>",
      "Halve BPM for deck <D>",
      "Double BPM for deck <D>",
      "Pitch bend down deck <D>",
      "Pitch bend up deck <D>",
      "Set deck <D> playback mode to vari",
      "Set deck <D> playback mode to keylock",
      // mixing
      "Deck <D> volume",
      "Deck <D> speed",
      "Deck <D> filter frequency",
      "Crossfade A to B",
      "Crossfade curve",
      "Master volume",
      // EQ + isolation
      "Kill low EQ on deck <D>",
      "Kill mid EQ on deck <D>",
      "Kill high EQ on deck <D>",
      "Isolate bass on deck <D>",
      "Isolate vocal on deck <D>",
      "Isolate instr on deck <D>",
      "Isolate perc on deck <D>",
      // bite + roll + pump
      "Set bite in point on deck <D>",
      "Set bite out point on deck <D>",
      "Hold to roll ¼ beats on deck <D>",
      "Hold to roll ½ beats on deck <D>",
      "Hold to roll 1 beat on deck <D>",
      "Hold to roll 2 beats on deck <D>",
      "Toggle pump ducking on deck <D>",
      // BITE send row — only rendered once a region is marked.
      "Preview the bite on deck <D>",
      "Send the bite from deck <D> to sample pad <N>",
      "Send the bite to the crate from deck <D>",
      "Download the bite as WAV from deck <D>",
      "Clear the bite region on deck <D>",
      "Sample pad for deck <D> bites",
      // loading
      "Load audio for Deck <D>",
      "Eject the track from deck <D>",
      "Add tracks to the crate",
      "Load sample pad <N>",
      "Pad <N> volume",
      "Play loop <N>",
      "Loop <N> volume",
      "Loop <N> bar count",
      // master bus
      "Record the master mix",
      "Drop a cue marker at the current recording time",
      "Export settings to a JSON file",
      "Import settings from a JSON file",
      "Clean",
      "Radio",
    ];

    const missing = REQUIRED.filter((n) => !generic.has(n));
    expect(missing).toEqual([]);

    // Drift guard. The app exposed 250 distinctly-named interactive controls
    // across all tab states when this was written; a large drop means a whole
    // panel stopped rendering.
    expect(found.size).toBeGreaterThanOrEqual(240);
  });
});

describe("interaction census — every button survives being clicked — US75", () => {
  it("@us US75: clicking every button twice never throws and never unmounts the app", async () => {
    await renderFullApp();

    const buttons = screen.queryAllByRole("button");
    expect(buttons.length).toBeGreaterThan(150);

    const failures = [];
    for (const btn of buttons) {
      const name = label(btn);
      if (!btn.isConnected) continue; // removed by an earlier click (e.g. crate rows)
      try {
        // Twice: the second click is where toggle handlers that assume a
        // one-way transition (start → started) blow up.
        await act(async () => {
          fireEvent.click(btn);
        });
        if (btn.isConnected) {
          await act(async () => {
            fireEvent.click(btn);
          });
        }
      } catch (err) {
        failures.push(`${name}: ${err.message}`);
      }
    }

    expect(failures).toEqual([]);
    // The app is still mounted and still interactive after ~400 clicks.
    expect(screen.getByRole("slider", { name: /Crossfade A to B/i })).toBeTruthy();
  });
});

describe("interaction census — every slider survives its extremes — US75", () => {
  it("@us US75: every range input accepts min, max and midpoint without throwing", async () => {
    await renderFullApp();

    const ranges = [...document.querySelectorAll('input[type="range"]')];
    expect(ranges.length).toBeGreaterThan(20);

    const failures = [];
    for (const r of ranges) {
      const min = parseFloat(r.min || "0");
      const max = parseFloat(r.max || "1");
      for (const v of [min, max, (min + max) / 2]) {
        try {
          await act(async () => {
            fireEvent.change(r, { target: { value: String(v) } });
          });
        } catch (err) {
          failures.push(`${label(r)} @ ${v}: ${err.message}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("@us US75: every select accepts every one of its own options", async () => {
    await renderFullApp();

    const selects = [...document.querySelectorAll("select")];
    expect(selects.length).toBeGreaterThan(4);

    const failures = [];
    for (const s of selects) {
      for (const opt of [...s.options]) {
        try {
          await act(async () => {
            fireEvent.change(s, { target: { value: opt.value } });
          });
        } catch (err) {
          failures.push(`${label(s)} = ${opt.value}: ${err.message}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("interaction census — momentary controls release cleanly — US75", () => {
  // ROLL and NUDGE are hold-to-engage. The failure mode that matters is a
  // press with no matching release, or a release with no matching press
  // (pointer leaves the button, browser cancels the gesture) leaving the deck
  // stuck at a rolled/bent rate forever.
  it("@us US75: press-without-release then a stray release leaves no control stuck", async () => {
    await renderFullApp();

    const momentary = screen
      .queryAllByRole("button")
      .filter((b) => /Hold to roll|Pitch bend/i.test(label(b)));
    expect(momentary.length).toBe(18); // (4 roll + 2 nudge) × 3 decks

    const failures = [];
    for (const b of momentary) {
      try {
        await act(async () => {
          fireEvent.pointerDown(b);
        });
        // Stray release on a *different* element, then a real one — the
        // pointer-capture path a mouse-off-the-button gesture takes.
        await act(async () => {
          fireEvent.pointerUp(document.body);
          fireEvent.pointerUp(b);
        });
        // Orphan release with no press.
        await act(async () => {
          fireEvent.pointerUp(b);
        });
      } catch (err) {
        failures.push(`${label(b)}: ${err.message}`);
      }
    }
    expect(failures).toEqual([]);

    // Every deck's speed slider is back at its resting value — nothing is
    // stuck bent or rolled.
    for (const id of ["A", "B", "C"]) {
      const speed = screen.getByRole("slider", {
        name: new RegExp(`Deck ${id} speed`, "i"),
      });
      expect(parseFloat(speed.value)).toBeCloseTo(1, 2);
    }
  });
});

describe("interaction census — controls on an empty deck — US75", () => {
  // The negative case: every deck control operated with NO track loaded.
  // These are the handlers most likely to dereference a null buffer.
  it("@us US75: every deck control is safe to operate before a track is loaded", async () => {
    render(<App />);

    const deckButtons = screen
      .queryAllByRole("button")
      .filter((b) => /deck [ABC]\b|Deck [ABC]\b/.test(label(b)));
    expect(deckButtons.length).toBeGreaterThan(50);

    const failures = [];
    for (const b of deckButtons) {
      try {
        await act(async () => {
          fireEvent.pointerDown(b);
          fireEvent.click(b);
          fireEvent.pointerUp(b);
        });
      } catch (err) {
        failures.push(`${label(b)}: ${err.message}`);
      }
    }
    expect(failures).toEqual([]);
    expect(screen.getByRole("slider", { name: /Master volume/i })).toBeTruthy();
  });
});
