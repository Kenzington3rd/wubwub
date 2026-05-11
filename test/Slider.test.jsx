import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Slider from "../src/components/Slider.jsx";

describe("Slider — used by US3 (volume), US4 (speed), US5 (filter), US7 (crossfade)", () => {
  it("@us US3: renders the optional label", () => {
    render(<Slider value={0.5} onChange={() => {}} label="VOL" />);
    expect(screen.getByText("VOL")).toBeInTheDocument();
  });

  it("@us US3: fires onChange with a parsed float when moved", () => {
    const onChange = vi.fn();
    render(<Slider value={0.5} onChange={onChange} />);
    const input = screen.getByRole("slider");
    fireEvent.change(input, { target: { value: "0.75" } });
    expect(onChange).toHaveBeenCalledWith(0.75);
  });

  it("@us US4: respects min/max/step props", () => {
    render(<Slider value={1} onChange={() => {}} min={0.5} max={2.0} step={0.01} />);
    const input = screen.getByRole("slider");
    expect(input.min).toBe("0.5");
    expect(input.max).toBe("2");
    expect(input.step).toBe("0.01");
  });

  it("@us US17: vertical orientation applies slider-vertical appearance", () => {
    render(<Slider value={0.5} onChange={() => {}} vertical />);
    const input = screen.getByRole("slider");
    expect(input.style.height).toBeTruthy();
    // happy-dom doesn't compute layout, but the inline style is set
  });
});
