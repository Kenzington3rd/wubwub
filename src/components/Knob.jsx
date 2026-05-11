import { useRef } from "react";

export default function Knob({
  value,
  onChange,
  min = -12,
  max = 12,
  label,
  color = "#00f5d4",
  size = 52,
  format,
}) {
  const knobRef = useRef(null);
  const dragRef = useRef({ active: false, startY: 0, startVal: 0 });

  const range = max - min;
  const norm = (value - min) / range;
  const angle = -135 + norm * 270;

  const handlePointerDown = (e) => {
    e.preventDefault();
    dragRef.current = { active: true, startY: e.clientY, startVal: value };
    const onMove = (ev) => {
      if (!dragRef.current.active) return;
      const delta = (dragRef.current.startY - ev.clientY) * (range / 120);
      const newVal = Math.max(min, Math.min(max, dragRef.current.startVal + delta));
      onChange(Math.round(newVal * 100) / 100);
    };
    const onUp = () => {
      dragRef.current.active = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const display =
    typeof format === "function"
      ? format(value)
      : value > 0
      ? `+${value}`
      : `${value}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <div
        ref={knobRef}
        onPointerDown={handlePointerDown}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: "radial-gradient(circle at 40% 35%, #2a2f45, #12152a)",
          border: `2px solid ${color}55`,
          cursor: "grab",
          position: "relative",
          boxShadow: `0 0 12px ${color}22, inset 0 1px 2px rgba(255,255,255,0.05)`,
          touchAction: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: 2,
            height: size * 0.35,
            background: color,
            borderRadius: 1,
            transformOrigin: "center top",
            transform: `translate(-50%, 0) rotate(${angle}deg)`,
            boxShadow: `0 0 6px ${color}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: color,
            transform: "translate(-50%,-50%)",
            boxShadow: `0 0 8px ${color}88`,
          }}
        />
      </div>
      {label && (
        <span
          style={{
            fontSize: 9,
            color: "#8892b0",
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          {label}
        </span>
      )}
      <span style={{ fontSize: 10, color, fontFamily: "'Exo 2', sans-serif" }}>
        {display}
      </span>
    </div>
  );
}
