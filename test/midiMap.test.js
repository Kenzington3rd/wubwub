import { describe, it, expect } from "vitest";
import {
  mapCcToValue,
  MIDI_TARGETS,
  MIDI_SUPPORTED,
} from "../src/midi/midiMap.js";

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
