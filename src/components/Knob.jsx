import { useRef, useState } from "react";

export default function Knob({
  value,
  onChange,
  min = -12,
  max = 12,
  label,
  // Accessible name, when the visible `label` alone would be ambiguous. Three
  // decks each render a knob captioned "LOW"; without a scoped name they are
  // indistinguishable to a screen reader (and unaddressable by tests).
  ariaLabel,
  color = "#00f5d4",
  size = 52,
  format,
  disabled = false,
}) {
  const knobRef = useRef(null);
  const dragRef = useRef({ active: false, startY: 0, startVal: 0 });
  // D5 — hover state. Knob styling is inline (dynamic accent color), so the
  // hover lift can't live in CSS; it is tracked here and only applied when the
  // knob is enabled, giving the control a distinct default/hover/active state.
  const [hover, setHover] = useState(false);

  const range = max - min;
  const norm = (value - min) / range;
  const angle = -135 + norm * 270;

  // Keyboard step: 1 for integer-range knobs (e.g. drive 0–100), otherwise
  // a hundredth of the range, rounded to match the drag rounding precision.
  const rawStep = range / 100;
  const step =
    Number.isInteger(min) && Number.isInteger(max) && range >= 100
      ? 1
      : Math.round(rawStep * 100) / 100 || 0.01;

  // Mirror the drag rounding so keyboard and pointer produce identical values.
  const commit = (v) => onChange(Math.round(Math.max(min, Math.min(max, v)) * 100) / 100);

  const handlePointerDown = (e) => {
    if (disabled) return;
    e.preventDefault();
    dragRef.current = { active: true, startY: e.clientY, startVal: value };
    const onMove = (ev) => {
      if (!dragRef.current.active) return;
      const delta = (dragRef.current.startY - ev.clientY) * (range / 120);
      commit(dragRef.current.startVal + delta);
    };
    const onUp = () => {
      dragRef.current.active = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleKeyDown = (e) => {
    if (disabled) return;
    switch (e.key) {
      case "ArrowUp":
      case "ArrowRight":
        e.preventDefault();
        commit(value + step);
        break;
      case "ArrowDown":
      case "ArrowLeft":
        e.preventDefault();
        commit(value - step);
        break;
      case "Home":
        e.preventDefault();
        commit(min);
        break;
      case "End":
        e.preventDefault();
        commit(max);
        break;
      default:
        break;
    }
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
        role="slider"
        aria-orientation="vertical"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel || label}
        aria-valuenow={value}
        aria-valuetext={display}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-disabled={disabled || undefined}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        onPointerEnter={() => !disabled && setHover(true)}
        onPointerLeave={() => setHover(false)}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: "radial-gradient(circle at 40% 35%, #2a2f45, #12152a)",
          // D5 — hover lifts the border + glow so the knob has a clear hover
          // state, distinct from default; disabled never shows the lift.
          border: `2px solid ${color}${hover && !disabled ? "99" : "55"}`,
          cursor: disabled ? "not-allowed" : "grab",
          position: "relative",
          boxShadow:
            hover && !disabled
              ? `0 0 18px ${color}44, inset 0 1px 2px rgba(255,255,255,0.08)`
              : `0 0 12px ${color}22, inset 0 1px 2px rgba(255,255,255,0.05)`,
          touchAction: "none",
          opacity: disabled ? 0.4 : 1,
          transition: "border-color 0.15s ease, box-shadow 0.15s ease",
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
