import { describe, it, expect } from "vitest";
import {
  buildSettings,
  serializeSettings,
  parseSettings,
  SETTINGS_APP,
  SETTINGS_VERSION,
} from "../src/settings.js";

const FULL_CONFIG = {
  deckAColor: "#f0c040",
  deckBColor: "#4ade80",
  crossfadeCurve: "linear",
  midiMappings: {
    crossfade: { channel: 0, cc: 7 },
    "deckA.volume": { channel: 2, cc: 21 },
  },
  recordTapMode: "pre",
};

describe("settings — export shape (W1.4 / US62)", () => {
  it("@us US62: buildSettings stamps the app marker + version", () => {
    const s = buildSettings(FULL_CONFIG);
    expect(s.app).toBe(SETTINGS_APP);
    expect(s.app).toBe("WAVECRAFT");
    expect(s.version).toBe(SETTINGS_VERSION);
  });

  it("@us US62: serializeSettings produces valid JSON with the config fields", () => {
    const text = serializeSettings(FULL_CONFIG);
    const obj = JSON.parse(text); // must not throw
    expect(obj.deckAColor).toBe("#f0c040");
    expect(obj.crossfadeCurve).toBe("linear");
    expect(obj.recordTapMode).toBe("pre");
    expect(obj.midiMappings.crossfade).toEqual({ channel: 0, cc: 7 });
  });

  it("@us US62: the export contains no audio buffers, file names or cue points", () => {
    const obj = JSON.parse(serializeSettings(FULL_CONFIG));
    const keys = Object.keys(obj);
    expect(keys).not.toContain("buffer");
    expect(keys).not.toContain("fileName");
    expect(keys).not.toContain("cues");
  });
});

describe("settings — round-trip (W1.4 / US62)", () => {
  it("@us US62: export then import reproduces the config exactly", () => {
    const text = serializeSettings(FULL_CONFIG);
    const result = parseSettings(text);
    expect(result.ok).toBe(true);
    expect(result.config.deckAColor).toBe("#f0c040");
    expect(result.config.deckBColor).toBe("#4ade80");
    expect(result.config.crossfadeCurve).toBe("linear");
    expect(result.config.recordTapMode).toBe("pre");
    expect(result.config.midiMappings).toEqual(FULL_CONFIG.midiMappings);
  });

  it("@us US62: MIDI mappings survive a round-trip (the reload-survival benefit)", () => {
    const result = parseSettings(serializeSettings(FULL_CONFIG));
    expect(result.config.midiMappings["deckA.volume"]).toEqual({
      channel: 2,
      cc: 21,
    });
  });
});

describe("settings — malformed import is handled gracefully (W1.4 / US62)", () => {
  it("@us US62: non-JSON input returns an error, never throws", () => {
    let result;
    expect(() => {
      result = parseSettings("}{ not json");
    }).not.toThrow();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/JSON/i);
  });

  it("@us US62: JSON missing the app marker is rejected", () => {
    const result = parseSettings(JSON.stringify({ version: 1, deckAColor: "#00f5d4" }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/WAVECRAFT/);
  });

  it("@us US62: a file from a different app is rejected", () => {
    const result = parseSettings(
      JSON.stringify({ app: "SomeOtherApp", version: 1 })
    );
    expect(result.ok).toBe(false);
  });

  it("@us US62: a missing / invalid version is rejected", () => {
    expect(parseSettings(JSON.stringify({ app: "WAVECRAFT" })).ok).toBe(false);
    expect(
      parseSettings(JSON.stringify({ app: "WAVECRAFT", version: 0 })).ok
    ).toBe(false);
  });

  it("@us US62: unknown / off-palette fields are dropped, valid ones kept", () => {
    const result = parseSettings(
      JSON.stringify({
        app: "WAVECRAFT",
        version: 1,
        deckAColor: "#ff00ff", // not a registered theme value → dropped
        deckBColor: "#a78bfa", // valid → kept
        crossfadeCurve: "bogus-curve", // invalid → dropped
        recordTapMode: "sideways", // invalid → dropped
        somethingNew: "from the future", // unknown → ignored
      })
    );
    expect(result.ok).toBe(true);
    expect(result.config.deckAColor).toBeUndefined();
    expect(result.config.deckBColor).toBe("#a78bfa");
    expect(result.config.crossfadeCurve).toBeUndefined();
    expect(result.config.recordTapMode).toBeUndefined();
    expect(result.config.somethingNew).toBeUndefined();
  });

  it("@us US62: malformed MIDI mappings are skipped, well-formed ones kept", () => {
    const result = parseSettings(
      JSON.stringify({
        app: "WAVECRAFT",
        version: 1,
        midiMappings: {
          crossfade: { channel: 1, cc: 10 }, // valid
          masterVol: { channel: 99, cc: 10 }, // channel out of range → dropped
          "deckA.speed": { cc: 5 }, // missing channel → dropped
          "deckB.volume": "garbage", // not an object → dropped
        },
      })
    );
    expect(result.ok).toBe(true);
    expect(result.config.midiMappings).toEqual({
      crossfade: { channel: 1, cc: 10 },
    });
  });

  it("@us US62: a bare array or null is rejected without throwing", () => {
    expect(parseSettings("[]").ok).toBe(false);
    expect(parseSettings("null").ok).toBe(false);
  });
});
