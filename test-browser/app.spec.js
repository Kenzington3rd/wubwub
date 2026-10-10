// Real-browser end-to-end tests — the layer the Vitest suite structurally cannot reach.
//
// WHY THIS EXISTS
// The 558-test Vitest suite runs in happy-dom, which stubs Web Audio wholesale
// (test/mocks/webAudioMock.js). Every AudioContext, every decodeAudioData, every
// filter node in those tests is a fake. That is the right trade for fast unit
// tests, but it means an entire class of defect is invisible to them: anything
// that only fails against a real audio implementation, a real canvas, or a real
// `file://` origin.
//
// These tests run the ACTUAL single-file build in ACTUAL Chromium with the real
// Web Audio stack, and assert the things only that can prove.
import { test, expect } from "./fixture.js";
import { kickLoop, silence, notAudio } from "./fixtures.mjs";

// The deck's hidden file input is NOT the first one on the page — the settings
// importer comes earlier in DOM order. Scope to the deck or you end up feeding
// audio to the JSON importer (which correctly rejects it).
async function deckFileInput(page, deck) {
  const idx = await page.evaluate((d) => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      new RegExp(`Load audio for Deck ${d}`).test(b.getAttribute("aria-label") || ""),
    );
    if (!btn) return -1;
    let scope = btn.parentElement;
    while (scope && !scope.querySelector('input[type="file"]')) scope = scope.parentElement;
    return [...document.querySelectorAll('input[type="file"]')].indexOf(
      scope.querySelector('input[type="file"]'),
    );
  }, deck);
  expect(idx, `deck ${deck} file input not found`).toBeGreaterThanOrEqual(0);
  return page.locator('input[type="file"]').nth(idx);
}

async function loadFixture(page, deck, { bytes, name }) {
  const input = await deckFileInput(page, deck);
  await input.setInputFiles({ name, mimeType: "audio/wav", buffer: Buffer.from(bytes) });
}

test.describe("real browser — the app actually boots", () => {
  test("mounts from file:// with no console errors", async ({ page, appErrors }) => {
    await expect(page.getByRole("button", { name: /Load audio for Deck A/i })).toBeVisible();
    // Three decks, and a control surface of the expected magnitude.
    for (const d of ["A", "B", "C"]) {
      await expect(page.getByRole("button", { name: `Play deck ${d}` })).toBeVisible();
    }
    const controls = await page.locator('button,input,select,[role="slider"]').count();
    expect(controls).toBeGreaterThan(200);
    expect(appErrors, `console errors: ${JSON.stringify(appErrors)}`).toEqual([]);
  });

  test("the real Web Audio stack is present and usable", async ({ page }) => {
    // happy-dom can't answer this: it hands back mocks regardless.
    const probe = await page.evaluate(async () => {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return { ok: false };
      const ctx = new Ctor();
      const factories = [
        "createGain", "createBiquadFilter", "createConvolver", "createDelay",
        "createWaveShaper", "createDynamicsCompressor", "createAnalyser",
        "createBufferSource", "createMediaStreamDestination",
      ];
      const out = {
        ok: true,
        sampleRate: ctx.sampleRate,
        hasWorklet: typeof ctx.audioWorklet !== "undefined",
        missing: factories.filter((f) => typeof ctx[f] !== "function"),
      };
      await ctx.close();
      return out;
    });
    expect(probe.ok).toBe(true);
    // Every node type the signal chain in CLAUDE.md depends on.
    expect(probe.missing).toEqual([]);
    expect(probe.hasWorklet, "AudioWorklet is required by the looper and KEYLOCK").toBe(true);
    expect(probe.sampleRate).toBeGreaterThan(8000);
  });
});

