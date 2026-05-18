import { describe, it, expect } from "vitest";
import { useRef } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import Looper from "../src/components/Looper.jsx";

// Build a Looper harness with a mocked Web Audio graph. The global Web Audio
// mock (installed in test/setup.js) provides AudioContext + AudioWorkletNode.
// `onWorklet` exposes the mock worklet node so tests can inspect postMessage.
function Harness({ workletReady = true, bpm = 128, onWorklet, onRefs }) {
  const audioCtxRef = useRef(new AudioContext());
  const outputNodeRef = useRef(audioCtxRef.current.createGain());
  const recordTapRef = useRef(audioCtxRef.current.createGain());
  const workletNodeRef = useRef(
    new AudioWorkletNode(audioCtxRef.current, "looper-processor", {
      processorOptions: { seconds: 60 },
    })
  );
  const effectiveBpmRef = useRef(bpm);
  if (onWorklet) onWorklet(workletNodeRef.current);
  if (onRefs) onRefs({ outputNodeRef, recordTapRef });
  return (
    <Looper
      audioCtxRef={audioCtxRef}
      workletNodeRef={workletNodeRef}
      outputNodeRef={outputNodeRef}
      recordTapRef={recordTapRef}
      workletReady={workletReady}
      effectiveBpmRef={effectiveBpmRef}
    />
  );
}

describe("Looper — US28", () => {
  it("@us US28: renders 4 loop slots", () => {
    render(<Harness />);
    for (const label of ["L1", "L2", "L3", "L4"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("@us US28: each slot's bar selector offers 4 / 8 / 16 bars", () => {
    render(<Harness />);
    const selects = screen.getAllByRole("combobox");
    expect(selects.length).toBe(4);
    for (const sel of selects) {
      const opts = Array.from(sel.options).map((o) => o.value);
      expect(opts).toEqual(["4", "8", "16"]);
    }
  });

  it("@us US28: Capture is disabled until the worklet is ready", () => {
    render(<Harness workletReady={false} />);
    const captures = screen.getAllByRole("button", { name: /Capture/i });
    expect(captures.length).toBe(4);
    for (const btn of captures) expect(btn).toBeDisabled();
  });

  it("@us US28: Capture is enabled once the worklet is ready", () => {
    render(<Harness workletReady />);
    const captures = screen.getAllByRole("button", { name: /Capture/i });
    for (const btn of captures) expect(btn).not.toBeDisabled();
  });

  it("@us US28: capture seconds is clamped to <= 60 even at the BPM floor", () => {
    // At 40 BPM, 16 bars = 16*4*60/40 = 96 s — must be clamped to 60.
    let workletNode;
    render(<Harness workletReady bpm={40} onWorklet={(n) => { workletNode = n; }} />);
    // Set the first slot to 16 bars, then capture.
    const select = screen.getAllByRole("combobox")[0];
    fireEvent.change(select, { target: { value: "16" } });
    const capture = screen.getAllByRole("button", { name: /Capture/i })[0];
    fireEvent.click(capture);

    const posted = workletNode.port.postedMessages.find((m) => m.type === "capture");
    expect(posted).toBeTruthy();
    expect(posted.seconds).toBeLessThanOrEqual(60);
  });

  it("@us US61: a playing loop slot fans its output into the pre-limiter record tap", () => {
    // The "Clean" (pre-limiter) recorder tap must carry looper audio, not just
    // the decks. Verify the slot's gain node connects to BOTH the master
    // output and the parallel recordTap node.
    let workletNode;
    let refs;
    render(
      <Harness
        workletReady
        onWorklet={(n) => { workletNode = n; }}
        onRefs={(r) => { refs = r; }}
      />
    );
    // Deliver a synthetic capture so slot L1 has a buffer to play.
    const ctx = workletNode.context;
    const left = new Float32Array(1024);
    const right = new Float32Array(1024);
    act(() => {
      for (const fn of workletNode.port._listeners) {
        fn({
          data: {
            type: "capture",
            slot: 0,
            left: left.buffer,
            right: right.buffer,
            sampleRate: ctx.sampleRate,
          },
        });
      }
    });
    // Play the captured loop — this lazily builds the slot gain node.
    const playBtn = screen.getByRole("button", { name: /Play loop 1/i });
    act(() => {
      fireEvent.click(playBtn);
    });

    // The slot's buffer source connects to the slot gain; that gain fans into
    // BOTH the master output AND the parallel pre-limiter record tap.
    const src = ctx._lastStartedSource;
    expect(src).toBeTruthy();
    const slotGain = src.connections[0];
    expect(slotGain).toBeTruthy();
    expect(slotGain.connections).toContain(refs.outputNodeRef.current);
    expect(slotGain.connections).toContain(refs.recordTapRef.current);
  });
});
