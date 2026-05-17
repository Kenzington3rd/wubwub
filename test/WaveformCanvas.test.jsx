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

function Harness({ onSeek, onMount, isLooping = false }) {
  const chainRef = useRef({ analyser: null });
  const currentTimeRef = useRef(0);
  const durationRef = useRef(60);
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
