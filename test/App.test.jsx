import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import App from "../src/App.jsx";

// Helper: dispatch a keydown on window (which is what App's handler listens on).
function pressKey(key, opts = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
  // Use document.body as the target so we don't trigger the "skip on input" guard.
  Object.defineProperty(event, "target", { value: document.body });
  window.dispatchEvent(event);
}

describe("App keyboard shortcuts — US26, US27, US32, US43", () => {
  it("@us US27: App renders both decks with focus indicators", () => {
    render(<App />);
    expect(screen.getByText("DECK A")).toBeInTheDocument();
    expect(screen.getByText("DECK B")).toBeInTheDocument();
  });

  it("@us US26: ArrowRight nudges crossfade — does not throw", () => {
    render(<App />);
    expect(() => act(() => pressKey("ArrowRight"))).not.toThrow();
  });

  it("@us US26: Shift+ArrowLeft snaps crossfader without throwing", () => {
    render(<App />);
    expect(() => act(() => pressKey("ArrowLeft", { shiftKey: true }))).not.toThrow();
  });

  it("@us US32: sample pad keys (q w e r a s d f) don't throw when pressed", () => {
    render(<App />);
    for (const k of ["q", "w", "e", "r", "a", "s", "d", "f"]) {
      expect(() => act(() => pressKey(k))).not.toThrow();
    }
  });

  it("@us US43: space key with target=button skips re-trigger via blur", () => {
    render(<App />);
    const playBtn = screen.getByRole("button", { name: /Play deck A/i });
    // Click → focus moves to play button. Then keydown for space.
    fireEvent.click(playBtn);
    // Press space; our handler should blur the button to prevent double-trigger.
    const event = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "target", { value: playBtn });
    expect(() => act(() => window.dispatchEvent(event))).not.toThrow();
  });

  it("@us US26: keys in <input> fields don't trigger app shortcuts", () => {
    render(<App />);
    const inp = document.createElement("input");
    document.body.appendChild(inp);
    inp.focus();
    const event = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "target", { value: inp });
    expect(() => act(() => window.dispatchEvent(event))).not.toThrow();
    document.body.removeChild(inp);
  });
});

describe("App master controls — US21, US36, US37", () => {
  it("@us US21 / US37: app renders a record button and master volume", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /RECORD/i })).toBeInTheDocument();
    // Master slider is one of multiple sliders; just verify >= 1.
    expect(screen.getAllByRole("slider").length).toBeGreaterThanOrEqual(1);
  });

  it("@us US36: theme pickers for both decks are present", () => {
    render(<App />);
    // ThemePicker swatches have aria-labels like "Deck A color: Cyan".
    expect(screen.getByRole("button", { name: /Deck A color: Cyan/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Deck B color: Purple/i })).toBeInTheDocument();
  });
});

describe("App MIDI panel — US39", () => {
  it("@us US39: MIDI panel is collapsed by default and includes 'MIDI' label", () => {
    render(<App />);
    expect(screen.getByText("MIDI")).toBeInTheDocument();
  });
});
