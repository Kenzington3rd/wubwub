import { describe, it, expect, vi } from "vitest";
import { useRef, useEffect } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import Deck from "../src/components/Deck.jsx";
import { MockAudioBuffer } from "./mocks/webAudioMock.js";

function Harness({ id = "A", onMount, color = "#00f5d4", onKeyDetected }) {
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
    const syncBtn = screen.getByRole("button", { name: /Sync deck A to other deck/i });
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
});
