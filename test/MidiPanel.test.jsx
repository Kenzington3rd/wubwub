import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Default props for MidiPanel — a fresh, un-mapped, disabled panel.
const baseProps = {
  enabled: false,
  onEnable: () => {},
  onDisable: () => {},
  mappings: {},
  learnTarget: null,
  onStartLearn: () => {},
  onCancelLearn: () => {},
  onClearMapping: () => {},
  inputName: null,
  error: null,
};

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.unmock("../src/midi/midiMap.js");
});

describe("MidiPanel — US39 (disclosure + collapse)", () => {
  it("@us US39: collapsed by default with aria-expanded=false", async () => {
    const { default: MidiPanel } = await import("../src/components/MidiPanel.jsx");
    render(<MidiPanel {...baseProps} />);
    const toggle = screen.getByRole("button", { name: /MIDI/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("@us US39: expanding the panel flips aria-expanded to true", async () => {
    const { default: MidiPanel } = await import("../src/components/MidiPanel.jsx");
    render(<MidiPanel {...baseProps} />);
    const toggle = screen.getByRole("button", { name: /MIDI/i });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});

describe("MidiPanel — US39 (Web MIDI unsupported)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("../src/midi/midiMap.js", () => ({
      MIDI_SUPPORTED: false,
      MIDI_TARGETS: [],
    }));
  });

  it("@us US39: shows the not-supported message when Web MIDI is unavailable", async () => {
    const { default: MidiPanel } = await import("../src/components/MidiPanel.jsx");
    render(<MidiPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /MIDI/i }));
    expect(
      screen.getByText(/Web MIDI isn't available here/i)
    ).toBeInTheDocument();
  });
});

describe("MidiPanel — US39 (Web MIDI supported)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("../src/midi/midiMap.js", () => ({
      MIDI_SUPPORTED: true,
      MIDI_TARGETS: [{ id: "crossfade", label: "Crossfader" }],
    }));
  });

  it("@us US39: Enable MIDI button is present when Web MIDI is supported", async () => {
    const { default: MidiPanel } = await import("../src/components/MidiPanel.jsx");
    render(<MidiPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^MIDI/i }));
    const enableBtn = screen.getByRole("button", { name: /Enable MIDI/i });
    expect(enableBtn).toBeInTheDocument();
    expect(enableBtn).toHaveAttribute("aria-pressed", "false");
  });
});
