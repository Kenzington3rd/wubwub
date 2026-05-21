import { describe, it, expect, vi } from "vitest";
import { useRef, useEffect } from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import SamplePad from "../src/components/SamplePad.jsx";

function Harness({ onMount, onRefs, tapReady = true }) {
  const audioCtxRef = useRef(new AudioContext());
  const outputNodeRef = useRef(audioCtxRef.current.createGain());
  // A6 — start with no tap when tapReady=false so the test can fill the ref
  // later, simulating the master bus coming online after a pad's gain node
  // has already been lazily built. Mirrors the Looper deferred-attach test.
  const recordTapRef = useRef(tapReady ? audioCtxRef.current.createGain() : null);
  const ref = useRef(null);
  useEffect(() => { if (onMount) onMount(ref); }, []);
  if (onRefs) onRefs({ audioCtxRef, outputNodeRef, recordTapRef });
  return (
    <SamplePad
      ref={ref}
      audioCtxRef={audioCtxRef}
      outputNodeRef={outputNodeRef}
      recordTapRef={recordTapRef}
    />
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

  it("@us US33: an undecodable file shows an inline role=alert error, not alert()", async () => {
    // Make the decode fail for this pad load.
    let refs;
    const { container } = render(
      <Harness onRefs={(r) => { refs = r; }} />
    );
    refs.audioCtxRef.current.decodeAudioData = () =>
      Promise.reject(new Error("bad audio"));
    // Spy on window.alert — the old behavior used a blocking alert(); the
    // inline-error pattern must never call it.
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    try {
      const padDiv = screen.getByText("Q").closest("div").parentElement;
      const badFile = new File([new Uint8Array([9, 9, 9])], "broken.xyz", {
        type: "audio/wav",
      });
      await act(async () => {
        fireEvent.drop(padDiv, {
          dataTransfer: { files: [badFile], items: [{ kind: "file" }] },
        });
      });
      // Inline error surfaces with role="alert" and names the file.
      const err = await screen.findByRole("alert");
      expect(err).toHaveTextContent(/broken\.xyz/);
      // No blocking alert() — routine feedback stays inline.
      expect(alertSpy).not.toHaveBeenCalled();
    } finally {
      alertSpy.mockRestore();
    }
  });

  it("@us US33: a successful load clears a prior inline decode error", async () => {
    let refs;
    render(<Harness onRefs={(r) => { refs = r; }} />);
    const ctx = refs.audioCtxRef.current;
    const padDiv = screen.getByText("Q").closest("div").parentElement;
    // First: a failing decode → inline error shows.
    ctx.decodeAudioData = () => Promise.reject(new Error("bad audio"));
    await act(async () => {
      fireEvent.drop(padDiv, {
        dataTransfer: {
          files: [new File([new Uint8Array([1])], "bad.wav", { type: "audio/wav" })],
          items: [{ kind: "file" }],
        },
      });
    });
    await screen.findByRole("alert");
    // Then: a successful decode on the same pad → error clears.
    ctx.decodeAudioData = () =>
      Promise.resolve(ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate));
    await act(async () => {
      fireEvent.drop(padDiv, {
        dataTransfer: {
          files: [new File([new Uint8Array([2])], "good.wav", { type: "audio/wav" })],
          items: [{ kind: "file" }],
        },
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("@us US61 (A6): a pad whose gain was built before the record tap existed still reaches the tap once it comes online", async () => {
    // A6 — ensureGain caches a pad's GainNode the first time it's triggered.
    // If recordTapRef.current was null at that moment, the tap connection was
    // silently skipped. The cached gain must NOT stay orphaned: a later
    // trigger must reconnect to the tap once it exists, or "Clean" recording
    // will miss sample-pad audio forever after the pad is loaded.
    let api;
    let refs;
    render(
      <Harness
        tapReady={false}
        onMount={(r) => { api = r; }}
        onRefs={(r) => { refs = r; }}
      />
    );
    // Load a sample into pad 1 (Q).
    const padDiv = screen.getByText("Q").closest("div").parentElement;
    const fakeAudio = new File([new Uint8Array([0, 1, 2])], "kick.wav", {
      type: "audio/wav",
    });
    await act(async () => {
      fireEvent.drop(padDiv, {
        dataTransfer: { files: [fakeAudio], items: [{ kind: "file" }] },
      });
    });
    await waitFor(() => {
      expect(screen.getAllByText("+ Load").length).toBe(7);
    });

    // First trigger — record tap is NOT ready yet. The pad gain is created
    // and wired to the master output, but NOT to the (still-null) tap.
    await act(async () => {
      api.current.triggerByKey("q");
    });
    const ctx = refs.audioCtxRef.current;
    let src = ctx._lastStartedSource;
    const padGain = src.connections[0];
    expect(padGain).toBeTruthy();
    expect(padGain.connections).toContain(refs.outputNodeRef.current);
    // The tap was null when the gain was built — no stale connection.
    expect(refs.recordTapRef.current).toBeNull();
    expect(padGain.connections).toHaveLength(1);

    // Now the master bus comes online and the record tap is built. Filling
    // the ref simulates the App's late master-bus setup — exactly the "tap
    // built later" sequence A6 covers.
    refs.recordTapRef.current = ctx.createGain();

    // Second trigger — ensureGain finds the cached gain and the now-ready
    // tap, and attaches the tap connection on this call.
    await act(async () => {
      api.current.triggerByKey("q");
    });
    src = ctx._lastStartedSource;
    // The pad gain is the SAME cached node (still has the output connection),
    // but it has now picked up the deferred tap connection too.
    expect(src.connections[0]).toBe(padGain);
    expect(padGain.connections).toContain(refs.outputNodeRef.current);
    expect(padGain.connections).toContain(refs.recordTapRef.current);
  });

  it("@us US61: a triggered pad fans its output into the pre-limiter record tap", async () => {
    // The "Clean" (pre-limiter) recorder tap must carry sample-pad audio, not
    // just the decks. Load a pad, trigger it, and verify the pad's gain node
    // connects to BOTH the master output and the parallel recordTap node.
    let api;
    let refs;
    const { container } = render(
      <Harness onMount={(r) => { api = r; }} onRefs={(r) => { refs = r; }} />
    );
    // Load a sample into pad 1 via drop (the mock decodeAudioData resolves a
    // buffer), then trigger it so the lazy gain node is built. Pad 1 is the
    // one whose keyboard hint is "Q" — walk up to its container div.
    const padDiv = screen.getByText("Q").closest("div").parentElement;
    const fakeAudio = new File([new Uint8Array([0, 1, 2])], "kick.wav", {
      type: "audio/wav",
    });
    await act(async () => {
      fireEvent.drop(padDiv, {
        dataTransfer: { files: [fakeAudio], items: [{ kind: "file" }] },
      });
    });
    // Wait for the decoded buffer to register (pad label flips off "+ Load").
    await waitFor(() => {
      expect(screen.getAllByText("+ Load").length).toBe(7);
    });
    await act(async () => {
      api.current.triggerByKey("q"); // pad 1
    });

    const ctx = refs.audioCtxRef.current;
    const src = ctx._lastStartedSource;
    expect(src).toBeTruthy();
    // The source connects to the pad gain; that gain fans to output + tap.
    const padGain = src.connections[0];
    expect(padGain).toBeTruthy();
    expect(padGain.connections).toContain(refs.outputNodeRef.current);
    expect(padGain.connections).toContain(refs.recordTapRef.current);
  });
});
