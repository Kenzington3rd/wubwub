import "@testing-library/jest-dom/vitest";
import { installWebAudioMock } from "./mocks/webAudioMock.js";

// happy-dom doesn't ship Web Audio. Install a deterministic mock globally
// so production modules under test can construct AudioContexts unchanged.
installWebAudioMock(globalThis);

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
