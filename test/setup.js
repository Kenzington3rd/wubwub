import "@testing-library/jest-dom/vitest";
import { installWebAudioMock } from "./mocks/webAudioMock.js";

// happy-dom doesn't ship Web Audio. Install a deterministic mock globally
// so production modules under test can construct AudioContexts unchanged.
installWebAudioMock(globalThis);

// R17 — Web MIDI feature-detect runs at module load (MIDI_SUPPORTED in
// midiMap.js). Plant a placeholder requestMIDIAccess on `navigator` BEFORE
// any test file imports App so the MidiPanel renders the Enable button under
// test. Individual tests replace this with a vi.fn() that resolves to a fake
// MIDIAccess; the placeholder is only here for the import-time presence check.
if (typeof navigator !== "undefined" && !navigator.requestMIDIAccess) {
  // Async by spec — a real Promise.reject keeps any accidental real call
  // observable rather than silently no-op'ing.
  navigator.requestMIDIAccess = () =>
    Promise.reject(new Error("MIDI mock not installed"));
}

// happy-dom's matchMedia is partial — patch it to be deterministic.
if (!globalThis.matchMedia) {
  globalThis.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// requestAnimationFrame fallback so the waveform canvas's RAF loop doesn't crash.
if (!globalThis.requestAnimationFrame) {
  let raf = 0;
  globalThis.requestAnimationFrame = (cb) => {
    const id = ++raf;
    setTimeout(() => cb(performance.now()), 16);
    return id;
  };
  globalThis.cancelAnimationFrame = () => {};
}
