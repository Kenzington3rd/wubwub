import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import VoxRecorder, { micCapability } from "../src/components/VoxRecorder.jsx";
import { MockAudioContext } from "./mocks/webAudioMock.js";

// W3.2 — voice / mic recording. Mic capture is a local device API; these
// tests pin the capability gating (secure context, permission denial) and
// the take pipeline (record → decode → send to deck/crate/pad).

function makeStream() {
  return {
    getTracks: () => [{ stop: vi.fn() }],
  };
}

function Harness({ overrides = {} }) {
  const ctx = Harness.ctx;
  return (
    <VoxRecorder
      audioCtxRef={{ current: ctx }}
      masterCompressorRef={{ current: Harness.comp }}
      ensureMasterCtx={async () => ctx}
      onSendToDeck={Harness.onSendToDeck}
      onSendToCrate={Harness.onSendToCrate}
      onSendToPad={Harness.onSendToPad}
      {...overrides}
    />
  );
}

describe("VoxRecorder — W3.2 / US67", () => {
  let getUserMedia;

  beforeEach(() => {
    Harness.ctx = new MockAudioContext();
    Harness.comp = Harness.ctx.createDynamicsCompressor();
    Harness.onSendToDeck = vi.fn();
    Harness.onSendToCrate = vi.fn();
    Harness.onSendToPad = vi.fn();
    getUserMedia = vi.fn(async () => makeStream());
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
  });

  afterEach(() => {
    delete navigator.mediaDevices;
  });

  it("@us US67: micCapability reports 'insecure' outside a secure context", () => {
    Object.defineProperty(window, "isSecureContext", {
      value: false,
      configurable: true,
    });
    expect(micCapability()).toEqual({ ok: false, reason: "insecure" });
  });

  it("@us US67: micCapability reports 'unsupported' with no mediaDevices", () => {
    delete navigator.mediaDevices;
    expect(micCapability()).toEqual({ ok: false, reason: "unsupported" });
  });

  it("@us US67: on file:// (insecure) the panel shows the capability notice, no ARM control", () => {
    Object.defineProperty(window, "isSecureContext", {
      value: false,
      configurable: true,
    });
    render(<Harness />);
    expect(screen.getByText(/needs a secure context/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Arm the microphone/i })).toBeNull();
  });

  it("@us US67: mic permission denial surfaces an inline alert, not a throw", async () => {
    getUserMedia.mockRejectedValueOnce(
      Object.assign(new Error("nope"), { name: "NotAllowedError" })
    );
    render(<Harness />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Arm the microphone/i }));
    });
    expect(screen.getByRole("alert").textContent).toMatch(/permission was denied/i);
    // Still recoverable — the ARM button is still there.
    expect(screen.getByRole("button", { name: /Arm the microphone/i })).toBeInTheDocument();
  });

  it("@us US67: arm requests music-tuned constraints (no echo cancellation / NS / AGC)", async () => {
    render(<Harness />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Arm the microphone/i }));
    });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    expect(screen.getByRole("button", { name: /Start recording your voice/i })).toBeInTheDocument();
  });

  async function armRecordStop() {
    render(<Harness />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Arm the microphone/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Start recording your voice/i }));
    });
    // Stop — the MediaRecorder mock flushes ondataavailable/onstop on a
    // 0 ms timeout; the take then decodes through the mock context.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Stop the voice recording/i }));
      await new Promise((r) => setTimeout(r, 5));
    });
    return screen.findByText(/vox take 1/i);
  }

  it("@us US67: record → stop produces a take with preview and routing controls", async () => {
    await armRecordStop();
    expect(screen.getByRole("button", { name: /Preview the take/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send the take to deck C/i })).toBeInTheDocument();
  });

  it("@us US67: a take routes to a deck as a decoded AudioBuffer", async () => {
    await armRecordStop();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Send the take to deck B/i }));
    });
    expect(Harness.onSendToDeck).toHaveBeenCalledTimes(1);
    const [deckId, buffer, name] = Harness.onSendToDeck.mock.calls[0];
    expect(deckId).toBe("B");
    expect(buffer.duration).toBeGreaterThan(0);
    expect(name).toBe("vox take 1");
  });

  it("@us US67: a take routes to the crate and to a chosen sample pad", async () => {
    await armRecordStop();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Send the take to the crate/i }));
    });
    expect(Harness.onSendToCrate).toHaveBeenCalledTimes(1);

    // Pick pad 4 (index 3), then send.
    fireEvent.change(screen.getByRole("combobox", { name: /Sample pad to send/i }), {
      target: { value: "3" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Send the take to sample pad 4/i }));
    });
    expect(Harness.onSendToPad).toHaveBeenCalledWith(3, expect.anything(), "vox take 1");
  });

  it("@us US67: DISCARD drops the take; DISARM releases the stream tracks", async () => {
    await armRecordStop();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Discard the take/i }));
    });
    expect(screen.queryByText(/vox take 1/i)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Release the microphone/i }));
    });
    expect(screen.getByRole("button", { name: /Arm the microphone/i })).toBeInTheDocument();
  });

  it("@us US67: MONITOR wires mic → gain → master compressor and toggles back off", async () => {
    render(<Harness />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Arm the microphone/i }));
    });
    const monitor = screen.getByRole("button", { name: /Monitor the microphone/i });
    await act(async () => { fireEvent.click(monitor); });
    expect(monitor.getAttribute("aria-pressed")).toBe("true");
    const source = Harness.ctx._nodes.find(
      (n) => n.nodeType === "MediaStreamAudioSourceNode"
    );
    expect(source).toBeTruthy();
    // source → gain → compressor
    const gain = source.connections[0];
    expect(gain.connections).toContain(Harness.comp);
    await act(async () => { fireEvent.click(monitor); });
    expect(monitor.getAttribute("aria-pressed")).toBe("false");
  });
});
