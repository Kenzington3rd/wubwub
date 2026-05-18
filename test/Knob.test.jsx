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

  it("@us US6 (a11y): exposes slider role + aria-value attributes", () => {
    render(<Knob value={3} onChange={() => {}} min={-12} max={12} label="MID" />);
    const knob = screen.getByRole("slider", { name: "MID" });
    expect(knob).toHaveAttribute("aria-valuenow", "3");
    expect(knob).toHaveAttribute("aria-valuemin", "-12");
    expect(knob).toHaveAttribute("aria-valuemax", "12");
    expect(knob).toHaveAttribute("tabindex", "0");
  });

  it("@us US6 (a11y): ArrowUp / ArrowRight increment by one step", () => {
    const onChange = vi.fn();
    render(<Knob value={0} onChange={onChange} min={-12} max={12} label="MID" />);
    const knob = screen.getByRole("slider", { name: "MID" });
    // Integer range of 24 → step is 24/100 rounded = 0.24.
    fireEvent.keyDown(knob, { key: "ArrowUp" });
    expect(onChange.mock.calls.at(-1)[0]).toBeGreaterThan(0);
    fireEvent.keyDown(knob, { key: "ArrowRight" });
    expect(onChange.mock.calls.at(-1)[0]).toBeGreaterThan(0);
  });

  it("@us US6 (a11y): ArrowDown / ArrowLeft decrement by one step", () => {
    const onChange = vi.fn();
    render(<Knob value={0} onChange={onChange} min={-12} max={12} label="MID" />);
    const knob = screen.getByRole("slider", { name: "MID" });
    fireEvent.keyDown(knob, { key: "ArrowDown" });
    expect(onChange.mock.calls.at(-1)[0]).toBeLessThan(0);
    fireEvent.keyDown(knob, { key: "ArrowLeft" });
    expect(onChange.mock.calls.at(-1)[0]).toBeLessThan(0);
  });

  it("@us US6 (a11y): Home jumps to min, End jumps to max", () => {
    const onChange = vi.fn();
    render(<Knob value={0} onChange={onChange} min={-12} max={12} label="MID" />);
    const knob = screen.getByRole("slider", { name: "MID" });
    fireEvent.keyDown(knob, { key: "Home" });
    expect(onChange.mock.calls.at(-1)[0]).toBe(-12);
    fireEvent.keyDown(knob, { key: "End" });
    expect(onChange.mock.calls.at(-1)[0]).toBe(12);
  });

  it("@us US6 (a11y): keyboard steps are clamped to the range", () => {
    const onChange = vi.fn();
    render(<Knob value={12} onChange={onChange} min={-12} max={12} label="MID" />);
    const knob = screen.getByRole("slider", { name: "MID" });
    fireEvent.keyDown(knob, { key: "ArrowUp" });
    // Already at max — clamps, never exceeds.
    expect(onChange.mock.calls.at(-1)[0]).toBeLessThanOrEqual(12);
  });

  it("@us US6 (a11y): disabled prop sets tabindex=-1 and not-allowed cursor", () => {
    render(<Knob value={0} onChange={() => {}} label="MIX" disabled />);
    const knob = screen.getByRole("slider", { name: "MIX" });
    expect(knob).toHaveAttribute("tabindex", "-1");
    expect(knob.style.cursor).toBe("not-allowed");
  });

  it("@us US6 (a11y): disabled blocks keyboard input", () => {
    const onChange = vi.fn();
    render(<Knob value={0} onChange={onChange} min={-12} max={12} label="MIX" disabled />);
    const knob = screen.getByRole("slider", { name: "MIX" });
    fireEvent.keyDown(knob, { key: "ArrowUp" });
    fireEvent.keyDown(knob, { key: "End" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("@us US6 (a11y): disabled blocks pointer drag", () => {
    const onChange = vi.fn();
    render(<Knob value={0} onChange={onChange} min={-12} max={12} label="MIX" disabled />);
    const knob = screen.getByRole("slider", { name: "MIX" });
    fireEvent.pointerDown(knob, { clientY: 200 });
    fireEvent.pointerMove(window, { clientY: 100 });
    fireEvent.pointerUp(window);
    expect(onChange).not.toHaveBeenCalled();
  });
});
