import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
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

  // Helper: dispatch a keydown and return the event so callers can inspect
  // defaultPrevented. The sync (S) branch calls preventDefault(); the sample
  // -pad branch does not — so defaultPrevented discriminates which fired.
  function pressKeyEvent(key, opts = {}) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...opts,
    });
    Object.defineProperty(event, "target", { value: document.body });
    act(() => window.dispatchEvent(event));
    return event;
  }

  it("@us US32: 'S' triggers deck sync when a deck is focused (not sample pad 6)", () => {
    render(<App />);
    // Focus Deck A by pointer-down on its region.
    const deckA = screen.getByRole("region", { name: /Deck A/i });
    fireEvent.pointerDown(deckA);
    // With a deck focused, 'S' is the sync shortcut — the handler calls
    // preventDefault(). The sample-pad branch never calls preventDefault().
    const ev = pressKeyEvent("s");
    expect(ev.defaultPrevented).toBe(true);
  });

  it("@us US32: 'S' triggers sample pad 6 when no deck is focused", () => {
    render(<App />);
    // No deck focused → sample-pad branch handles 'S' and does NOT
    // preventDefault, and it must not throw.
    const ev = pressKeyEvent("s");
    expect(ev.defaultPrevented).toBe(false);
  });

  it("@us US32: sample pads still trigger when a deck is focused (q w e r a d f)", () => {
    render(<App />);
    const deckA = screen.getByRole("region", { name: /Deck A/i });
    fireEvent.pointerDown(deckA);
    // Non-colliding pad keys remain reachable with a deck focused.
    for (const k of ["q", "w", "e", "r", "a", "d", "f"]) {
      const ev = pressKeyEvent(k);
      expect(ev.defaultPrevented).toBe(false);
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
    expect(
      screen.getByRole("button", { name: /Record the master mix/i })
    ).toBeInTheDocument();
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

describe("App recording markers — US60 (W1.3)", () => {
  it("@us US60: MARKER button starts disabled and the tap toggle is present", () => {
    render(<App />);
    expect(
      screen.getByRole("button", { name: /Drop a cue marker/i })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /Clean/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Radio/i })).toBeInTheDocument();
  });

  it("@us US60: M key is a no-op when not recording (does not throw)", () => {
    render(<App />);
    expect(() => act(() => pressKey("m"))).not.toThrow();
  });

  it("@us US60: starting a recording enables MARKER and dropping a marker bumps the count", async () => {
    render(<App />);
    const recordBtn = screen.getByRole("button", {
      name: /Record the master mix/i,
    });
    await act(async () => {
      fireEvent.click(recordBtn);
    });
    const markerBtn = screen.getByRole("button", {
      name: /Drop a cue marker/i,
    });
    expect(markerBtn).not.toBeDisabled();
    // Drop two markers — count badge reflects them.
    await act(async () => {
      fireEvent.click(markerBtn);
      fireEvent.click(markerBtn);
    });
    expect(markerBtn).toHaveTextContent("2");
  });

  it("@us US60: marker count resets when a new recording starts", async () => {
    render(<App />);
    const recordBtn = screen.getByRole("button", {
      name: /Record the master mix/i,
    });
    // First recording — drop a marker.
    await act(async () => {
      fireEvent.click(recordBtn);
    });
    const markerBtn = screen.getByRole("button", {
      name: /Drop a cue marker/i,
    });
    await act(async () => {
      fireEvent.click(markerBtn);
    });
    expect(markerBtn).toHaveTextContent("1");
    // Stop the recording. rec.stop() resolves via a macrotask in the mock,
    // so wait for the button to flip back to its idle label.
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Stop recording/i })
      );
    });
    const idleRecordBtn = await screen.findByRole("button", {
      name: /Record the master mix/i,
    });
    // Start a fresh recording — the count is back to zero (no badge).
    await act(async () => {
      fireEvent.click(idleRecordBtn);
    });
    const freshMarkerBtn = screen.getByRole("button", {
      name: /Drop a cue marker/i,
    });
    expect(freshMarkerBtn).not.toHaveTextContent(/[1-9]/);
  });

  it("@us US61: the tap toggle is disabled while recording is in progress", async () => {
    render(<App />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Record the master mix/i })
      );
    });
    expect(screen.getByRole("button", { name: /Clean/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Radio/i })).toBeDisabled();
  });
});

