import { useCallback, useEffect, useRef } from "react";

// Live waveform + frequency-bar canvas with optional click-to-seek and cue markers.
// Mutating values (currentTime, duration, cues) come in via refs so the RAF loop
// doesn't restart on every parent render.
export default function WaveformCanvas({
  analyserRef,
  color,
  isPlaying,
  currentTimeRef,
  durationRef,
  cuesRef,
  onSeek,
}) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      const analyser = analyserRef.current;
      const duration = durationRef?.current ?? 0;
      const currentTime = currentTimeRef?.current ?? 0;
      const cues = cuesRef?.current ?? [];

      if (!analyser) {
        ctx2d.clearRect(0, 0, W, H);
        ctx2d.fillStyle = "rgba(10,14,26,0.85)";
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
      const data = new Uint8Array(bufLen);
      analyser.getByteTimeDomainData(data);

      ctx2d.fillStyle = "rgba(10,14,26,0.25)";
      ctx2d.fillRect(0, 0, W, H);

      ctx2d.shadowColor = color;
      ctx2d.shadowBlur = 12;
      ctx2d.lineWidth = 2;
      ctx2d.strokeStyle = color;
      ctx2d.beginPath();
      const sliceW = W / bufLen;
      let x = 0;
      for (let i = 0; i < bufLen; i++) {
        const v = data[i] / 128.0;
        const y = (v * H) / 2;
        if (i === 0) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
        x += sliceW;
      }
      ctx2d.lineTo(W, H / 2);
      ctx2d.stroke();
      ctx2d.shadowBlur = 0;

      const freqData = new Uint8Array(bufLen);
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
          // Index badge at the top
          ctx2d.fillStyle = cue.color || "#f0c040";
          ctx2d.fillRect(cx - 8, 0, 16, 14);
          ctx2d.fillStyle = "#0a0e1a";
          ctx2d.font = "bold 9px 'Exo 2', sans-serif";
          ctx2d.textAlign = "center";
          ctx2d.textBaseline = "middle";
          ctx2d.fillText(String(i + 1), cx, 7);
        }
      }

      // Playhead line — dashed so it doesn't get confused with cue lines
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
    return () => cancelAnimationFrame(animRef.current);
  }, [analyserRef, color, isPlaying, currentTimeRef, durationRef, cuesRef]);

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

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={120}
      onPointerDown={handlePointer}
      style={{
        width: "100%",
        height: 120,
        borderRadius: 8,
        border: `1px solid ${color}33`,
        cursor: onSeek ? "crosshair" : "default",
        touchAction: "none",
      }}
    />
  );
}
