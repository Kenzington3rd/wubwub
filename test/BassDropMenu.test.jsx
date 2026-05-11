import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BassDropMenu from "../src/components/BassDropMenu.jsx";

describe("BassDropMenu — US34", () => {
  it("@us US34: lists Standard, Heavy, Wobble options", () => {
    render(<BassDropMenu preset="standard" onChange={() => {}} color="#00f5d4" />);
    const options = Array.from(screen.getByRole("combobox").options).map((o) => o.text);
    expect(options).toEqual(expect.arrayContaining(["Standard", "Heavy", "Wobble"]));
  });

  it("@us US34: change fires onChange with the selected preset id", () => {
    const onChange = vi.fn();
    render(<BassDropMenu preset="standard" onChange={onChange} color="#00f5d4" />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "wobble" } });
    expect(onChange).toHaveBeenCalledWith("wobble");
  });
});
