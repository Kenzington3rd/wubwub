import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import MasterBus from "../src/components/MasterBus.jsx";

// Minimal props the component needs; individual tests override what they test.
function baseProps(overrides = {}) {
  return {
    masterVol: 0.85,
    onMasterVolChange: () => {},
    deckAColor: "#00f5d4",
    deckBColor: "#a78bfa",
    onDeckAColorChange: () => {},
    onDeckBColorChange: () => {},
    isRecording: false,
    onToggleRecord: () => {},
    recordSupported: true,
    recordStartedAt: null,
    recordTapMode: "post",
    onRecordTapModeChange: () => {},
    markerCount: 0,
    onDropMarker: () => {},
    clipAnalyserRef: { current: null },
    ...overrides,
  };
}

describe("MasterBus marker button — US60 (W1.3)", () => {
  it("@us US60: MARKER button is disabled when not recording", () => {
    render(<MasterBus {...baseProps({ isRecording: false })} />);
    const btn = screen.getByRole("button", { name: /Drop a cue marker/i });
    expect(btn).toBeDisabled();
  });

  it("@us US60: MARKER button is enabled while recording", () => {
    render(
      <MasterBus
        {...baseProps({ isRecording: true, recordStartedAt: Date.now() })}
      />
    );
    const btn = screen.getByRole("button", { name: /Drop a cue marker/i });
    expect(btn).not.toBeDisabled();
  });

  it("@us US60: clicking MARKER while recording invokes onDropMarker", () => {
    const onDropMarker = vi.fn();
    render(
      <MasterBus
        {...baseProps({
          isRecording: true,
          recordStartedAt: Date.now(),
          onDropMarker,
        })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Drop a cue marker/i }));
    expect(onDropMarker).toHaveBeenCalledTimes(1);
  });

  it("@us US60: shows a live count badge once markers are dropped", () => {
    render(
      <MasterBus
        {...baseProps({
          isRecording: true,
          recordStartedAt: Date.now(),
          markerCount: 3,
        })}
      />
    );
    const btn = screen.getByRole("button", { name: /Drop a cue marker/i });
    expect(btn).toHaveTextContent("3");
  });

  it("@us US60: a marker drop is announced on the recording live region", () => {
    const { rerender } = render(
      <MasterBus
        {...baseProps({
          isRecording: true,
          recordStartedAt: Date.now(),
          markerCount: 0,
        })}
      />
    );
    const live = screen.getByRole("status");
    expect(live).not.toHaveTextContent(/Marker/i);
    // Marker count increasing (button or `M` key) → drop announced.
    rerender(
      <MasterBus
        {...baseProps({
          isRecording: true,
          recordStartedAt: Date.now(),
          markerCount: 1,
        })}
      />
    );
    expect(live).toHaveTextContent("Marker 1 dropped");
    rerender(
      <MasterBus
        {...baseProps({
          isRecording: true,
          recordStartedAt: Date.now(),
          markerCount: 2,
        })}
      />
    );
    expect(live).toHaveTextContent("Marker 2 dropped");
  });
});

describe("MasterBus recorder tap toggle — US61 (W1.7)", () => {
  it("@us US61: Clean and Radio toggle options are present", () => {
    render(<MasterBus {...baseProps()} />);
    expect(screen.getByRole("button", { name: /Clean/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Radio/i })).toBeInTheDocument();
  });

  it("@us US61: the toggle is enabled (changeable) while idle", () => {
    render(<MasterBus {...baseProps({ isRecording: false })} />);
    expect(screen.getByRole("button", { name: /Clean/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /Radio/i })).not.toBeDisabled();
  });

  it("@us US61: the toggle is disabled while a recording is in progress", () => {
    render(
      <MasterBus
        {...baseProps({ isRecording: true, recordStartedAt: Date.now() })}
      />
    );
    expect(screen.getByRole("button", { name: /Clean/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Radio/i })).toBeDisabled();
  });

  it("@us US61: choosing a tap mode invokes onRecordTapModeChange", () => {
    const onRecordTapModeChange = vi.fn();
    render(<MasterBus {...baseProps({ onRecordTapModeChange })} />);
    fireEvent.click(screen.getByRole("button", { name: /Clean/i }));
    expect(onRecordTapModeChange).toHaveBeenCalledWith("pre");
  });

  it("@us US61: the active tap segment uses the gold master accent, not cyan", () => {
    // "post" is active by default — the MasterBus is the gold master surface.
    render(<MasterBus {...baseProps({ recordTapMode: "post" })} />);
    const radio = screen.getByRole("button", { name: /Radio/i });
    expect(radio.style.color).toBe("#f0c040");
    expect(radio.style.background).toBe("rgba(240, 192, 64, 0.18)");
    // Inactive segment stays neutral slate, not an accent.
    const clean = screen.getByRole("button", { name: /Clean/i });
    expect(clean.style.color).toBe("#8892b0");
  });
});

describe("MasterBus clip meter — US61 (W1.7)", () => {
  let rafQueue;
  beforeEach(() => {
    // Drive rAF synchronously so the clip-meter loop can be stepped in tests.
    rafQueue = [];
    vi.stubGlobal("requestAnimationFrame", (cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function flushRaf() {
    const q = rafQueue;
    rafQueue = [];
    q.forEach((cb) => cb(0));
  }

  it("@us US61: clip indicator stays calm for a quiet signal", () => {
    const analyser = {
      getFloatTimeDomainData: (arr) => arr.fill(0.2),
    };
    render(
      <MasterBus {...baseProps({ clipAnalyserRef: { current: analyser } })} />
    );
    act(() => flushRaf());
    // The clip meter is visual-only (no live region): its calm/clipping state
    // is carried by the title attribute, not role="status".
    expect(screen.getByTitle(/Clip meter/i)).toBeInTheDocument();
  });

  it("@us US61: clip indicator lights when peak exceeds the clip threshold", () => {
    const analyser = {
      // Peak 1.0 > 0.99 threshold → clipping.
      getFloatTimeDomainData: (arr) => arr.fill(1.0),
    };
    render(
      <MasterBus {...baseProps({ clipAnalyserRef: { current: analyser } })} />
    );
    act(() => flushRaf());
    expect(screen.getByTitle(/Clipping — the master signal is too hot/i)).toBeInTheDocument();
  });

  it("@us US61: clip indicator is purely visual — no role=status live region", () => {
    const analyser = { getFloatTimeDomainData: (arr) => arr.fill(1.0) };
    render(
      <MasterBus {...baseProps({ clipAnalyserRef: { current: analyser } })} />
    );
    act(() => flushRaf());
    // role="status" would announce on every on/off flip — many per second on
    // a hot signal. The clip meter must not be a live region.
    expect(
      screen.queryByRole("status", { name: /Audio (clipping|level normal)/i })
    ).toBeNull();
  });
});
