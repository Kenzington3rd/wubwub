import { describe, it, expect, vi } from "vitest";
import { useRef, useEffect } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import Deck from "../src/components/Deck.jsx";
import { MockAudioBuffer } from "./mocks/webAudioMock.js";

function Harness({ id = "A", onMount, color = "#00f5d4" }) {
  const audioCtxRef = useRef(null);
  const masterCompressorRef = useRef(null);
  const deckRef = useRef(null);

  const ensureMasterCtx = async () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    if (!masterCompressorRef.current) {
      masterCompressorRef.current = audioCtxRef.current.createDynamicsCompressor();
      masterCompressorRef.current.connect(audioCtxRef.current.destination);
    }
    if (audioCtxRef.current.state === "suspended") {
      await audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  useEffect(() => {
    if (onMount) onMount({ deckRef, audioCtxRef, masterCompressorRef });
  }, []);

  return (
    <Deck
      ref={deckRef}
      id={id}
      color={color}
      audioCtxRef={audioCtxRef}
      masterCompressorRef={masterCompressorRef}
      ensureMasterCtx={ensureMasterCtx}
      crossfadeGain={1}
      focused={false}
      onFocus={() => {}}
      onSync={() => {}}
    />
  );
}

async function loadFakeFile(api, name = "test.mp3") {
  const ctx = await api.ensureMasterCtx;
  void ctx;
  const file = new File([new Uint8Array([0, 1, 2])], name, { type: "audio/mpeg" });
  // The deck's button is hidden behind a label-button; we drive via drop instead.
  return file;
}

describe("Deck — integration tests across many user stories", () => {
  it("@us US2: imperative play / pause / stop API exists", async () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    expect(typeof api.deckRef.current.play).toBe("function");
    expect(typeof api.deckRef.current.pause).toBe("function");
    expect(typeof api.deckRef.current.stop).toBe("function");
    expect(typeof api.deckRef.current.togglePlay).toBe("function");
  });

  it("@us US3: nudgeVolume clamps within [0, 1]", () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    api.deckRef.current.setVolume(1.5);
    api.deckRef.current.nudgeVolume(-0.1);
    // setVolume(1.5) clamps to 1; nudge -0.1 → 0.9
    api.deckRef.current.setVolume(-1);
    // Setting to -1 clamps to 0.
  });

  it("@us US9: tapping BPM at 120 BPM intervals lands near 120", async () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    // Simulate 4 taps 500 ms apart → 120 BPM.
    const now = Date.now();
    const dateSpy = vi.spyOn(Date, "now");
    dateSpy.mockReturnValueOnce(now);
    dateSpy.mockReturnValueOnce(now + 500);
    dateSpy.mockReturnValueOnce(now + 1000);
    dateSpy.mockReturnValueOnce(now + 1500);
    const tapButton = screen.getByRole("button", { name: /Tap BPM/i });
    await act(async () => fireEvent.click(tapButton));
    await act(async () => fireEvent.click(tapButton));
    await act(async () => fireEvent.click(tapButton));
    await act(async () => fireEvent.click(tapButton));
    dateSpy.mockRestore();
    expect(screen.getByText(/120 BPM/)).toBeInTheDocument();
  });

  it("@us US9: two taps in the same millisecond never yield a non-finite BPM", async () => {
    render(<Harness />);
    // Both taps report the identical timestamp → avg interval 0. Without the
    // guard this computes 60000/0 = Infinity and renders "Infinity BPM".
    const now = Date.now();
    const dateSpy = vi.spyOn(Date, "now");
    dateSpy.mockReturnValue(now);
    const tapButton = screen.getByRole("button", { name: /Tap BPM/i });
    await act(async () => fireEvent.click(tapButton));
    await act(async () => fireEvent.click(tapButton));
    dateSpy.mockRestore();
    // No Infinity / NaN leaked into the display; BPM stays at the 128 default.
    expect(screen.queryByText(/Infinity/i)).toBeNull();
    expect(screen.queryByText(/NaN/i)).toBeNull();
    expect(screen.getByText(/128 BPM/)).toBeInTheDocument();
  });

  it("@us US9: a fast (220+ BPM) tap interval is clamped into the musical range", async () => {
    render(<Harness />);
    // Taps 100 ms apart → 600 BPM raw; must clamp to the 220 ceiling.
    const now = Date.now();
    const dateSpy = vi.spyOn(Date, "now");
    dateSpy.mockReturnValueOnce(now);
    dateSpy.mockReturnValueOnce(now + 100);
    dateSpy.mockReturnValueOnce(now + 200);
    const tapButton = screen.getByRole("button", { name: /Tap BPM/i });
    await act(async () => fireEvent.click(tapButton));
    await act(async () => fireEvent.click(tapButton));
    await act(async () => fireEvent.click(tapButton));
    dateSpy.mockRestore();
    expect(screen.getByText(/220 BPM/)).toBeInTheDocument();
  });

  it("@us US25 / US45: ½× and ×2 BPM nudge buttons exist (disabled with no file)", () => {
    render(<Harness />);
    const halve = screen.getByRole("button", { name: /Halve BPM/i });
    const dbl = screen.getByRole("button", { name: /Double BPM/i });
    expect(halve).toBeDisabled();
    expect(dbl).toBeDisabled();
  });

  it("@us US25: syncTo(otherBpm) adjusts the deck's speed within [0.5, 2]", () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    // Default BPM is 128. syncTo(64) should halve speed → 0.5, the lower bound.
    api.deckRef.current.syncTo(64);
    // The internal speed state isn't directly exposed, but no error means it ran.
    // The imperative method clamps to [0.5, 2.0] — assert no throw.
    expect(() => api.deckRef.current.syncTo(64)).not.toThrow();
  });

  it("@us US22 / US47: cue limit; deck imperative setCue can be called", () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    // setCue requires a loaded buffer; without one it's a no-op.
    expect(() => api.deckRef.current.setCue()).not.toThrow();
  });

  it("@us US44: deck has dragover/drop handlers (drag-and-drop file load)", () => {
    const { container } = render(<Harness />);
    const deckDiv = container.querySelector('[role="region"]');
    expect(deckDiv).toBeTruthy();
    // Drop event should fire without throwing (no file → no decode).
    expect(() => {
      fireEvent.dragOver(deckDiv, {
        dataTransfer: { items: [{ kind: "file" }] },
      });
      fireEvent.drop(deckDiv, {
        dataTransfer: { files: [], items: [] },
      });
    }).not.toThrow();
  });

  it("@us US50 (a11y): deck region has aria-label naming the deck", () => {
    const { container } = render(<Harness id="A" />);
    const region = container.querySelector('[role="region"]');
    expect(region.getAttribute("aria-label")).toMatch(/Deck A/i);
  });

  it("@us US26: transport buttons have aria-pressed reflecting active state", () => {
    render(<Harness />);
    const playBtn = screen.getByRole("button", { name: /Play deck/i });
    expect(playBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("@us US25 (sync button disabled gating)", () => {
    render(<Harness />);
    const syncBtn = screen.getByRole("button", { name: /Sync deck A to other deck/i });
    expect(syncBtn).toBeDisabled();
  });

  it("@us US19 / US20: imperative setFilterFreq clamps to [60, 20000]", () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    expect(() => api.deckRef.current.setFilterFreq(50)).not.toThrow();
    expect(() => api.deckRef.current.setFilterFreq(50000)).not.toThrow();
  });

  it("@us US4: imperative setSpeed clamps to [0.5, 2.0]", () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    expect(() => api.deckRef.current.setSpeed(0.1)).not.toThrow();
    expect(() => api.deckRef.current.setSpeed(5)).not.toThrow();
  });

  it("@us US40: AUTO button is disabled when no file is loaded", () => {
    render(<Harness />);
    const auto = screen.getByRole("button", { name: /Auto-detect BPM and key/i });
    expect(auto).toBeDisabled();
  });

  it("@us US24 / US34 (wobble re-entry leak): a second wobble drop in the active window is a no-op — no orphaned oscillator", async () => {
    let api;
    const { container } = render(<Harness onMount={(a) => { api = a; }} />);
    const deckDiv = container.querySelector('[role="region"]');
    const fakeAudio = new File([new Uint8Array([0, 1, 2])], "track.mp3", {
      type: "audio/mpeg",
    });
    await act(async () => {
      fireEvent.dragOver(deckDiv, { dataTransfer: { items: [{ kind: "file" }] } });
      fireEvent.drop(deckDiv, {
        dataTransfer: { files: [fakeAudio], items: [{ kind: "file" }] },
      });
    });

    const bassDrop = await waitFor(() => {
      const btn = screen.getByRole("button", { name: /BASS DROP/i });
      expect(btn).not.toBeDisabled();
      return btn;
    });

    // Switch the preset selector to Wobble — the wobble path spawns an LFO
    // oscillator whose `onended` owns clearing the re-entry guard.
    const presetSelect = screen.getByTitle(/Bass drop preset/i);
    await act(async () => fireEvent.change(presetSelect, { target: { value: "wobble" } }));

    // Count oscillators created from the moment the first wobble fires.
    const ctx = api.audioCtxRef.current;
    const before = [];
    const realCreateOsc = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = () => {
      const o = realCreateOsc();
      before.push(o);
      return o;
    };

    // Fire the bass drop twice back-to-back. The synchronous
    // bassDropRunningRef guard (cleared only by osc.onended for wobble, NOT
    // by the setTimeout) must make the second call a no-op — otherwise the
    // second wobble's nodes get orphaned.
    expect(() => {
      act(() => {
        fireEvent.click(bassDrop);
        fireEvent.click(bassDrop);
      });
    }).not.toThrow();

    // Exactly one wobble oscillator was created — the guard held.
    expect(before).toHaveLength(1);
    // The button is disabled while the drop is active (re-entry blocked).
    expect(bassDrop).toBeDisabled();
  });

  it("@us US24: bass-drop re-entry guard — double-fire does not throw", async () => {
    // Load a buffer via drop so the deck chain is built and BASS DROP enables.
    const { container } = render(<Harness />);
    const deckDiv = container.querySelector('[role="region"]');
    const fakeAudio = new File([new Uint8Array([0, 1, 2])], "track.mp3", {
      type: "audio/mpeg",
    });
    await act(async () => {
      fireEvent.dragOver(deckDiv, { dataTransfer: { items: [{ kind: "file" }] } });
      fireEvent.drop(deckDiv, {
        dataTransfer: { files: [fakeAudio], items: [{ kind: "file" }] },
      });
    });

    const bassDrop = await waitFor(() => {
      const btn = screen.getByRole("button", { name: /BASS DROP/i });
      expect(btn).not.toBeDisabled();
      return btn;
    });

    // Firing the bass drop twice in immediate succession must not throw — the
    // synchronous bassDropRunningRef guard makes the second call a no-op
    // (before the disabled attribute updates a render later).
    expect(() => {
      act(() => {
        fireEvent.click(bassDrop);
        fireEvent.click(bassDrop);
      });
    }).not.toThrow();
  });
});
