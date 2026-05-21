import { useCallback, useEffect, useRef } from "react";

// Live waveform + frequency-bar canvas with click-to-seek, keyboard seek, and
// cue markers. Reads the analyser via `chainRef` so the RAF loop doesn't restart
// when the parent re-renders (chainRef identity is stable; .current changes are
// picked up dynamically inside the loop).
//
// Mutating values (currentTime, duration, cues) also come in via refs.
//
// Keyboard seek (DESIGN_GUIDE §6 — the whole app is operable without a mouse):
// when a track is loaded the canvas is a `role="slider"` seek control. ←/→ step
// the playhead ±5 s, Home jumps to 0, End to the track end. The seek target is
// handed to `onSeek` as a normalized 0–1 value — the exact contract the
// pointer handler uses — so Deck's `handleSeek` is reused unchanged.
//
// ↑/↓ are intentionally NOT seek keys here — they are reserved for the global
// shortcut "focused deck volume ±5%" (CLAUDE.md). The canvas lets them bubble
// untouched (no `preventDefault`, no `stopPropagation`) so the App-level
// keydown handler can act on them while the canvas has focus.

// Arrow-key seek step, in seconds. Small enough for fine positioning, large
// enough that a few presses cover a phrase.
const SEEK_STEP_SECONDS = 5;

