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

  it("@us US28: a capture in flight keeps keyboard focus on its button and ignores a repeat press", async () => {
    let node;
    render(<Harness onWorklet={(n) => { node = n; }} />);
    const btn = screen.getByRole("button", { name: /Capture 4 bars into loop 1/i });
    btn.focus();
    await act(async () => { fireEvent.click(btn); });
    // Busy, not disabled: a disabled focused element drops focus to <body>.
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).toHaveAttribute("title", expect.stringMatching(/Capturing loop 1/));
    // Dimmed via fill/border, never opacity — opacity would fade the focus ring.
    expect(btn.style.opacity).toBe("1");
    expect(btn).toHaveAccessibleName(/Capturing loop 1/i);
    expect(document.activeElement).toBe(btn);
    await act(async () => { fireEvent.click(btn); });
    expect(node.port.postedMessages.filter((m) => m.type === "capture").length).toBe(1);
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
    const slotGain = src.connections[0].connections[0];
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
    expect(src.connections[0].connections[0]).toBe(slotGain);
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
    const slotGain = src.connections[0].connections[0];
    expect(slotGain).toBeTruthy();
    expect(slotGain.connections).toContain(refs.outputNodeRef.current);
    expect(slotGain.connections).toContain(refs.recordTapRef.current);
  });

  // Capture a synthetic loop into slot L1 and return { ctx, playBtn }.
  function setupLoadedSlot() {
    let workletNode;
    render(<Harness workletReady onWorklet={(n) => { workletNode = n; }} />);
    const ctx = workletNode.context;
    const buf = new Float32Array(1024);
    act(() => {
      for (const fn of workletNode.port._listeners) {
        fn({ data: { type: "capture", slot: 0, left: buf.buffer.slice(0), right: buf.buffer.slice(0), sampleRate: ctx.sampleRate } });
      }
    });
    return { ctx, playBtn: screen.getByRole("button", { name: /Play loop 1/i }) };
  }

  it("@us US61: a slot source plays through its own fade node, fading in from 0", () => {
    const { ctx, playBtn } = setupLoadedSlot();
    act(() => fireEvent.click(playBtn));
    const src = ctx._lastStartedSource;
    const fade = src.connections[0];
    const slotGain = fade.connections[0];
    expect(fade).not.toBe(slotGain);
    const ev = fade.gain.scheduledValues;
    expect(ev.find((e) => e.type === "setValue").value).toBe(0);
    expect(ev.find((e) => e.type === "setTarget" && e.target === 1)).toBeTruthy();
  });

  it("@us US61: stopping a slot fades the per-source node, schedules a future stop and leaves the slot gain alone", () => {
    const { ctx, playBtn } = setupLoadedSlot();
    act(() => fireEvent.click(playBtn));
    const src = ctx._lastStartedSource;
    const fade = src.connections[0];
    const slotGain = fade.connections[0];
    const stops = [];
    src.stop = (when) => stops.push(when);
    ctx._currentTime = 3.0;
    const slotBefore = slotGain.gain.scheduledValues.length;
    const fadeBefore = fade.gain.scheduledValues.length;
    act(() => fireEvent.click(playBtn)); // stop
    const events = fade.gain.scheduledValues.slice(fadeBefore);
    const ramp = events.find((e) => e.type === "setTarget" && e.target === 0);
    expect(ramp, "stop must ramp the source's fade node to 0").toBeTruthy();
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBeGreaterThan(3.0);
    expect(stops[0]).toBeLessThan(3.02);
    // The shared slot gain (volume slider's) is never modified by a stop.
    expect(slotGain.gain.scheduledValues.length).toBe(slotBefore);
    // Graph is released from onended, after the tail played — not immediately.
    expect(typeof src.onended).toBe("function");
    expect(src.connections.length).toBeGreaterThan(0);
    src.onended();
    expect(src.connections).toHaveLength(0);
    expect(fade.connections).toHaveLength(0);
  });

  it("@us US61: stop-fade bounds — tau <= 1.25 ms, stop >= 4 tau out, delay inside the documented window", () => {
    const { ctx, playBtn } = setupLoadedSlot();
    act(() => fireEvent.click(playBtn));
    const src = ctx._lastStartedSource;
    const fade = src.connections[0];
    const stops = [];
    src.stop = (when) => stops.push(when);
    ctx._currentTime = 3.0;
    const before = fade.gain.scheduledValues.length;
    act(() => fireEvent.click(playBtn));
    const ramp = fade.gain.scheduledValues.slice(before).find((e) => e.type === "setTarget" && e.target === 0);
    expect(ramp.time).toBe(3.0);
    expect(ramp.tau).toBeGreaterThan(0);
    expect(ramp.tau).toBeLessThanOrEqual(0.00125 + 1e-12);
    const delay = stops[0] - 3.0;
    expect(delay).toBeGreaterThanOrEqual(4 * ramp.tau - 1e-9);
    // Documented window: >= 10 ms scheduling margin, <= 20 ms so a re-play stays tight.
    expect(delay).toBeGreaterThanOrEqual(0.010);
    expect(delay).toBeLessThanOrEqual(0.020);
  });

  it("@us US61: fade-in reaches >= 95% within 5 ms", () => {
    const { ctx, playBtn } = setupLoadedSlot();
    act(() => fireEvent.click(playBtn));
    const fade = ctx._lastStartedSource.connections[0];
    const up = fade.gain.scheduledValues.find((e) => e.type === "setTarget" && e.target === 1);
    expect(up.tau).toBeGreaterThan(0);
    expect(1 - Math.exp(-0.005 / up.tau)).toBeGreaterThanOrEqual(0.95);
  });

  it("@us US61: stop re-anchors with cancelAndHoldAtTime when available, never from the stale .value", () => {
    const { ctx, playBtn } = setupLoadedSlot();
    act(() => fireEvent.click(playBtn));
    const fade = ctx._lastStartedSource.connections[0];
    ctx._currentTime = 2.0;
    const before = fade.gain.scheduledValues.length;
    act(() => fireEvent.click(playBtn));
    const ev = fade.gain.scheduledValues.slice(before);
    expect(ev[0]).toEqual({ type: "cancelAndHold", time: 2.0 });
    expect(ev.some((e) => e.type === "setValue")).toBe(false);
    expect(ev.some((e) => e.type === "cancel")).toBe(false);
    expect(ev.at(-1)).toMatchObject({ type: "setTarget", target: 0, time: 2.0 });
  });

  it("@us US61: stop falls back to cancelScheduledValues (no stale .value re-anchor) without cancelAndHoldAtTime", () => {
    const { ctx, playBtn } = setupLoadedSlot();
    act(() => fireEvent.click(playBtn));
    const fade = ctx._lastStartedSource.connections[0];
    fade.gain.cancelAndHoldAtTime = undefined;
    ctx._currentTime = 2.0;
    const before = fade.gain.scheduledValues.length;
    act(() => fireEvent.click(playBtn));
    const ev = fade.gain.scheduledValues.slice(before);
    expect(ev[0].type).toBe("cancel");
    expect(ev[0].time).toBeGreaterThanOrEqual(2.0);
    expect(ev[0].time).toBeLessThan(2.001);
    expect(ev.some((e) => e.type === "setValue")).toBe(false);
    expect(ev.at(-1)).toMatchObject({ type: "setTarget", target: 0, time: 2.0 });
  });

  it("@us US61: volume set before stop survives stop and re-play (slot gain stays at the user's value)", () => {
    const { ctx, playBtn } = setupLoadedSlot();
    act(() => fireEvent.click(playBtn));
    const slotGain = ctx._lastStartedSource.connections[0].connections[0];
    const vol = screen.getByRole("slider", { name: /Loop 1 volume/i });
    act(() => fireEvent.change(vol, { target: { value: "0.3" } }));
    expect(slotGain.gain.value).toBeCloseTo(0.3, 5);
    act(() => fireEvent.click(playBtn)); // stop
    act(() => fireEvent.click(playBtn)); // play again
    expect(slotGain.gain.value).toBeCloseTo(0.3, 5);
    // No stale restore event at the old volume can land later: nothing on the
    // slot gain after the 0.3 target.
    const ev = slotGain.gain.scheduledValues;
    const lastTarget = ev.map((e) => e.type).lastIndexOf("setTarget");
    expect(ev.slice(lastTarget + 1).filter((e) => e.type === "setValue")).toHaveLength(0);
  });

  it("@us US61: an immediate re-play after stop starts a fresh source at full fade-in with no slot-gain attenuation", () => {
    const { ctx, playBtn } = setupLoadedSlot();
    act(() => fireEvent.click(playBtn));
    const first = ctx._lastStartedSource;
    const slotGain = first.connections[0].connections[0];
    const slotEventsBefore = slotGain.gain.scheduledValues.length;
    act(() => fireEvent.click(playBtn)); // stop
    act(() => fireEvent.click(playBtn)); // re-play within the same instant
    const second = ctx._lastStartedSource;
    expect(second).not.toBe(first);
    const fade2 = second.connections[0];
    expect(fade2).not.toBe(first.connections[0]);
    expect(fade2.connections[0]).toBe(slotGain);
    const ev = fade2.gain.scheduledValues;
    expect(ev.find((e) => e.type === "setValue").value).toBe(0);
    expect(ev.find((e) => e.type === "setTarget").target).toBe(1);
    // The slot gain saw no fade/restore automation from stop or play.
    expect(slotGain.gain.scheduledValues.length).toBe(slotEventsBefore);
    expect(slotGain.gain.value).toBeCloseTo(0.8, 5);
  });
});
