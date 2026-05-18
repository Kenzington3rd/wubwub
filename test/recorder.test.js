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
