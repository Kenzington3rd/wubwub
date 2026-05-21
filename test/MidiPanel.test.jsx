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
    // W3 (R20) — DESIGN_GUIDE §6 explicitly requires toggle buttons to expose
    // aria-pressed. The standard ARIA pattern for action-labelled toggles is
    // "action label + pressed state": "Disable MIDI, pressed" correctly reads
    // as "the button is in pressed/enabled state; clicking it will disable."
    expect(enableBtn).toHaveAttribute("aria-pressed", "false");
    // type="button" so wrapping in a form would never accidentally submit.
    expect(enableBtn).toHaveAttribute("type", "button");
  });

  // @us US39 (W3 R20) — enabled state flips aria-pressed=true; the action
  // label flips to "Disable MIDI". A screen reader announces "Disable MIDI,
  // pressed" — i.e. the toggle is currently in pressed/enabled state and
  // clicking it will perform the labelled action (disable).
  it("@us US39: enabled state carries aria-pressed=true with the Disable label", async () => {
    const { default: MidiPanel } = await import("../src/components/MidiPanel.jsx");
    render(<MidiPanel {...baseProps} enabled />);
    fireEvent.click(screen.getByRole("button", { name: /^MIDI/i }));
    const disableBtn = screen.getByRole("button", { name: /Disable MIDI/i });
    expect(disableBtn).toHaveAttribute("aria-pressed", "true");
    expect(disableBtn).toHaveAttribute("type", "button");
  });
});

// C1 + C2 — once a mapping exists with the new shape, the per-row summary
// shows ch/cc or ch/note, appends the controller name only when more than one
// controller is bound, and the mode dropdown is visible for CC mappings.
describe("MidiPanel — US39 (mapping display, bugs C1 + C2 + C3)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("../src/midi/midiMap.js", () => ({
      MIDI_SUPPORTED: true,
      MIDI_TARGETS: [
        { id: "crossfade", label: "Crossfader" },
        { id: "deckA.volume", label: "Deck A Volume" },
      ],
    }));
  });

  it("@us US39 (bug C1): single controller — summary is plain 'ch1 cc7' (no name)", async () => {
    const { default: MidiPanel } = await import("../src/components/MidiPanel.jsx");
    render(
      <MidiPanel
        {...baseProps}
        enabled
        mappings={{
          crossfade: {
            inputId: "in-a",
            channel: 0,
            kind: "cc",
            number: 7,
            mode: "absolute",
          },
        }}
        inputNames={{ "in-a": "DDJ-FLX4" }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^MIDI/i }));
    expect(screen.getByText(/^ch1 cc7$/)).toBeInTheDocument();
  });

  it("@us US39 (bug C1): two controllers — summary appends the controller name", async () => {
    const { default: MidiPanel } = await import("../src/components/MidiPanel.jsx");
    render(
      <MidiPanel
        {...baseProps}
        enabled
        mappings={{
          crossfade: {
            inputId: "in-a",
            channel: 0,
            kind: "cc",
            number: 7,
            mode: "absolute",
          },
          "deckA.volume": {
            inputId: "in-b",
            channel: 0,
            kind: "cc",
            number: 7,
            mode: "absolute",
          },
        }}
        inputNames={{ "in-a": "DDJ-FLX4", "in-b": "Launch Control" }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^MIDI/i }));
    expect(screen.getByText(/ch1 cc7 · DDJ-FLX4/)).toBeInTheDocument();
    expect(screen.getByText(/ch1 cc7 · Launch Control/)).toBeInTheDocument();
  });

  it("@us US39 (bug C2): note mapping renders 'ch1 note36'", async () => {
    const { default: MidiPanel } = await import("../src/components/MidiPanel.jsx");
    render(
      <MidiPanel
        {...baseProps}
        enabled
        mappings={{
          crossfade: {
            inputId: "in-a",
            channel: 0,
            kind: "note",
            number: 36,
            mode: "absolute",
          },
        }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^MIDI/i }));
    expect(screen.getByText(/^ch1 note36$/)).toBeInTheDocument();
  });

  it("@us US39 (bug C3): a CC mapping renders the Mode dropdown defaulted to its mode", async () => {
    const { default: MidiPanel } = await import("../src/components/MidiPanel.jsx");
    render(
      <MidiPanel
        {...baseProps}
        enabled
        onChangeMode={() => {}}
        mappings={{
          crossfade: {
            inputId: "in-a",
            channel: 0,
            kind: "cc",
            number: 7,
            mode: "relative2c",
          },
        }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^MIDI/i }));
    const select = screen.getByRole("combobox", { name: /Mode for Crossfader/i });
    expect(select).toHaveValue("relative2c");
  });

  it("@us US39 (bug C3): note mappings have no Mode dropdown", async () => {
    const { default: MidiPanel } = await import("../src/components/MidiPanel.jsx");
    render(
      <MidiPanel
        {...baseProps}
        enabled
        onChangeMode={() => {}}
        mappings={{
          crossfade: {
            inputId: "in-a",
            channel: 0,
            kind: "note",
            number: 36,
            mode: "absolute",
          },
        }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^MIDI/i }));
    expect(
      screen.queryByRole("combobox", { name: /Mode for Crossfader/i })
    ).not.toBeInTheDocument();
  });

  it("@us US39 (bug C3): changing the Mode dropdown calls onChangeMode with the new mode", async () => {
    const { default: MidiPanel } = await import("../src/components/MidiPanel.jsx");
    const onChangeMode = vi.fn();
    render(
      <MidiPanel
        {...baseProps}
        enabled
        onChangeMode={onChangeMode}
        mappings={{
          crossfade: {
            inputId: "in-a",
            channel: 0,
            kind: "cc",
            number: 7,
            mode: "absolute",
          },
        }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^MIDI/i }));
    const select = screen.getByRole("combobox", { name: /Mode for Crossfader/i });
    fireEvent.change(select, { target: { value: "relative2c" } });
    expect(onChangeMode).toHaveBeenCalledWith("crossfade", "relative2c");
  });
});
