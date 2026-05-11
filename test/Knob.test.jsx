import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Knob from "../src/components/Knob.jsx";

describe("Knob — used by US6 (EQ), US18-20 (Effects)", () => {
  it("@us US6: renders with label and formatted value", () => {
    render(<Knob value={0} onChange={() => {}} label="LOW" />);
    expect(screen.getByText("LOW")).toBeInTheDocument();
    // Default formatter shows "0" with no sign for zero.
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("@us US6: positive values show with a leading '+'", () => {
    render(<Knob value={6} onChange={() => {}} label="MID" />);
    expect(screen.getByText("+6")).toBeInTheDocument();
  });

  it("@us US6: custom format function overrides default rendering", () => {
    render(
      <Knob
        value={0.5}
        onChange={() => {}}
        min={0}
        max={1}
        label="MIX"
        format={(v) => `${Math.round(v * 100)}%`}
      />
    );
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("@us US6: dragging up calls onChange with a higher value (clamped to max)", () => {
    const onChange = vi.fn();
    render(<Knob value={0} onChange={onChange} min={-12} max={12} label="MID" />);
    const knob = screen.getByText("MID").parentElement.firstChild;
    fireEvent.pointerDown(knob, { clientY: 200 });
    fireEvent.pointerMove(window, { clientY: 100 });
    fireEvent.pointerUp(window);
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls.at(-1)[0];
    expect(lastCall).toBeGreaterThan(0);
    expect(lastCall).toBeLessThanOrEqual(12);
  });

  it("@us US6: onChange respects min bound when dragging down past it", () => {
    const onChange = vi.fn();
    render(<Knob value={0} onChange={onChange} min={0} max={1} label="DRIVE" />);
    const knob = screen.getByText("DRIVE").parentElement.firstChild;
    fireEvent.pointerDown(knob, { clientY: 0 });
    fireEvent.pointerMove(window, { clientY: 1000 });
    fireEvent.pointerUp(window);
    const lastCall = onChange.mock.calls.at(-1)[0];
    expect(lastCall).toBeGreaterThanOrEqual(0);
  });
});
