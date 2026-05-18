import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Crate from "../src/components/Crate.jsx";

function baseProps(overrides = {}) {
  return {
    entries: [],
    onAdd: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn(),
    onClear: vi.fn(),
    onLoadToDeck: vi.fn(),
    deckAColor: "#00f5d4",
    deckBColor: "#a78bfa",
    ...overrides,
  };
}

const SAMPLE_ENTRIES = [
  { id: 1, name: "track-one.mp3", bpm: null, camelot: null },
  { id: 2, name: "track-two.wav", bpm: 128, camelot: "8B" },
];

describe("Crate panel — W1.5 / US63", () => {
  it("@us US63: the panel is a labelled region", () => {
    render(<Crate {...baseProps()} />);
    expect(
      screen.getByRole("region", { name: /Session crate/i })
    ).toBeInTheDocument();
  });

  it("@us US63: an empty crate shows a call-to-action empty state", () => {
    render(<Crate {...baseProps({ entries: [] })} />);
    expect(screen.getByText(/Crate is empty/i)).toBeInTheDocument();
  });

  it("@us US63: each entry lists its file name and load buttons for both decks", () => {
    render(<Crate {...baseProps({ entries: SAMPLE_ENTRIES })} />);
    expect(screen.getByText("track-one.mp3")).toBeInTheDocument();
    expect(screen.getByText("track-two.wav")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Load "track-one.mp3" to deck A/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Load "track-one.mp3" to deck B/i })
    ).toBeInTheDocument();
  });

  it("@us US63: clicking a load button quick-loads that entry to the deck", () => {
    const onLoadToDeck = vi.fn();
    render(<Crate {...baseProps({ entries: SAMPLE_ENTRIES, onLoadToDeck })} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Load "track-two.wav" to deck B/i })
    );
    expect(onLoadToDeck).toHaveBeenCalledWith("B", 2);
  });

  it("@us US63: removing an entry calls onRemove with its id", () => {
    const onRemove = vi.fn();
    render(<Crate {...baseProps({ entries: SAMPLE_ENTRIES, onRemove })} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Remove "track-one.mp3"/i })
    );
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it("@us US63: Clear is shown only when the crate has entries", () => {
    const { rerender } = render(<Crate {...baseProps({ entries: [] })} />);
    expect(
      screen.queryByRole("button", { name: /Clear the whole crate/i })
    ).toBeNull();
    rerender(<Crate {...baseProps({ entries: SAMPLE_ENTRIES })} />);
    expect(
      screen.getByRole("button", { name: /Clear the whole crate/i })
    ).toBeInTheDocument();
  });

  it("@us US63: clicking Clear calls onClear", () => {
    const onClear = vi.fn();
    render(<Crate {...baseProps({ entries: SAMPLE_ENTRIES, onClear })} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Clear the whole crate/i })
    );
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("@us US63: a known BPM / key shows in the entry columns", () => {
    render(<Crate {...baseProps({ entries: SAMPLE_ENTRIES })} />);
    expect(screen.getByText(/128 BPM/)).toBeInTheDocument();
    expect(screen.getByText("8B")).toBeInTheDocument();
  });

  it("@us US63: dropping an audio file decodes it via onAdd", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<Crate {...baseProps({ onAdd })} />);
    const region = screen.getByRole("region", { name: /Session crate/i });
    const file = new File([new Uint8Array([1, 2, 3])], "drop.mp3", {
      type: "audio/mpeg",
    });
    await fireEvent.drop(region, {
      dataTransfer: { files: [file], items: [{ kind: "file" }] },
    });
    expect(onAdd).toHaveBeenCalledWith(file);
  });

  it("@us US63: dropping a non-audio file shows an inline error, never throws", async () => {
    const onAdd = vi.fn();
    render(<Crate {...baseProps({ onAdd })} />);
    const region = screen.getByRole("region", { name: /Session crate/i });
    const bad = new File(["text"], "notes.txt", { type: "text/plain" });
    await fireEvent.drop(region, {
      dataTransfer: { files: [bad], items: [{ kind: "file" }] },
    });
    expect(onAdd).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/skipped/i);
  });

  it("@us US63: load buttons track the user-selected deck accent colors", () => {
    // Deck accents are user-selectable — the crate's "→ A" / "→ B" buttons
    // must tint with the threaded deckAColor / deckBColor props, not a
    // hard-coded cyan / purple.
    render(
      <Crate
        {...baseProps({
          entries: SAMPLE_ENTRIES,
          deckAColor: "#4ade80", // green
          deckBColor: "#fb923c", // orange
        })}
      />
    );
    const toA = screen.getAllByRole("button", { name: /to deck A/i })[0];
    const toB = screen.getAllByRole("button", { name: /to deck B/i })[0];
    expect(toA.style.color).toBe("#4ade80");
    expect(toB.style.color).toBe("#fb923c");
  });

  it("@us US63: a decode failure during add surfaces an inline error", async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error("decode failed"));
    render(<Crate {...baseProps({ onAdd })} />);
    const region = screen.getByRole("region", { name: /Session crate/i });
    const file = new File([new Uint8Array([0])], "corrupt.mp3", {
      type: "audio/mpeg",
    });
    await fireEvent.drop(region, {
      dataTransfer: { files: [file], items: [{ kind: "file" }] },
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
