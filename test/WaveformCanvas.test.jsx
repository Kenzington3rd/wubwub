import { describe, it, expect, vi } from "vitest";
import { useRef } from "react";
import { render, fireEvent } from "@testing-library/react";
import WaveformCanvas from "../src/components/WaveformCanvas.jsx";

// happy-dom returns 0 for clientWidth/getBoundingClientRect width by default.
// Stub it so click-to-seek can compute a sensible normalized x.
function stubBoundingRect(width = 400) {
  HTMLCanvasElement.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, width, height: 120, right: width, bottom: 120, x: 0, y: 0 };
  };
}

function Harness({
  onSeek,
  onMount,
  isLooping = false,
  duration = 60,
  currentTime = 0,
}) {
  const chainRef = useRef({ analyser: null });
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  const cuesRef = useRef([]);
  if (onMount) onMount({ chainRef, currentTimeRef, durationRef, cuesRef });
  return (
    <WaveformCanvas
      chainRef={chainRef}
      color="#00f5d4"
      isLooping={isLooping}
      currentTimeRef={currentTimeRef}
      durationRef={durationRef}
      cuesRef={cuesRef}
      onSeek={onSeek}
      ariaLabel="Seek position in deck A track"
    />
  );
}

describe("WaveformCanvas — US10, US14, US46", () => {
  it("@us US10: renders a canvas element of width 400 × height 120", () => {
    const { container } = render(<Harness />);
    const canvas = container.querySelector("canvas");
    expect(canvas).toBeTruthy();
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(120);
  });

  it("@us US14: pointerdown on the canvas fires onSeek with normalized x", () => {
    stubBoundingRect(400);
    const onSeek = vi.fn();
    const { container } = render(<Harness onSeek={onSeek} />);
    const canvas = container.querySelector("canvas");
    fireEvent.pointerDown(canvas, { clientX: 200 });
    expect(onSeek).toHaveBeenCalled();
    const norm = onSeek.mock.calls.at(-1)[0];
    expect(norm).toBeGreaterThan(0.4);
    expect(norm).toBeLessThan(0.6);
  });

  it("@us US14: when onSeek is absent, canvas cursor is default (not crosshair)", () => {
    const { container } = render(<Harness />);
    const canvas = container.querySelector("canvas");
    expect(canvas.style.cursor).toBe("default");
  });

  it("@us US14: when onSeek is provided, canvas cursor is crosshair", () => {
    const { container } = render(<Harness onSeek={() => {}} />);
    const canvas = container.querySelector("canvas");
    expect(canvas.style.cursor).toBe("crosshair");
  });

  it("@us US46: looping renders a dashed border (bug-fix verification)", () => {
    const { container } = render(<Harness isLooping={true} />);
    const canvas = container.querySelector("canvas");
    expect(canvas.style.border).toMatch(/dashed/);
  });

  it("@us US46: not looping renders a solid border", () => {
    const { container } = render(<Harness isLooping={false} />);
    const canvas = container.querySelector("canvas");
    expect(canvas.style.border).toMatch(/solid/);
  });
});

