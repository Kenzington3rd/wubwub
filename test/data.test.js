import { describe, it, expect } from "vitest";
import {
  CAMELOT_WHEEL,
  GENRE_BPM,
  TIPS,
  COLOR_THEMES,
  CROSSFADE_CURVES,
  BASS_DROP_PRESETS,
  KEYBOARD_HINTS,
  SAMPLE_PAD_KEYS,
  LOOPER_BAR_OPTIONS,
  camelotCompatible,
} from "../src/data.js";

describe("CAMELOT_WHEEL — US11", () => {
  it("@us US11: contains all 24 keys (12 major + 12 minor)", () => {
    expect(CAMELOT_WHEEL).toHaveLength(24);
    const codes = CAMELOT_WHEEL.map((k) => k.camelot);
    expect(new Set(codes).size).toBe(24);
  });

  it("@us US11: codes form 1A/1B..12A/12B (Camelot canonical)", () => {
    const pattern = /^([1-9]|1[0-2])[AB]$/;
    for (const k of CAMELOT_WHEEL) {
      expect(k.camelot).toMatch(pattern);
    }
  });

  it("@us US11: each key declares 3 harmonically compatible neighbours (not including self)", () => {
    // Bug #16 fix — the shape used to include the key itself in `compatible`
    // (4 items), while `camelotCompatible()` returned only the 3 neighbours.
    // The two diverged; consumers (TheoryPanel uses `.compatible`, Deck uses
    // the helper) disagreed. Both now use the 3-item neighbours-only shape.
    for (const k of CAMELOT_WHEEL) {
      expect(k.compatible).toHaveLength(3);
      // Each compatible code must be a real Camelot code, and never self.
      for (const c of k.compatible) {
        expect(CAMELOT_WHEEL.some((w) => w.camelot === c)).toBe(true);
        expect(c).not.toBe(k.camelot);
      }
    }
  });
});

describe("camelotCompatible — US58 (reactive harmonic key suggestions)", () => {
  it("@us US58: returns the relative key, +1, and -1 in that order", () => {
    // 8A (A min) → 8B relative, 9A up, 7A down.
    expect(camelotCompatible("8A")).toEqual(["8B", "9A", "7A"]);
    // 8B (C maj) → 8A relative, 9B up, 7B down.
    expect(camelotCompatible("8B")).toEqual(["8A", "9B", "7B"]);
  });

  it("@us US58: wraps 12 → 1 going up", () => {
    expect(camelotCompatible("12A")).toEqual(["12B", "1A", "11A"]);
    expect(camelotCompatible("12B")).toEqual(["12A", "1B", "11B"]);
  });

  it("@us US58: wraps 1 → 12 going down", () => {
    expect(camelotCompatible("1A")).toEqual(["1B", "2A", "12A"]);
    expect(camelotCompatible("1B")).toEqual(["1A", "2B", "12B"]);
  });

  it("@us US58: every result is a real Camelot code on the wheel", () => {
    const all = new Set(CAMELOT_WHEEL.map((w) => w.camelot));
    for (const k of CAMELOT_WHEEL) {
      for (const c of camelotCompatible(k.camelot)) {
        expect(all.has(c)).toBe(true);
      }
    }
  });

  it("@us US58: agrees with the CAMELOT_WHEEL.compatible set (order aside)", () => {
    // Post bug #16: both shapes are the same 3-item neighbours-only list.
    for (const k of CAMELOT_WHEEL) {
      const computed = camelotCompatible(k.camelot);
      expect(new Set(computed)).toEqual(new Set(k.compatible));
    }
  });

  it("@us US58: returns [] for invalid input", () => {
    expect(camelotCompatible("")).toEqual([]);
    expect(camelotCompatible(null)).toEqual([]);
    expect(camelotCompatible("13A")).toEqual([]);
    expect(camelotCompatible("0B")).toEqual([]);
    expect(camelotCompatible("8C")).toEqual([]);
    expect(camelotCompatible("garbage")).toEqual([]);
  });

  it("@us US58: accepts lowercase letter codes", () => {
    expect(camelotCompatible("8a")).toEqual(["8B", "9A", "7A"]);
  });
});

