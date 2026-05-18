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

  it("@us US50 (a11y): aria-pressed reflects the active swatch", () => {
    // value === "#a78bfa" → the Purple swatch is the selected theme.
    render(<ThemePicker deckId="A" value="#a78bfa" onChange={() => {}} />);
    const activeSwatch = screen.getByRole("button", { name: /Deck A color: Purple/ });
    expect(activeSwatch).toHaveAttribute("aria-pressed", "true");
    // Every other swatch must report aria-pressed="false".
    for (const c of COLOR_THEMES) {
      if (c.name === "Purple") continue;
      expect(
        screen.getByRole("button", { name: `Deck A color: ${c.name}` })
      ).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("@us US50 (a11y): exactly one swatch is aria-pressed at a time", () => {
    render(<ThemePicker deckId="B" value="#f0c040" onChange={() => {}} />);
    const pressed = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
  });
});