describe("WaveformCanvas — keyboard seek (US64)", () => {
  it("@us US64: with onSeek the canvas is a focusable role=slider with ARIA value", () => {
    const { container } = render(
      <Harness onSeek={() => {}} duration={120} currentTime={30} />
    );
    const canvas = container.querySelector("canvas");
    expect(canvas.getAttribute("role")).toBe("slider");
    expect(canvas.getAttribute("tabindex")).toBe("0");
    expect(canvas.getAttribute("aria-label")).toMatch(/seek/i);
    expect(canvas.getAttribute("aria-valuemin")).toBe("0");
    expect(canvas.getAttribute("aria-valuemax")).toBe("120");
    expect(canvas.getAttribute("aria-valuenow")).toBe("30");
    expect(canvas.getAttribute("aria-valuetext")).toBe("0:30 / 2:00");
  });

  it("@us US64: with no onSeek (no track) the canvas is not a focusable slider", () => {
    const { container } = render(<Harness />);
    const canvas = container.querySelector("canvas");
    expect(canvas.getAttribute("role")).toBeNull();
    expect(canvas.getAttribute("tabindex")).toBeNull();
    expect(canvas.getAttribute("aria-valuenow")).toBeNull();
  });

  it("@us US64: ArrowRight seeks +5 s as a normalized fraction", () => {
    const onSeek = vi.fn();
    const { container } = render(
      <Harness onSeek={onSeek} duration={100} currentTime={20} />
    );
    const canvas = container.querySelector("canvas");
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    expect(onSeek).toHaveBeenCalledTimes(1);
    // 20 s + 5 s = 25 s of 100 s → 0.25
    expect(onSeek.mock.calls.at(-1)[0]).toBeCloseTo(0.25, 5);
  });

  it("@us US64: ArrowLeft seeks -5 s and clamps at the start", () => {
    const onSeek = vi.fn();
    const { container } = render(
      <Harness onSeek={onSeek} duration={100} currentTime={2} />
    );
    const canvas = container.querySelector("canvas");
    fireEvent.keyDown(canvas, { key: "ArrowLeft" });
    // 2 s - 5 s clamps to 0 → 0.0
    expect(onSeek.mock.calls.at(-1)[0]).toBe(0);
  });

  it("@us US64: Home seeks to 0 and End seeks to the track end", () => {
    const onSeek = vi.fn();
    const { container } = render(
      <Harness onSeek={onSeek} duration={100} currentTime={50} />
    );
    const canvas = container.querySelector("canvas");
    fireEvent.keyDown(canvas, { key: "Home" });
    expect(onSeek.mock.calls.at(-1)[0]).toBe(0);
    fireEvent.keyDown(canvas, { key: "End" });
    // End lands a hair before duration so a non-looping track doesn't reset.
    expect(onSeek.mock.calls.at(-1)[0]).toBeCloseTo(1, 3);
    expect(onSeek.mock.calls.at(-1)[0]).toBeLessThanOrEqual(1);
  });

  it("@us US64: a consumed arrow key has propagation stopped (global handler skipped)", () => {
    // The canvas must stopPropagation() on keys it seeks with — otherwise the
    // global App keydown handler would ALSO move the crossfader/volume.
    const onSeek = vi.fn();
    const { container } = render(
      <Harness onSeek={onSeek} duration={100} currentTime={20} />
    );
    const canvas = container.querySelector("canvas");

    // Listen on window: a stopPropagation'd event never reaches it.
    const windowSpy = vi.fn();
    window.addEventListener("keydown", windowSpy);
    try {
      fireEvent.keyDown(canvas, { key: "ArrowRight" });
      expect(onSeek).toHaveBeenCalledTimes(1);
      // The event bubbled out of the canvas was stopped before window.
      expect(windowSpy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", windowSpy);
    }
  });

  it("@us US64: a non-seek key bubbles normally (not consumed)", () => {
    const onSeek = vi.fn();
    const { container } = render(
      <Harness onSeek={onSeek} duration={100} currentTime={20} />
    );
    const canvas = container.querySelector("canvas");
    const windowSpy = vi.fn();
    window.addEventListener("keydown", windowSpy);
    try {
      fireEvent.keyDown(canvas, { key: "a" });
      expect(onSeek).not.toHaveBeenCalled();
      // Not a seek key — it must still reach the global handler.
      expect(windowSpy).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", windowSpy);
    }
  });

  it("@us US64: keyboard seek is a no-op when there is no track duration", () => {
    const onSeek = vi.fn();
    const { container } = render(
      <Harness onSeek={onSeek} duration={0} currentTime={0} />
    );
    const canvas = container.querySelector("canvas");
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    expect(onSeek).not.toHaveBeenCalled();
  });
});
