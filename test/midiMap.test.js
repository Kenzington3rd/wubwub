import { describe, it, expect, vi, afterEach } from "vitest";
import {
  enableMidi,
  mapCcToValue,
  applyRelative,
  decodeRelative2c,
  decodeSignedMag,
  MIDI_TARGETS,
  MIDI_MODES,
  MIDI_SUPPORTED,
} from "../src/midi/midiMap.js";

// A minimal fake MIDI input that records its `midimessage` listeners so a test
// can fire a message and count how many handlers respond.
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
    // test helper: deliver a Note On message to every bound handler
    emitNoteOn: (channel, note, velocity) => {
      const ev = { data: [0x90 | channel, note, velocity] };
      listeners.forEach((fn) => fn(ev));
    },
    // test helper: deliver a Note Off message to every bound handler
    emitNoteOff: (channel, note) => {
      const ev = { data: [0x80 | channel, note, 0] };
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

describe("MIDI_MODES — US39 (C3 mode selector)", () => {
  it("@us US39: includes absolute, relative2c, signedMag", () => {
    expect(MIDI_MODES).toEqual(
      expect.arrayContaining(["absolute", "relative2c", "signedMag"])
    );
  });
});

describe("enableMidi — US39, US52", () => {
  afterEach(() => {
    delete navigator.requestMIDIAccess;
    vi.restoreAllMocks();
  });

  it("@us US39: subscribes existing inputs and forwards CC messages with inputId + name", async () => {
    const input = makeFakeInput("in-1", "Launch Control");
    const access = makeFakeAccess([input]);
    navigator.requestMIDIAccess = vi.fn().mockResolvedValue(access);
    const onMidi = vi.fn();

    const unsub = await enableMidi(onMidi);
    input.emitCc(0, 7, 64);

    expect(onMidi).toHaveBeenCalledTimes(1);
    expect(onMidi).toHaveBeenCalledWith(
      { kind: "cc", channel: 0, cc: 7, value: 64 },
      "in-1",
      "Launch Control"
    );
    unsub();
  });

  it("@us US39: unplug→replug does not double-bind the message handler", async () => {
    const input = makeFakeInput("in-1", "Launch Control");
    const access = makeFakeAccess([input]);
    navigator.requestMIDIAccess = vi.fn().mockResolvedValue(access);
    const onMidi = vi.fn();

    const unsub = await enableMidi(onMidi);
    // Simulate the device dropping off and coming back.
    access.fireStateChange({ ...input, type: "input", state: "disconnected" });
    access.fireStateChange({ ...input, type: "input", state: "connected" });

    expect(input.listenerCount()).toBe(1);
    input.emitCc(1, 10, 100);
    // Exactly one delivery — not two.
    expect(onMidi).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("@us US39: the returned unsubscribe removes all handlers", async () => {
    const input = makeFakeInput("in-1", "Launch Control");
    const access = makeFakeAccess([input]);
    navigator.requestMIDIAccess = vi.fn().mockResolvedValue(access);
    const onMidi = vi.fn();

    const unsub = await enableMidi(onMidi);
    unsub();
    input.emitCc(0, 7, 64);

    expect(input.listenerCount()).toBe(0);
    expect(onMidi).not.toHaveBeenCalled();
  });

  it("@us US39: short messages and unrecognised statuses are ignored", async () => {
    const input = makeFakeInput("in-1", "Pad");
    const access = makeFakeAccess([input]);
    navigator.requestMIDIAccess = vi.fn().mockResolvedValue(access);
    const onMidi = vi.fn();

    const unsub = await enableMidi(onMidi);
    input.emitRaw([0xb0, 7]); // CC but too short (< 3 bytes)
    input.emitRaw([0xc0, 12]); // Program change — not recognised
    input.emitRaw([0xe0, 0, 64]); // Pitch bend — not recognised
    expect(onMidi).not.toHaveBeenCalled();

    input.emitRaw([0xb2, 7, 99]); // a valid CC on channel 2
    expect(onMidi).toHaveBeenCalledTimes(1);
    expect(onMidi).toHaveBeenCalledWith(
      { kind: "cc", channel: 2, cc: 7, value: 99 },
      "in-1",
      "Pad"
    );
    unsub();
  });

  // C1 regression: two inputs both emitting on the same (channel, cc) must
  // each surface as a distinct event with its own inputId — otherwise two
  // controllers can't be mapped to different targets on the same CC.
  it("@us US39 (bug C1): two inputs sharing channel/cc emit independent onMidi calls with distinct inputIds", async () => {
    const a = makeFakeInput("in-a", "DDJ-FLX4");
    const b = makeFakeInput("in-b", "Launch Control");
    const access = makeFakeAccess([a, b]);
    navigator.requestMIDIAccess = vi.fn().mockResolvedValue(access);
    const onMidi = vi.fn();

    const unsub = await enableMidi(onMidi);
    // Both fire the same channel/cc.
    a.emitCc(0, 7, 64);
    b.emitCc(0, 7, 96);

    expect(onMidi).toHaveBeenCalledTimes(2);
    const calls = onMidi.mock.calls;
    // Each call carries its own inputId; the two inputIds are distinct.
    expect(calls[0][1]).toBe("in-a");
    expect(calls[0][2]).toBe("DDJ-FLX4");
    expect(calls[1][1]).toBe("in-b");
    expect(calls[1][2]).toBe("Launch Control");
    expect(calls[0][1]).not.toBe(calls[1][1]);
    unsub();
  });

  // C2 regression: Note On / Note Off used to be silently dropped because the
  // handler filtered to status & 0xf0 === 0xb0. They must now arrive as
  // kind:"noteon" / kind:"noteoff" messages.
  it("@us US39 (bug C2): Note On is parsed and forwarded with kind 'noteon'", async () => {
    const input = makeFakeInput("in-1", "Pad");
    const access = makeFakeAccess([input]);
    navigator.requestMIDIAccess = vi.fn().mockResolvedValue(access);
    const onMidi = vi.fn();

    const unsub = await enableMidi(onMidi);
    input.emitNoteOn(0, 36, 100);

    expect(onMidi).toHaveBeenCalledTimes(1);
    expect(onMidi).toHaveBeenCalledWith(
      { kind: "noteon", channel: 0, note: 36, velocity: 100 },
      "in-1",
      "Pad"
    );
    unsub();
  });

  it("@us US39 (bug C2): Note Off is parsed and forwarded with kind 'noteoff'", async () => {
    const input = makeFakeInput("in-1", "Pad");
    const access = makeFakeAccess([input]);
    navigator.requestMIDIAccess = vi.fn().mockResolvedValue(access);
    const onMidi = vi.fn();

    const unsub = await enableMidi(onMidi);
    input.emitNoteOff(0, 36);

    expect(onMidi).toHaveBeenCalledTimes(1);
    expect(onMidi).toHaveBeenCalledWith(
      { kind: "noteoff", channel: 0, note: 36 },
      "in-1",
      "Pad"
    );
    unsub();
  });

  it("@us US39 (bug C2): Note On with velocity 0 normalises to noteoff (MIDI-spec quirk)", async () => {
    const input = makeFakeInput("in-1", "Pad");
    const access = makeFakeAccess([input]);
    navigator.requestMIDIAccess = vi.fn().mockResolvedValue(access);
    const onMidi = vi.fn();

    const unsub = await enableMidi(onMidi);
    input.emitNoteOn(0, 36, 0);

    expect(onMidi).toHaveBeenCalledTimes(1);
    expect(onMidi).toHaveBeenCalledWith(
      { kind: "noteoff", channel: 0, note: 36 },
      "in-1",
      "Pad"
    );
    unsub();
  });
});

// C3 — relative encoder decoders. Two encodings cover the vast majority of
// DJ-controller jog wheels: two's-complement-signed-7 (the most common, used
// by DDJ / Mixtrack), and signed-magnitude (Pioneer's legacy encoding).
describe("decodeRelative2c — US39 (bug C3)", () => {
  it("@us US39: 0x40 (64) is zero — encoder at rest", () => {
    expect(decodeRelative2c(0x40)).toBe(0);
  });

  it("@us US39: 0x41 is +1 (one tick forward)", () => {
    expect(decodeRelative2c(0x41)).toBe(1);
  });

  it("@us US39: 0x3F is -1 (one tick back)", () => {
    expect(decodeRelative2c(0x3f)).toBe(-1);
  });

  it("@us US39: 0x7F is +63 (max forward in one message)", () => {
    expect(decodeRelative2c(0x7f)).toBe(63);
  });

  it("@us US39: 0x00 is -64 (max back in one message)", () => {
    expect(decodeRelative2c(0x00)).toBe(-64);
  });
});

describe("decodeSignedMag — US39 (bug C3)", () => {
  it("@us US39: 0x40 (high-bit only, magnitude 0) is +0", () => {
    expect(decodeSignedMag(0x40)).toBe(0);
  });

  it("@us US39: 0x00 has zero magnitude (acts as 0 for delta math)", () => {
    // -0 and +0 are mathematically equivalent for delta accumulation; assert
    // the magnitude is zero rather than caring about IEEE-754 sign.
    expect(Math.abs(decodeSignedMag(0x00))).toBe(0);
  });

  it("@us US39: 0x41 is +1 (direction set, magnitude 1)", () => {
    expect(decodeSignedMag(0x41)).toBe(1);
  });

  it("@us US39: 0x01 is -1 (direction unset, magnitude 1)", () => {
    expect(decodeSignedMag(0x01)).toBe(-1);
  });

  it("@us US39: 0x7F is +63 (direction set, max magnitude)", () => {
    expect(decodeSignedMag(0x7f)).toBe(63);
  });

  it("@us US39: 0x3F is -63 (direction unset, max magnitude)", () => {
    expect(decodeSignedMag(0x3f)).toBe(-63);
  });
});

describe("applyRelative — US39 (bug C3)", () => {
  it("@us US39: a +1 tick on a [0,1] target advances by 1/127", () => {
    expect(applyRelative(0.5, 1, "crossfade")).toBeCloseTo(0.5 + 1 / 127, 5);
  });

  it("@us US39: a -1 tick on a [0,1] target retreats by 1/127", () => {
    expect(applyRelative(0.5, -1, "crossfade")).toBeCloseTo(0.5 - 1 / 127, 5);
  });

  it("@us US39: clamps to the upper edge of the natural domain", () => {
    expect(applyRelative(0.99, 64, "crossfade")).toBe(1);
  });

  it("@us US39: clamps to the lower edge of the natural domain", () => {
    expect(applyRelative(0.01, -64, "crossfade")).toBe(0);
  });

  it("@us US39: respects the filterFreq 60–20000 span", () => {
    // A +1 tick scales by (20000-60)/127 ≈ 157 Hz.
    expect(applyRelative(10000, 1, "deckA.filterFreq")).toBeCloseTo(
      10000 + (20000 - 60) / 127,
      3
    );
  });
});