test.describe("real browser — real audio decodes and plays", () => {
  test("a real WAV decodes to the exact expected duration", async ({ page }) => {
    const fx = kickLoop({ bpm: 128, bars: 8 });
    const decoded = await page.evaluate(async (bytes) => {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const buf = await ctx.decodeAudioData(new Uint8Array(bytes).buffer);
      const ch = buf.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
      const r = { duration: buf.duration, channels: buf.numberOfChannels, peak };
      await ctx.close();
      return r;
    }, [...fx.bytes]);

    // Bar-exact: 8 bars at 128 BPM is 15.000 s. A decoder or encoder bug shows
    // up here as drift, which is what breaks seamless looping in a deck.
    expect(decoded.duration).toBeCloseTo(fx.seconds, 2);
    expect(decoded.channels).toBe(2);
    expect(decoded.peak).toBeGreaterThan(0.1);
  });

  test("load → play paints the waveform (audio is really flowing)", async ({ page, appErrors }) => {
    await loadFixture(page, "A", { ...kickLoop({ bpm: 128 }), name: "kick-128.wav" });
    await expect(
      page.getByRole("button", { name: /click to replace \(Deck A\)/i }),
    ).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "Play deck A" }).click();
    await expect(page.locator('button[aria-label="Play deck A"][aria-pressed="true"]')).toBeVisible();

    // The waveform canvas is driven by a real AnalyserNode reading real output.
    // Lit pixels prove the graph is actually passing signal, not just that a
    // boolean flipped — the assertion a mocked analyser can never make.
    await page.waitForTimeout(1500);
    const lit = await page.evaluate(() => {
      const c = document.querySelector("canvas");
      if (!c) return -1;
      const px = c.getContext("2d").getImageData(0, 0, c.width, Math.min(c.height, 80)).data;
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 60) n++;
      return n;
    });
    expect(lit, "waveform canvas is blank — no signal reaching the analyser").toBeGreaterThan(500);
    expect(appErrors).toEqual([]);
  });
});

test.describe("real browser — BPM detection against known-tempo audio", () => {
  // The detector's accuracy can only be measured against audio whose tempo is
  // known by construction. These fixtures are generated at an exact BPM.
  for (const bpm of [124, 140, 150]) {
    test(`detects ${bpm} BPM on a clean four-on-the-floor fixture`, async ({ page }) => {
      await loadFixture(page, "A", { ...kickLoop({ bpm }), name: `kick-${bpm}.wav` });
      await expect(
        page.getByRole("button", { name: /click to replace \(Deck A\)/i }),
      ).toBeVisible({ timeout: 15000 });

      await page.getByRole("button", { name: "Auto-detect BPM and key for deck A" }).click();

      // The BPM readout lives inside the deck's own region. Scoping to
      // role=region/"Deck A" matters: several numbers elsewhere on the page
      // look like a tempo and a page-wide regex will happily grab one of them
      // (an earlier version of this test did exactly that and "found" 63 BPM
      // on a 126 BPM track, which is outside the detector's own 70-180 range
      // and so could never have been a real reading).
      const readout = page
        .getByRole("region", { name: /^Deck A/ })
        .locator("span", { hasText: /^\d+ BPM$/ })
        .first();

      await expect
        .poll(async () => parseInt((await readout.innerText()).match(/(\d+)/)[1], 10), {
          timeout: 60_000,
          message: `detector never settled on a reading for a ${bpm} BPM fixture`,
        })
        .not.toBe(128); // 128 is the deck default — prove detection actually ran

      const got = parseInt((await readout.innerText()).match(/(\d+)/)[1], 10);
      // A clean synthetic four-on-the-floor is the easy case. Allow an exact
      // hit or a documented octave error (bpmDetect.js calls these out and the
      // deck ships the div-2/x2 buttons as the mitigation) — but nothing else.
      const exact = Math.abs(got - bpm) <= 2;
      const octave = Math.abs(got * 2 - bpm) <= 3 || Math.abs(got / 2 - bpm) <= 3;
      expect(exact || octave, `detected ${got} for a ${bpm} BPM fixture`).toBe(true);
    });
  }
});

