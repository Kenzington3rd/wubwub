// Web MIDI mapping. Feature-detected — silently degrades when unsupported.

export const MIDI_SUPPORTED =
  typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;

// The targets a user can map a MIDI message to.
export const MIDI_TARGETS = [
  { id: "crossfade", label: "Crossfader" },
  { id: "masterVol", label: "Master Volume" },
  { id: "deckA.volume", label: "Deck A Volume" },
  { id: "deckA.filterFreq", label: "Deck A Filter" },
  { id: "deckA.speed", label: "Deck A Speed" },
  { id: "deckB.volume", label: "Deck B Volume" },
  { id: "deckB.filterFreq", label: "Deck B Filter" },
  { id: "deckB.speed", label: "Deck B Speed" },
  { id: "deckC.volume", label: "Deck C Volume" },
  { id: "deckC.filterFreq", label: "Deck C Filter" },
  { id: "deckC.speed", label: "Deck C Speed" },
];

// The three CC application modes a mapping can carry. "absolute" is the
// classic CC=0..127 → target-domain mapping. "relative2c" and "signedMag" are
// the two relative-encoder encodings DJ controllers use for jog wheels and
// endless rotaries — they emit deltas rather than absolutes, and a mapping
// with one of those modes accumulates against the current target value.
export const MIDI_MODES = ["absolute", "relative2c", "signedMag"];

// Decode a "relative two's-complement" CC value (the most common jog-wheel
// encoding). 0x40 is rest (0); 0x41..0x7F is +1..+63; 0x3F..0x00 is -1..-64.
// Equivalent to interpreting the low 7 bits as a signed offset from 0x40.
export function decodeRelative2c(value) {
  // Mask to 7 bits, then re-center: 0x40 = 64 = zero.
  const v = value & 0x7f;
  return v - 64;
}

// Decode a "signed-magnitude" CC value (the other common jog encoding).
// High bit of the low-7 (0x40) is the direction (set = positive), low 6 bits
// (0x3F) are the magnitude. 0x40 itself is +0; 0x00 is -0; both behave as 0.
export function decodeSignedMag(value) {
  const v = value & 0x7f;
  const mag = v & 0x3f;
  return (v & 0x40) ? mag : -mag;
}

// Request MIDI access and subscribe to all current inputs. Returns an
// unsubscribe function. `onMidi` is called with (message, inputId, inputName)
// for every recognised MIDI message; `message` is one of:
//   { kind: "cc", channel, cc, value }
//   { kind: "noteon", channel, note, velocity }
//   { kind: "noteoff", channel, note }
// Other status bytes (program change, pitch bend, sysex, …) are dropped.
export async function enableMidi(onMidi) {
  // Re-check at call time rather than trusting the import-time constant — the
  // navigator can be polyfilled/mocked after module load.
  if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) {
    throw new Error("Web MIDI not supported in this browser.");
  }
  const access = await navigator.requestMIDIAccess({ sysex: false });
  // Keyed by input.id so an unplug→replug cycle re-uses the same slot instead of
  // stacking a second `midimessage` handler (which would fire `onMidi` twice).
  const subscribers = new Map();

  const subscribeToInput = (input) => {
    // Already bound — drop the stale handler before re-binding.
    const existing = subscribers.get(input.id);
    if (existing) existing();
    const handler = (e) => {
      const data = e.data;
      if (!data || data.length < 2) return;
      const status = data[0];
      const channel = status & 0x0f;
      const kindNibble = status & 0xf0;
      if (kindNibble === 0xb0) {
        if (data.length < 3) return;
        onMidi(
          { kind: "cc", channel, cc: data[1], value: data[2] },
          input.id,
          input.name
        );
      } else if (kindNibble === 0x90) {
        if (data.length < 3) return;
        const velocity = data[2];
        // Spec quirk: Note On with velocity 0 is a Note Off. Normalise so
        // consumers don't have to.
        if (velocity === 0) {
          onMidi(
            { kind: "noteoff", channel, note: data[1] },
            input.id,
            input.name
          );
        } else {
          onMidi(
            { kind: "noteon", channel, note: data[1], velocity },
            input.id,
            input.name
          );
        }
      } else if (kindNibble === 0x80) {
        // Strict 3-byte guard to match Note On above (spec Note Off is
        // status + note + velocity). A malformed 2-byte Note Off is dropped.
        if (data.length < 3) return;
        onMidi(
          { kind: "noteoff", channel, note: data[1] },
          input.id,
          input.name
        );
      }
      // Any other status (program change, pitch bend, sysex, …) is dropped.
    };
    input.addEventListener("midimessage", handler);
    subscribers.set(input.id, () =>
      input.removeEventListener("midimessage", handler)
    );
  };

  const unsubscribeFromInput = (input) => {
    const unsub = subscribers.get(input.id);
    if (unsub) {
      unsub();
      subscribers.delete(input.id);
    }
  };

  for (const input of access.inputs.values()) subscribeToInput(input);

  const onStateChange = (e) => {
    if (e.port?.type !== "input") return;
    if (e.port.state === "connected") subscribeToInput(e.port);
    else if (e.port.state === "disconnected") unsubscribeFromInput(e.port);
  };
  access.addEventListener("statechange", onStateChange);

  return () => {
    subscribers.forEach((unsub) => unsub());
    subscribers.clear();
    access.removeEventListener("statechange", onStateChange);
  };
}

// Natural domain for each mappable target. Used for both absolute mapping and
// for clamping the running value when a relative encoder advances past the
// edge. `min` and `max` are the inclusive boundaries.
const TARGET_DOMAIN = {
  "deckA.filterFreq": { min: 60, max: 20000 },
  "deckB.filterFreq": { min: 60, max: 20000 },
  "deckC.filterFreq": { min: 60, max: 20000 },
  "deckA.speed": { min: 0.5, max: 2 },
  "deckB.speed": { min: 0.5, max: 2 },
  "deckC.speed": { min: 0.5, max: 2 },
  // crossfade, masterVol, per-deck volume all live in [0, 1].
};

function domainFor(targetId) {
  return TARGET_DOMAIN[targetId] || { min: 0, max: 1 };
}

// Map a CC value (0-127) into the target parameter's natural domain.
export function mapCcToValue(cc127, targetId) {
  const norm = Math.max(0, Math.min(1, cc127 / 127));
  const { min, max } = domainFor(targetId);
  return min + norm * (max - min);
}

// Apply a relative delta (raw -64..+63 integer from a relative encoder) to a
// target's current value. The delta is scaled by 1/127 of the target's domain
// span so a full encoder revolution (~127 ticks) covers roughly the whole
// range — a reasonable default for jog-wheel-as-knob behaviour. Clamps to the
// target's natural domain.
export function applyRelative(current, delta, targetId) {
  const { min, max } = domainFor(targetId);
  const span = max - min;
  const next = current + (delta / 127) * span;
  return Math.max(min, Math.min(max, next));
}