export default function WaveformCanvas({
  chainRef,
  color,
  isLooping,
  currentTimeRef,
  durationRef,
  cuesRef,
  onSeek,
  ariaLabel,
}) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  // A7 — current CSS-pixel dimensions of the canvas, kept in a ref so the
  // draw loop reads the latest size without restarting on every resize. The
  // backing store is sized to CSS × devicePixelRatio for crisp rendering on
  // retina/high-DPI displays; ctx2d is scaled by DPR so draw math stays in
  // CSS pixels.
  const cssSizeRef = useRef({ w: 400, h: 120 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    // Canvas 2D can be unavailable (GPU blocked, headless test env, very old
    // browser). Skip the entire draw loop in that case rather than crashing.
    if (!ctx2d) return;

    // Pre-allocate the FFT scratch buffers once. The AnalyserNode's
    // frequencyBinCount is fixed (fftSize/2 = 1024 here), so this never grows.
    // Avoids ~245 KB/sec of GC pressure on mobile.
    let timeData = null;
    let freqData = null;

    // A7 — resize the backing store to CSS × DPR and scale the 2D context so
    // every subsequent draw uses CSS pixels. Only fires when the measured CSS
    // size actually changes (set is idempotent on the canvas otherwise).
    const resize = (cssW, cssH) => {
      if (cssW <= 0 || cssH <= 0) return;
      const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
      const targetW = Math.round(cssW * dpr);
      const targetH = Math.round(cssH * dpr);
      if (canvas.width !== targetW) canvas.width = targetW;
      if (canvas.height !== targetH) canvas.height = targetH;
      // setTransform replaces — never compounds — so this stays stable across
      // repeated resize calls (no DPR^N blow-up).
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      cssSizeRef.current = { w: cssW, h: cssH };
    };

    // Initial size: read the canvas's laid-out CSS size if available,
    // otherwise fall back to the markup width/height (used by happy-dom which
    // doesn't compute layout).
    const initialW =
      canvas.clientWidth || canvas.getBoundingClientRect()?.width || 400;
    const initialH =
      canvas.clientHeight || canvas.getBoundingClientRect()?.height || 120;
    resize(initialW, initialH);

    // Track size changes (mobile breakpoint flip, deck-card resize). Don't
    // reallocate every frame — only when ResizeObserver fires a real change.
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          // contentRect on older browsers; contentBoxSize on newer ones.
          const r = e.contentRect;
          if (r) resize(r.width, r.height);
        }
      });
      ro.observe(canvas);
    }

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      const analyser = chainRef?.current?.analyser ?? null;
      const duration = durationRef?.current ?? 0;
      const currentTime = currentTimeRef?.current ?? 0;
      const cues = cuesRef?.current ?? [];
      // A7 — draw math uses CSS pixels (ctx2d is pre-scaled by DPR).
      const W = cssSizeRef.current.w;
      const H = cssSizeRef.current.h;

      if (!analyser) {
        ctx2d.clearRect(0, 0, W, H);
        ctx2d.fillStyle = "rgba(7,10,20,0.85)";
        ctx2d.fillRect(0, 0, W, H);
        ctx2d.strokeStyle = color + "44";
        ctx2d.lineWidth = 1;
        ctx2d.beginPath();
        ctx2d.moveTo(0, H / 2);
        ctx2d.lineTo(W, H / 2);
        ctx2d.stroke();
        return;
      }

      const bufLen = analyser.frequencyBinCount;
      if (!timeData || timeData.length !== bufLen) {
        timeData = new Uint8Array(bufLen);
        freqData = new Uint8Array(bufLen);
      }
      analyser.getByteTimeDomainData(timeData);

      ctx2d.fillStyle = "rgba(7,10,20,0.25)";
      ctx2d.fillRect(0, 0, W, H);

      ctx2d.shadowColor = color;
      ctx2d.shadowBlur = 12;
      ctx2d.lineWidth = 2;
      ctx2d.strokeStyle = color;
      ctx2d.beginPath();
      const sliceW = W / bufLen;
      let x = 0;
      for (let i = 0; i < bufLen; i++) {
        const v = timeData[i] / 128.0;
        const y = (v * H) / 2;
        if (i === 0) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
        x += sliceW;
      }
      ctx2d.lineTo(W, H / 2);
      ctx2d.stroke();
      ctx2d.shadowBlur = 0;

      analyser.getByteFrequencyData(freqData);
      const barCount = 48;
      const barW = W / barCount - 1;
      for (let i = 0; i < barCount; i++) {
        const idx = Math.floor((i / barCount) * bufLen);
        const val = freqData[idx] / 255;
        const barH = val * H * 0.4;
        const grad = ctx2d.createLinearGradient(0, H, 0, H - barH);
        grad.addColorStop(0, color + "cc");
        grad.addColorStop(1, color + "11");
        ctx2d.fillStyle = grad;
        ctx2d.fillRect(i * (barW + 1), H - barH, barW, barH);
      }

      // Cue markers
      if (duration > 0 && cues.length > 0) {
        for (let i = 0; i < cues.length; i++) {
          const cue = cues[i];
          const cx = (cue.time / duration) * W;
          ctx2d.strokeStyle = cue.color || "#f0c040";
          ctx2d.lineWidth = 2;
          ctx2d.beginPath();
          ctx2d.moveTo(cx, 0);
          ctx2d.lineTo(cx, H);
          ctx2d.stroke();
          ctx2d.fillStyle = cue.color || "#f0c040";
          ctx2d.fillRect(cx - 8, 0, 16, 14);
          ctx2d.fillStyle = "#070a14";
          ctx2d.font = "bold 9px 'Exo 2', sans-serif";
          ctx2d.textAlign = "center";
          ctx2d.textBaseline = "middle";
          ctx2d.fillText(String(i + 1), cx, 7);
        }
      }

      // Playhead — dashed so it doesn't get confused with cue lines
      if (duration > 0) {
        const px = (currentTime / duration) * W;
        ctx2d.strokeStyle = color + "cc";
        ctx2d.lineWidth = 1.5;
        ctx2d.setLineDash([3, 3]);
        ctx2d.beginPath();
        ctx2d.moveTo(px, 0);
        ctx2d.lineTo(px, H);
        ctx2d.stroke();
        ctx2d.setLineDash([]);
      }
    };
    draw();
    return () => {
      cancelAnimationFrame(animRef.current);
      if (ro) ro.disconnect();
    };
  }, [chainRef, color, currentTimeRef, durationRef, cuesRef]);

  const handlePointer = useCallback(
    (e) => {
      if (!onSeek) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const norm = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onSeek(norm);
    },
    [onSeek]
  );

  // Keyboard seek. Active only when `onSeek` is wired (i.e. a track is loaded);
  // the canvas is otherwise not a focusable control. ←/→ step ±5 s, Home/End
  // jump to the track ends. The seek target is normalized to 0–1 — the same
  // shape the pointer handler passes — so Deck's seek contract is reused.
  //
  // IMPORTANT: keys consumed here MUST `stopPropagation()` so the global
  // window keydown handler in App.jsx does not ALSO act on the same press
  // (its skip-list covers inputs/textareas/selects/contenteditable but not a
  // focused canvas — arrow keys would otherwise nudge the crossfader/volume).
  //
  // ↑/↓ are intentionally NOT handled here. They are reserved for the global
  // "focused deck volume ±5%" shortcut documented in CLAUDE.md, so we let
  // them bubble untouched (no preventDefault, no stopPropagation).
  const handleKeyDown = useCallback(
    (e) => {
      if (!onSeek) return;
      const duration = durationRef?.current ?? 0;
      if (duration <= 0) return;
      const currentTime = currentTimeRef?.current ?? 0;
      let targetSeconds = null;
      switch (e.key) {
        case "ArrowLeft":
          targetSeconds = currentTime - SEEK_STEP_SECONDS;
          break;
        case "ArrowRight":
          targetSeconds = currentTime + SEEK_STEP_SECONDS;
          break;
        case "Home":
          targetSeconds = 0;
          break;
        case "End":
          // A hair before the very end so a non-looping track doesn't
          // immediately fire `onended` and reset to 0.
          targetSeconds = Math.max(0, duration - 0.01);
          break;
        default:
          return; // not a seek key — let it bubble normally
      }
      // Consume the event so the global App keydown handler doesn't also
      // act on it (arrow keys move the crossfader / deck volume there).
      e.preventDefault();
      e.stopPropagation();
      const clamped = Math.max(0, Math.min(duration, targetSeconds));
      onSeek(clamped / duration);
    },
    [onSeek, durationRef, currentTimeRef]
  );

  // ARIA slider value model: whole-second position within the track. When no
  // track is loaded the canvas is a plain, non-focusable element.
  const seekable = !!onSeek;
  const duration = durationRef?.current ?? 0;
  const currentTime = currentTimeRef?.current ?? 0;
  const maxSeconds = Math.max(0, Math.round(duration));
  const nowSeconds = Math.max(0, Math.min(maxSeconds, Math.round(currentTime)));
  const fmt = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={120}
      onPointerDown={handlePointer}
      onKeyDown={seekable ? handleKeyDown : undefined}
      role={seekable ? "slider" : undefined}
      tabIndex={seekable ? 0 : undefined}
      aria-label={seekable ? ariaLabel || "Track seek position" : undefined}
      aria-valuemin={seekable ? 0 : undefined}
      aria-valuemax={seekable ? maxSeconds : undefined}
      aria-valuenow={seekable ? nowSeconds : undefined}
      aria-valuetext={seekable ? `${fmt(nowSeconds)} / ${fmt(maxSeconds)}` : undefined}
      style={{
        width: "100%",
        height: 120,
        borderRadius: 8,
        border: isLooping
          ? `1px dashed ${color}aa`
          : `1px solid ${color}33`,
        cursor: onSeek ? "crosshair" : "default",
        touchAction: "none",
      }}
    />
  );
}