test.describe("real browser — v1.3.2 field fixes", () => {
  test("EJECT returns a loaded deck to empty and it reloads cleanly", async ({ page }) => {
    await loadFixture(page, "A", { ...kickLoop({ bpm: 128 }), name: "first.wav" });
    await expect(page.getByRole("button", { name: /click to replace \(Deck A\)/i })).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "Eject the track from deck A" }).click();
    await expect(page.getByRole("button", { name: /Load audio for Deck A/i })).toBeVisible();
    // Waveform seek only exists while a track is loaded.
    await expect(page.getByRole("slider", { name: /Seek position in deck A track/i })).toHaveCount(0);

    // The point of ejecting is switching tracks — prove the reload half too.
    await loadFixture(page, "A", { ...kickLoop({ bpm: 124 }), name: "second.wav" });
    await expect(page.getByRole("button", { name: /Loaded: second\.wav/i })).toBeVisible({ timeout: 15000 });
  });

  test("EJECT keeps keyboard focus in the deck instead of dropping it to <body>", async ({ page }) => {
    // The button disables itself as a result of its own click. Without an
    // explicit focus hand-off the browser drops focus to document.body and
    // the next Tab restarts from the top of the page.
    await loadFixture(page, "A", { ...kickLoop({ bpm: 128 }), name: "focus.wav" });
    await expect(page.getByRole("button", { name: /click to replace \(Deck A\)/i })).toBeVisible({ timeout: 15000 });

    const eject = page.getByRole("button", { name: "Eject the track from deck A" });
    await eject.focus();
    await page.keyboard.press("Enter");

    const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName);
    expect(focused, "focus fell off the deck after EJECT").toMatch(/Load audio for Deck A/i);
  });

  test("dragging over a non-zone shows the no-drop cursor, a real zone still accepts", async ({ page }) => {
    // Cancelling dragover alone makes the whole page a 'valid target' and
    // the OS shows a copy cursor over the master bus — inviting a drop that
    // is then silently swallowed. The guard must set dropEffect=none there,
    // while a real deck zone (which claims the event first) keeps its effect.
    const effects = await page.evaluate(() => {
      const fire = (target) => {
        const dt = { dropEffect: "copy", effectAllowed: "all", files: [], items: [{ kind: "file" }], types: ["Files"] };
        const ev = new Event("dragover", { bubbles: true, cancelable: true });
        Object.defineProperty(ev, "dataTransfer", { value: dt });
        target.dispatchEvent(ev);
        return { prevented: ev.defaultPrevented, effect: dt.dropEffect };
      };
      const nonZone = document.querySelector('input[aria-label="Master volume"]');
      const zone = document.querySelector('[role="region"][aria-label^="Deck A"]');
      return { nonZone: fire(nonZone), zone: fire(zone) };
    });
    expect(effects.nonZone.prevented, "non-zone dragover must still be cancelled (navigation guard)").toBe(true);
    expect(effects.nonZone.effect, "non-zone must show the no-drop cursor").toBe("none");
    expect(effects.zone.prevented).toBe(true);
    expect(effects.zone.effect, "the guard must not veto a real drop zone").not.toBe("none");
  });

  test("a stray drop cannot navigate the app away", async ({ page }) => {
    // The bug this guards: an unclaimed drop fell through to the browser
    // default, which is NAVIGATE TO THE FILE — replacing the app and destroying
    // the session. Only a real browser has that default to cancel.
    const before = page.url();
    const result = await page.evaluate(() => {
      const ev = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "dataTransfer", { value: { files: [], items: [] } });
      document.body.dispatchEvent(ev);
      const over = new Event("dragover", { bubbles: true, cancelable: true });
      document.body.dispatchEvent(over);
      return { drop: ev.defaultPrevented, dragover: over.defaultPrevented };
    });
    expect(result.drop).toBe(true);
    expect(result.dragover).toBe(true);
    await page.waitForTimeout(500);
    expect(page.url()).toBe(before);
    await expect(page.getByRole("slider", { name: /Master volume/i })).toBeVisible();
  });

  test("a non-audio file is rejected inline and the deck stays usable", async ({ page, appErrors }) => {
    const input = await deckFileInput(page, "A");
    await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from(notAudio()) });
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 10000 });
    // Still empty, still loadable, and a good file works afterwards.
    await expect(page.getByRole("button", { name: /Load audio for Deck A/i })).toBeVisible();
    await loadFixture(page, "A", { ...kickLoop({ bpm: 128 }), name: "good.wav" });
    await expect(page.getByRole("button", { name: /Loaded: good\.wav/i })).toBeVisible({ timeout: 15000 });
    // A rejected file must not throw — only surface an alert.
    expect(appErrors).toEqual([]);
  });

  test("silent-but-valid audio still loads (decodes fine, just has no beat)", async ({ page }) => {
    await loadFixture(page, "A", { ...silence({ seconds: 2 }), name: "silence.wav" });
    await expect(page.getByRole("button", { name: /Loaded: silence\.wav/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "Play deck A" })).toBeEnabled();
  });
});

test.describe("real browser — privacy promise", () => {
  test("the app makes no network requests at all", async ({ page, context }) => {
    // CLAUDE.md's hardest danger zone: "NEVER add fetch, XHR, WebSocket,
    // sendBeacon". test/csp.test.js asserts the policy from source; this
    // asserts the actual behaviour of the running app.
    const external = [];
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (!url.startsWith("file://") && !url.startsWith("data:") && !url.startsWith("blob:")) {
        external.push(url);
      }
      route.continue();
    });
    await loadFixture(page, "A", { ...kickLoop({ bpm: 128 }), name: "kick.wav" });
    await page.getByRole("button", { name: "Play deck A" }).click().catch(() => {});
    await page.waitForTimeout(2000);
    expect(external, `app reached the network: ${JSON.stringify(external)}`).toEqual([]);
  });
});
