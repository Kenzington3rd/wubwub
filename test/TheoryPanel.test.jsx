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

describe("TheoryPanel — US58 (live deck-key highlight on the Camelot wheel)", () => {
  it("@us US58: highlights the focused deck's detected key", () => {
    render(
      <TheoryPanel
        deckKeys={{ A: "8A", B: null }}
        focusedDeck="A"
        deckAColor="#00f5d4"
        deckBColor="#a78bfa"
      />
    );
    const keyBtn = screen.getByRole("button", { name: /^8A A min$/i });
    // The detected key carries a descriptive title pointing at the deck.
    expect(keyBtn.getAttribute("title")).toMatch(/Deck A detected key/i);
  });

  it("@us US58: marks the detected key's compatible neighbours", () => {
    render(
      <TheoryPanel deckKeys={{ A: "8A", B: null }} focusedDeck="A" />
    );
    // 8A's compatible neighbours: 8B, 9A, 7A.
    for (const code of ["8B", "9A", "7A"]) {
      const btn = screen.getByRole("button", {
        name: new RegExp(`^${code} `, "i"),
      });
      expect(btn.getAttribute("title")).toMatch(/Compatible with Deck A/i);
    }
    // A non-compatible key (e.g. 1A) carries no live-highlight title.
    const unrelated = screen.getByRole("button", { name: /^1A Ab min$/i });
    expect(unrelated.getAttribute("title")).toBeNull();
  });

  it("@us US58: surfaces the focused deck's detected key in a caption", () => {
    render(<TheoryPanel deckKeys={{ A: null, B: "5B" }} focusedDeck="B" />);
    expect(screen.getByText(/Deck B detected/i)).toBeInTheDocument();
    expect(screen.getByText(/5B \(Eb maj\)/i)).toBeInTheDocument();
  });

  it("@us US58: no highlight caption when neither deck has a detected key", () => {
    render(<TheoryPanel deckKeys={{ A: null, B: null }} focusedDeck="A" />);
    expect(screen.queryByText(/detected/i)).toBeNull();
  });
});
