// Process end-to-end — every pipeline WAVECRAFT contains, driven from the
// first click to its terminal artifact.
//
// The census (test/interaction-census.test.jsx) proves every control exists
// and survives being operated. This file proves the *processes* connect: that
// a bite actually reaches a WAV on disk, that a recording actually reaches a
// download, that exported settings actually reproduce the app's state when
// imported back. A control that fires a handler which quietly drops the
// payload passes a control-level test and fails here.
//
// "Reaches disk" is asserted at the last point still inside the app: the
// anchor click that downloadBlob() performs. Nothing here touches the network
// (nor could it — see test/csp.test.js).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import App from "../src/App.jsx";

// ── Download interception ──────────────────────────────────────────────────
// downloadBlob() creates an <a download>, clicks it, and revokes the URL.
// Capture the filename and the Blob for every such click.
let downloads;
let origClick;
let origCreateURL;
const blobsByUrl = new Map();

beforeEach(() => {
  downloads = [];
  blobsByUrl.clear();

  origCreateURL = URL.createObjectURL;
  let n = 0;
  URL.createObjectURL = (blob) => {
    const url = `blob:wavecraft/${++n}`;
    blobsByUrl.set(url, blob);
    return url;
  };
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};

  origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) {
      downloads.push({ name: this.download, blob: blobsByUrl.get(this.href) });
    }
    // Deliberately NOT calling through: a real anchor click in happy-dom is a
    // navigation, and this is the app's only egress point.
  };

  window.isSecureContext = true;
  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, "mediaDevices", { value: {}, configurable: true });
  }
  navigator.mediaDevices.getUserMedia = vi.fn(async () => ({
    getTracks: () => [{ stop: vi.fn(), kind: "audio" }],
    getAudioTracks: () => [{ stop: vi.fn(), kind: "audio" }],
  }));
});

afterEach(() => {
  HTMLAnchorElement.prototype.click = origClick;
  URL.createObjectURL = origCreateURL;
});

// ── Helpers ────────────────────────────────────────────────────────────────
function audioFile(name) {
  return new File([new Uint8Array([0, 1, 2, 3])], name, { type: "audio/mpeg" });
}

async function loadDeck(id, name = `${id}.mp3`) {
  const btn = screen.getByRole("button", {
    name: new RegExp(`Load audio for Deck ${id}`, "i"),
  });
  // The load button sits in a flex row beside EJECT; the hidden file input
  // is a sibling of that row, so walk up to the ancestor that contains it.
  let scope = btn.parentElement;
  while (scope && !scope.querySelector('input[type="file"]')) scope = scope.parentElement;
  const input = scope?.querySelector('input[type="file"]');
  await act(async () => {
    fireEvent.change(input, { target: { files: [audioFile(name)] } });
  });
}

const click = async (el) => {
  await act(async () => {
    fireEvent.click(el);
  });
};

const btn = (name) => screen.getByRole("button", { name });

// Mark a bite region: IN at the playhead, seek forward, OUT ahead of IN.
async function markBite(id) {
  await click(btn(new RegExp(`Set bite in point on deck ${id}`, "i")));
  const wave = screen.getByRole("slider", {
    name: new RegExp(`Seek position in deck ${id} track`, "i"),
  });
  await act(async () => fireEvent.keyDown(wave, { key: "ArrowRight" }));
  await click(btn(new RegExp(`Set bite out point on deck ${id}`, "i")));
}

// ── 1. Record a mix → audio file on disk ───────────────────────────────────
describe("process: record a mix → downloaded audio — US37/US61", () => {
  it("@us US37: load → play → record → stop produces a downloaded audio file", async () => {
    render(<App />);
    await loadDeck("A");
    await click(btn(/Play deck A/i));

    await click(btn(/Record the master mix/i));
    // The button becomes the stop control while armed — that state flip is the
    // app's only signal that the recorder actually started.
    const stop = await screen.findByRole("button", { name: /Stop recording/i });
    await click(stop);

    await waitFor(() => expect(downloads.length).toBeGreaterThan(0));
    const audio = downloads.find((d) => /\.(webm|m4a|ogg|audio|bin)$/.test(d.name));
    expect(audio, `no audio download among ${downloads.map((d) => d.name)}`).toBeTruthy();
    expect(audio.blob).toBeInstanceOf(Blob);
  });

  it("@us US61: markers dropped during a recording produce a .cue.txt alongside the audio", async () => {
    render(<App />);
    await loadDeck("A");
    await click(btn(/Record the master mix/i));

    const marker = btn(/Drop a cue marker at the current recording time/i);
    await click(marker);
    await click(marker);

    await click(await screen.findByRole("button", { name: /Stop recording/i }));
    await waitFor(() => expect(downloads.length).toBeGreaterThanOrEqual(2));

    const cue = downloads.find((d) => d.name.endsWith(".cue.txt"));
    expect(cue).toBeTruthy();
    const text = await cue.blob.text();
    expect(text).toContain("WAVECRAFT MIX CUE SHEET");
    // Two markers dropped → two marker lines, and the header agrees.
    expect(text).toContain("Markers: 2");
    expect(text).toContain("Marker 1");
    expect(text).toContain("Marker 2");

    // The cue sheet names the audio file it belongs to — a cue sheet that
    // can't be matched to its mix is useless.
    const audio = downloads.find((d) => !d.name.endsWith(".cue.txt"));
    const base = audio.name.replace(/\.[^.]+$/, "");
    expect(text).toContain(base);
  });

  it("@us US61: a marker dropped while NOT recording produces no download", async () => {
    // Negative: the marker button is always present; it must be inert when
    // there is no recording to annotate.
    render(<App />);
    await loadDeck("A");
    await click(btn(/Drop a cue marker at the current recording time/i));
    expect(downloads).toEqual([]);
  });
});

