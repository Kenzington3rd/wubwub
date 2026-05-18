import { useCallback, useRef, useState } from "react";
import Icon from "./Icon.jsx";

// Session crate panel (W1.5).
//
// A non-persistent list of decoded tracks the user can quick-load to either
// deck. The crate lives in App state and holds in-memory AudioBuffers only —
// it is empty on every fresh load and is NEVER written to disk, localStorage,
// or IndexedDB. Files are decoded once on add and reused; loading a crate
// entry to a deck hands the deck the already-decoded buffer (no re-decode).
//
// Styling — follows the shared-panel heading-accent pattern (DESIGN_GUIDE §4):
// the Crate carries ONE fixed identity accent (green) on its HEADING TEXT
// only; the panel body — borders, glow, the "Add tracks" button, the per-entry
// music icon — stays neutral slate, exactly like Looper (purple heading) and
// SamplePad (cyan heading). The only accented body controls are the per-entry
// "→ A" / "→ B" deck-load buttons, which are deck-scoped and tint with each
// deck's user-selected accent (threaded in as deckAColor / deckBColor).

// Fixed identity accent for the Crate heading — green, distinct from
// Looper-purple and SamplePad-cyan. Heading text only; never the body.
const CRATE_ACCENT = "#4ade80";

const AUDIO_EXT = /\.(mp3|wav|ogg|flac|m4a|aac)$/i;

function isAudioFile(file) {
  return !!file && (file.type.startsWith("audio/") || AUDIO_EXT.test(file.name));
}

