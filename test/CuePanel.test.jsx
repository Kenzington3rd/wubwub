import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CuePanel from "../src/components/CuePanel.jsx";

const cue = (id, time, color = "#00f5d4") => ({ id, time, color });

describe("CuePanel — US22, US23, US24, US47", () => {
  it("@us US22: '+ CUE' button is enabled when there's a file and room", () => {
    render(
      <CuePanel cues={[]} color="#00f5d4" disabled={false} onSet={() => {}} onJump={() => {}} onDelete={() => {}} />
    );
    const btn = screen.getByRole("button", { name: /add cue/i });
    expect(btn).toBeEnabled();
    expect(btn.textContent).toContain("+ CUE");
  });

  it("@us US22: clicking '+ CUE' fires onSet", () => {
    const onSet = vi.fn();
    render(
      <CuePanel cues={[]} color="#00f5d4" disabled={false} onSet={onSet} onJump={() => {}} onDelete={() => {}} />
    );
    fireEvent.click(screen.getByRole("button", { name: /add cue/i }));
    expect(onSet).toHaveBeenCalledOnce();
  });

  it("@us US47: shows '8 / 8' and is disabled when at the limit", () => {
    const cues = Array.from({ length: 8 }, (_, i) => cue(i, i * 10));
    render(
      <CuePanel
        cues={cues}
        color="#00f5d4"
        disabled
        maxReached
        onSet={() => {}}
        onJump={() => {}}
        onDelete={() => {}}
      />
    );
    const btn = screen.getByRole("button", { name: /cue limit reached/i });
    expect(btn).toBeDisabled();
    expect(btn.textContent).toContain("8 / 8");
  });

  it("@us US23: clicking a cue chip fires onJump with its index", () => {
    const onJump = vi.fn();
    render(
      <CuePanel
        cues={[cue(1, 12.3), cue(2, 45.6)]}
        color="#00f5d4"
        disabled={false}
        onSet={() => {}}
        onJump={onJump}
        onDelete={() => {}}
      />
    );
    // The chip's first button is the jump button. Click the "2" label.
    fireEvent.click(screen.getAllByText("2")[0]);
    expect(onJump).toHaveBeenCalledWith(1);
  });

  it("@us US24: clicking the × button on a cue fires onDelete with its id", () => {
    const onDelete = vi.fn();
    render(
      <CuePanel
        cues={[cue(42, 12.3)]}
        color="#00f5d4"
        disabled={false}
        onSet={() => {}}
        onJump={() => {}}
        onDelete={onDelete}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /delete cue 1/i }));
    expect(onDelete).toHaveBeenCalledWith(42);
  });

  it("@us US50 (a11y): set/delete buttons carry aria-labels", () => {
    render(
      <CuePanel
        cues={[cue(1, 12.3)]}
        color="#00f5d4"
        disabled={false}
        onSet={() => {}}
        onJump={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /add cue at current position/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete cue 1/i })).toBeInTheDocument();
  });
});
