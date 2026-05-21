// Each entry's `compatible` array lists the three harmonically-safe
// neighbours and DOES NOT include the key itself. Consumers that want to
// highlight "current selection + compatible" treat the selected key as an
// implicit fourth member. This matches what `camelotCompatible()` returns and
// keeps the two consumers in sync (the previous 4-item shape included self
// and diverged from the helper, which let TheoryPanel and Deck disagree).
export const CAMELOT_WHEEL = [
  { key: "Ab min", camelot: "1A", compatible: ["1B", "12A", "2A"] },
  { key: "B maj", camelot: "1B", compatible: ["1A", "12B", "2B"] },
  { key: "Eb min", camelot: "2A", compatible: ["2B", "1A", "3A"] },
  { key: "Gb maj", camelot: "2B", compatible: ["2A", "1B", "3B"] },
  { key: "Bb min", camelot: "3A", compatible: ["3B", "2A", "4A"] },
  { key: "Db maj", camelot: "3B", compatible: ["3A", "2B", "4B"] },
  { key: "F min", camelot: "4A", compatible: ["4B", "3A", "5A"] },
  { key: "Ab maj", camelot: "4B", compatible: ["4A", "3B", "5B"] },
  { key: "C min", camelot: "5A", compatible: ["5B", "4A", "6A"] },
  { key: "Eb maj", camelot: "5B", compatible: ["5A", "4B", "6B"] },
  { key: "G min", camelot: "6A", compatible: ["6B", "5A", "7A"] },
  { key: "Bb maj", camelot: "6B", compatible: ["6A", "5B", "7B"] },
  { key: "D min", camelot: "7A", compatible: ["7B", "6A", "8A"] },
  { key: "F maj", camelot: "7B", compatible: ["7A", "6B", "8B"] },
  { key: "A min", camelot: "8A", compatible: ["8B", "7A", "9A"] },
  { key: "C maj", camelot: "8B", compatible: ["8A", "7B", "9B"] },
  { key: "E min", camelot: "9A", compatible: ["9B", "8A", "10A"] },
  { key: "G maj", camelot: "9B", compatible: ["9A", "8B", "10B"] },
  { key: "B min", camelot: "10A", compatible: ["10B", "9A", "11A"] },
  { key: "D maj", camelot: "10B", compatible: ["10A", "9B", "11B"] },
  { key: "Gb min", camelot: "11A", compatible: ["11B", "10A", "12A"] },
  { key: "A maj", camelot: "11B", compatible: ["11A", "10B", "12B"] },
  { key: "Db min", camelot: "12A", compatible: ["12B", "11A", "1A"] },
  { key: "E maj", camelot: "12B", compatible: ["12A", "11B", "1B"] },
];

// Harmonically-safe mixing targets for a Camelot code `NX` (N = 1–12, X = A|B):
//   - relative major/minor: same number, opposite letter (`N` flips A↔B)
//   - energy boost:         `N+1`, same letter
//   - energy drop:          `N-1`, same letter
// The number wraps 12 ↔ 1. Returns the three distinct neighbours in that
// order (relative, +1, -1) — the order surfaced in the deck "mix → …" hint.
// Returns [] for anything that isn't a valid Camelot code.
export function camelotCompatible(camelot) {
  const m = /^([0-9]{1,2})([AB])$/i.exec(String(camelot || "").trim());
  if (!m) return [];
  const n = parseInt(m[1], 10);
  if (n < 1 || n > 12) return [];
  const letter = m[2].toUpperCase();
  const wrap = (x) => ((x - 1 + 12) % 12) + 1;
  const other = letter === "A" ? "B" : "A";
  return [`${n}${other}`, `${wrap(n + 1)}${letter}`, `${wrap(n - 1)}${letter}`];
}