export default function Crate({
  entries,
  onAdd,
  onRemove,
  onClear,
  onLoadToDeck,
  deckAColor,
  deckBColor,
}) {
  const fileInputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState(null);

  // Decode each picked/dropped file and hand the buffer up to App via onAdd.
  // Wrong file types and decode failures surface inline — never thrown, never
  // an alert(): a dead file shouldn't crash the panel or block the others.
  const ingestFiles = useCallback(
    async (files) => {
      const list = Array.from(files || []);
      if (list.length === 0) return;
      let anyError = false;
      for (const file of list) {
        if (!isAudioFile(file)) {
          anyError = true;
          continue;
        }
        try {
          await onAdd(file);
        } catch {
          anyError = true;
        }
      }
      setError(
        anyError
          ? "Some files were skipped — use audio files (MP3, WAV, OGG, FLAC, M4A, AAC)."
          : null
      );
    },
    [onAdd]
  );

  const onDragOver = useCallback((e) => {
    if (e.dataTransfer?.items?.length) {
      e.preventDefault();
      setIsDragOver(true);
    }
  }, []);
  const onDragLeave = useCallback(() => setIsDragOver(false), []);
  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setIsDragOver(false);
      ingestFiles(e.dataTransfer?.files);
    },
    [ingestFiles]
  );

  const onPick = useCallback(
    (e) => {
      ingestFiles(e.target.files);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [ingestFiles]
  );

  return (
    <section
      aria-label="Session crate"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        padding: 16,
        background: "rgba(15,18,35,0.6)",
        borderRadius: 16,
        // The Crate is a shared, non-deck panel — its chrome uses the neutral
        // slate scale (like Looper / SamplePad), not a deck accent. The
        // drag-over active state is a brighter neutral highlight, not cyan.
        border: `1px solid ${
          isDragOver ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.04)"
        }`,
        boxShadow: isDragOver ? "0 0 40px rgba(255,255,255,0.1)" : "none",
        marginTop: 16,
        transition: "border 0.2s, box-shadow 0.2s",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <h3
          style={{
            fontFamily: "'Audiowide', sans-serif",
            fontSize: 13,
            color: CRATE_ACCENT,
            margin: 0,
            letterSpacing: 2,
          }}
        >
          CRATE
        </h3>
        <span style={{ fontSize: 10, color: "#8892b0", flex: 1, minWidth: 120 }}>
          Drop tracks here — quick-load any to a deck. Session-only, never saved.
        </span>

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          onChange={onPick}
          style={{ display: "none" }}
        />
        {/* Neutral-slate body control — matches Looper / SamplePad chrome. The
            heading carries the Crate's identity accent; the body does not. */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="wc-btn-hover"
          aria-label="Add tracks to the crate"
          title="Add audio files to the crate"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "#8892b0",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 10,
            letterSpacing: 1,
            textTransform: "uppercase",
            fontFamily: "'Exo 2', sans-serif",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            minHeight: 38,
          }}
        >
          <Icon name="plus" size={11} color="#8892b0" />
          Add tracks
        </button>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="wc-btn-hover"
            aria-label="Clear the whole crate"
            title="Remove every track from the crate"
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#8892b0",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 10,
              letterSpacing: 1,
              textTransform: "uppercase",
              fontFamily: "'Exo 2', sans-serif",
              cursor: "pointer",
              minHeight: 38,
            }}
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            color: "#f87171",
            fontSize: 11,
            fontFamily: "'Exo 2', sans-serif",
            marginBottom: 8,
          }}
        >
          {error}
        </div>
      )}

      {entries.length === 0 ? (
        <div
          style={{
            border: "1px dashed rgba(255,255,255,0.12)",
            borderRadius: 10,
            padding: "18px 12px",
            textAlign: "center",
            color: "#8892b0",
            fontSize: 11,
            fontFamily: "'Exo 2', sans-serif",
          }}
        >
          Crate is empty — drop audio here or click "Add tracks".
        </div>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {entries.map((entry) => (
            <li
              key={entry.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 8,
              }}
            >
              {/* Neutral-slate body icon — the accent lives on the heading. */}
              <Icon name="music" size={13} color="#8892b0" />
              <span
                title={entry.name}
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: "#ccd6f6",
                  fontSize: 12,
                  fontFamily: "'Exo 2', sans-serif",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {entry.name}
              </span>
              {/* BPM / key columns — populated only if trivially known.
                  A dedicated crate analysis pipeline is deferred (W1.5 §5). */}
              <span
                style={{
                  width: 56,
                  textAlign: "right",
                  fontSize: 10,
                  color: entry.bpm ? "#8892b0" : "#4a5580",
                  fontFamily: "'Exo 2', sans-serif",
                }}
              >
                {entry.bpm ? `${entry.bpm} BPM` : "— BPM"}
              </span>
              <span
                style={{
                  width: 34,
                  textAlign: "right",
                  fontSize: 10,
                  color: entry.camelot ? "#8892b0" : "#4a5580",
                  fontFamily: "'Exo 2', sans-serif",
                }}
              >
                {entry.camelot || "—"}
              </span>
              {/* Load buttons track each deck's user-selected accent — the
                  deck theme colors are threaded in as props, never hard-coded. */}
              {[
                { deck: "A", color: deckAColor },
                { deck: "B", color: deckBColor },
              ].map(({ deck, color }) => (
                <button
                  key={deck}
                  type="button"
                  onClick={() => onLoadToDeck(deck, entry.id)}
                  className="wc-btn-hover"
                  aria-label={`Load "${entry.name}" to deck ${deck}`}
                  title={`Load to deck ${deck}`}
                  style={{
                    background: `${color}18`,
                    border: `1px solid ${color}44`,
                    color,
                    borderRadius: 6,
                    padding: "4px 8px",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: 1,
                    fontFamily: "'Exo 2', sans-serif",
                    cursor: "pointer",
                    minHeight: 38,
                  }}
                >
                  {`→ ${deck}`}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onRemove(entry.id)}
                aria-label={`Remove "${entry.name}" from the crate`}
                title="Remove from crate"
                style={{
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 6,
                  padding: "4px 6px",
                  minWidth: 38,
                  minHeight: 38,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="close" size={11} color="#4a5580" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
