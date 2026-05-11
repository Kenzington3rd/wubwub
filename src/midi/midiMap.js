// Web MIDI mapping. Feature-detected — silently degrades when unsupported.

export const MIDI_SUPPORTED =
  typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;

// The targets a user can map a MIDI CC to.
export const MIDI_TARGETS = [
  { id: "crossfade", label: "Crossfader" },
  { id: "masterVol", label: "Master Volume" },
  { id: "deckA.volume", label: "Deck A Volume" },
  { id: "deckA.filterFreq", label: "Deck A Filter" },
  { id: "deckA.speed", label: "Deck A Speed" },
  { id: "deckB.volume", label: "Deck B Volume" },
  { id: "deckB.filterFreq", label: "Deck B Filter" },
  { id: "deckB.speed", label: "Deck B Speed" },
];

// Request MIDI access and subscribe to all current inputs. Returns an unsubscribe
// function. `onCc` is called with (channel, cc, value127, inputName) for every
// CC message; status bytes outside CC range (0xB0-0xBF) are dropped.
export async function enableMidi(onCc) {
  if (!MIDI_SUPPORTED) throw new Error("Web MIDI not supported in this browser.");
  const access = await navigator.requestMIDIAccess({ sysex: false });
  const subscribers = [];

  const subscribeToInput = (input) => {
    const handler = (e) => {
      const data = e.data;
      if (!data || data.length < 3) return;
      const status = data[0];
      const channel = status & 0x0f;
      const isCc = (status & 0xf0) === 0xb0;
      if (!isCc) return;
      const cc = data[1];
      const value = data[2];
      onCc(channel, cc, value, input.name);
    };
    input.addEventListener("midimessage", handler);
    subscribers.push(() => input.removeEventListener("midimessage", handler));
  };

  for (const input of access.inputs.values()) subscribeToInput(input);

  const onStateChange = (e) => {
    if (e.port?.type === "input" && e.port.state === "connected") {
      subscribeToInput(e.port);
    }
  };
  access.addEventListener("statechange", onStateChange);

  return () => {
    subscribers.forEach((unsub) => unsub());
    access.removeEventListener("statechange", onStateChange);
  };
}

// Map a CC value (0-127) into the target parameter's natural domain.
export function mapCcToValue(cc127, targetId) {
  const norm = Math.max(0, Math.min(1, cc127 / 127));
  switch (targetId) {
    case "deckA.filterFreq":
    case "deckB.filterFreq":
      return 60 + norm * (20000 - 60);
    case "deckA.speed":
    case "deckB.speed":
      return 0.5 + norm * 1.5;
    default:
      return norm;
  }
}
