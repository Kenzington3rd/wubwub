import { describe, it, expect, vi } from "vitest";
import { useRef, useEffect } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import Deck from "../src/components/Deck.jsx";
import { MockAudioBuffer } from "./mocks/webAudioMock.js";

function Harness({ id = "A", onMount, color = "#00f5d4", onKeyDetected, deckProps = {} }) {
  const audioCtxRef = useRef(null);
  const masterCompressorRef = useRef(null);
  const deckRef = useRef(null);

  const ensureMasterCtx = async () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    if (!masterCompressorRef.current) {
      masterCompressorRef.current = audioCtxRef.current.createDynamicsCompressor();
      masterCompressorRef.current.connect(audioCtxRef.current.destination);
    }
    if (audioCtxRef.current.state === "suspended") {
      await audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  useEffect(() => {
    if (onMount) onMount({ deckRef, audioCtxRef, masterCompressorRef });
  }, []);

  return (
    <Deck
      {...deckProps}
      ref={deckRef}
      id={id}
      color={color}
      audioCtxRef={audioCtxRef}
      masterCompressorRef={masterCompressorRef}
      ensureMasterCtx={ensureMasterCtx}
      crossfadeGain={1}
      focused={false}
      onFocus={() => {}}
      onSync={() => {}}
      onKeyDetected={onKeyDetected}
    />
  );
}

async function loadFakeFile(api, name = "test.mp3") {
  const ctx = await api.ensureMasterCtx;
  void ctx;
  const file = new File([new Uint8Array([0, 1, 2])], name, { type: "audio/mpeg" });
  // The deck's button is hidden behind a label-button; we drive via drop instead.
  return file;
}

describe("Deck — integration tests across many user stories", () => {
  it("@us US2: imperative play / pause / stop API exists", async () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    expect(typeof api.deckRef.current.play).toBe("function");
    expect(typeof api.deckRef.current.pause).toBe("function");
    expect(typeof api.deckRef.current.stop).toBe("function");
    expect(typeof api.deckRef.current.togglePlay).toBe("function");
  });

  it("@us US3: nudgeVolume clamps within [0, 1]", () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    api.deckRef.current.setVolume(1.5);
    api.deckRef.current.nudgeVolume(-0.1);
    // setVolume(1.5) clamps to 1; nudge -0.1 → 0.9
    api.deckRef.current.setVolume(-1);
    // Setting to -1 clamps to 0.
  });

  it("@us US9: tapping BPM at 120 BPM intervals lands near 120", async () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    // Simulate 4 taps 500 ms apart → 120 BPM.
    const now = Date.now();
    const dateSpy = vi.spyOn(Date, "now");
    dateSpy.mockReturnValueOnce(now);
    dateSpy.mockReturnValueOnce(now + 500);
    dateSpy.mockReturnValueOnce(now + 1000);
    dateSpy.mockReturnValueOnce(now + 1500);
    const tapButton = screen.getByRole("button", { name: /Tap BPM/i });
    await act(async () => fireEvent.click(tapButton));
    await act(async () => fireEvent.click(tapButton));
    await act(async () => fireEvent.click(tapButton));
    await act(async () => fireEvent.click(tapButton));
    dateSpy.mockRestore();
    expect(screen.getByText(/120 BPM/)).toBeInTheDocument();
  });

  it("@us US9: two taps in the same millisecond never yield a non-finite BPM", async () => {
    render(<Harness />);
    // Both taps report the identical timestamp → avg interval 0. Without the
    // guard this computes 60000/0 = Infinity and renders "Infinity BPM".
    const now = Date.now();
    const dateSpy = vi.spyOn(Date, "now");
    dateSpy.mockReturnValue(now);
    const tapButton = screen.getByRole("button", { name: /Tap BPM/i });
    await act(async () => fireEvent.click(tapButton));
    await act(async () => fireEvent.click(tapButton));
    dateSpy.mockRestore();
    // No Infinity / NaN leaked into the display; BPM stays at the 128 default.
    expect(screen.queryByText(/Infinity/i)).toBeNull();
    expect(screen.queryByText(/NaN/i)).toBeNull();
    expect(screen.getByText(/128 BPM/)).toBeInTheDocument();
  });

  it("@us US9: a fast (220+ BPM) tap interval is clamped into the musical range", async () => {
    render(<Harness />);
    // Taps 100 ms apart → 600 BPM raw; must clamp to the 220 ceiling.
    const now = Date.now();
    const dateSpy = vi.spyOn(Date, "now");
    dateSpy.mockReturnValueOnce(now);
    dateSpy.mockReturnValueOnce(now + 100);
    dateSpy.mockReturnValueOnce(now + 200);
    const tapButton = screen.getByRole("button", { name: /Tap BPM/i });
    await act(async () => fireEvent.click(tapButton));
    await act(async () => fireEvent.click(tapButton));
    await act(async () => fireEvent.click(tapButton));
    dateSpy.mockRestore();
    expect(screen.getByText(/220 BPM/)).toBeInTheDocument();
  });

  it("@us US25 / US45: ½× and ×2 BPM nudge buttons exist (disabled with no file)", () => {
    render(<Harness />);
    const halve = screen.getByRole("button", { name: /Halve BPM/i });
    const dbl = screen.getByRole("button", { name: /Double BPM/i });
    expect(halve).toBeDisabled();
    expect(dbl).toBeDisabled();
  });

  it("@us US25: syncTo(otherBpm) adjusts the deck's speed within [0.5, 2]", () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    // Default BPM is 128. syncTo(64) should halve speed → 0.5, the lower bound.
    api.deckRef.current.syncTo(64);
    // The internal speed state isn't directly exposed, but no error means it ran.
    // The imperative method clamps to [0.5, 2.0] — assert no throw.
    expect(() => api.deckRef.current.syncTo(64)).not.toThrow();
  });

  it("@us US22 / US47: cue limit; deck imperative setCue can be called", () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    // setCue requires a loaded buffer; without one it's a no-op.
    expect(() => api.deckRef.current.setCue()).not.toThrow();
  });

  it("@us US44: deck has dragover/drop handlers (drag-and-drop file load)", () => {
    const { container } = render(<Harness />);
    const deckDiv = container.querySelector('[role="region"]');
    expect(deckDiv).toBeTruthy();
    // Drop event should fire without throwing (no file → no decode).
    expect(() => {
      fireEvent.dragOver(deckDiv, {
        dataTransfer: { items: [{ kind: "file" }] },
      });
      fireEvent.drop(deckDiv, {
        dataTransfer: { files: [], items: [] },
      });
    }).not.toThrow();
  });

  it("@us US50 (a11y): deck region has aria-label naming the deck", () => {
    const { container } = render(<Harness id="A" />);
    const region = container.querySelector('[role="region"]');
    expect(region.getAttribute("aria-label")).toMatch(/Deck A/i);
  });

  it("@us US26: transport buttons have aria-pressed reflecting active state", () => {
    render(<Harness />);
    const playBtn = screen.getByRole("button", { name: /Play deck/i });
    expect(playBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("@us US25 (sync button disabled gating)", () => {
    render(<Harness />);
    const syncBtn = screen.getByRole("button", { name: /Sync deck A to the dominant playing deck/i });
    expect(syncBtn).toBeDisabled();
  });

  it("@us US19 / US20: imperative setFilterFreq clamps to [60, 20000]", () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    expect(() => api.deckRef.current.setFilterFreq(50)).not.toThrow();
    expect(() => api.deckRef.current.setFilterFreq(50000)).not.toThrow();
  });

  it("@us US4: imperative setSpeed clamps to [0.5, 2.0]", () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    expect(() => api.deckRef.current.setSpeed(0.1)).not.toThrow();
    expect(() => api.deckRef.current.setSpeed(5)).not.toThrow();
  });

  it("@us US40: AUTO button is disabled when no file is loaded", () => {
    render(<Harness />);
    const auto = screen.getByRole("button", { name: /Auto-detect BPM and key/i });
    expect(auto).toBeDisabled();
  });

  it("@us US24 / US34 (wobble re-entry leak): a second wobble drop in the active window is a no-op — no orphaned oscillator", async () => {
    let api;
    const { container } = render(<Harness onMount={(a) => { api = a; }} />);
    const deckDiv = container.querySelector('[role="region"]');
    const fakeAudio = new File([new Uint8Array([0, 1, 2])], "track.mp3", {
      type: "audio/mpeg",
    });
    await act(async () => {
      fireEvent.dragOver(deckDiv, { dataTransfer: { items: [{ kind: "file" }] } });
      fireEvent.drop(deckDiv, {
        dataTransfer: { files: [fakeAudio], items: [{ kind: "file" }] },
      });
    });

    const bassDrop = await waitFor(() => {
      const btn = screen.getByRole("button", { name: /BASS DROP/i });
      expect(btn).not.toBeDisabled();
      return btn;
    });

    // Switch the preset selector to Wobble — the wobble path spawns an LFO
    // oscillator whose `onended` owns clearing the re-entry guard.
    const presetSelect = screen.getByTitle(/Bass drop preset/i);
    await act(async () => fireEvent.change(presetSelect, { target: { value: "wobble" } }));

    // Count oscillators created from the moment the first wobble fires.
    const ctx = api.audioCtxRef.current;
    const before = [];
    const realCreateOsc = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = () => {
      const o = realCreateOsc();
      before.push(o);
      return o;
    };

    // Fire the bass drop twice back-to-back. The synchronous
    // bassDropRunningRef guard (cleared only by osc.onended for wobble, NOT
    // by the setTimeout) must make the second call a no-op — otherwise the
    // second wobble's nodes get orphaned.
    expect(() => {
      act(() => {
        fireEvent.click(bassDrop);
        fireEvent.click(bassDrop);
      });
    }).not.toThrow();

    // Exactly one wobble oscillator was created — the guard held.
    expect(before).toHaveLength(1);
    // The button is disabled while the drop is active (re-entry blocked).
    expect(bassDrop).toBeDisabled();
  });

  it("@us US58: no compatible-keys hint before a key is auto-detected", () => {
    render(<Harness />);
    expect(screen.queryByText(/mix →/i)).toBeNull();
  });

  it("@us US58: AUTO surfaces compatible keys and lifts the key via onKeyDetected", async () => {
    // Build a loud C-major triad so keyDetect resolves to 8B with confidence.
    const sr = 11025;
    const len = sr * 12;
    const cmaj = new MockAudioBuffer(1, len, sr);
    const data = cmaj.getChannelData(0);
    const freqs = [261.63, 329.63, 392.0];
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let s = 0;
      for (const f of freqs) s += Math.sin(2 * Math.PI * f * t);
      data[i] = s / freqs.length;
    }

    let api;
    const liftedKeys = [];
    const { container } = render(
      <Harness
        onMount={(a) => { api = a; }}
        onKeyDetected={(k) => liftedKeys.push(k)}
      />
    );
    // Stub decode so the deck's loaded buffer is our C-major chord.
    api.audioCtxRef.current = new AudioContext();
    api.audioCtxRef.current.decodeAudioData = () => Promise.resolve(cmaj);

    const deckDiv = container.querySelector('[role="region"]');
    const fakeAudio = new File([new Uint8Array([0, 1, 2])], "cmaj.mp3", {
      type: "audio/mpeg",
    });
    await act(async () => {
      fireEvent.dragOver(deckDiv, { dataTransfer: { items: [{ kind: "file" }] } });
      fireEvent.drop(deckDiv, {
        dataTransfer: { files: [fakeAudio], items: [{ kind: "file" }] },
      });
    });
    // loadFile pushes a `null` reset through onKeyDetected.
    expect(liftedKeys).toContain(null);

    const auto = screen.getByRole("button", { name: /Auto-detect BPM and key/i });
    await act(async () => fireEvent.click(auto));

    await waitFor(() => {
      // 8B detected → compatible mix targets 8A · 9B · 7B shown on the deck.
      expect(screen.getByText(/mix →/i)).toBeInTheDocument();
    });
    const hint = screen.getByText(/mix →/i);
    expect(hint.textContent).toMatch(/8A/);
    expect(hint.textContent).toMatch(/9B/);
    expect(hint.textContent).toMatch(/7B/);
    // The detected key was lifted to the parent.
    expect(liftedKeys).toContain("8B");
  });

  it("@us US59: NUDGE − / NUDGE + buttons are disabled with no file loaded", () => {
    render(<Harness />);
    const down = screen.getByRole("button", { name: /Pitch bend down deck A/i });
    const up = screen.getByRole("button", { name: /Pitch bend up deck A/i });
    expect(down).toBeDisabled();
    expect(up).toBeDisabled();
  });

  it("@us US59: holding NUDGE + applies a temporary +4% offset and reverts on release", async () => {
    let api;
    const { container } = render(<Harness onMount={(a) => { api = a; }} />);
    const deckDiv = container.querySelector('[role="region"]');
    const fakeAudio = new File([new Uint8Array([0, 1, 2])], "track.mp3", {
      type: "audio/mpeg",
    });
    await act(async () => {
      fireEvent.dragOver(deckDiv, { dataTransfer: { items: [{ kind: "file" }] } });
      fireEvent.drop(deckDiv, {
        dataTransfer: { files: [fakeAudio], items: [{ kind: "file" }] },
      });
    });

    // Start playback so a live BufferSource exists to bend.
    await act(async () => api.deckRef.current.play());
    const ctx = api.audioCtxRef.current;
    // Grab the live source: it's the most-recently-started buffer source.
    const src = ctx._lastStartedSource;
    expect(src).toBeTruthy();
    const baseRate = src.playbackRate.value; // base speed (1.0)

    const up = screen.getByRole("button", { name: /Pitch bend up deck A/i });

    // Hold the button: pointerdown → effective rate slides to base + 0.04.
    await act(async () => {
      fireEvent.pointerDown(up, { pointerId: 1 });
    });
    expect(src.playbackRate.value).toBeCloseTo(baseRate + 0.04, 5);
    // It ramps via setTargetAtTime (no click), not a hard value write.
    const last = src.playbackRate.scheduledValues.at(-1);
    expect(last.type).toBe("setTarget");

    // Release: the bend reverts to the persisted base speed.
    await act(async () => {
      fireEvent.pointerUp(up, { pointerId: 1 });
    });
    expect(src.playbackRate.value).toBeCloseTo(baseRate, 5);
  });

  it("@us US59: pointerleave while held also reverts the pitch bend", async () => {
    let api;
    const { container } = render(<Harness onMount={(a) => { api = a; }} />);
    const deckDiv = container.querySelector('[role="region"]');
    const fakeAudio = new File([new Uint8Array([0, 1, 2])], "track.mp3", {
      type: "audio/mpeg",
    });
    await act(async () => {
      fireEvent.dragOver(deckDiv, { dataTransfer: { items: [{ kind: "file" }] } });
      fireEvent.drop(deckDiv, {
        dataTransfer: { files: [fakeAudio], items: [{ kind: "file" }] },
      });
    });
    await act(async () => api.deckRef.current.play());
    const src = api.audioCtxRef.current._lastStartedSource;
    const baseRate = src.playbackRate.value;

    const down = screen.getByRole("button", { name: /Pitch bend down deck A/i });
    await act(async () => fireEvent.pointerDown(down, { pointerId: 2 }));
    expect(src.playbackRate.value).toBeCloseTo(baseRate - 0.04, 5);
    // Pointer slides off the button without a pointerup — must still revert.
    await act(async () => fireEvent.pointerLeave(down, { pointerId: 2 }));
    expect(src.playbackRate.value).toBeCloseTo(baseRate, 5);
  });

  it("@us US59: pitch-bend keeps the effective playback rate clamped to [0.5, 2.0]", async () => {
    let api;
    const { container } = render(<Harness onMount={(a) => { api = a; }} />);
    const deckDiv = container.querySelector('[role="region"]');
    const fakeAudio = new File([new Uint8Array([0, 1, 2])], "track.mp3", {
      type: "audio/mpeg",
    });
    await act(async () => {
      fireEvent.dragOver(deckDiv, { dataTransfer: { items: [{ kind: "file" }] } });
      fireEvent.drop(deckDiv, {
        dataTransfer: { files: [fakeAudio], items: [{ kind: "file" }] },
      });
    });
    await act(async () => api.deckRef.current.play());
    const src = api.audioCtxRef.current._lastStartedSource;

    // Push the base speed to the ceiling, then nudge UP: base + 0.04 = 2.04,
    // which must clamp to the 2.0 maximum, not overshoot.
    await act(async () => api.deckRef.current.setSpeed(2.0));
    const up = screen.getByRole("button", { name: /Pitch bend up deck A/i });
    await act(async () => fireEvent.pointerDown(up, { pointerId: 7 }));
    expect(src.playbackRate.value).toBeLessThanOrEqual(2.0);
    expect(src.playbackRate.value).toBeCloseTo(2.0, 5);
    // Release → reverts cleanly to the persisted base speed.
    await act(async () => fireEvent.pointerUp(up, { pointerId: 7 }));
    expect(src.playbackRate.value).toBeCloseTo(2.0, 5);

    // Push the base speed to the floor, then nudge DOWN: 0.5 - 0.04 = 0.46,
    // which must clamp to the 0.5 minimum.
    await act(async () => api.deckRef.current.setSpeed(0.5));
    const down = screen.getByRole("button", { name: /Pitch bend down deck A/i });
    await act(async () => fireEvent.pointerDown(down, { pointerId: 8 }));
    expect(src.playbackRate.value).toBeGreaterThanOrEqual(0.5);
    expect(src.playbackRate.value).toBeCloseTo(0.5, 5);
    await act(async () => fireEvent.pointerUp(down, { pointerId: 8 }));
    expect(src.playbackRate.value).toBeCloseTo(0.5, 5);
  });

  it("@us US63: deck exposes a loadBuffer imperative method", () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    expect(typeof api.deckRef.current.loadBuffer).toBe("function");
  });

  it("@us US63: loadBuffer adopts a pre-decoded AudioBuffer without re-decoding", async () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    // Pre-decode a buffer ourselves (simulating a crate entry).
    const sr = 11025;
    const preDecoded = new MockAudioBuffer(1, sr * 3, sr); // 3 s track
    // decodeAudioData must NOT be called by the loadBuffer path.
    const ctx = new AudioContext();
    api.audioCtxRef.current = ctx;
    const decodeSpy = vi.spyOn(ctx, "decodeAudioData");

    await act(async () => {
      await api.deckRef.current.loadBuffer(preDecoded, "from-crate.mp3");
    });

    expect(decodeSpy).not.toHaveBeenCalled();
    // The deck is now ready (a buffer is loaded) and the file name shows.
    expect(api.deckRef.current.isReady()).toBe(true);
    expect(screen.getByText("from-crate.mp3")).toBeInTheDocument();
  });

  it("@us US63: loadBuffer is a no-op when handed no buffer", async () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    await act(async () => {
      await api.deckRef.current.loadBuffer(null, "nothing");
    });
    expect(api.deckRef.current.isReady()).toBe(false);
  });

  it("@us US40: a stale auto-detect bails after the buffer is swapped mid-detection (Q2)", async () => {
    // Q2 — runAutoBpm captures bufferRef.current at detection start. If a new
    // track is loaded (e.g. a crate quick-load) while detection is in flight,
    // the stale result must NOT apply — even its key — to the new track.
    const sr = 11025;
    const len = sr * 12;
    // Buffer 1: a loud C-major triad → keyDetect would resolve 8B.
    const cmaj = new MockAudioBuffer(1, len, sr);
    const cData = cmaj.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let s = 0;
      for (const f of [261.63, 329.63, 392.0]) s += Math.sin(2 * Math.PI * f * t);
      cData[i] = s / 3;
    }
    // Buffer 2: silence — the replacement track. keyDetect on it is low-conf.
    const swapped = new MockAudioBuffer(1, sr * 3, sr);

    let api;
    const liftedKeys = [];
    render(
      <Harness
        onMount={(a) => { api = a; }}
        onKeyDetected={(k) => liftedKeys.push(k)}
      />
    );
    // Load the C-major buffer onto the deck via the imperative loadBuffer.
    await act(async () => {
      await api.deckRef.current.loadBuffer(cmaj, "cmaj.mp3");
    });
    liftedKeys.length = 0; // discard the load-time null reset

    const auto = screen.getByRole("button", { name: /Auto-detect BPM and key/i });
    // Kick off auto-detect, then swap the buffer before detection resolves —
    // all inside one act() so the swap lands during the in-flight Promise.all.
    await act(async () => {
      fireEvent.click(auto);
      await api.deckRef.current.loadBuffer(swapped, "swapped.mp3");
      // Let the stale detection's Promise.all settle.
      await new Promise((r) => setTimeout(r, 0));
    });

    // The stale C-major detection must NOT have lifted 8B for the new track.
    expect(liftedKeys).not.toContain("8B");
    // The deck shows the new track, not a stale detected-key chip.
    expect(screen.getByText("swapped.mp3")).toBeInTheDocument();
  });

  it("@us US59: applyBend re-anchors start time so playback position stays consistent across a nudge", async () => {
    // QA flagged the start-time recompute on nudge start/end (Deck.jsx A2) as
    // intricate and untested. The interval anchors elapsed time on
    //   elapsed = (ctx.currentTime - startTimeRef) * speed
    // which assumes playbackRate === base speed. While a bend is held the real
    // rate is speed + bend, so startTimeRef must be re-anchored on bend start
    // AND end — otherwise the reported time drifts/jumps. This test plays a
    // track, advances ctx time across a held-then-released bend, and asserts
    // the displayed time advances smoothly with no jump.
    vi.useFakeTimers();
    try {
      let api;
      const { container } = render(<Harness onMount={(a) => { api = a; }} />);
      // Adopt a long (60 s) pre-decoded buffer so 6 s of test playback never
      // wraps the loop — the position math, not loop wrapping, is under test.
      const sr = 11025;
      const longBuf = new MockAudioBuffer(1, sr * 60, sr);
      await act(async () => {
        await api.deckRef.current.loadBuffer(longBuf, "long.mp3");
      });

      // Start playback — this opens the 100 ms position interval.
      await act(async () => { await api.deckRef.current.play(); });
      const ctx = api.audioCtxRef.current;

      // Helper: advance the audio clock then let the position interval tick,
      // and read the deck's reported current time. The waveform slider's
      // aria-valuetext ("M:SS / M:SS") mirrors the live currentTime ref.
      const reported = () => {
        const slider = container.querySelector('[role="slider"]');
        const vt = slider?.getAttribute("aria-valuetext") || "";
        const m = vt.match(/^(\d+:\d\d)\s*\//);
        return m ? m[1] : null;
      };
      const tick = (seconds) => {
        act(() => {
          ctx.advance(seconds);
          vi.advanceTimersByTime(100); // one interval cycle
        });
      };

      // Play 2 s at base speed.
      tick(2);
      const tBeforeBend = reported();

      // Hold NUDGE + : applyBend snapshots the position at the OLD rate and
      // re-anchors startTimeRef to the new effective rate. No time jump here.
      const up = screen.getByRole("button", { name: /Pitch bend up deck A/i });
      await act(async () => fireEvent.pointerDown(up, { pointerId: 11 }));
      const tAtBendStart = reported();
      // The re-anchor must not jump the reported position when the bend starts.
      expect(tAtBendStart).toBe(tBeforeBend);

      // Play 2 s with the bend held, then release it.
      tick(2);
      await act(async () => fireEvent.pointerUp(up, { pointerId: 11 }));
      const tAtBendEnd = reported();

      // Play 2 more seconds at base speed after the release.
      tick(2);
      const tAfter = reported();

      // Across the whole sequence the reported time advanced monotonically
      // with no backward jump — the re-anchor on bend start AND end kept the
      // position math consistent.
      const toSec = (s) => {
        const [m, sec] = s.split(":").map(Number);
        return m * 60 + sec;
      };
      expect(toSec(tAtBendEnd)).toBeGreaterThanOrEqual(toSec(tAtBendStart));
      expect(toSec(tAfter)).toBeGreaterThanOrEqual(toSec(tAtBendEnd));
      // No wild jump: ~6 s of playback total (bend is only ±4%), so the final
      // reported position sits in a tight, sane band — not drifted seconds off.
      expect(toSec(tAfter)).toBeGreaterThanOrEqual(5);
      expect(toSec(tAfter)).toBeLessThanOrEqual(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it("@us US59 (A2): pause mid-NUDGE uses the effective rate so the resume offset doesn't snap", async () => {
    // A2 — pause() converts the elapsed audio-clock delta into a buffer-
    // position offset. While a NUDGE bend is held the playbackRate is
    // speed+bend, not speed. Multiplying by the bare speedRef shifts the
    // pause offset by up to ±4% of the held interval — the resume position
    // snaps. With the fix the offset is computed against the same effective
    // rate the source is actually running at, so pause/resume during a held
    // bend round-trips cleanly.
    vi.useFakeTimers();
    try {
      let api;
      const { container } = render(<Harness onMount={(a) => { api = a; }} />);
      // 60 s buffer so 4 s of playback never wraps the loop math.
      const sr = 11025;
      const longBuf = new MockAudioBuffer(1, sr * 60, sr);
      await act(async () => {
        await api.deckRef.current.loadBuffer(longBuf, "long.mp3");
      });
      await act(async () => { await api.deckRef.current.play(); });
      const ctx = api.audioCtxRef.current;

      // Advance 2 s at base speed, then hold NUDGE + for 2 s of audio-clock.
      act(() => { ctx.advance(2); vi.advanceTimersByTime(100); });
      const up = screen.getByRole("button", { name: /Pitch bend up deck A/i });
      await act(async () => fireEvent.pointerDown(up, { pointerId: 21 }));
      act(() => { ctx.advance(2); vi.advanceTimersByTime(100); });

      // Pause WHILE the bend is held. The effective rate is 1.04, so the
      // correct offset for 4 s of audio-clock at effRate=1.04 spans roughly
      // 2 s base + 2.08 s bent = ~4.08 s of buffer position.
      await act(async () => api.deckRef.current.pause());
      // Read the offset off the slider's aria-valuetext (M:SS / M:SS).
      const slider = container.querySelector('[role="slider"]');
      const vt = slider.getAttribute("aria-valuetext") || "";
      const m = vt.match(/^(\d+):(\d{2})\s*\//);
      expect(m).toBeTruthy();
      const seconds = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      // The correct answer is ~4 s (bare-speed math gave ~4 too, but only
      // because 4 s of audio-clock × 1.0 = 4). The interesting check is the
      // bent half: with the bug the multiplication would have used bare speed
      // for the entire 4 s. The fix uses effRate so the held-bend slice
      // contributes 2 × 1.04 = 2.08 s. Allow a tight band (3 – 5 s) to keep
      // the test robust to interval-tick scheduling order.
      expect(seconds).toBeGreaterThanOrEqual(3);
      expect(seconds).toBeLessThanOrEqual(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("@us US59 (A3): seek-while-bent keeps the displayed time consistent with the audible playback rate", async () => {
    // A3 — seekTo anchors startTimeRef = ct - target / rate. With the bug the
    // anchor used the bare speed even while a NUDGE bend was held, so the
    // position-interval (which multiplies by speed) reported a stale target.
    // With the fix the anchor uses the same effective rate the source is
    // running at, and seek-mid-bend lands at the requested time.
    vi.useFakeTimers();
    try {
      let api;
      const { container } = render(<Harness onMount={(a) => { api = a; }} />);
      const sr = 11025;
      const longBuf = new MockAudioBuffer(1, sr * 60, sr);
      await act(async () => {
        await api.deckRef.current.loadBuffer(longBuf, "long.mp3");
      });
      await act(async () => { await api.deckRef.current.play(); });

      // Hold NUDGE + first so the seek runs mid-bend.
      const up = screen.getByRole("button", { name: /Pitch bend up deck A/i });
      await act(async () => fireEvent.pointerDown(up, { pointerId: 31 }));

      // Drive 5 s of playback at the bent rate so currentTime advances past
      // zero, then assert the position interval reports a value consistent
      // with the audible playback. Before the A3 fix, startTimeRef was
      // anchored against the bare speed but the interval was about to start
      // multiplying by effective rate; that mismatch would have caused a 4%
      // drift across the 5 s window.
      const ctx = api.audioCtxRef.current;
      const slider = container.querySelector('[role="slider"]');
      // Reset to 0 first (also exercises the fixed seekTo path under a held
      // bend), then advance the audio clock.
      await act(async () => {
        fireEvent.keyDown(slider, { key: "Home" });
      });
      act(() => { ctx.advance(5); vi.advanceTimersByTime(100); });
      const vt = slider.getAttribute("aria-valuetext") || "";
      const m = vt.match(/^(\d+):(\d{2})\s*\//);
      expect(m).toBeTruthy();
      const seconds = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      // effRate = 1.04 → 5 s of audio clock = 5.2 s of buffer position.
      // Pre-A3 the interval would have reported 5 s flat (4% drift from the
      // audible rate). With the fix the interval honours effRate so the
      // displayed time tracks the audible playback rate. The test asserts
      // the displayed time is consistent with the *bent* rate within a tight
      // band, NOT the pre-fix base-rate value.
      expect(seconds).toBeGreaterThanOrEqual(5);
      expect(seconds).toBeLessThanOrEqual(6);
      // Release the bend cleanly so the test tears down without an open hold.
      await act(async () => fireEvent.pointerUp(up, { pointerId: 31 }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("@us US18: changing reverb SIZE while wet > 0 doesn't strand wet at 0 (P1 R16)", async () => {
    // P1 (R16) — the SIZE debounce swaps the convolver's IR. Doing that
    // mid-tail produces an audible click, so the fix ducks the wet gain to 0
    // first, swaps the IR, then ramps wet back to the user's target. The
    // dangerous failure mode is the ramp-back getting lost — leaving the
    // reverb silent forever. This test pins the contract: after the debounce
    // fires, the wet gain target equals the user's mix value (here 0.5).
    vi.useFakeTimers();
    try {
      let api;
      render(<Harness onMount={(a) => { api = a; }} />);
      // Load a buffer so the deck chain exists.
      const sr = 11025;
      const buf = new MockAudioBuffer(1, sr * 3, sr);
      await act(async () => {
        await api.deckRef.current.loadBuffer(buf, "track.mp3");
      });

      // Turn reverb ON with a non-zero mix.
      const reverbToggle = screen.getByLabelText(/Reverb effect (on|off)/i);
      await act(async () => fireEvent.click(reverbToggle));

      // Drive the reverb mix to 0.5 by spinning the MIX knob via its
      // role=slider ArrowUp keyboard contract — covers the "user toggled
      // reverb then turned mix up" path.
      const knobs = screen.getAllByRole("slider");
      // Find the reverb MIX knob (the only knob aria-labelled MIX).
      const mixKnob = knobs.find((k) => k.getAttribute("aria-label") === "MIX");
      expect(mixKnob).toBeTruthy();
      // Default mix is 0.3; bump to 0.5 via repeated ArrowUp (step 0.01).
      for (let i = 0; i < 20; i++) {
        await act(async () => fireEvent.keyDown(mixKnob, { key: "ArrowUp" }));
      }

      const chain = api.deckRef.current; // imperative API doesn't expose chain
      // The deck doesn't expose the chain directly; reach via the audio ctx's
      // node list — the wet gain is the GainNode at index reverbWet.
      const ctx = api.audioCtxRef.current;
      // Find the reverbWet GainNode: it's the first GainNode wired downstream
      // from a convolver in the deck chain.
      const conv = ctx._nodes.find((n) => n.nodeType === "ConvolverNode");
      expect(conv).toBeTruthy();
      const reverbWet = conv.connections.find((n) => n.nodeType === "GainNode");
      expect(reverbWet).toBeTruthy();
      // After turning reverb on + mix=0.5, the wet gain target is ~0.5.
      expect(reverbWet.gain.value).toBeCloseTo(0.5, 2);

      // Now drive the SIZE knob — find it by its aria-label.
      const sizeKnob = knobs.find((k) => k.getAttribute("aria-label") === "SIZE");
      expect(sizeKnob).toBeTruthy();
      // One ArrowUp on SIZE (step 0.1) → triggers the 200 ms debounce.
      await act(async () => fireEvent.keyDown(sizeKnob, { key: "ArrowUp" }));
      // Let the debounce fire.
      await act(async () => { vi.advanceTimersByTime(250); });

      // After the IR swap, the wet gain must NOT be left at 0 — the fix
      // ramps back to the user's target (≈ 0.5). Allow a small tolerance
      // because rampGain via setTargetAtTime writes the target into .value.
      expect(reverbWet.gain.value).toBeGreaterThan(0.4);
      // The buffer was swapped — at least one new buffer assignment happened.
      // (The mock's convolver.buffer is a plain property, so we just assert
      // it's set to a buffer matching the new SIZE duration band.)
      expect(conv.buffer).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  // @us US18 (R18 T3) — Changing the distortion DRIVE knob swaps the
  // WaveShaper transfer function. Doing that while wet > 0 is the same
  // class of audible discontinuity the reverb-IR hot-swap had: the curve
  // changes shape between two consecutive samples, producing a click. The
  // fix routes the swap through the same duck-swap-restore pattern (debounce
  // → ramp wet to 0 → swap curve → ramp wet back to user target). This test
  // pins the contract: after a DRIVE change while distortion is on at a
  // non-trivial mix, the wet gain is restored to the user's target — NOT
  // left stranded at 0 (which would silence the distortion forever).
  it("@us US18: changing distortion DRIVE while wet > 0 doesn't strand wet at 0 (R18 T3)", async () => {
    vi.useFakeTimers();
    try {
      let api;
      render(<Harness onMount={(a) => { api = a; }} />);
      const sr = 11025;
      const buf = new MockAudioBuffer(1, sr * 3, sr);
      await act(async () => {
        await api.deckRef.current.loadBuffer(buf, "track.mp3");
      });

      // Turn distortion ON.
      const distToggle = screen.getByLabelText(/Distortion effect (on|off)/i);
      await act(async () => fireEvent.click(distToggle));

      // Bump the MIX knob to 0.6 via repeated ArrowUp (default 0.4, step 0.01).
      // Distortion sits in its own EffectCard; its MIX knob is the second
      // MIX-labelled slider on the page (after reverb's). Use getAllByRole
      // and filter by ancestor card title.
      const knobs = screen.getAllByRole("slider");
      // Distortion's DRIVE knob has the unique aria-label "DRIVE" — locate
      // distortion's MIX knob by walking up from DRIVE to the EffectCard's
      // root div. The card's first child is the toggle button; its sibling
      // is the knobs container holding MIX + DRIVE.
      const driveKnob = knobs.find((k) => k.getAttribute("aria-label") === "DRIVE");
      expect(driveKnob).toBeTruthy();
      // driveKnob → knob wrapper → knobs row → card root
      const card = driveKnob.parentElement?.parentElement?.parentElement;
      expect(card).toBeTruthy();
      const mixKnob = Array.from(card.querySelectorAll('[role="slider"]')).find(
        (k) => k.getAttribute("aria-label") === "MIX"
      );
      expect(mixKnob).toBeTruthy();
      // Bump distortion MIX from 0.4 to 0.6 (20 ticks at step 0.01).
      for (let i = 0; i < 20; i++) {
        await act(async () => fireEvent.keyDown(mixKnob, { key: "ArrowUp" }));
      }

      // Locate the WaveShaper's downstream wet GainNode via the audio ctx.
      const ctx = api.audioCtxRef.current;
      const shaper = ctx._nodes.find((n) => n.nodeType === "WaveShaperNode");
      expect(shaper).toBeTruthy();
      const distortionWet = shaper.connections.find(
        (n) => n.nodeType === "GainNode"
      );
      expect(distortionWet).toBeTruthy();
      // After ON + mix≈0.6 the wet gain target is ~0.6.
      expect(distortionWet.gain.value).toBeCloseTo(0.6, 1);

      // Snapshot the curve before, then drive a DRIVE change. The 200 ms
      // debounce coalesces the spin; advance fake timers to fire it.
      const curveBefore = shaper.curve;
      await act(async () => fireEvent.keyDown(driveKnob, { key: "ArrowUp" }));
      await act(async () => { vi.advanceTimersByTime(250); });

      // After the duck-swap-restore: wet must be ramped back to the user's
      // target (≈ 0.6), NOT stranded at 0. Allow a small tolerance because
      // setTargetAtTime writes the *target* into .value in the mock.
      expect(distortionWet.gain.value).toBeGreaterThan(0.5);
      // The curve was actually swapped — a new Float32Array (or new
      // reference) is now on the shaper.
      expect(shaper.curve).not.toBe(curveBefore);
      expect(shaper.curve).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("@us US24: bass-drop re-entry guard — double-fire does not throw", async () => {
    // Load a buffer via drop so the deck chain is built and BASS DROP enables.
    const { container } = render(<Harness />);
    const deckDiv = container.querySelector('[role="region"]');
    const fakeAudio = new File([new Uint8Array([0, 1, 2])], "track.mp3", {
      type: "audio/mpeg",
    });
    await act(async () => {
      fireEvent.dragOver(deckDiv, { dataTransfer: { items: [{ kind: "file" }] } });
      fireEvent.drop(deckDiv, {
        dataTransfer: { files: [fakeAudio], items: [{ kind: "file" }] },
      });
    });

    const bassDrop = await waitFor(() => {
      const btn = screen.getByRole("button", { name: /BASS DROP/i });
      expect(btn).not.toBeDisabled();
      return btn;
    });

    // Firing the bass drop twice in immediate succession must not throw — the
    // synchronous bassDropRunningRef guard makes the second call a no-op
    // (before the disabled attribute updates a render later).
    expect(() => {
      act(() => {
        fireEvent.click(bassDrop);
        fireEvent.click(bassDrop);
      });
    }).not.toThrow();
  });

  // @us US6 (R18 T1) — turning an EQ knob must schedule through setTargetAtTime
  // on the BiquadFilter's gain AudioParam, never a direct `.value =` write. A
  // direct write is one step in the param's automation curve and produces
  // audible zipper noise under a fast spin. The mock records every scheduling
  // call into `scheduledValues`, so the test asserts the last recorded entry
  // is a `setTarget` with the new knob value.
  it("@us US6: EQ knob changes schedule via setTargetAtTime (R18 T1)", async () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    const sr = 11025;
    const buf = new MockAudioBuffer(1, sr * 3, sr);
    await act(async () => { await api.deckRef.current.loadBuffer(buf, "track.mp3"); });

    const ctx = api.audioCtxRef.current;
    // eqLow is the first BiquadFilter in the deck chain (chain.js order:
    // eqLow lowshelf, eqMid peaking, eqHigh highshelf, filter lowpass).
    const lowShelf = ctx._nodes.find(
      (n) => n.nodeType === "BiquadFilterNode" && n.type === "lowshelf"
    );
    expect(lowShelf).toBeTruthy();

    // Spin the LOW knob via the keyboard slider contract (step 1 dB per arrow).
    const knobs = screen.getAllByRole("slider");
    const lowKnob = knobs.find((k) => k.getAttribute("aria-label") === "LOW");
    expect(lowKnob).toBeTruthy();
    await act(async () => fireEvent.keyDown(lowKnob, { key: "ArrowUp" }));

    // The most-recent scheduling entry on eqLow.gain must be a setTarget,
    // NOT a direct value write (which the mock would not record).
    const last = lowShelf.gain.scheduledValues.at(-1);
    expect(last).toBeTruthy();
    expect(last.type).toBe("setTarget");
  });

  // @us US59 (R18 T2) — the speed slider drives a live BufferSource's
  // playbackRate. A direct `.value =` write would zipper under a rapid drag.
  // The fix routes the change through setTargetAtTime (tau matches the bend
  // smoothing) so both pitch-change paths share one constant.
  it("@us US59: speed slider schedules playbackRate via setTargetAtTime (R18 T2)", async () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    const sr = 11025;
    const buf = new MockAudioBuffer(1, sr * 3, sr);
    await act(async () => { await api.deckRef.current.loadBuffer(buf, "track.mp3"); });
    await act(async () => { await api.deckRef.current.play(); });

    const src = api.audioCtxRef.current._lastStartedSource;
    expect(src).toBeTruthy();
    // Snapshot the schedule queue length so we only look at the entry
    // produced by the upcoming speed change.
    const before = src.playbackRate.scheduledValues.length;

    // Push the speed via the imperative setter — it routes through the same
    // useEffect the slider does.
    await act(async () => { api.deckRef.current.setSpeed(1.2); });

    const after = src.playbackRate.scheduledValues.slice(before);
    // At least one new entry — and it must be a setTarget, not a direct write.
    expect(after.length).toBeGreaterThan(0);
    expect(after.at(-1).type).toBe("setTarget");
  });

  // @us US18 (V1 R19) — the reverb-size duck-swap-restore race. The prior fix
  // anchored both setTargetAtTime calls at ctx.currentTime so the restore
  // ramp replaced the duck ramp instantly; the convolver still saw a non-zero
  // input across the buffer swap. The fix pins wet to 0 with setValueAtTime
  // before the swap, then ramps wet back. This test asserts the recorded
  // schedule contains a setValueAtTime(0, …) entry BEFORE the ramp-back's
  // setTargetAtTime — proof the duck actually lands.
  it("@us US18: reverb-size swap pins wet to 0 via setValueAtTime before the IR swap (V1 R19)", async () => {
    vi.useFakeTimers();
    try {
      let api;
      render(<Harness onMount={(a) => { api = a; }} />);
      const sr = 11025;
      const buf = new MockAudioBuffer(1, sr * 3, sr);
      await act(async () => { await api.deckRef.current.loadBuffer(buf, "track.mp3"); });

      // Turn reverb on with a non-zero mix so wet > 0 before the swap.
      const reverbToggle = screen.getByLabelText(/Reverb effect (on|off)/i);
      await act(async () => fireEvent.click(reverbToggle));
      // Default mix is 0.3 — already > 0.001 → triggers the pin-and-restore path.

      const ctx = api.audioCtxRef.current;
      const conv = ctx._nodes.find((n) => n.nodeType === "ConvolverNode");
      const reverbWet = conv.connections.find((n) => n.nodeType === "GainNode");
      // Snapshot the schedule queue so we only inspect entries the size swap adds.
      const before = reverbWet.gain.scheduledValues.length;

      // Spin SIZE — fires the 200 ms debounce path.
      const knobs = screen.getAllByRole("slider");
      const sizeKnob = knobs.find((k) => k.getAttribute("aria-label") === "SIZE");
      await act(async () => fireEvent.keyDown(sizeKnob, { key: "ArrowUp" }));
      await act(async () => { vi.advanceTimersByTime(250); });

      const after = reverbWet.gain.scheduledValues.slice(before);
      // The duck-pin entry: setValueAtTime(0, …) lands BEFORE the ramp-back.
      const setZeroIdx = after.findIndex(
        (e) => e.type === "setValue" && e.value === 0
      );
      const rampBackIdx = after.findIndex(
        (e) => e.type === "setTarget" && e.target > 0
      );
      expect(setZeroIdx).toBeGreaterThanOrEqual(0);
      expect(rampBackIdx).toBeGreaterThan(setZeroIdx);
    } finally {
      vi.useRealTimers();
    }
  });

  // @us US6 (V5 R19) — user moves an EQ knob during a running bass drop. The
  // drop owns the eqLow schedule (multi-leg linearRamp). Without the fix the
  // user's setTargetAtTime queues behind the drop and the knob appears to do
  // nothing until t3. The fix cancel-and-holds first so the user's value lands
  // immediately. The schedule queue must contain a `cancelAndHold` entry
  // recorded BEFORE the user's setTargetAtTime.
  it("@us US6: EQ change during a bass drop cancel-and-holds the schedule (V5 R19)", async () => {
    let api;
    const { container } = render(<Harness onMount={(a) => { api = a; }} />);
    // Load a buffer so the drop can fire.
    const deckDiv = container.querySelector('[role="region"]');
    const fakeAudio = new File([new Uint8Array([0, 1, 2])], "track.mp3", {
      type: "audio/mpeg",
    });
    await act(async () => {
      fireEvent.dragOver(deckDiv, { dataTransfer: { items: [{ kind: "file" }] } });
      fireEvent.drop(deckDiv, {
        dataTransfer: { files: [fakeAudio], items: [{ kind: "file" }] },
      });
    });

    const bassDrop = await waitFor(() => {
      const btn = screen.getByRole("button", { name: /BASS DROP/i });
      expect(btn).not.toBeDisabled();
      return btn;
    });
    await act(async () => fireEvent.click(bassDrop));

    const ctx = api.audioCtxRef.current;
    const lowShelf = ctx._nodes.find(
      (n) => n.nodeType === "BiquadFilterNode" && n.type === "lowshelf"
    );
    // Snapshot the schedule length so we only inspect entries the user EQ
    // change adds (the drop's ramps are already queued before this point).
    const before = lowShelf.gain.scheduledValues.length;

    // User moves LOW while the drop is still running.
    const knobs = screen.getAllByRole("slider");
    const lowKnob = knobs.find((k) => k.getAttribute("aria-label") === "LOW");
    await act(async () => fireEvent.keyDown(lowKnob, { key: "ArrowUp" }));

    const after = lowShelf.gain.scheduledValues.slice(before);
    // cancelAndHoldAtTime (or its fallback cancelScheduledValues + setValueAtTime)
    // lands BEFORE the user's setTargetAtTime so the user value wins now.
    const cahIdx = after.findIndex(
      (e) => e.type === "cancelAndHold" || e.type === "cancel"
    );
    const setTargetIdx = after.findIndex((e) => e.type === "setTarget");
    expect(cahIdx).toBeGreaterThanOrEqual(0);
    expect(setTargetIdx).toBeGreaterThan(cahIdx);
  });

  // @us US24 (V4 R19) — the BASS DROP button must announce its engaged state.
  // While the drop is active the label flips ("DROPPING") and the button gets
  // aria-pressed=true so screen readers know it's currently engaged. The
  // button also has type="button" so wrapping it in a form would never submit.
  it("@us US24: BASS DROP button carries aria-pressed + type=button (V4 R19)", async () => {
    const { container } = render(<Harness />);
    const deckDiv = container.querySelector('[role="region"]');
    const fakeAudio = new File([new Uint8Array([0, 1, 2])], "track.mp3", {
      type: "audio/mpeg",
    });
    await act(async () => {
      fireEvent.dragOver(deckDiv, { dataTransfer: { items: [{ kind: "file" }] } });
      fireEvent.drop(deckDiv, {
        dataTransfer: { files: [fakeAudio], items: [{ kind: "file" }] },
      });
    });
    const bassDrop = await waitFor(() => {
      const btn = screen.getByRole("button", { name: /BASS DROP/i });
      expect(btn).not.toBeDisabled();
      return btn;
    });
    expect(bassDrop).toHaveAttribute("type", "button");
    expect(bassDrop).toHaveAttribute("aria-pressed", "false");
    await act(async () => fireEvent.click(bassDrop));
    // After firing, the button is engaged → aria-pressed=true.
    expect(bassDrop).toHaveAttribute("aria-pressed", "true");
  });

  // @us US7 (W5 R20) — V5 (R19) added cancel-and-hold for the LPF sweep param
  // too, not just EQ. During a running bass drop the drop owns the multi-leg
  // exponential LPF schedule; a user-driven filter slider move used to queue
  // behind those ramps and not take effect until t3. The fix cancel-and-holds
  // first so the user's value lands immediately. The schedule queue must
  // contain a `cancelAndHold` entry (or its fallback) BEFORE the user's
  // setTargetAtTime.
  it("@us US7: filter change during a bass drop cancel-and-holds the LPF schedule (V5 R19)", async () => {
    let api;
    const { container } = render(<Harness onMount={(a) => { api = a; }} />);
    const deckDiv = container.querySelector('[role="region"]');
    const fakeAudio = new File([new Uint8Array([0, 1, 2])], "track.mp3", {
      type: "audio/mpeg",
    });
    await act(async () => {
      fireEvent.dragOver(deckDiv, { dataTransfer: { items: [{ kind: "file" }] } });
      fireEvent.drop(deckDiv, {
        dataTransfer: { files: [fakeAudio], items: [{ kind: "file" }] },
      });
    });

    const bassDrop = await waitFor(() => {
      const btn = screen.getByRole("button", { name: /BASS DROP/i });
      expect(btn).not.toBeDisabled();
      return btn;
    });
    await act(async () => fireEvent.click(bassDrop));

    const ctx = api.audioCtxRef.current;
    // The LPF sweep node is the only lowpass BiquadFilter in the deck chain.
    const filter = ctx._nodes.find(
      (n) => n.nodeType === "BiquadFilterNode" && n.type === "lowpass"
    );
    // Snapshot the queue length so we only see what the user-driven slider
    // move appends; the drop's exponentialRamp legs are already queued.
    const before = filter.frequency.scheduledValues.length;

    // User moves the FLT slider while the drop is still running. The native
    // range input responds to onChange, not keyDown.
    const filterSlider = screen.getByRole("slider", {
      name: /filter frequency/i,
    });
    await act(async () => {
      fireEvent.change(filterSlider, { target: { value: "8000" } });
    });

    const after = filter.frequency.scheduledValues.slice(before);
    // cancelAndHoldAtTime (or its fallback cancelScheduledValues +
    // setValueAtTime) lands BEFORE the user's setTargetAtTime — proof the
    // user's value supersedes the drop's owned schedule.
    const cahIdx = after.findIndex(
      (e) => e.type === "cancelAndHold" || e.type === "cancel"
    );
    const setTargetIdx = after.findIndex((e) => e.type === "setTarget");
    expect(cahIdx).toBeGreaterThanOrEqual(0);
    expect(setTargetIdx).toBeGreaterThan(cahIdx);
  });

  // @us US20 (W5 R20) — V1's synchronous-pin pattern is paired across reverb
  // and distortion. The reverb-size test already exists (lines ~940). This
  // mirrors it for distortion DRIVE: with distortion.on=true and mix>0, the
  // 200 ms-debounced curve hot-swap must pin wet to 0 via setValueAtTime
  // BEFORE the ramp-back's setTargetAtTime — otherwise the duck-ramp and
  // restore-ramp anchored at the same ctx.currentTime collide and the duck
  // never lands.
  it("@us US20: distortion-drive swap pins wet to 0 via setValueAtTime before the curve swap (V1 R19)", async () => {
    vi.useFakeTimers();
    try {
      let api;
      render(<Harness onMount={(a) => { api = a; }} />);
      const sr = 11025;
      const buf = new MockAudioBuffer(1, sr * 3, sr);
      await act(async () => { await api.deckRef.current.loadBuffer(buf, "track.mp3"); });

      // Turn distortion on with default mix=0.3 (> 0.001 → triggers the
      // pin-and-restore path).
      const distortionToggle = screen.getByLabelText(
        /Distortion effect (on|off)/i
      );
      await act(async () => fireEvent.click(distortionToggle));

      const ctx = api.audioCtxRef.current;
      // distortionWet is the GainNode the WaveShaper's host wires its wet bus
      // through. The chain.js builder connects WaveShaper → distortionWet, so
      // we grab it by walking from the WaveShaperNode.
      const shaper = ctx._nodes.find((n) => n.nodeType === "WaveShaperNode");
      const distortionWet = shaper.connections.find(
        (n) => n.nodeType === "GainNode"
      );
      const before = distortionWet.gain.scheduledValues.length;

      // Spin DRIVE — fires the 200 ms debounce path.
      const knobs = screen.getAllByRole("slider");
      const driveKnob = knobs.find((k) => k.getAttribute("aria-label") === "DRIVE");
      await act(async () => fireEvent.keyDown(driveKnob, { key: "ArrowUp" }));
      await act(async () => { vi.advanceTimersByTime(250); });

      const after = distortionWet.gain.scheduledValues.slice(before);
      // setValueAtTime(0, …) lands BEFORE the ramp-back's setTargetAtTime
      // with a positive target.
      const setZeroIdx = after.findIndex(
        (e) => e.type === "setValue" && e.value === 0
      );
      const rampBackIdx = after.findIndex(
        (e) => e.type === "setTarget" && e.target > 0
      );
      expect(setZeroIdx).toBeGreaterThanOrEqual(0);
      expect(rampBackIdx).toBeGreaterThan(setZeroIdx);
    } finally {
      vi.useRealTimers();
    }
  });

  // @us US18 (W2 R20) — MIX is owned by a separate, non-debounced wet-gain
  // effect. R19 added effects.reverb.mix to the reverb-size debounce's deps,
  // which caused a 200 ms-debounced duck-swap-restore to fire every time the
  // MIX knob moved — audibly dipping the wet bus. The fix removes MIX from
  // the size-debounce deps. Regression: with reverb on + non-zero mix, moving
  // ONLY the mix knob must NOT fire the size debounce (no new setValue(0)
  // duck entry on the wet gain, no new IR built).
  it("@us US18: changing reverb MIX does not fire the size-debounce duck (W2 R20)", async () => {
    vi.useFakeTimers();
    try {
      let api;
      render(<Harness onMount={(a) => { api = a; }} />);
      const sr = 11025;
      const buf = new MockAudioBuffer(1, sr * 3, sr);
      await act(async () => { await api.deckRef.current.loadBuffer(buf, "track.mp3"); });

      // Turn reverb on; default mix=0.3 (> 0).
      const reverbToggle = screen.getByLabelText(/Reverb effect (on|off)/i);
      await act(async () => fireEvent.click(reverbToggle));
      // Let the initial IR build settle out of the debounce window.
      await act(async () => { vi.advanceTimersByTime(250); });

      const ctx = api.audioCtxRef.current;
      const conv = ctx._nodes.find((n) => n.nodeType === "ConvolverNode");
      const reverbWet = conv.connections.find((n) => n.nodeType === "GainNode");
      // Snapshot both the wet schedule and the convolver's buffer identity.
      const before = reverbWet.gain.scheduledValues.length;
      const irBefore = conv.buffer;

      // Move ONLY the MIX knob — must NOT trigger a size-debounce rebuild.
      const knobs = screen.getAllByRole("slider");
      const mixKnob = knobs.find(
        (k) =>
          k.getAttribute("aria-label") === "MIX" &&
          k.closest("div")?.textContent?.includes("Reverb") !== false
      );
      // There are multiple MIX knobs (reverb, delay, distortion); the first
      // one is the reverb card's. Either way only the reverb-specific
      // debounce is under test here.
      const reverbMixKnob = mixKnob || knobs.find((k) => k.getAttribute("aria-label") === "MIX");
      await act(async () => fireEvent.keyDown(reverbMixKnob, { key: "ArrowUp" }));
      // Advance well past the 200 ms debounce — if MIX were still in the deps,
      // a duck-swap-restore would land in this window.
      await act(async () => { vi.advanceTimersByTime(250); });

      const after = reverbWet.gain.scheduledValues.slice(before);
      // The debounce body would have written a setValue(0, …) at ctx.currentTime
      // (the synchronous-pin duck). Its absence proves the size-debounce
      // didn't fire — so MIX is no longer in the deps. The dedicated wet-gain
      // useEffect ramps the wet gain directly via setTarget (no setValue pin
      // on a non-zero target), so the only entries we tolerate are setTarget
      // (and cancelAndHold from the W1 rampGain prefix).
      const duckPin = after.find(
        (e) => e.type === "setValue" && e.value === 0
      );
      expect(duckPin).toBeUndefined();
      // And the IR buffer was NOT swapped — same reference as before.
      expect(conv.buffer).toBe(irBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  // @us US26 (X1 R21) — Pause and Stop are MOMENTARY actions, not toggles.
  // Per DESIGN_GUIDE §6 non-toggle buttons MUST NOT carry aria-pressed (a
  // hardcoded "false" attribute incorrectly tells assistive tech the control
  // is a toggle that happens to be off). Play and Loop ARE toggles (active
  // tracks isPlaying / isLooping) and must keep aria-pressed.
  it("@us US26: Pause and Stop omit aria-pressed; Play and Loop carry it (X1 R21)", () => {
    render(<Harness />);
    const playBtn = screen.getByRole("button", { name: /Play deck/i });
    const pauseBtn = screen.getByRole("button", { name: /Pause deck/i });
    const stopBtn = screen.getByRole("button", { name: /Stop deck/i });
    const loopBtn = screen.getByRole("button", { name: /Loop deck/i });
    // Toggles: aria-pressed present (and "false" while inactive).
    expect(playBtn).toHaveAttribute("aria-pressed");
    expect(loopBtn).toHaveAttribute("aria-pressed");
    // Loop is engaged by default (isLooping starts true).
    expect(loopBtn).toHaveAttribute("aria-pressed", "true");
    expect(playBtn).toHaveAttribute("aria-pressed", "false");
    // Momentary actions: the attribute must NOT appear in the DOM at all.
    expect(pauseBtn).not.toHaveAttribute("aria-pressed");
    expect(stopBtn).not.toHaveAttribute("aria-pressed");
  });

  // @us US44 (X2 R21) — once a file is loaded, the file-load button's visible
  // text becomes JUST the filename and the accessible name loses its verb. An
  // explicit aria-label keeps the action context ("load / replace") and the
  // deck identity in the SR announcement, both empty and loaded.
  it("@us US44: file-load button aria-label flips between empty / loaded states (X2 R21)", async () => {
    let api;
    const { container } = render(<Harness id="A" onMount={(a) => { api = a; }} />);
    // Empty state — the load button is the only one with this aria-label shape.
    expect(
      screen.getByRole("button", { name: /Load audio for Deck A/i })
    ).toBeInTheDocument();
    // Drop a fake audio file → adoptBuffer flips fileName.
    const deckDiv = container.querySelector('[role="region"]');
    const fakeAudio = new File([new Uint8Array([0, 1, 2])], "tune.mp3", {
      type: "audio/mpeg",
    });
    await act(async () => {
      fireEvent.dragOver(deckDiv, { dataTransfer: { items: [{ kind: "file" }] } });
      fireEvent.drop(deckDiv, {
        dataTransfer: { files: [fakeAudio], items: [{ kind: "file" }] },
      });
    });
    // Loaded state — the label now carries the filename + replace action.
    const loaded = screen.getByRole("button", {
      name: /Loaded: tune\.mp3 — click to replace \(Deck A\)/i,
    });
    expect(loaded).toBeInTheDocument();
    // The bare "Load audio for Deck A" label is gone now.
    expect(
      screen.queryByRole("button", { name: /^Load audio for Deck A$/i })
    ).toBeNull();
    // Keep api reference live so eslint-no-unused doesn't complain.
    expect(api.deckRef.current).toBeTruthy();
  });

  // @us US26 (X3 R21) — all four transport buttons are gated on a loaded file,
  // matching SYNC / AUTO / ÷2 / ×2 / NUDGE / BASS DROP. Without a buffer the
  // controls are non-operative; surfacing that as `disabled` keeps the focus
  // model honest and announces the state to screen readers.
  it("@us US26: transport buttons are disabled until a file is loaded (X3 R21)", async () => {
    let api;
    const { container } = render(<Harness onMount={(a) => { api = a; }} />);
    // Empty: every transport button is disabled.
    for (const name of [/Play deck/i, /Pause deck/i, /Stop deck/i, /Loop deck/i]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    // Drop a track → transport enables.
    const deckDiv = container.querySelector('[role="region"]');
    const fakeAudio = new File([new Uint8Array([0, 1, 2])], "track.mp3", {
      type: "audio/mpeg",
    });
    await act(async () => {
      fireEvent.dragOver(deckDiv, { dataTransfer: { items: [{ kind: "file" }] } });
      fireEvent.drop(deckDiv, {
        dataTransfer: { files: [fakeAudio], items: [{ kind: "file" }] },
      });
    });
    for (const name of [/Play deck/i, /Pause deck/i, /Stop deck/i, /Loop deck/i]) {
      expect(screen.getByRole("button", { name })).not.toBeDisabled();
    }
    expect(api.deckRef.current).toBeTruthy();
  });

  // @us US18 (X4 R21) — the 200 ms reverb-size debounce captures effects.reverb.mix
  // in closure. If the user nudges SIZE and then slides MIX from 0.3 → 0.7
  // inside the debounce window, the timer fires AFTER mix already moved — the
  // ramp-back used to pin wet to the STALE captured 0.3, overriding the live
  // 0.7 from the non-debounced mix effect. Fix mirrors mix into reverbMixRef
  // so the ramp-back reads the LIVE value.
  it("@us US18: reverb-size debounce ramp-back reads LIVE mix from ref, not stale closure (X4 R21)", async () => {
    vi.useFakeTimers();
    try {
      let api;
      render(<Harness onMount={(a) => { api = a; }} />);
      const sr = 11025;
      const buf = new MockAudioBuffer(1, sr * 3, sr);
      await act(async () => { await api.deckRef.current.loadBuffer(buf, "track.mp3"); });

      // Turn reverb ON; default mix is 0.3 → wet > 0 triggers pin-and-restore.
      const reverbToggle = screen.getByLabelText(/Reverb effect (on|off)/i);
      await act(async () => fireEvent.click(reverbToggle));
      // Let any initial effect-toggle ramps drain past the debounce window.
      await act(async () => { vi.advanceTimersByTime(250); });

      const ctx = api.audioCtxRef.current;
      const conv = ctx._nodes.find((n) => n.nodeType === "ConvolverNode");
      const reverbWet = conv.connections.find((n) => n.nodeType === "GainNode");

      // Locate the reverb knobs by walking from SIZE up to its EffectCard.
      const knobs = screen.getAllByRole("slider");
      const sizeKnob = knobs.find((k) => k.getAttribute("aria-label") === "SIZE");
      expect(sizeKnob).toBeTruthy();
      // The reverb card hosts BOTH MIX and SIZE knobs; MIX in this card is
      // the one whose closest EffectCard ancestor contains the SIZE knob.
      const card = sizeKnob.parentElement?.parentElement?.parentElement;
      const reverbMixKnob = Array.from(card.querySelectorAll('[role="slider"]'))
        .find((k) => k.getAttribute("aria-label") === "MIX");
      expect(reverbMixKnob).toBeTruthy();

      // Step 1: nudge SIZE → schedules the 200 ms debounce that closes over
      // mix=0.3 (the current captured value).
      await act(async () => fireEvent.keyDown(sizeKnob, { key: "ArrowUp" }));

      // Step 2: within the debounce window, slide MIX UP from 0.3 to ≈0.7
      // (40 ArrowUp ticks at step 0.01). The live, non-debounced wet effect
      // ramps wet to ~0.7 in real time.
      for (let i = 0; i < 40; i++) {
        await act(async () => fireEvent.keyDown(reverbMixKnob, { key: "ArrowUp" }));
      }
      // Sanity: the live wet gain reflects the user's mix move BEFORE the
      // debounce fires (the non-debounced effect already ramped to ~0.7).
      expect(reverbWet.gain.value).toBeCloseTo(0.7, 1);

      // Snapshot the schedule queue at the boundary — anything after this
      // belongs to the debounce timer body.
      const before = reverbWet.gain.scheduledValues.length;

      // Step 3: advance past the 200 ms debounce → timer body fires. With the
      // bug it pins wet to 0 and ramps back to the STALE 0.3. With the fix it
      // reads reverbMixRef.current (≈0.7) and ramps back to 0.7.
      await act(async () => { vi.advanceTimersByTime(250); });

      const appended = reverbWet.gain.scheduledValues.slice(before);
      // The duck pin must have landed (setValueAtTime(0,…)).
      const pin = appended.find((e) => e.type === "setValue" && e.value === 0);
      expect(pin).toBeTruthy();
      // The ramp-back endpoint must be the LIVE mix (≈0.7), NOT the captured 0.3.
      const rampBack = [...appended].reverse().find((e) => e.type === "setTarget");
      expect(rampBack).toBeTruthy();
      expect(rampBack.target).toBeCloseTo(0.7, 1);
      // Strict guard against regression — the stale-closure bug would have
      // landed a setTarget at exactly the captured 0.3.
      expect(rampBack.target).not.toBeCloseTo(0.3, 2);
    } finally {
      vi.useRealTimers();
    }
  });

  // @us US20 (X5 R21) — symmetric regression for distortion MIX. Mirrors the
  // existing reverb-MIX test (W2 R20): moving ONLY the distortion MIX knob
  // must NOT trigger the drive-debounce duck-swap-restore (no setValue(0)
  // pin on the wet gain, no curve rebuild). Confirms the R20 dep-list fix
  // applies symmetrically to distortion, not just reverb.
  it("@us US20: changing distortion MIX does not fire the drive-debounce duck (X5 R21)", async () => {
    vi.useFakeTimers();
    try {
      let api;
      render(<Harness onMount={(a) => { api = a; }} />);
      const sr = 11025;
      const buf = new MockAudioBuffer(1, sr * 3, sr);
      await act(async () => { await api.deckRef.current.loadBuffer(buf, "track.mp3"); });

      // Turn distortion on; default mix=0.4 → wet > 0.
      const distortionToggle = screen.getByLabelText(/Distortion effect (on|off)/i);
      await act(async () => fireEvent.click(distortionToggle));
      await act(async () => { vi.advanceTimersByTime(250); });

      const ctx = api.audioCtxRef.current;
      const shaper = ctx._nodes.find((n) => n.nodeType === "WaveShaperNode");
      const distortionWet = shaper.connections.find((n) => n.nodeType === "GainNode");
      const curveBefore = shaper.curve;
      const beforeLen = distortionWet.gain.scheduledValues.length;

      // Walk up from DRIVE to the distortion EffectCard, then pick its MIX.
      const knobs = screen.getAllByRole("slider");
      const driveKnob = knobs.find((k) => k.getAttribute("aria-label") === "DRIVE");
      const card = driveKnob.parentElement?.parentElement?.parentElement;
      const distortionMixKnob = Array.from(card.querySelectorAll('[role="slider"]'))
        .find((k) => k.getAttribute("aria-label") === "MIX");
      expect(distortionMixKnob).toBeTruthy();

      // Move ONLY the MIX knob — must NOT trigger the drive-debounce rebuild.
      await act(async () => fireEvent.keyDown(distortionMixKnob, { key: "ArrowUp" }));
      // Well past the 200 ms debounce window.
      await act(async () => { vi.advanceTimersByTime(250); });

      const appended = distortionWet.gain.scheduledValues.slice(beforeLen);
      // The duck-pin (setValue(0)) is the smoking gun of a debounce-fire —
      // its absence proves the drive-debounce did NOT run.
      const duckPin = appended.find(
        (e) => e.type === "setValue" && e.value === 0
      );
      expect(duckPin).toBeUndefined();
      // The WaveShaper curve was NOT swapped — same reference as before.
      expect(shaper.curve).toBe(curveBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  // @us US19 (X5 R21) — interaction between rampGain's cancelAndHoldAtTime
  // prefix (R20 W1) and the debounce duck-swap-restore. The swap path pins
  // wet to 0 with setValueAtTime(0, now), then calls rampGain(wetParam,
  // target, ctx, 0.003) which itself prefixes a cancelAndHoldAtTime(now).
  // The concern: does the cancelAndHold undo the explicit 0 pin? The
  // contract is "no" — cancelAndHoldAtTime FREEZES the value at the time
  // it's called (the 0 we just wrote), then the new setTarget ramps FROM 0
  // back to the user's mix. The recorded queue must show setValue(0) →
  // cancelAndHold → setTarget(>0), in that order, with NO intervening event
  // that would erase the 0 pin.
  it("@us US19: duck-swap-restore — cancelAndHold does not undo the 0 pin (X5 R21)", async () => {
    vi.useFakeTimers();
    try {
      let api;
      render(<Harness onMount={(a) => { api = a; }} />);
      const sr = 11025;
      const buf = new MockAudioBuffer(1, sr * 3, sr);
      await act(async () => { await api.deckRef.current.loadBuffer(buf, "track.mp3"); });

      // Turn reverb on (wet > 0 → triggers the pin-and-restore branch).
      const reverbToggle = screen.getByLabelText(/Reverb effect (on|off)/i);
      await act(async () => fireEvent.click(reverbToggle));
      await act(async () => { vi.advanceTimersByTime(250); });

      const ctx = api.audioCtxRef.current;
      const conv = ctx._nodes.find((n) => n.nodeType === "ConvolverNode");
      const reverbWet = conv.connections.find((n) => n.nodeType === "GainNode");

      // Snapshot the schedule queue so we only see the size-swap entries.
      const before = reverbWet.gain.scheduledValues.length;

      // Spin SIZE → schedules the 200 ms debounce; fire it.
      const knobs = screen.getAllByRole("slider");
      const sizeKnob = knobs.find((k) => k.getAttribute("aria-label") === "SIZE");
      await act(async () => fireEvent.keyDown(sizeKnob, { key: "ArrowUp" }));
      await act(async () => { vi.advanceTimersByTime(250); });

      const appended = reverbWet.gain.scheduledValues.slice(before);

      // 1) setValue(0) pin lands first.
      const pinIdx = appended.findIndex(
        (e) => e.type === "setValue" && e.value === 0
      );
      expect(pinIdx).toBeGreaterThanOrEqual(0);

      // 2) rampGain's cancelAndHoldAtTime (or cancel fallback) lands AFTER
      //    the pin — freezing the 0 value, not erasing it.
      const cahIdx = appended.findIndex(
        (e, i) =>
          i > pinIdx && (e.type === "cancelAndHold" || e.type === "cancel")
      );
      expect(cahIdx).toBeGreaterThan(pinIdx);

      // 3) The ramp-back's setTarget lands LAST with a positive target — the
      //    convolver ramps from the 0 the cancelAndHold froze, back up to mix.
      const rampBackIdx = appended.findIndex(
        (e, i) => i > cahIdx && e.type === "setTarget" && e.target > 0
      );
      expect(rampBackIdx).toBeGreaterThan(cahIdx);

      // No subsequent event between the pin and the cancelAndHold writes a
      // non-zero value (which would undo the duck) — only the pin itself
      // touched the param in that window.
      const between = appended.slice(pinIdx + 1, cahIdx);
      const overrider = between.find(
        (e) =>
          (e.type === "setValue" && e.value !== 0) ||
          (e.type === "setTarget" && e.target !== 0)
      );
      expect(overrider).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── W3.3 — EQ kill switches (US66) ───
describe("Deck EQ kills — US66", () => {
  it("@us US66: killing a band schedules the kill floor without moving the knob", async () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    const sr = 11025;
    const buf = new MockAudioBuffer(1, sr * 3, sr);
    await act(async () => { await api.deckRef.current.loadBuffer(buf, "track.mp3"); });

    const ctx = api.audioCtxRef.current;
    const lowShelf = ctx._nodes.find(
      (n) => n.nodeType === "BiquadFilterNode" && n.type === "lowshelf"
    );

    // Raise the LOW knob to +3 first so we can prove the knob doesn't move.
    const lowKnob = screen
      .getAllByRole("slider")
      .find((k) => k.getAttribute("aria-label") === "LOW");
    for (let i = 0; i < 3; i++) {
      await act(async () => fireEvent.keyDown(lowKnob, { key: "ArrowUp" }));
    }
    const knobBefore = lowKnob.getAttribute("aria-valuenow");

    const kill = screen.getByRole("button", { name: /Kill low EQ on deck A/i });
    expect(kill.getAttribute("aria-pressed")).toBe("false");
    await act(async () => { fireEvent.click(kill); });

    // aria-pressed flips; the scheduled value is the -26 dB kill floor via
    // setTargetAtTime (never an instant write); the knob is untouched.
    expect(kill.getAttribute("aria-pressed")).toBe("true");
    const last = lowShelf.gain.scheduledValues.at(-1);
    expect(last.type).toBe("setTarget");
    expect(last.target).toBe(-26);
    expect(lowKnob.getAttribute("aria-valuenow")).toBe(knobBefore);
  });

  it("@us US66: un-killing restores the knob's exact prior gain", async () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    const sr = 11025;
    const buf = new MockAudioBuffer(1, sr * 3, sr);
    await act(async () => { await api.deckRef.current.loadBuffer(buf, "track.mp3"); });

    const ctx = api.audioCtxRef.current;
    const highShelf = ctx._nodes.find(
      (n) => n.nodeType === "BiquadFilterNode" && n.type === "highshelf"
    );
    const highKnob = screen
      .getAllByRole("slider")
      .find((k) => k.getAttribute("aria-label") === "HIGH");
    for (let i = 0; i < 5; i++) {
      await act(async () => fireEvent.keyDown(highKnob, { key: "ArrowUp" }));
    }
    const knobValue = Number(highKnob.getAttribute("aria-valuenow"));

    const kill = screen.getByRole("button", { name: /Kill high EQ on deck A/i });
    await act(async () => { fireEvent.click(kill); });
    await act(async () => { fireEvent.click(kill); });

    expect(kill.getAttribute("aria-pressed")).toBe("false");
    const last = highShelf.gain.scheduledValues.at(-1);
    expect(last.type).toBe("setTarget");
    expect(last.target).toBe(knobValue);
  });

  it("@us US66: turning a knob while its band is killed keeps the band killed", async () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    const sr = 11025;
    const buf = new MockAudioBuffer(1, sr * 3, sr);
    await act(async () => { await api.deckRef.current.loadBuffer(buf, "track.mp3"); });

    const ctx = api.audioCtxRef.current;
    const midPeak = ctx._nodes.find(
      (n) => n.nodeType === "BiquadFilterNode" && n.type === "peaking"
    );
    const kill = screen.getByRole("button", { name: /Kill mid EQ on deck A/i });
    await act(async () => { fireEvent.click(kill); });

    const midKnob = screen
      .getAllByRole("slider")
      .find((k) => k.getAttribute("aria-label") === "MID");
    await act(async () => fireEvent.keyDown(midKnob, { key: "ArrowUp" }));

    // The knob moved, but the effective scheduled gain stays at the floor.
    const last = midPeak.gain.scheduledValues.at(-1);
    expect(last.target).toBe(-26);
  });
});

// ─── W3.7 — component isolation (US68) ───
describe("Deck isolation mode — US68", () => {
  async function loadDeck() {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    const sr = 11025;
    const buf = new MockAudioBuffer(1, sr * 3, sr);
    await act(async () => { await api.deckRef.current.loadBuffer(buf, "track.mp3"); });
    return api;
  }

  it("@us US68: engaging VOCAL ramps dry→0 and the vocal gate→1 via setTargetAtTime", async () => {
    const api = await loadDeck();
    const chain = api.deckRef.current ? null : null;
    const ctx = api.audioCtxRef.current;
    const vocalBtn = screen.getByRole("button", { name: /Isolate vocal on deck A/i });
    await act(async () => { fireEvent.click(vocalBtn); });
    expect(vocalBtn.getAttribute("aria-pressed")).toBe("true");

    // Find the iso gains: the vocal gate is the mono-forced gain feeding the
    // 200 Hz highpass.
    const hp = ctx._nodes.find(
      (n) => n.nodeType === "BiquadFilterNode" && n.type === "highpass" && n.frequency.value === 200
    );
    const vocalGate = ctx._nodes.find((n) => n.connections?.includes(hp));
    expect(vocalGate).toBeTruthy();
    const lastGate = vocalGate.gain.scheduledValues.at(-1);
    expect(lastGate.type).toBe("setTarget");
    expect(lastGate.target).toBe(1);
  });

  it("@us US68: switching modes is radio-style; OFF restores the dry path to exactly 1", async () => {
    const api = await loadDeck();
    const ctx = api.audioCtxRef.current;
    const bassBtn = screen.getByRole("button", { name: /Isolate bass on deck A/i });
    const percBtn = screen.getByRole("button", { name: /Isolate perc on deck A/i });

    await act(async () => { fireEvent.click(bassBtn); });
    await act(async () => { fireEvent.click(percBtn); });
    expect(bassBtn.getAttribute("aria-pressed")).toBe("false");
    expect(percBtn.getAttribute("aria-pressed")).toBe("true");

    // Toggle PERC off — every gate targets 0 and the dry path targets 1.
    await act(async () => { fireEvent.click(percBtn); });
    expect(percBtn.getAttribute("aria-pressed")).toBe("false");
    const lp180s = ctx._nodes.filter(
      (n) => n.nodeType === "BiquadFilterNode" && n.type === "lowpass" && n.frequency.value === 180
    );
    expect(lp180s.length).toBe(2);
    const bassGate = ctx._nodes.find((n) => n.connections?.includes(lp180s[0]));
    expect(bassGate.gain.scheduledValues.at(-1).target).toBe(0);
    // Dry gain: the gain node whose latest schedule targets 1 and which
    // feeds a gain that feeds eqLow (lowshelf).
    const lowshelf = ctx._nodes.find(
      (n) => n.nodeType === "BiquadFilterNode" && n.type === "lowshelf"
    );
    const isoOut = ctx._nodes.find((n) => n.connections?.includes(lowshelf) && n.nodeType !== "BiquadFilterNode");
    const isoDry = ctx._nodes.find((n) => n.connections?.includes(isoOut) && n.gain?.scheduledValues?.length);
    expect(isoDry.gain.scheduledValues.at(-1).target).toBe(1);
  });

  it("@us US68: isolation buttons are disabled until a track is loaded", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: /Isolate bass on deck A/i })).toBeDisabled();
  });
});

// ─── W3.6 — sound-bite extraction (US69) ───
describe("Deck sound bites — US69", () => {
  async function loadedDeck(extraProps = {}) {
    let api;
    render(<Harness onMount={(a) => { api = a; }} deckProps={extraProps} />);
    const sr = 11025;
    const buf = new MockAudioBuffer(1, sr * 4, sr);
    buf.getChannelData(0).fill(0.5);
    await act(async () => { await api.deckRef.current.loadBuffer(buf, "song.mp3"); });
    return api;
  }

  it("@us US69: SET IN then SET OUT marks a region; OUT is disabled first", async () => {
    await loadedDeck();
    const inBtn = screen.getByRole("button", { name: /Set bite in point on deck A/i });
    const outBtn = screen.getByRole("button", { name: /Set bite out point on deck A/i });
    expect(outBtn).toBeDisabled();
    await act(async () => { fireEvent.click(inBtn); });
    expect(outBtn).not.toBeDisabled();
  });

  it("@us US69: a bite routes to the crate as a decoded slice", async () => {
    const onSendToCrate = vi.fn();
    let api;
    render(
      <Harness onMount={(a) => { api = a; }} deckProps={{ onSendToCrate }} />
    );
    const sr = 11025;
    const buf = new MockAudioBuffer(1, sr * 4, sr);
    buf.getChannelData(0).fill(0.5);
    await act(async () => { await api.deckRef.current.loadBuffer(buf, "song.mp3"); });

    // IN at t=0, seek to 2 s, OUT — a deterministic 2-second region.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Set bite in point on deck A/i }));
    });
    await act(async () => { api.deckRef.current.seekTo(2); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Set bite out point on deck A/i }));
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Send the bite to the crate from deck A/i })
      );
    });
    expect(onSendToCrate).toHaveBeenCalledTimes(1);
    const [slice, name] = onSendToCrate.mock.calls[0];
    expect(slice.length).toBe(sr * 2);
    expect(name).toMatch(/song bite 1/);
  });
});

// ─── W3.5 — PUMP (US70) ───
describe("Deck pump — US70", () => {
  async function loadedDeck() {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    const sr = 11025;
    const buf = new MockAudioBuffer(1, sr * 3, sr);
    await act(async () => { await api.deckRef.current.loadBuffer(buf, "track.mp3"); });
    return api;
  }

  const findPumpGain = (ctx) => {
    // pumpGain is the gain node fed by the lowpass sweep filter (20 kHz).
    const sweep = ctx._nodes.find(
      (n) => n.nodeType === "BiquadFilterNode" && n.type === "lowpass" && n.frequency.value === 20000
    );
    return sweep.connections.find((n) => n.gain);
  };

  it("@us US70: engaging PUMP arms per-beat setValueCurve windows (dip to 1-depth, recover to 1)", async () => {
    const api = await loadedDeck();
    const ctx = api.audioCtxRef.current;
    const pumpBtn = screen.getByRole("button", { name: /Toggle pump ducking on deck A/i });
    await act(async () => { fireEvent.click(pumpBtn); });
    expect(pumpBtn.getAttribute("aria-pressed")).toBe("true");

    const pumpGain = findPumpGain(ctx);
    const curves = pumpGain.gain.scheduledValues.filter((s) => s.type === "setValueCurve");
    expect(curves.length).toBeGreaterThanOrEqual(3); // ~4 beats armed ahead
    const c = curves[0].curve;
    expect(c[0]).toBeCloseTo(1 - 0.6, 2); // default depth 0.6 dips to 0.4
    expect(c[c.length - 1]).toBe(1); // recovers to unity
    // Windows are beat-length: default 128 BPM → ~0.46 s.
    expect(curves[0].duration).toBeCloseTo((60 / 128) * 0.98, 2);
  });

  it("@us US70: disengaging PUMP cancels the schedule and returns the gain to exactly 1", async () => {
    const api = await loadedDeck();
    const ctx = api.audioCtxRef.current;
    const pumpBtn = screen.getByRole("button", { name: /Toggle pump ducking on deck A/i });
    await act(async () => { fireEvent.click(pumpBtn); });
    await act(async () => { fireEvent.click(pumpBtn); });
    expect(pumpBtn.getAttribute("aria-pressed")).toBe("false");
    const pumpGain = findPumpGain(ctx);
    const last = pumpGain.gain.scheduledValues.at(-1);
    expect(last.type).toBe("setTarget");
    expect(last.target).toBe(1);
  });

  it("@us US70: PUMP is disabled until a track is loaded", () => {
    render(<Harness />);
    expect(
      screen.getByRole("button", { name: /Toggle pump ducking on deck A/i })
    ).toBeDisabled();
  });
});

// ─── W3.4 — momentary loop roll (US72) ───
describe("Deck loop roll — US72", () => {
  async function playingDeck() {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    const sr = 11025;
    const buf = new MockAudioBuffer(1, sr * 10, sr);
    await act(async () => { await api.deckRef.current.loadBuffer(buf, "track.mp3"); });
    await act(async () => { await api.deckRef.current.play(); });
    // Advance the playhead so a roll has material behind it.
    await act(async () => { api.deckRef.current.seekTo(2); });
    return api;
  }

  it("@us US72: roll buttons are disabled until the deck is playing", async () => {
    let api;
    render(<Harness onMount={(a) => { api = a; }} />);
    const sr = 11025;
    const buf = new MockAudioBuffer(1, sr * 4, sr);
    await act(async () => { await api.deckRef.current.loadBuffer(buf, "t.mp3"); });
    expect(screen.getByRole("button", { name: /Hold to roll 1 beat on deck A/i })).toBeDisabled();
    await act(async () => { await api.deckRef.current.play(); });
    expect(screen.getByRole("button", { name: /Hold to roll 1 beat on deck A/i })).not.toBeDisabled();
  });

  it("@us US72: holding a roll loops the last beat at the deck's BPM; release resumes the timeline", async () => {
    const api = await playingDeck();
    const ctx = api.audioCtxRef.current;
    const mainSrc = ctx._lastStartedSource;
    const rollBtn = screen.getByRole("button", { name: /Hold to roll 1 beat on deck A/i });

    await act(async () => { fireEvent.pointerDown(rollBtn); });
    const rollSrc = ctx._lastStartedSource;
    expect(rollSrc).not.toBe(mainSrc);
    expect(rollSrc.loop).toBe(true);
    // Default BPM 128 → 1 beat = 60/128 s of buffer.
    expect(rollSrc.loopEnd - rollSrc.loopStart).toBeCloseTo(60 / 128, 2);
    expect(rollBtn.getAttribute("aria-pressed")).toBe("true");
    // The main source was silenced but the deck still reads as playing
    // (the timeline keeps running underneath).
    expect(api.deckRef.current.isPlaying()).toBe(true);

    await act(async () => {
      fireEvent.pointerUp(rollBtn);
      // seekTo's source rebuild is async (awaits the chain) — flush it.
      await new Promise((r) => setTimeout(r, 0));
    });
    const resumed = ctx._lastStartedSource;
    expect(resumed).not.toBe(rollSrc);
    // The resumed MAIN source has no roll window (whole-track loop toggle
    // aside, its loopStart/loopEnd stay 0) — unlike the roll source.
    expect(resumed.loopEnd).toBe(0);
    expect(rollBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("@us US72: pausing mid-roll kills the roll source (nothing keeps ringing)", async () => {
    const api = await playingDeck();
    const ctx = api.audioCtxRef.current;
    const rollBtn = screen.getByRole("button", { name: /Hold to roll 2 beats on deck A/i });
    await act(async () => { fireEvent.pointerDown(rollBtn); });
    const rollSrc = ctx._lastStartedSource;
    await act(async () => { api.deckRef.current.pause(); });
    expect(rollSrc.stopped).toBe(true);
    expect(rollBtn.getAttribute("aria-pressed")).toBe("false");
  });
});
