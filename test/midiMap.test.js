import { describe, it, expect, vi, afterEach } from "vitest";
import {
  enableMidi,
  mapCcToValue,
  MIDI_TARGETS,
  MIDI_SUPPORTED,
} from "../src/midi/midiMap.js";

// A minimal fake MIDI input that records its `midimessage` listeners so a test
// can fire a CC and count how many handlers respond.
function makeFakeInput(id, name) {
  const listeners = new Set();
  return {
    id,
    name,
    addEventListener: (type, fn) => type === "midimessage" && listeners.add(fn),
    removeEventListener: (type, fn) =>
      type === "midimessage" && listeners.delete(fn),
    // test helper: deliver a CC message to every bound handler
    emitCc: (channel, cc, value) => {
      const ev = { data: [0xb0 | channel, cc, value] };
      listeners.forEach((fn) => fn(ev));
    },
    // test helper: deliver a raw MIDI message (any status byte)
    emitRaw: (data) => {
      const ev = { data };
      listeners.forEach((fn) => fn(ev));
    },
    listenerCount: () => listeners.size,
  };
}

function makeFakeAccess(inputs) {
  const inputMap = new Map(inputs.map((i) => [i.id, i]));
  const stateListeners = new Set();
  return {
    inputs: inputMap,
    addEventListener: (t, fn) => t === "statechange" && stateListeners.add(fn),
    removeEventListener: (t, fn) =>
      t === "statechange" && stateListeners.delete(fn),
    // test helper: simulate a device connect/disconnect
    fireStateChange: (port) =>
      stateListeners.forEach((fn) => fn({ port })),
  };
}

describe("mapCcToValue — US39, US52", () => {
  it("@us US52: CC=0 maps to the bottom of the target's domain", () => {
    expect(mapCcToValue(0, "crossfade")).toBe(0);
    expect(mapCcToValue(0, "masterVol")).toBe(0);
    expect(mapCcToValue(0, "deckA.volume")).toBe(0);
  });

  it("@us US52: CC=127 maps to the top of the target's domain", () => {
    expect(mapCcToValue(127, "crossfade")).toBeCloseTo(1, 5);
    expect(mapCcToValue(127, "masterVol")).toBeCloseTo(1, 5);
  });

  it("@us US52: deckA.filterFreq maps the full 60–20000 Hz range", () => {
    expect(mapCcToValue(0, "deckA.filterFreq")).toBeCloseTo(60, 0);
    expect(mapCcToValue(127, "deckA.filterFreq")).toBeCloseTo(20000, 0);
  });

  it("@us US52: deckB.speed maps the full 0.5x–2.0x range", () => {
    expect(mapCcToValue(0, "deckB.speed")).toBeCloseTo(0.5, 4);
    expect(mapCcToValue(127, "deckB.speed")).toBeCloseTo(2.0, 4);
  });

  it("@us US52: out-of-range CC values are clamped", () => {
    expect(mapCcToValue(-50, "crossfade")).toBe(0);
    expect(mapCcToValue(999, "crossfade")).toBe(1);
  });
});

describe("MIDI_TARGETS — US39", () => {
  it("@us US39: 8 mappable targets (crossfade, master, per-deck vol/filter/speed)", () => {
    const ids = MIDI_TARGETS.map((t) => t.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "crossfade",
        "masterVol",
        "deckA.volume",
        "deckA.filterFreq",
        "deckA.speed",
        "deckB.volume",
        "deckB.filterFreq",
        "deckB.speed",
      ])
    );
  });

  it("@us US39: every target has both id and label", () => {
    for (const t of MIDI_TARGETS) {
      expect(typeof t.id).toBe("string");
      expect(typeof t.label).toBe("string");
    }
  });
});

describe("MIDI_SUPPORTED — US39", () => {
  it("@us US39: feature detection is a boolean", () => {
    expect(typeof MIDI_SUPPORTED).toBe("boolean");
  });
});

describe("enableMidi — US39, US52", () => {
  afterEach(() => {
    delete navigator.requestMIDIAccess;
    vi.restoreAllMocks();
  });

  it("@us US39: subscribes existing inputs and forwards CC messages", async () => {
    const input = makeFakeInput("in-1", "Launch Control");
    const access = makeFakeAccess([input]);
    navigator.requestMIDIAccess = vi.fn().mockResolvedValue(access);
    const onCc = vi.fn();

    const unsub = await enableMidi(onCc);
    input.emitCc(0, 7, 64);

    expect(onCc).toHaveBeenCalledTimes(1);
    expect(onCc).toHaveBeenCalledWith(0, 7, 64, "Launch Control");
    unsub();
  });

  it("@us US39: unplug→replug does not double-bind the message handler", async () => {
    const input = makeFakeInput("in-1", "Launch Control");
    const access = makeFakeAccess([input]);
    navigator.requestMIDIAccess = vi.fn().mockResolvedValue(access);
    const onCc = vi.fn();

    const unsub = await enableMidi(onCc);
    // Simulate the device dropping off and coming back.
    access.fireStateChange({ ...input, type: "input", state: "disconnected" });
    access.fireStateChange({ ...input, type: "input", state: "connected" });

    expect(input.listenerCount()).toBe(1);
    input.emitCc(1, 10, 100);
    // Exactly one delivery — not two.
    expect(onCc).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("@us US39: the returned unsubscribe removes all handlers", async () => {
    const input = makeFakeInput("in-1", "Launch Control");
    const access = makeFakeAccess([input]);
    navigator.requestMIDIAccess = vi.fn().mockResolvedValue(access);
    const onCc = vi.fn();

    const unsub = await enableMidi(onCc);
    unsub();
    input.emitCc(0, 7, 64);

    expect(input.listenerCount()).toBe(0);
    expect(onCc).not.toHaveBeenCalled();
  });

  it("@us US39: non-CC status bytes and short messages are ignored", async () => {
    const input = makeFakeInput("in-1", "Pad");
    const access = makeFakeAccess([input]);
    navigator.requestMIDIAccess = vi.fn().mockResolvedValue(access);
    const onCc = vi.fn();

    const unsub = await enableMidi(onCc);
    input.emitRaw([0x90, 60, 100]); // Note On — not a CC
    input.emitRaw([0xb0, 7]); // CC but too short (< 3 bytes)
    expect(onCc).not.toHaveBeenCalled();

    input.emitRaw([0xb2, 7, 99]); // a valid CC on channel 2
    expect(onCc).toHaveBeenCalledTimes(1);
    expect(onCc).toHaveBeenCalledWith(2, 7, 99, "Pad");
    unsub();
  });
});