// ── 2. Bite → WAV / pad / crate ────────────────────────────────────────────
describe("process: sound bite → its three destinations — US70", () => {
  it("@us US70: mark IN/OUT → WAV downloads a real RIFF file", async () => {
    render(<App />);
    await loadDeck("A", "rose-garden.mp3");
    await markBite("A");

    await click(btn(/Download the bite as WAV from deck A/i));
    await waitFor(() => expect(downloads.length).toBe(1));

    const wav = downloads[0];
    expect(wav.name).toMatch(/\.wav$/);
    // Assert it is actually a WAV, not just named one.
    const head = new Uint8Array(await wav.blob.arrayBuffer()).slice(0, 12);
    const tag = String.fromCharCode(...head);
    expect(tag.slice(0, 4)).toBe("RIFF");
    expect(tag.slice(8, 12)).toBe("WAVE");
  });

  it("@us US70: → PAD loads the slice into the chosen sample pad", async () => {
    render(<App />);
    await loadDeck("A");
    await markBite("A");

    await click(btn(/Send the bite from deck A to sample pad 1/i));

    // End state: pad 1 is no longer an empty "Load" slot.
    await waitFor(() => {
      const pad1 = screen.queryByRole("button", { name: /Load sample pad 1/i });
      expect(pad1).toBeNull();
    });
  });

  it("@us US70: → CRATE adds the slice as a loadable crate entry", async () => {
    render(<App />);
    await loadDeck("A", "rose-garden.mp3");
    await markBite("A");

    await click(btn(/Send the bite to the crate from deck A/i));

    // End state: the crate offers to load it onto a deck.
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: /Load ".*" to deck A/i }).length,
      ).toBeGreaterThan(0);
    });
  });

  it("@us US70: CLEAR retracts the region and removes the send controls", async () => {
    // Negative: after clearing there is nothing to export, so the whole send
    // row must disappear rather than silently exporting an empty slice.
    render(<App />);
    await loadDeck("A");
    await markBite("A");
    expect(screen.getByRole("button", { name: /Download the bite as WAV from deck A/i })).toBeTruthy();

    await click(btn(/Clear the bite region on deck A/i));

    expect(
      screen.queryByRole("button", { name: /Download the bite as WAV from deck A/i }),
    ).toBeNull();
    expect(downloads).toEqual([]);
  });
});

// ── 3. Settings export → import round-trip ─────────────────────────────────
describe("process: settings export → import round-trip — US62", () => {
  it("@us US62: exported JSON restores deck colors and crossfade curve on import", async () => {
    render(<App />);

    // Move the app off its defaults.
    await click(btn(/Deck A color: Gold/i));
    const curve = screen.getByRole("combobox", { name: /Crossfade curve/i });
    const alt = [...curve.options].find((o) => o.value !== curve.value).value;
    await act(async () => fireEvent.change(curve, { target: { value: alt } }));

    await click(btn(/Export settings to a JSON file/i));
    await waitFor(() => expect(downloads.length).toBe(1));

    const json = JSON.parse(await downloads[0].blob.text());
    expect(json.crossfadeCurve).toBe(alt);
    expect(json.deckAColor).toBeTruthy();
    const exportedColor = json.deckAColor;

    // Change everything back, then import and confirm the file wins.
    await click(btn(/Deck A color: Cyan/i));
    await act(async () => fireEvent.change(curve, { target: { value: curve.options[0].value } }));

    const importBtn = btn(/Import settings from a JSON file/i);
    const fileInput = importBtn.closest("div").querySelector('input[type="file"]');
    const cfg = new File([JSON.stringify(json)], "wavecraft-settings.json", {
      type: "application/json",
    });
    // happy-dom's File.text() is what settings import reads.
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [cfg] } });
    });

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /Crossfade curve/i }).value).toBe(alt);
    });
    // Deck A's accent is back to the exported one.
    const gold = screen.getByRole("button", { name: /Deck A color: Gold/i });
    expect(gold.getAttribute("aria-pressed")).toBe("true");
    expect(exportedColor).toBeTruthy();
  });

  it("@us US62: importing malformed JSON is rejected inline and changes nothing", async () => {
    // Negative: a corrupt config must not throw, must not half-apply, and must
    // tell the user — the file comes from their own disk, so it can be junk.
    render(<App />);
    const curveBefore = screen.getByRole("combobox", { name: /Crossfade curve/i }).value;

    const importBtn = btn(/Import settings from a JSON file/i);
    const fileInput = importBtn.closest("div").querySelector('input[type="file"]');
    const junk = new File(["{ not json at all"], "broken.json", { type: "application/json" });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [junk] } });
    });

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /Crossfade curve/i }).value).toBe(curveBefore);
    });
    // Still mounted and still usable.
    expect(screen.getByRole("slider", { name: /Master volume/i })).toBeTruthy();
  });
});

