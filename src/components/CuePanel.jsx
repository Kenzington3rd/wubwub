import Icon from "./Icon.jsx";

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function CuePanel({ cues, color, disabled, maxReached, onSet, onJump, onDelete }) {
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
        type="button"
        onClick={onSet}
        disabled={disabled}
        title={maxReached ? "Max 8 cues — delete one first" : "Set cue at current position"}
        aria-label={maxReached ? "Cue limit reached" : "Add cue at current position"}
        style={{
          background: disabled ? "rgba(255,255,255,0.04)" : `${color}22`,
          border: `1px solid ${color}55`,
          // Disabled label uses text-muted + opacity, never text-dim #4a5580
          // on the deep bg (fails WCAG 1.4.11). Matches Deck's disabled-button
          // pattern.
          color: disabled ? "#8892b0" : color,
          borderRadius: 8,
          padding: "4px 10px",
          fontSize: 10,
          letterSpacing: 1,
          textTransform: "uppercase",
          fontFamily: "'Exo 2', sans-serif",
          fontWeight: 700,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {maxReached ? "8 / 8" : "+ CUE"}
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
            type="button"
            onClick={() => onJump(i)}
            aria-label={`Jump to cue ${i + 1}`}
            style={{
              background: "transparent",
              border: "none",
              // 38×38 minimum hit area — matches the sibling delete button on
              // the same chip and clears the WCAG 2.5.8 target-size minimum.
              // Padding pulls the text out from the edges; justifyContent
              // keeps the label centered.
              minWidth: 38,
              minHeight: 38,
              padding: "0 4px",
              color: "inherit",
              fontFamily: "inherit",
              fontSize: "inherit",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
            }}
          >
            <strong>{i + 1}</strong>
            <span style={{ opacity: 0.7 }}>{formatTime(cue.time)}</span>
          </button>
          <button
            type="button"
            onClick={() => onDelete(cue.id)}
            aria-label={`Delete cue ${i + 1}`}
            style={{
              background: "transparent",
              border: "none",
              opacity: 0.6,
              cursor: "pointer",
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 38,
              minHeight: 38,
            }}
          >
            <Icon name="close" size={11} color="currentColor" />
          </button>
        </span>
      ))}
    </div>
  );
}
