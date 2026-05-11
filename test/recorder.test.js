import { describe, it, expect } from "vitest";
import {
  createMasterRecorder,
  extensionForMime,
  downloadBlob,
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
