// WAVECRAFT settings serialization (W1.4).
//
// Save / restore the user's *configuration* — deck accent themes, the
// crossfade curve, MIDI CC mappings, and the recorder tap mode — to a
// user-controlled `.json` file on their own disk.
//
// Constraint note: this is config, NOT user audio. No AudioBuffers, no file
// names, no cue points, no transient playback state is ever serialized. The
// file is written / read only by the user's explicit action (download / file
// pick), so it never reaches the network and nothing leaves the device that
// the user didn't choose to save.

import { COLOR_THEMES, CROSSFADE_CURVES } from "./data.js";
import { MIDI_MODES } from "./midi/midiMap.js";

// Bumped to 2 in Round 9 — the MIDI mapping shape grew an `inputId` (so two
// controllers can no longer collide on the same channel/CC), a `kind` field
// ("cc" | "note") so Note On pads can be mapped, and a `mode` field
// ("absolute" | "relative2c" | "signedMag") for jog-wheel encoders. V1 files
// (no inputId, no kind, no mode) still import — missing fields fill in with
// sane defaults (inputId undefined, kind "cc", mode "absolute").
export const SETTINGS_VERSION = 2;
export const SETTINGS_APP = "WAVECRAFT";

const VALID_THEME_VALUES = new Set(COLOR_THEMES.map((t) => t.value));
const VALID_CURVES = new Set(Object.keys(CROSSFADE_CURVES));
const VALID_TAP_MODES = new Set(["pre", "post"]);
const VALID_KINDS = new Set(["cc", "note"]);
const VALID_MODES = new Set(MIDI_MODES);

// Sane upper bound for an inputId. MIDIInput.id strings are short, app-
// assigned identifiers (Chrome uses a UUID-like form); 256 is generous and
// caps a corrupt file's footprint.
const MAX_INPUT_ID_LEN = 256;

// Build the versioned, serializable config object from the live app state.
// `config` is a plain object with the fields below; missing fields are simply
// omitted from the export.
export function buildSettings({
  deckAColor,
  deckBColor,
  crossfadeCurve,
  midiMappings,
  recordTapMode,
} = {}) {
  return {
    app: SETTINGS_APP,
    version: SETTINGS_VERSION,
    exportedAt: new Date().toISOString(),
    deckAColor,
    deckBColor,
    crossfadeCurve,
    // Shallow copy so the export can't be mutated by later state changes.
    midiMappings: midiMappings ? { ...midiMappings } : {},
    recordTapMode,
  };
}

// Serialize the config to a pretty-printed JSON string.
export function serializeSettings(config) {
  return JSON.stringify(buildSettings(config), null, 2);
}

// True for a well-formed MIDI mapping value. The post-Round-9 shape is
//   { inputId?, channel, kind, number, mode? }
// V1 files use `{ channel, cc }` — those import too, with `kind` defaulting to
// "cc" (number copied from cc), mode "absolute", inputId undefined.
function normalizeMapping(m) {
  if (!m || typeof m !== "object") return null;
  if (!Number.isInteger(m.channel) || m.channel < 0 || m.channel > 15) {
    return null;
  }
  // Determine kind + number. Prefer v2 shape; fall back to v1's `cc` field.
  let kind;
  let number;
  if (typeof m.kind === "string") {
    if (!VALID_KINDS.has(m.kind)) return null;
    kind = m.kind;
    if (!Number.isInteger(m.number) || m.number < 0 || m.number > 127) {
      return null;
    }
    number = m.number;
  } else if (Number.isInteger(m.cc)) {
    // Legacy v1 mapping: cc only, always absolute.
    if (m.cc < 0 || m.cc > 127) return null;
    kind = "cc";
    number = m.cc;
  } else {
    return null;
  }
  // Mode is optional; default absolute. Note mappings are always treated as
  // absolute since "relative note" doesn't exist.
  let mode = "absolute";
  if (typeof m.mode === "string") {
    if (!VALID_MODES.has(m.mode)) return null;
    mode = m.mode;
  }
  // InputId is optional (undefined on v1 imports, defined on v2). Validate
  // length + type when present.
  let inputId;
  if (m.inputId !== undefined && m.inputId !== null) {
    if (typeof m.inputId !== "string") return null;
    if (m.inputId.length === 0 || m.inputId.length > MAX_INPUT_ID_LEN) {
      return null;
    }
    inputId = m.inputId;
  }
  const out = { channel: m.channel, kind, number, mode };
  if (inputId !== undefined) out.inputId = inputId;
  return out;
}

// Parse + validate a settings JSON string. Never throws on bad input — instead
// returns `{ ok: false, error }`. On success returns `{ ok: true, config }`
// where `config` contains only the fields that validated; unknown or malformed
// fields are silently dropped so a partially-corrupt file still restores what
// it can. Accepts both v1 and v2 settings files.
export function parseSettings(jsonText) {
  let raw;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "That file isn't a WAVECRAFT settings file." };
  }
  if (raw.app !== SETTINGS_APP) {
    return { ok: false, error: "That file isn't a WAVECRAFT settings file." };
  }
  if (!Number.isInteger(raw.version) || raw.version < 1) {
    return { ok: false, error: "Unrecognized settings file version." };
  }

  const config = {};
  if (typeof raw.deckAColor === "string" && VALID_THEME_VALUES.has(raw.deckAColor)) {
    config.deckAColor = raw.deckAColor;
  }
  if (typeof raw.deckBColor === "string" && VALID_THEME_VALUES.has(raw.deckBColor)) {
    config.deckBColor = raw.deckBColor;
  }
  if (typeof raw.crossfadeCurve === "string" && VALID_CURVES.has(raw.crossfadeCurve)) {
    config.crossfadeCurve = raw.crossfadeCurve;
  }
  if (typeof raw.recordTapMode === "string" && VALID_TAP_MODES.has(raw.recordTapMode)) {
    config.recordTapMode = raw.recordTapMode;
  }
  if (raw.midiMappings && typeof raw.midiMappings === "object" && !Array.isArray(raw.midiMappings)) {
    const clean = {};
    for (const [target, mapping] of Object.entries(raw.midiMappings)) {
      if (typeof target !== "string") continue;
      const normalized = normalizeMapping(mapping);
      if (normalized) clean[target] = normalized;
    }
    config.midiMappings = clean;
  }

  return { ok: true, config };
}
