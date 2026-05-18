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

// Bumped when the on-disk shape changes incompatibly. Importers tolerate any
// version with a matching APP marker and simply skip fields they don't know.
export const SETTINGS_VERSION = 1;
export const SETTINGS_APP = "WAVECRAFT";

const VALID_THEME_VALUES = new Set(COLOR_THEMES.map((t) => t.value));
const VALID_CURVES = new Set(Object.keys(CROSSFADE_CURVES));
const VALID_TAP_MODES = new Set(["pre", "post"]);

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

// True for a well-formed MIDI mapping value: { channel, cc } with integer
// channel 0-15 and cc 0-127.
function isValidMapping(m) {
  return (
    m &&
    typeof m === "object" &&
    Number.isInteger(m.channel) &&
    m.channel >= 0 &&
    m.channel <= 15 &&
    Number.isInteger(m.cc) &&
    m.cc >= 0 &&
    m.cc <= 127
  );
}

// Parse + validate a settings JSON string. Never throws on bad input — instead
// returns `{ ok: false, error }`. On success returns `{ ok: true, config }`
// where `config` contains only the fields that validated; unknown or malformed
// fields are silently dropped so a partially-corrupt file still restores what
// it can.
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
      if (typeof target === "string" && isValidMapping(mapping)) {
        clean[target] = { channel: mapping.channel, cc: mapping.cc };
      }
    }
    config.midiMappings = clean;
  }

  return { ok: true, config };
}
