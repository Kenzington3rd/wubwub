// WAVECRAFT icon set — hand-drawn inline SVG. No emoji, no icon font, no
// network request. Every glyph is authored on a 24×24 viewBox.
//
// Two render styles:
//   FILL   — solid shapes (play, pause, stop, bolt, record)
//   STROKE — outlined, 2px round-capped strokes (loop, close, plus, music,
//            bulb, keyboard, speaker)
//
// Usage: <Icon name="play" size={16} color="#00f5d4" />
// `title` renders an accessible <title> child; omit it for purely decorative
// icons that sit next to a text label.

const FILL_PATHS = {
  play: "M8 5.14v13.72a1 1 0 0 0 1.54.84l10.3-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z",
  pause: "M6 4.5h4v15H6zM14 4.5h4v15h-4z",
  stop: "M6.5 6.5h11v11h-11z",
  bolt: "M13.5 2 4 13.8a.7.7 0 0 0 .54 1.15H9.3l-1 6.45a.6.6 0 0 0 1.07.47L20 9.9a.7.7 0 0 0-.54-1.15h-4.9l1.3-6.04A.62.62 0 0 0 13.5 2z",
  record: "M12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z",
};

const STROKE_PATHS = {
  // single circular arrow — reads as "repeat / loop"
  loop: "M20.5 12a8.5 8.5 0 1 1-2.46-6 M20.5 3.5v4h-4",
  close: "M6 6l12 12 M18 6 6 18",
  plus: "M12 5v14 M5 12h14",
  // right-pointing chevron; rotate 90° via CSS for a "down" disclosure state
  chevron: "M9 5l7 7-7 7",
  // two note-heads joined by a beam
  music: "M9 17.5V6l11-2v9.5 M9 17.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M20 13.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  bulb: "M9.5 18.5h5 M10 21.5h4 M12 3a6 6 0 0 0-3.8 10.65c.6.5.8 1 .8 2.35h6c0-1.35.2-1.85.8-2.35A6 6 0 0 0 12 3z",
  keyboard:
    "M3.5 7h17a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z M7 11h0 M11 11h0 M15 11h0 M8 14h8",
  speaker: "M11 5 6.5 9H3v6h3.5L11 19z M15 9.2a4 4 0 0 1 0 5.6 M17.8 6.4a8 8 0 0 1 0 11.2",
};

export default function Icon({ name, size = 16, color = "currentColor", title }) {
  const isFill = name in FILL_PATHS;
  const d = isFill ? FILL_PATHS[name] : STROKE_PATHS[name];
  if (!d) {
    // Unknown icon name — render nothing rather than a broken glyph.
    return null;
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      style={{ display: "block", flexShrink: 0 }}
    >
      {title ? <title>{title}</title> : null}
      <path
        d={d}
        {...(isFill
          ? { fill: color }
          : {
              stroke: color,
              strokeWidth: 2,
              strokeLinecap: "round",
              strokeLinejoin: "round",
            })}
      />
    </svg>
  );
}

// Names exported for tests / tooling that need to enumerate the set.
export const ICON_NAMES = [
  ...Object.keys(FILL_PATHS),
  ...Object.keys(STROKE_PATHS),
];