export const GENRE_BPM = [
  { genre: "Dubstep", bpm: "138–142", feel: "Half-time at ~70" },
  { genre: "Drum & Bass", bpm: "170–180", feel: "High energy" },
  { genre: "House", bpm: "120–130", feel: "Four-on-the-floor" },
  { genre: "Techno", bpm: "125–150", feel: "Driving, hypnotic" },
  { genre: "Trance", bpm: "130–145", feel: "Euphoric, layered" },
  { genre: "Future Bass", bpm: "130–170", feel: "Lush, emotional" },
  { genre: "Trap", bpm: "130–170", feel: "Half-time at ~75" },
  { genre: "Lo-fi", bpm: "70–90", feel: "Chill, relaxed" },
  { genre: "Breakbeat", bpm: "110–150", feel: "Syncopated" },
];

export const TIPS = [
  "Match BPMs before crossfading for seamless transitions",
  "Use the Camelot wheel — mix tracks ±1 for harmonic blending",
  "Cut the bass on the incoming track, then swap bass at the drop",
  "High-pass filter sweeps build tension before a bass drop",
  "Layer a riser with a filter sweep for massive build-ups",
  "Use the EQ kill (full cut) on bass to create contrast",
  "Beatmatch by ear: focus on the kick drums aligning",
  "Drop the bass after 8 or 16 bars for maximum impact",
  "Try mixing in key — it makes everything sound intentional",
  "Use echo/delay on the outgoing track for smooth exits",
];

export const COLOR_THEMES = [
  { id: "cyan", name: "Cyan", value: "#00f5d4" },
  { id: "purple", name: "Purple", value: "#a78bfa" },
  { id: "gold", name: "Gold", value: "#f0c040" },
  { id: "pink", name: "Pink", value: "#f472b6" },
  { id: "green", name: "Green", value: "#4ade80" },
  { id: "orange", name: "Orange", value: "#fb923c" },
];

export const CROSSFADE_CURVES = {
  "equal-power": { name: "Equal Power" },
  linear: { name: "Linear" },
  "constant-power-3db": { name: "Constant 3dB" },
};

export const BASS_DROP_PRESETS = {
  standard: {
    name: "Standard",
    buildSec: 1.5,
    lpfStart: 200,
    eqLowKill: -24,
    eqLowPostDrop: 12,
    decaySec: 2.0,
    wobble: null,
  },
  heavy: {
    name: "Heavy",
    buildSec: 2.5,
    lpfStart: 150,
    eqLowKill: -24,
    eqLowPostDrop: 9,
    decaySec: 2.5,
    wobble: null,
  },
  wobble: {
    name: "Wobble",
    buildSec: 1.5,
    lpfStart: 200,
    eqLowKill: -24,
    eqLowPostDrop: 12,
    decaySec: 2.5,
    // baseFreq + depth chosen so modulation stays positive (LFO swings filter
    // freq between 300 Hz and 1700 Hz). Asymmetric values (depth > baseFreq)
    // get clamped by BiquadFilter and sound less musical.
    wobble: { freq: 6, depth: 700, baseFreq: 1000 },
  },
};

export const KEYBOARD_HINTS = [
  { key: "Space", action: "Play/Pause focused deck" },
  { key: "←/→", action: "Crossfade ±5%" },
  { key: "Shift+←/→", action: "Snap crossfader to 0/1" },
  { key: "↑/↓", action: "Focused deck volume ±5%" },
  { key: "S", action: "Sync focused deck to the other" },
  { key: "C", action: "Set cue on focused deck" },
  { key: "1–8", action: "Jump to cue N on focused deck" },
  { key: "M", action: "Drop a recording cue marker (while recording)" },
  { key: ", / .", action: "Hold to nudge focused deck pitch ±4% (momentary)" },
  { key: "←/→ · Home/End", action: "Seek the focused waveform (±5s / start / end)" },
  { key: "Q W E R / A S D F", action: "Trigger sample pads 1–8" },
  { key: "S (note)", action: "Syncs the focused deck; triggers sample pad 6 only when no deck is focused" },
];

export const SAMPLE_PAD_KEYS = ["q", "w", "e", "r", "a", "s", "d", "f"];

export const LOOPER_BAR_OPTIONS = [4, 8, 16];
