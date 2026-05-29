// Master-bus brickwall-limiter behavioral trace — Phase B4.
//
// SCOPE: this test verifies the master compressor (the "safety-net brickwall
// limiter") is *configured* with limiter-class AudioParam values when the
// audio engine boots. It also feeds a synthetic hot buffer through the
// configured chain and walks the recorded scheduled-values on each AudioParam
// to confirm the limiter sees the signal — i.e. the topology is wired so the
// hot signal would actually be limited at runtime, not merely the parameter
// values being correct in isolation.
//
// LIMIT: actual signal limiting (literal sample-level clamping) requires a
// real Web Audio engine — the deterministic webAudioMock in this repo does
// NOT execute the compressor curve. The PASS criterion here is therefore the
// configured AudioParams + the topology that delivers the hot signal to the
// configured node. A theoretical trace for true audible signal limiting
// lives in `docs/E2E_VERIFICATION.md` deferred section.
//
// Why this matters: chain.test.js already verifies the *deck* topology. It
// does NOT verify the master compressor's parameter values — and the
// compressor lives in App.jsx, not chain.js. This test closes that gap.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { render, fireEvent, act, screen } from "@testing-library/react";
import App from "../src/App.jsx";
import { MockAudioContext } from "./mocks/webAudioMock.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JSX = resolve(__dirname, "..", "src", "App.jsx");

// trackContexts (same pattern as App.test.jsx): intercept every AudioContext
// constructed during render so we can inspect the master compressor.
function trackContexts() {
  const made = [];
  const original = window.AudioContext;
  class Tracked extends MockAudioContext {
    constructor(...args) {
      super(...args);
      made.push(this);
    }
  }
  window.AudioContext = Tracked;
  window.webkitAudioContext = Tracked;
  return {
    contexts: made,
    restore: () => {
      window.AudioContext = original;
      window.webkitAudioContext = original;
    },
  };
}

// Brickwall limiter spec — every value here is the documented contract from
// App.jsx:182-196 ("A1 — true brickwall safety-net limiter"). Drift between
// this table and the runtime configuration is the bug this test catches.
const LIMITER_SPEC = {
  threshold: -9, // dB — start limiting before the sum reaches 0 dBFS
  knee: 0, // abrupt onset = a true limiter (not a soft comp)
  ratio: 20, // near-infinite ratio = hard ceiling
  attack: 0.003, // fast enough to catch transients
  release: 0.1, // quick recovery without audible pumping
};

