import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TheoryPanel from "../src/components/TheoryPanel.jsx";

describe("TheoryPanel — US11, US12, US13, US26 (hints tab)", () => {
  it("@us US11: opens with the Harmonic Mixing tab selected", () => {
    render(<TheoryPanel />);
    // Camelot label "8B" should be present (C major key).
    expect(screen.getByText("8B")).toBeInTheDocument();
  });

  it("@us US11: clicking a key reveals its compatible-keys panel", () => {
    render(<TheoryPanel />);
    // Click the "8B" key button (C maj).
    const keyButton = screen.getByRole("button", { name: /^8B C maj$/i });
    fireEvent.click(keyButton);
    // After selection, the detail panel renders the selected key's compatible
    // codes in a paragraph that begins literally "Compatible keys: ".
    expect(screen.getByText(/^Compatible keys: /)).toBeInTheDocument();
  });

  it("@us US12: BPM tab shows genre BPM ranges", () => {
    render(<TheoryPanel />);
    // Tabs use proper tab semantics (role="tab"), not plain buttons.
    fireEvent.click(screen.getByRole("tab", { name: /Genre BPM Guide/i }));
    expect(screen.getByText("Dubstep")).toBeInTheDocument();
    expect(screen.getByText("House")).toBeInTheDocument();
  });

  it("@us US13: Tips tab shows a tip and a Next button that rotates them", () => {
    render(<TheoryPanel />);
    fireEvent.click(screen.getByRole("tab", { name: /DJ Tips/i }));
    const firstTipQuote = screen.getByText(/^".*"$/);
    const firstText = firstTipQuote.textContent;
    fireEvent.click(screen.getByRole("button", { name: /Next Tip/i }));
    const secondTipQuote = screen.getByText(/^".*"$/);
    expect(secondTipQuote.textContent).not.toBe(firstText);
  });

  it("@us US26: Shortcuts tab lists keyboard hints (Space, S, C, 1-8)", () => {
    render(<TheoryPanel />);
    fireEvent.click(screen.getByRole("tab", { name: /Shortcuts/i }));
    // <kbd> elements specifically — disambiguates from action descriptions
    // that also contain digit ranges.
    const kbds = document.querySelectorAll("kbd");
    const kbdTexts = Array.from(kbds).map((k) => k.textContent);
    expect(kbdTexts).toEqual(expect.arrayContaining(["Space", "1–8"]));
  });
});
