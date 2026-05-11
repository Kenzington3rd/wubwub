import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useMatchMedia from "../src/hooks/useMatchMedia.js";

function stubMatchMedia(initialMatches = false) {
  const listeners = new Set();
  let matches = initialMatches;
  globalThis.matchMedia = (query) => ({
    get matches() { return matches; },
    media: query,
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  });
  return {
    fire(newMatches) {
      matches = newMatches;
      for (const fn of listeners) fn({ matches: newMatches });
    },
  };
}

describe("useMatchMedia — US17, US51", () => {
  it("@us US51: returns initial match state from matchMedia", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useMatchMedia("(max-width: 720px)"));
    expect(result.current).toBe(true);
  });

  it("@us US51: updates when matchMedia fires a change event", () => {
    const ctl = stubMatchMedia(false);
    const { result } = renderHook(() => useMatchMedia("(max-width: 720px)"));
    expect(result.current).toBe(false);
    act(() => ctl.fire(true));
    expect(result.current).toBe(true);
  });

  it("@us US17: a different query receives independent state", () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useMatchMedia("(min-width: 1200px)"));
    expect(result.current).toBe(false);
  });
});