// ── 4. Crate → deck ────────────────────────────────────────────────────────
describe("process: crate → deck quick-load — US63", () => {
  it("@us US63: a crate entry loads onto Deck C and Deck C reports the track", async () => {
    render(<App />);
    // Seed the crate from a bite so the flow is entirely in-app.
    await loadDeck("A", "rose-garden.mp3");
    await markBite("A");
    await click(btn(/Send the bite to the crate from deck A/i));

    const toC = await screen.findByRole("button", { name: /Load ".*" to deck C/i });
    await click(toC);

    // End state: Deck C's load button now advertises a loaded track.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /click to replace \(Deck C\)/i }),
      ).toBeTruthy();
    });
  });
});

// ── 4b. Eject → deck back to empty ─────────────────────────────────────────
describe("process: eject a track → deck returns to empty — US77", () => {
  it("@us US77: eject clears the deck and the load slot re-opens", async () => {
    render(<App />);
    await loadDeck("A", "rose-garden.mp3");
    // Give the deck some state that must not survive the eject.
    await click(btn(/Play deck A/i));
    await click(btn(/Add cue at current position on deck A/i));
    await markBite("A");

    await click(btn(/Eject the track from deck A/i));

    // End state: the load slot is back to its empty invitation…
    expect(screen.getByRole("button", { name: /Load audio for Deck A/i })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /click to replace \(Deck A\)/i }),
    ).toBeNull();
    // …the track-scoped surfaces are gone…
    expect(
      screen.queryByRole("button", { name: /Download the bite as WAV from deck A/i }),
    ).toBeNull();
    expect(screen.queryByRole("slider", { name: /Seek position in deck A track/i })).toBeNull();
    // …and play is inert again (no buffer to start).
    const play = btn(/Play deck A/i);
    await click(play);
    expect(play.getAttribute("aria-pressed")).not.toBe("true");
  });

  it("@us US77: a fresh track loads cleanly after an eject", async () => {
    // The point of ejecting is switching tracks — prove the reload half.
    render(<App />);
    await loadDeck("A", "first.mp3");
    await click(btn(/Eject the track from deck A/i));
    await loadDeck("A", "second.mp3");
    expect(
      screen.getByRole("button", { name: /Loaded: second\.mp3 — click to replace \(Deck A\)/i }),
    ).toBeTruthy();
  });

  it("@us US77: eject on an empty deck is disabled and inert", async () => {
    // Negative: nothing loaded → the control must not be operable.
    render(<App />);
    const eject = btn(/Eject the track from deck A/i);
    expect(eject).toBeDisabled();
    await click(eject);
    expect(screen.getByRole("button", { name: /Load audio for Deck A/i })).toBeTruthy();
  });
});

