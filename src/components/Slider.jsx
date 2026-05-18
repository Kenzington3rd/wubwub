export default function Slider({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  vertical = false,
  height = 120,
  color = "#00f5d4",
  label,
  ariaLabel,
  className,
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: vertical ? "column" : "row",
        alignItems: "center",
        gap: 4,
        width: vertical ? undefined : "100%",
      }}
    >
      {label && (
        <span
          style={{
            fontSize: 9,
            color: "#8892b0",
            textTransform: "uppercase",
            letterSpacing: 1,
            writingMode: vertical ? "vertical-rl" : "horizontal-tb",
          }}
        >
          {label}
        </span>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        className={className}
        aria-label={ariaLabel || label || undefined}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          ...(vertical
            ? {
                WebkitAppearance: "slider-vertical",
                width: 24,
                height,
                writingMode: "vertical-lr",
                direction: "rtl",
              }
            : { width: "100%", height: 6 }),
          accentColor: color,
          cursor: "pointer",
        }}
      />
    </div>
  );
}
