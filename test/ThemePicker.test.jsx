import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ThemePicker from "../src/components/ThemePicker.jsx";
import { COLOR_THEMES } from "../src/data.js";

describe("ThemePicker — US36, US50", () => {
  it("@us US36: renders a swatch per color theme", () => {
    render(<ThemePicker deckId="A" value="#00f5d4" onChange={() => {}} />);
    for (const c of COLOR_THEMES) {
      expect(
        screen.getByRole("button", { name: `Deck A color: ${c.name}` })
      ).toBeInTheDocument();
    }
  });

  it("@us US36: clicking a swatch fires onChange with that color value", () => {
    const onChange = vi.fn();
    render(<ThemePicker deckId="B" value="#a78bfa" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Deck B color: Gold/ }));
    expect(onChange).toHaveBeenCalledWith("#f0c040");
  });

  it("@us US50: each swatch has an aria-label naming the deck and color", () => {
    render(<ThemePicker deckId="A" value="#00f5d4" onChange={() => {}} />);
    expect(
      screen.getAllByRole("button").every((b) => b.getAttribute("aria-label"))
    ).toBe(true);
  });
});
