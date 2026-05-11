import { describe, it, expect, vi } from "vitest";
import { useRef, useEffect } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import SamplePad from "../src/components/SamplePad.jsx";

function Harness({ onMount }) {
  const audioCtxRef = useRef(new AudioContext());
  const outputNodeRef = useRef(audioCtxRef.current.createGain());
  const ref = useRef(null);
  useEffect(() => { if (onMount) onMount(ref); }, []);
  return (
    <SamplePad ref={ref} audioCtxRef={audioCtxRef} outputNodeRef={outputNodeRef} />
  );
}

describe("SamplePad — US31, US32, US33", () => {
  it("@us US31: renders 8 pads, each with its keyboard hint", () => {
    render(<Harness />);
    for (const k of ["Q", "W", "E", "R", "A", "S", "D", "F"]) {
      expect(screen.getByText(k)).toBeInTheDocument();
    }
  });

  it("@us US32: triggerByKey looks up the index from the key letter", () => {
    let api;
    render(<Harness onMount={(r) => { api = r; }} />);
    // No buffer loaded → trigger is a no-op but should not throw.
    expect(() => api.current.triggerByKey("q")).not.toThrow();
    expect(() => api.current.triggerByKey("Q")).not.toThrow();
    expect(() => api.current.triggerByKey("z")).not.toThrow(); // out-of-range
  });

  it("@us US33: dropping an audio file calls loadFile path (no throw)", async () => {
    const { container } = render(<Harness />);
    const padDiv = container.querySelector("div[role], div"); // first pad div
    // Construct a File-like object the drop handler will pass to ctx.decodeAudioData
    const fakeAudio = new File([new Uint8Array([0, 1, 2])], "kick.wav", {
      type: "audio/wav",
    });
    // Just verify the drop event doesn't throw — actual decoding goes through
    // the mocked AudioContext which resolves to a 1s mono buffer.
    expect(() => {
      fireEvent.drop(padDiv, {
        dataTransfer: { files: [fakeAudio], items: [{ kind: "file" }] },
      });
    }).not.toThrow();
  });

  it("@us US31: pads show '+ Load' when empty", () => {
    render(<Harness />);
    const loadButtons = screen.getAllByText("+ Load");
    expect(loadButtons.length).toBe(8);
  });
});
