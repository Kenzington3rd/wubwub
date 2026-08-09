import { describe, it, expect } from "vitest";
import { encodeWav, sliceBuffer } from "../src/audio/wavEncode.js";
import { renderIsolated, ISOLATION_MODES } from "../src/audio/isolationRender.js";
import { MockAudioContext, MockAudioBuffer } from "./mocks/webAudioMock.js";

// W3.6 — sound-bite extraction primitives (US69).

function makeBuffer(ctx, seconds = 1, sr = 8000, fill = 0.5) {
  const buf = ctx.createBuffer(1, Math.floor(seconds * sr), sr);
  buf.getChannelData(0).fill(fill);
  return buf;
}

describe("encodeWav — US69", () => {
  it("@us US69: produces a valid RIFF/WAVE header with correct sizes", async () => {
    const ctx = new MockAudioContext();
    const buf = makeBuffer(ctx, 0.5, 8000);
    const blob = encodeWav(buf);
    expect(blob.type).toBe("audio/wav");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const ascii = (o, n) => String.fromCharCode(...bytes.slice(o, o + n));
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(36, 4)).toBe("data");
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(22, true)).toBe(1); // channels
    expect(view.getUint32(24, true)).toBe(8000); // sample rate
    expect(view.getUint32(40, true)).toBe(4000 * 2); // frames × 2 bytes
    expect(bytes.length).toBe(44 + 4000 * 2);
  });

  it("@us US69: clamps out-of-range samples instead of wrapping", async () => {
    const ctx = new MockAudioContext();
    const buf = ctx.createBuffer(1, 4, 8000);
    buf.getChannelData(0).set([2, -2, 1, -1]);
    const bytes = new DataView(await encodeWav(buf).arrayBuffer());
    expect(bytes.getInt16(44, true)).toBe(0x7fff);
    expect(bytes.getInt16(46, true)).toBe(-0x8000);
  });
});

describe("sliceBuffer — US69", () => {
  it("@us US69: extracts the exact sample range with equal-power edge fades", () => {
    const ctx = new MockAudioContext();
    const buf = makeBuffer(ctx, 2, 8000, 1);
    const slice = sliceBuffer(ctx, buf, 0.5, 1.5, 0.005);
    expect(slice.length).toBe(8000);
    const data = slice.getChannelData(0);
    // Edges faded toward 0; middle untouched.
    expect(Math.abs(data[0])).toBeLessThan(0.05);
    expect(data[4000]).toBe(1);
    expect(Math.abs(data[7999])).toBeLessThan(0.05);
  });

  it("@us US69: an empty or inverted range returns null", () => {
    const ctx = new MockAudioContext();
    const buf = makeBuffer(ctx, 1, 8000);
    expect(sliceBuffer(ctx, buf, 0.8, 0.2)).toBeNull();
  });

  it("@us US69: a WAV bite round-trips at identical length", async () => {
    const ctx = new MockAudioContext();
    const buf = makeBuffer(ctx, 1, 8000);
    const slice = sliceBuffer(ctx, buf, 0.25, 0.75);
    const blob = encodeWav(slice);
    // 44-byte header + frames × 2.
    expect(blob.size).toBe(44 + slice.length * 2);
  });
});

describe("renderIsolated — US69 × US68", () => {
  it("@us US69: unknown mode passes the buffer through untouched", async () => {
    const ctx = new MockAudioContext();
    const buf = makeBuffer(ctx, 0.5, 8000);
    expect(await renderIsolated(buf, "nope")).toBe(buf);
  });

  it("@us US69: each isolation mode renders offline to a same-shape buffer", async () => {
    const ctx = new MockAudioContext();
    for (const mode of ISOLATION_MODES) {
      const buf = makeBuffer(ctx, 0.5, 8000);
      const out = await renderIsolated(buf, mode);
      expect(out).not.toBe(buf);
      expect(out.length).toBe(buf.length);
      expect(out.sampleRate).toBe(buf.sampleRate);
    }
  });
});