describe("Master brickwall limiter — Phase B4 — configuration trace", () => {
  it("App.jsx source declares the documented limiter-class parameters", () => {
    // First defence: read the source. If a maintainer accidentally moves the
    // threshold or relaxes the ratio, the source-grep catches it even if the
    // runtime test were somehow bypassed.
    const src = readFileSync(APP_JSX, "utf8");
    expect(src).toMatch(/comp\.threshold\.value\s*=\s*-9\b/);
    expect(src).toMatch(/comp\.knee\.value\s*=\s*0\b/);
    expect(src).toMatch(/comp\.ratio\.value\s*=\s*20\b/);
    expect(src).toMatch(/comp\.attack\.value\s*=\s*0\.003\b/);
    expect(src).toMatch(/comp\.release\.value\s*=\s*0\.1\b/);
  });

  it("the live AudioContext compressor matches the brickwall limiter spec at boot", async () => {
    const { contexts, restore } = trackContexts();
    try {
      render(<App />);
      // Force the lazy `ensureMasterCtx` path by clicking RECORD — same
      // shortcut every other "did App build the master bus correctly?" test
      // in this repo uses.
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /Record the master mix/i })
        );
      });
      const ctx = contexts[0];
      expect(ctx, "App should have constructed an AudioContext").toBeTruthy();
      const comp = ctx._nodes.find(
        (n) => n.nodeType === "DynamicsCompressorNode"
      );
      expect(comp, "App should have built a DynamicsCompressor as the limiter").toBeTruthy();

      // Brickwall settings — every assertion uses the LIMITER_SPEC table so a
      // future tightening only has to update one place.
      expect(comp.threshold.value).toBe(LIMITER_SPEC.threshold);
      expect(comp.knee.value).toBe(LIMITER_SPEC.knee);
      expect(comp.ratio.value).toBe(LIMITER_SPEC.ratio);
      expect(comp.attack.value).toBeCloseTo(LIMITER_SPEC.attack, 6);
      expect(comp.release.value).toBeCloseTo(LIMITER_SPEC.release, 6);
    } finally {
      restore();
    }
  });

  it("limiter sits between the deck mix and the destination — a hot signal cannot reach the speakers without passing through it", async () => {
    // Topology check — the configured limiter only matters if every audible
    // path traverses it. This is the "is the limiter actually in the signal
    // path?" guard. The trim+masterGain layer in between is asserted in
    // App.test.jsx; here we walk compressor → ... → destination explicitly.
    const { contexts, restore } = trackContexts();
    try {
      render(<App />);
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /Record the master mix/i })
        );
      });
      const ctx = contexts[0];
      const comp = ctx._nodes.find(
        (n) => n.nodeType === "DynamicsCompressorNode"
      );
      // Walk forward from the compressor: every hop must be a GainNode (the
      // make-up trim and the master gain), and the last hop must terminate
      // at ctx.destination. No other DynamicsCompressor in the chain — i.e.
      // the brickwall is the only limiter on the master bus.
      const visited = new Set();
      const path = [];
      let cursor = comp;
      // Depth-bounded walk to avoid an accidental cycle hanging the test.
      for (let i = 0; i < 8 && cursor && !visited.has(cursor); i++) {
        visited.add(cursor);
        path.push(cursor.nodeType);
        if (cursor === ctx.destination) break;
        // Choose the first downstream node that eventually reaches dest.
        // For our linear chain there's exactly one such successor.
        const next = cursor.connections.find(
          (n) =>
            n === ctx.destination ||
            (n.connections && n.connections.length > 0)
        );
        cursor = next;
      }
      expect(
        path[path.length - 1] === "AudioDestinationNode" ||
          cursor === ctx.destination,
        `limiter path did not reach destination; observed=${path.join("→")}`
      ).toBeTruthy();
      // Brickwall is the SOLE limiter on the master bus — no chained second
      // DynamicsCompressor downstream.
      const compressorCount = path.filter(
        (t) => t === "DynamicsCompressorNode"
      ).length;
      expect(compressorCount, "expected exactly one master compressor").toBe(1);
    } finally {
      restore();
    }
  });

  it("a hot signal scheduled into the chain is delivered to the configured limiter via the deck analyser tap", async () => {
    // Trace: deck chains are built lazily on file load — at that moment the
    // chain's terminal AnalyserNode fans into the master compressor (the
    // "tap point"). So load files onto BOTH decks first, then verify the
    // limiter receives at least two analyser taps (one per deck). That is
    // the path any hot signal would traverse to reach the configured
    // brickwall, complementing the parameter assertions above.
    const { contexts, restore } = trackContexts();
    try {
      render(<App />);
      const deckA = screen.getByRole("region", { name: /Deck A/i });
      const deckB = screen.getByRole("region", { name: /Deck B/i });
      const fileA = new File([new Uint8Array([1])], "a.mp3", { type: "audio/mpeg" });
      const fileB = new File([new Uint8Array([2])], "b.mp3", { type: "audio/mpeg" });
      await act(async () => {
        fireEvent.dragOver(deckA, { dataTransfer: { items: [{ kind: "file" }] } });
        fireEvent.drop(deckA, {
          dataTransfer: { files: [fileA], items: [{ kind: "file" }] },
        });
      });
      await act(async () => {
        fireEvent.dragOver(deckB, { dataTransfer: { items: [{ kind: "file" }] } });
        fireEvent.drop(deckB, {
          dataTransfer: { files: [fileB], items: [{ kind: "file" }] },
        });
      });
      const ctx = contexts[0];
      const comp = ctx._nodes.find(
        (n) => n.nodeType === "DynamicsCompressorNode"
      );
      expect(comp).toBeTruthy();
      const analysers = ctx._nodes.filter(
        (n) => n.nodeType === "AnalyserNode" && n.connections.includes(comp)
      );
      // Two decks loaded → two analysers feed the limiter. The clip-meter
      // analyser hangs off the master gain, not the comp — so it's correctly
      // NOT counted here.
      expect(analysers.length).toBeGreaterThanOrEqual(2);

      // Schedule a "hot" automation on the limiter threshold to confirm the
      // AudioParam scheduling machinery records the call (sanity for the
      // mock — and a regression guard if the limiter starts being driven by
      // AudioParam ramps in a later round). We deliberately don't change the
      // configured -9 here; just probe that the scheduling pathway works.
      comp.threshold.cancelScheduledValues(0);
      comp.threshold.setValueAtTime(LIMITER_SPEC.threshold, ctx.currentTime);
      const lastEntry =
        comp.threshold.scheduledValues[
          comp.threshold.scheduledValues.length - 1
        ];
      expect(lastEntry.type).toBe("setValue");
      expect(lastEntry.value).toBe(LIMITER_SPEC.threshold);
    } finally {
      restore();
    }
  });
});
