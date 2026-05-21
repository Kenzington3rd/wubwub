import { describe, it, expect } from "vitest";
import {
  createMasterRecorder,
  extensionForMime,
  downloadBlob,
  buildCueSheet,
} from "../src/audio/recorder.js";

describe("extensionForMime — US37, US54", () => {
  it("@us US54: webm → webm", () => {
    expect(extensionForMime("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionForMime("audio/webm")).toBe("webm");
  });

  it("@us US54: mp4 → m4a", () => {
    expect(extensionForMime("audio/mp4;codecs=mp4a.40.2")).toBe("m4a");
  });

  it("@us US54: ogg → ogg", () => {
    expect(extensionForMime("audio/ogg;codecs=opus")).toBe("ogg");
  });

  it("@us US54: unknown mime falls back to a sensible default", () => {
    expect(extensionForMime(undefined)).toBe("bin");
    expect(extensionForMime("application/octet-stream")).toBe("audio");
  });
});

describe("createMasterRecorder — US37", () => {
  it("@us US37: returns null when MediaRecorder is unavailable", () => {
    const ctx = new AudioContext();
    const source = ctx.createGain();
    const originalMR = globalThis.MediaRecorder;
    globalThis.MediaRecorder = undefined;
    try {
      const rec = createMasterRecorder(ctx, source);
      expect(rec).toBeNull();
    } finally {
      globalThis.MediaRecorder = originalMR;
    }
  });

  it("@us US37: connects the source to a MediaStreamDestination + picks a supported mime", () => {
    const ctx = new AudioContext();
    const source = ctx.createGain();
    const rec = createMasterRecorder(ctx, source);
    expect(rec).not.toBeNull();
    expect(rec.mime).toMatch(/^audio\//);
    expect(typeof rec.start).toBe("function");
    expect(typeof rec.stop).toBe("function");
  });

  it("@us US37: start() transitions the recorder to recording state", () => {
    const ctx = new AudioContext();
    const source = ctx.createGain();
    const rec = createMasterRecorder(ctx, source);
    rec.start();
    expect(rec.state()).toBe("recording");
  });

  it("@us US37: stop() resolves with a Blob and disposes cleanly", async () => {
    const ctx = new AudioContext();
    const source = ctx.createGain();
    const rec = createMasterRecorder(ctx, source);
    rec.start();
    const blob = await rec.stop();
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    rec.dispose();
  });

  it("@us US37: dispose() is idempotent", () => {
    const ctx = new AudioContext();
    const source = ctx.createGain();
    const rec = createMasterRecorder(ctx, source);
    expect(() => {
      rec.dispose();
      rec.dispose();
    }).not.toThrow();
  });

  it("@us US37: dispose() releases the audio tap exactly once even if called twice (Q1)", () => {
    // Q1 — if the component unmounts while the stop path is mid-await, BOTH
    // the unmount cleanup and the stop path call dispose() on the same
    // recorder. The MediaStreamDestination tap must be disconnected once and
    // only once: the second dispose() is a no-op latched inside the recorder.
    const ctx = new AudioContext();
    const source = ctx.createGain();
    let disconnectCalls = 0;
    const originalDisconnect = source.disconnect.bind(source);
    source.disconnect = (target) => {
      disconnectCalls++;
      return originalDisconnect(target);
    };
    const rec = createMasterRecorder(ctx, source);
    // The tap connection was made on createMasterRecorder.
    expect(source.connections.length).toBe(1);
    rec.dispose();
    rec.dispose(); // racing second call — must not disconnect again
    expect(disconnectCalls).toBe(1);
    expect(source.connections.length).toBe(0);
  });

  it("@us US37: dispose() after a completed stop still runs exactly once (Q1)", async () => {
    // Mirrors the App stop path: await rec.stop(), then dispose(). A racing
    // unmount-cleanup dispose() before/after must not double-release the tap.
    const ctx = new AudioContext();
    const source = ctx.createGain();
    let disconnectCalls = 0;
    const originalDisconnect = source.disconnect.bind(source);
    source.disconnect = (target) => {
      disconnectCalls++;
      return originalDisconnect(target);
    };
    const rec = createMasterRecorder(ctx, source);
    rec.start();
    await rec.stop();
    rec.dispose(); // stop-path dispose
    rec.dispose(); // unmount-cleanup dispose racing in
    expect(disconnectCalls).toBe(1);
  });
});

describe("buildCueSheet — US60 (W1.3)", () => {
  it("@us US60: formats markers as MM:SS — Marker N lines", () => {
    const markers = [
      { elapsedMs: 0 },
      { elapsedMs: 65_000 }, // 1:05
      { elapsedMs: 605_000 }, // 10:05
    ];
    const text = buildCueSheet(markers, "wavecraft-mix-x.webm");
    expect(text).toContain("00:00 — Marker 1");
    expect(text).toContain("01:05 — Marker 2");
    expect(text).toContain("10:05 — Marker 3");
  });

  it("@us US60: header names the mix file and the marker count", () => {
    const text = buildCueSheet([{ elapsedMs: 1000 }], "wavecraft-mix-abc.webm");
    expect(text).toContain("WAVECRAFT MIX CUE SHEET");
    expect(text).toContain("Mix: wavecraft-mix-abc.webm");
    expect(text).toContain("Markers: 1");
  });

  it("@us US60: marker numbering is 1-based and sequential", () => {
    const markers = Array.from({ length: 4 }, (_, i) => ({
      elapsedMs: i * 1000,
    }));
    const text = buildCueSheet(markers, "mix.webm");
    expect(text).toContain("Marker 1");
    expect(text).toContain("Marker 4");
    expect(text).not.toContain("Marker 0");
    expect(text).not.toContain("Marker 5");
  });

  it("@us US60: an empty marker list still produces a valid header", () => {
    const text = buildCueSheet([], "mix.webm");
    expect(text).toContain("WAVECRAFT MIX CUE SHEET");
    expect(text).toContain("Markers: 0");
  });

  it("@us US60: an empty marker list emits no MM:SS — Marker N lines", () => {
    // The header is fine, but a stray "Marker 0" line would confuse a parser.
    // The body after the header must contain no marker lines at all.
    const text = buildCueSheet([], "mix.webm");
    expect(text).not.toMatch(/\d{2}:\d{2} — Marker/);
  });

  it("@us US60: a single marker at t=0 renders as 00:00 — Marker 1", () => {
    const text = buildCueSheet([{ elapsedMs: 0 }], "mix.webm");
    expect(text).toContain("00:00 — Marker 1");
    // And it carries the trailing newline contract so the file ends cleanly.
    expect(text.endsWith("\n")).toBe(true);
  });

  it("@us US60: minute-crossover boundary — 59.999 s stays 00:59, 60.000 s becomes 01:00", () => {
    // The minute crossover is exclusive at 60_000 ms: 59_999 floors to 59 s
    // (still 00:59), but exactly 60_000 ms rolls to 01:00. A stale rounding
    // bug (round-vs-floor) would surface here as a "01:00 — Marker 1" for
    // the 59_999 case.
    const text = buildCueSheet(
      [{ elapsedMs: 0 }, { elapsedMs: 59_999 }, { elapsedMs: 60_000 }],
      "mix.webm"
    );
    expect(text).toContain("00:00 — Marker 1");
    expect(text).toContain("00:59 — Marker 2");
    expect(text).toContain("01:00 — Marker 3");
  });

  it("@us US60: fractional seconds floor toward 0 — 999 ms is still 00:00, 1000 ms is 00:01", () => {
    // Sub-second drift inside the same wall-clock second must not show up as
    // the next second. Math.floor(ms/1000) is the contract; a Math.round bug
    // would flip 500–999 ms into the next second.
    const text = buildCueSheet(
      [{ elapsedMs: 500 }, { elapsedMs: 999 }, { elapsedMs: 1000 }],
      "mix.webm"
    );
    expect(text).toContain("00:00 — Marker 1");
    expect(text).toContain("00:00 — Marker 2");
    expect(text).toContain("00:01 — Marker 3");
  });

  it("@us US60: hours don't break formatting — a marker past 60 minutes still renders MM:SS without truncation", () => {
    // The format is MM:SS with no hour field; very long mixes (over an hour)
    // simply roll past 60 in the minute slot. The minute field is NOT zero-
    // padded beyond two digits for the >60-min case, so a 3-hour marker
    // legitimately reads "180:00" — verify the formatter doesn't overflow,
    // truncate, or insert an unexpected hour separator.
    const threeHours = 3 * 60 * 60 * 1000; // 10_800_000 ms
    const text = buildCueSheet(
      [{ elapsedMs: threeHours }, { elapsedMs: threeHours + 7_000 }],
      "long-mix.webm"
    );
    expect(text).toContain("180:00 — Marker 1");
    expect(text).toContain("180:07 — Marker 2");
    // No hour separator slipped into the marker lines themselves — extract
    // just the lines that name a marker and check those (the header's
    // "Exported:" timestamp legitimately contains H:MM:SS wall-clock).
    const markerLines = text.split("\n").filter((l) => l.includes(" — Marker "));
    for (const l of markerLines) {
      expect(l).not.toMatch(/\d+:\d{2}:\d{2}/);
    }
  });

  it("@us US60: negative elapsedMs (clock skew defensive case) clamps to 00:00", () => {
    // The recorder shouldn't emit a negative marker, but the formatter is
    // the last line of defense — a Math.max(0, …) inside fmtCueTime keeps
    // a bad input from rendering as "-1:-1" or NaN.
    const text = buildCueSheet([{ elapsedMs: -1 }, { elapsedMs: -5_000 }], "mix.webm");
    expect(text).toContain("00:00 — Marker 1");
    expect(text).toContain("00:00 — Marker 2");
    expect(text).not.toMatch(/-\d/);
  });
});

describe("downloadBlob — US37", () => {
  it("@us US37: creates a transient anchor that triggers a download", () => {
    const blob = new Blob(["x"], { type: "audio/webm" });
    const clicked = { count: 0 };
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clicked.count++;
    };
    try {
      downloadBlob(blob, "test.webm");
      expect(clicked.count).toBe(1);
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
    }
  });
});