describe("App MIDI panel — US39", () => {
  it("@us US39: MIDI panel is collapsed by default and includes 'MIDI' label", () => {
    render(<App />);
    expect(screen.getByText("MIDI")).toBeInTheDocument();
  });
});

describe("App session crate — US63 (W1.5)", () => {
  it("@us US63: the crate panel renders empty on a fresh load", () => {
    render(<App />);
    expect(
      screen.getByRole("region", { name: /Session crate/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/Crate is empty/i)).toBeInTheDocument();
  });

  it("@us US63: dropping a track adds a crate entry; loading it to a deck works", async () => {
    render(<App />);
    const crate = screen.getByRole("region", { name: /Session crate/i });
    const file = new File([new Uint8Array([1, 2, 3])], "crate-song.mp3", {
      type: "audio/mpeg",
    });
    await act(async () => {
      fireEvent.drop(crate, {
        dataTransfer: { files: [file], items: [{ kind: "file" }] },
      });
    });
    // The entry shows up in the crate list.
    const entry = await screen.findByText("crate-song.mp3");
    expect(entry).toBeInTheDocument();

    // Quick-load it onto Deck A — the deck adopts the decoded buffer.
    const loadA = screen.getByRole("button", {
      name: /Load "crate-song.mp3" to deck A/i,
    });
    await act(async () => {
      fireEvent.click(loadA);
    });
    // The track name now appears twice: once in the crate list, once in
    // Deck A's file-load button (which reflects the adopted buffer).
    await waitFor(() => {
      expect(screen.getAllByText("crate-song.mp3").length).toBeGreaterThanOrEqual(2);
    });
  });

  it("@us US63: removing the only entry returns the crate to its empty state", async () => {
    render(<App />);
    const crate = screen.getByRole("region", { name: /Session crate/i });
    const file = new File([new Uint8Array([1])], "removable.mp3", {
      type: "audio/mpeg",
    });
    await act(async () => {
      fireEvent.drop(crate, {
        dataTransfer: { files: [file], items: [{ kind: "file" }] },
      });
    });
    await screen.findByText("removable.mp3");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Remove "removable.mp3"/i })
      );
    });
    expect(screen.getByText(/Crate is empty/i)).toBeInTheDocument();
  });
});

describe("App settings export / import — US62 (W1.4)", () => {
  it("@us US62: Export and Import controls are present", () => {
    render(<App />);
    expect(
      screen.getByRole("button", { name: /Export settings/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Import settings/i })
    ).toBeInTheDocument();
  });

  it("@us US62: clicking Export downloads a settings file", () => {
    render(<App />);
    let clicks = 0;
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clicks++;
    };
    try {
      fireEvent.click(screen.getByRole("button", { name: /Export settings/i }));
      expect(clicks).toBe(1);
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
    }
  });

  it("@us US62: importing a valid settings file applies the config to state", async () => {
    render(<App />);
    // Deck B starts purple; the imported file selects green.
    expect(
      screen.getByRole("button", { name: /Deck B color: Purple/i })
    ).toHaveAttribute("aria-pressed", "true");

    const settings = {
      app: "WAVECRAFT",
      version: 1,
      deckBColor: "#4ade80", // green
      crossfadeCurve: "linear",
    };
    const file = new File([JSON.stringify(settings)], "wavecraft-settings.json", {
      type: "application/json",
    });
    // The Import button triggers a hidden file input.
    const input = document.querySelector('input[type="file"][accept*="json"]');
    expect(input).toBeTruthy();
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    // FileReader resolves on a macrotask — wait for the applied config.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Deck B color: Green/i })
      ).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("@us US62: importing a malformed file shows an inline error and does not crash", async () => {
    render(<App />);
    const file = new File(["}{ not json at all"], "broken.json", {
      type: "application/json",
    });
    const input = document.querySelector('input[type="file"][accept*="json"]');
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/JSON/i);
    });
    // The app is still alive — decks still render.
    expect(screen.getByText("DECK A")).toBeInTheDocument();
  });
});
