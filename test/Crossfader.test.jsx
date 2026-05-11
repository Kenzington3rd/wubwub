import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Crossfader from "../src/components/Crossfader.jsx";

describe("Crossfader — US7, US35, US17", () => {
  it("@us US7: renders A and B labels around the fader", () => {
    render(
      <Crossfader value={0.5} onChange={() => {}} isMobile={false} curve="equal-power" onCurveChange={() => {}} />
    );
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("X-FADE")).toBeInTheDocument();
  });

  it("@us US35: shows a curve selector with all three options", () => {
    render(
      <Crossfader value={0.5} onChange={() => {}} isMobile={false} curve="equal-power" onCurveChange={() => {}} />
    );
    const select = screen.getByRole("combobox");
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(
      expect.arrayContaining(["equal-power", "linear", "constant-power-3db"])
    );
  });

  it("@us US35: changing the curve selector fires onCurveChange", () => {
    const onCurveChange = vi.fn();
    render(
      <Crossfader value={0.5} onChange={() => {}} isMobile={false} curve="equal-power" onCurveChange={onCurveChange} />
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "linear" } });
    expect(onCurveChange).toHaveBeenCalledWith("linear");
  });

  it("@us US17: mobile mode renders horizontally (no slider-vertical)", () => {
    render(
      <Crossfader value={0.5} onChange={() => {}} isMobile={true} curve="equal-power" onCurveChange={() => {}} />
    );
    const slider = screen.getByRole("slider");
    // In mobile (horizontal) mode the slider uses default width sizing.
    expect(slider.style.height).toBe("6px");
  });

  it("@us US7: changing the fader fires onChange with normalized value", () => {
    const onChange = vi.fn();
    render(
      <Crossfader value={0.5} onChange={onChange} isMobile={true} curve="equal-power" onCurveChange={() => {}} />
    );
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0.8" } });
    expect(onChange).toHaveBeenCalledWith(0.8);
  });
});