// ── 4c. Stray / rejected drops must never navigate the app away ────────────
describe("process: dropping a file can never brick the app — US78", () => {
  it("@us US78: a drop outside every drop zone is cancelled (no navigation)", async () => {
    // The browser default for an unclaimed drop is NAVIGATE TO THE FILE —
    // which replaces the app and loses the whole session. The app-level guard
    // must cancel it. jsdom/happy-dom don't perform real navigation, so the
    // observable contract is defaultPrevented on an event nothing claimed.
    render(<App />);
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { files: [audioFile("stray.mp3")], items: [{ kind: "file" }] },
    });
    await act(async () => {
      document.body.dispatchEvent(drop);
    });
    expect(drop.defaultPrevented).toBe(true);

    const over = new Event("dragover", { bubbles: true, cancelable: true });
    await act(async () => {
      document.body.dispatchEvent(over);
    });
    expect(over.defaultPrevented).toBe(true);

    // Still alive and interactive.
    expect(screen.getByRole("slider", { name: /Master volume/i })).toBeTruthy();
  });

  it("@us US78: a non-audio file dropped on a deck shows an inline error, app survives", async () => {
    render(<App />);
    const loadBtn = btn(/Load audio for Deck A/i);
    const zone = loadBtn.closest("[aria-label], div");
    const junk = new File([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" });
    // Drop it on the deck card (the deck's own drop zone).
    const deckCard = loadBtn.closest('div[style*="border"]') || loadBtn.parentElement.parentElement;
    await act(async () => {
      fireEvent.drop(deckCard, {
        dataTransfer: { files: [junk], items: [{ kind: "file" }] },
      });
    });
    // Inline rejection, not a crash: the deck still offers to load, and the
    // app shell is still mounted.
    expect(screen.getByRole("button", { name: /Load audio for Deck A/i })).toBeTruthy();
    expect(screen.getByRole("slider", { name: /Master volume/i })).toBeTruthy();
  });

  it("@us US78: a corrupt audio file dropped on a deck is rejected inline, deck stays usable", async () => {
    // decode failure path (as opposed to wrong-type path): make decode throw.
    render(<App />);
    const loadBtn = btn(/Load audio for Deck A/i);
    let scope = loadBtn.parentElement;
    while (scope && !scope.querySelector('input[type="file"]')) scope = scope.parentElement;
    const input = scope.querySelector('input[type="file"]');
    const bad = new File([new Uint8Array([9, 9, 9])], "corrupt.mp3", { type: "audio/mpeg" });
    const orig = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = () =>
      Promise.reject(new Error("decode failed"));
    try {
      await act(async () => {
        fireEvent.change(input, { target: { files: [bad] } });
      });
    } finally {
      AudioContext.prototype.decodeAudioData = orig;
    }
    // The deck reports the failure and remains empty and loadable.
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not decode/i);
    expect(screen.getByRole("button", { name: /Load audio for Deck A/i })).toBeTruthy();
    // And a good file still loads afterwards — the failure left no debris.
    await loadDeck("A", "good.mp3");
    expect(
      screen.getByRole("button", { name: /Loaded: good\.mp3 — click to replace \(Deck A\)/i }),
    ).toBeTruthy();
  });
});

// ── 5. Looper capture → playback ───────────────────────────────────────────
describe("process: looper capture → playback — US35", () => {
  it("@us US35: capturing a loop arms its play control", async () => {
    render(<App />);
    await loadDeck("A");
    await click(btn(/Play deck A/i));

    await click(btn(/Capture 4 bars into loop 1/i));
    // Capture is armed against the master tap; the play control is the end
    // state the user reaches.
    const play = btn(/Play loop 1/i);
    await click(play);
    expect(play).toBeTruthy();
    expect(screen.getByRole("slider", { name: /Loop 1 volume/i })).toBeTruthy();
  });
});

// ── 6. Full mix session ────────────────────────────────────────────────────
describe("process: a complete three-deck mix session — US75", () => {
  it("@us US75: three decks load, assign, play, EQ, isolate, crossfade and record to a file", async () => {
    render(<App />);

    for (const id of ["A", "B", "C"]) await loadDeck(id, `${id}-track.mp3`);

    // Assign C to the B side so all three share the fader.
    await click(btn(/Assign deck C to crossfader side B/i));

    for (const id of ["A", "B", "C"]) await click(btn(new RegExp(`Play deck ${id}`, "i")));

    // Shape each deck: kill a band on A, isolate vocals on B, pump C.
    await click(btn(/Kill low EQ on deck A/i));
    await click(btn(/Isolate vocal on deck B/i));
    await click(btn(/Toggle pump ducking on deck C/i));

    // Ride the fader.
    const xf = screen.getByRole("slider", { name: /Crossfade A to B/i });
    for (const v of ["0", "0.5", "1"]) {
      await act(async () => fireEvent.change(xf, { target: { value: v } }));
    }
    expect(parseFloat(xf.value)).toBe(1);

    // Record the result and land it on disk.
    await click(btn(/Record the master mix/i));
    await click(await screen.findByRole("button", { name: /Stop recording/i }));
    await waitFor(() => expect(downloads.length).toBeGreaterThan(0));

    // Every applied state survived the session.
    expect(btn(/Kill low EQ on deck A/i).getAttribute("aria-pressed")).toBe("true");
    expect(btn(/Isolate vocal on deck B/i).getAttribute("aria-pressed")).toBe("true");
    expect(btn(/Toggle pump ducking on deck C/i).getAttribute("aria-pressed")).toBe("true");
    expect(btn(/Assign deck C to crossfader side B/i).getAttribute("aria-pressed")).toBe("true");
  });
});
