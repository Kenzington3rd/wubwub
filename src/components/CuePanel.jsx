function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function CuePanel({ cues, color, disabled, onSet, onJump, onDelete }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <button
        onClick={onSet}
        disabled={disabled}
        title="Set cue at current position"
        style={{
          background: disabled ? "rgba(255,255,255,0.04)" : `${color}22`,
          border: `1px solid ${color}55`,
          color: disabled ? "#4a5580" : color,
          borderRadius: 8,
          padding: "4px 10px",
          fontSize: 10,
          letterSpacing: 1,
          textTransform: "uppercase",
          fontFamily: "'Exo 2', sans-serif",
          fontWeight: 700,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        + CUE
      </button>
      {cues.map((cue, i) => (
        <span
          key={cue.id}
          style={{
            display: "inline-flex",
            alignItems: "center",
            background: `${cue.color || color}1c`,
            border: `1px solid ${cue.color || color}66`,
            borderRadius: 8,
            padding: "2px 4px 2px 8px",
            fontSize: 10,
            fontFamily: "'Exo 2', sans-serif",
            color: cue.color || color,
            gap: 6,
          }}
          title={`Cue ${i + 1} — ${formatTime(cue.time)}`}
        >
          <button
            onClick={() => onJump(i)}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              color: "inherit",
              fontFamily: "inherit",
              fontSize: "inherit",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <strong>{i + 1}</strong>
            <span style={{ opacity: 0.7 }}>{formatTime(cue.time)}</span>
          </button>
          <button
            onClick={() => onDelete(cue.id)}
            aria-label={`Delete cue ${i + 1}`}
            style={{
              background: "transparent",
              border: "none",
              color: "currentColor",
              opacity: 0.5,
              cursor: "pointer",
              fontSize: 11,
              padding: 0,
            }}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
