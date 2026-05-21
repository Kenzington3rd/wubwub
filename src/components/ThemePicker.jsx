import { COLOR_THEMES } from "../data.js";

export default function ThemePicker({ deckId, value, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span
        style={{
          fontSize: 9,
          color: "#8892b0",
          textTransform: "uppercase",
          letterSpacing: 1,
        }}
      >
        {deckId}
      </span>
      {COLOR_THEMES.map((c) => {
        const active = value === c.value;
        // The visible swatch stays 16×16 (kept tight so a six-swatch row
        // fits MasterBus chrome), but the <button> itself carries 4px
        // symmetric padding + a transparent border so the actual pointer
        // hit area is ≥ 24×24 — meeting WCAG 2.5.8 (Target Size — Minimum)
        // without changing how the swatches look.
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.value)}
            title={c.name}
            aria-label={`Deck ${deckId} color: ${c.name}`}
            aria-pressed={active}
            style={{
              // 4px padding around a 16px content box → 24×24 hit area.
              padding: 4,
              borderRadius: "50%",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: active ? `0 0 10px ${c.value}` : "none",
            }}
          >
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: c.value,
                border: active
                  ? `2px solid #ccd6f6`
                  : "1px solid rgba(255,255,255,0.1)",
                boxSizing: "border-box",
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