describe("GENRE_BPM, TIPS — US12, US13", () => {
  it("@us US12: 9 genres, each with bpm + feel strings", () => {
    expect(GENRE_BPM).toHaveLength(9);
    for (const g of GENRE_BPM) {
      expect(typeof g.genre).toBe("string");
      expect(typeof g.bpm).toBe("string");
      expect(typeof g.feel).toBe("string");
    }
  });

  it("@us US13: at least 10 DJ tips", () => {
    expect(TIPS.length).toBeGreaterThanOrEqual(10);
    for (const t of TIPS) expect(t.length).toBeGreaterThan(15);
  });
});

describe("COLOR_THEMES — US36", () => {
  it("@us US36: every theme has a hex color value", () => {
    expect(COLOR_THEMES.length).toBeGreaterThanOrEqual(4);
    for (const t of COLOR_THEMES) {
      expect(t.value).toMatch(/^#[0-9a-f]{6}$/i);
      expect(typeof t.name).toBe("string");
    }
  });
});

describe("CROSSFADE_CURVES — US35", () => {
  it("@us US35: includes equal-power, linear, and constant-power-3db", () => {
    expect(Object.keys(CROSSFADE_CURVES)).toEqual(
      expect.arrayContaining(["equal-power", "linear", "constant-power-3db"])
    );
  });
});

describe("BASS_DROP_PRESETS — US34", () => {
  it("@us US34: ships standard, heavy, wobble presets", () => {
    expect(Object.keys(BASS_DROP_PRESETS)).toEqual(
      expect.arrayContaining(["standard", "heavy", "wobble"])
    );
  });

  it("@us US34: each preset has buildSec, lpfStart, eqLowKill, eqLowPostDrop, decaySec", () => {
    for (const p of Object.values(BASS_DROP_PRESETS)) {
      expect(typeof p.buildSec).toBe("number");
      expect(typeof p.lpfStart).toBe("number");
      expect(typeof p.eqLowKill).toBe("number");
      expect(typeof p.eqLowPostDrop).toBe("number");
      expect(typeof p.decaySec).toBe("number");
    }
  });

  it("@us US34 (bug #7 regression): wobble depth is ≤ baseFreq (symmetric modulation)", () => {
    const w = BASS_DROP_PRESETS.wobble.wobble;
    expect(w).toBeTruthy();
    expect(w.depth).toBeLessThanOrEqual(w.baseFreq);
  });

  it("@us US34: standard/heavy have no wobble; wobble preset has it", () => {
    expect(BASS_DROP_PRESETS.standard.wobble).toBeNull();
    expect(BASS_DROP_PRESETS.heavy.wobble).toBeNull();
    expect(BASS_DROP_PRESETS.wobble.wobble).not.toBeNull();
  });

  it("@us US34 (bug #6 regression): preset field is named eqLowPostDrop (not eqHighBoost)", () => {
    for (const p of Object.values(BASS_DROP_PRESETS)) {
      expect("eqLowPostDrop" in p).toBe(true);
      expect("eqHighBoost" in p).toBe(false);
    }
  });
});

describe("Keyboard hints + sample-pad keys — US26, US32", () => {
  it("@us US26: includes Space / arrows / S / C / 1–8 / pad keys", () => {
    const flat = KEYBOARD_HINTS.map((h) => h.key).join(" ").toLowerCase();
    expect(flat).toMatch(/space/);
    expect(flat).toMatch(/←|left/i);
    expect(flat).toContain("s");
    expect(flat).toContain("c");
  });

  it("@us US32: 8 sample-pad keys spanning two keyboard rows", () => {
    expect(SAMPLE_PAD_KEYS).toHaveLength(8);
    expect(SAMPLE_PAD_KEYS).toEqual(["q", "w", "e", "r", "a", "s", "d", "f"]);
  });

  it("@us US28: looper offers 4 / 8 / 16 bar capture", () => {
    expect(LOOPER_BAR_OPTIONS).toEqual([4, 8, 16]);
  });
});
