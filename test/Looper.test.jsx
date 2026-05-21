import { describe, it, expect } from "vitest";
import { useRef } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import Looper from "../src/components/Looper.jsx";

// Build a Looper harness with a mocked Web Audio graph. The global Web Audio
// mock (installed in test/setup.js) provides AudioContext + AudioWorkletNode.
// `onWorklet` exposes the mock worklet node so tests can inspect postMessage.
// `tapReady=false` simulates the "record tap not yet built" startup race
// covered by A6.
function Harness({
  workletReady = true,
  bpm = 128,
  onWorklet,
  onRefs,
  tapReady = true,
}) {
  const audioCtxRef = useRef(new AudioContext());
  const outputNodeRef = useRef(audioCtxRef.current.createGain());
  // A6 — start with no tap when tapReady=false, then the test can fill the
  // ref later to simulate the master bus coming online after the Looper has
  // already lazily built a slot's gain node.
  const recordTapRef = useRef(tapReady ? audioCtxRef.current.createGain() : null);
  const workletNodeRef = useRef(
    new AudioWorkletNode(audioCtxRef.current, "looper-processor", {
      processorOptions: { seconds: 60 },
    })
  );
  const effectiveBpmRef = useRef(bpm);
  if (onWorklet) onWorklet(workletNodeRef.current);
  if (onRefs) onRefs({ outputNodeRef, recordTapRef, audioCtxRef });
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

  it("@us US28: a low-BPM / high-bar capture is hard-clamped to exactly 60 s in the worklet message", () => {
    // capture() computes seconds = (bars*4*60)/bpm, then Math.min(60, …). At a
    // low BPM with the highest bar count the raw window blows past the ring
    // buffer's 60 s, so the message posted to the worklet must carry exactly
    // 60 — the worklet would otherwise silently truncate the loop.
    let workletNode;
    render(<Harness workletReady bpm={50} onWorklet={(n) => { workletNode = n; }} />);
    // 16 bars @ 50 BPM = 16*4*60/50 = 76.8 s raw → clamp to 60.
    const select = screen.getAllByRole("combobox")[0];
    fireEvent.change(select, { target: { value: "16" } });
    const capture = screen.getAllByRole("button", { name: /Capture/i })[0];
    fireEvent.click(capture);

    const posted = workletNode.port.postedMessages.find((m) => m.type === "capture");
    expect(posted).toBeTruthy();
    expect(posted.seconds).toBe(60);
  });

  it("@us US61 (A6): a slot whose gain was built before the record tap existed still reaches the tap once it comes online", () => {
    // A6 — ensureGain caches a slot's GainNode the first time it's needed.
    // If recordTapRef.current was null at that moment, the tap connection was
    // silently skipped. The cached gain must NOT stay orphaned: a later play
    // must reconnect to the tap once it exists, or "Clean" recording will
    // miss looper audio forever after the slot is captured.
    let workletNode;
    let refs;
    render(
      <Harness
        workletReady
        tapReady={false}
        onWorklet={(n) => { workletNode = n; }}
        onRefs={(r) => { refs = r; }}
      />
    );
    const ctx = workletNode.context;
    // Deliver a synthetic capture so slot L1 has a buffer to play.
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
    // First play — record tap is NOT ready yet. The slot gain is created and
    // wired to the master output, but NOT to the (still-null) tap.
    const playBtn = screen.getByRole("button", { name: /Play loop 1/i });
    act(() => fireEvent.click(playBtn));
    let src = ctx._lastStartedSource;
    const slotGain = src.connections[0];
    expect(slotGain).toBeTruthy();
    expect(slotGain.connections).toContain(refs.outputNodeRef.current);
    // The tap was null when the gain was built — no stale connection.
    expect(refs.recordTapRef.current).toBeNull();
    expect(slotGain.connections).toHaveLength(1);

    // Stop the slot. Now the master bus comes online and the record tap is
    // built. Filling the ref simulates the App's late master-bus setup —
    // exactly the "tap built later" sequence A6 covers.
    act(() => fireEvent.click(playBtn)); // toggle to stop
    refs.recordTapRef.current = ctx.createGain();

    // Second play — ensureGain finds the cached gain and the now-ready tap,
    // and attaches the tap connection on this call.
    act(() => fireEvent.click(playBtn));
    src = ctx._lastStartedSource;
    // The slot gain is the SAME cached node (still has the output connection),
    // but it has now picked up the deferred tap connection too.
    expect(src.connections[0]).toBe(slotGain);
    expect(slotGain.connections).toContain(refs.outputNodeRef.current);
    expect(slotGain.connections).toContain(refs.recordTapRef.current);
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
