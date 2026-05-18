// Record a node's output to a downloadable audio file via MediaRecorder.
// Local-only: the blob is generated client-side and downloaded by anchor click;
// never uploaded, never reaches the network.

const PREFERRED_MIMES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/ogg;codecs=opus",
];

function pickMime() {
  if (typeof MediaRecorder === "undefined") return null;
  return PREFERRED_MIMES.find((m) => {
    try {
      return MediaRecorder.isTypeSupported(m);
    } catch {
      return false;
    }
  });
}

// Build a one-shot recorder that taps `sourceNode`. Caller is responsible for
// disposing it once they're done (which also disconnects the tap).
export function createMasterRecorder(audioContext, sourceNode) {
  const mime = pickMime();
  if (!mime) return null;

  const dest = audioContext.createMediaStreamDestination();
  sourceNode.connect(dest);

  const rec = new MediaRecorder(dest.stream, { mimeType: mime });
  const chunks = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  return {
    mime,
    start: () => {
      chunks.length = 0;
      if (rec.state === "inactive") rec.start();
    },
    stop: () =>
      new Promise((resolve) => {
        if (rec.state === "inactive") {
          resolve(new Blob(chunks, { type: mime }));
          return;
        }
        rec.onstop = () => resolve(new Blob(chunks, { type: mime }));
        rec.stop();
      }),
    state: () => rec.state,
    dispose: () => {
      try {
        if (rec.state !== "inactive") rec.stop();
      } catch {}
      try {
        sourceNode.disconnect(dest);
      } catch {}
    },
  };
}

// Format elapsed milliseconds as MM:SS for cue-sheet lines.
function fmtCueTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// Build a plain-text cue sheet from a list of marker objects.
// Each marker is `{ elapsedMs }` — the time, relative to record start, at
// which the user dropped the marker. `mixName` is the shared base filename so
// the cue sheet self-identifies which audio file it belongs to.
// Returns a readable string; never touches the network.
export function buildCueSheet(markers, mixName) {
  const stamp = new Date().toLocaleString();
  const lines = [
    "WAVECRAFT MIX CUE SHEET",
    `Mix: ${mixName}`,
    `Exported: ${stamp}`,
    `Markers: ${markers.length}`,
    "",
  ];
  markers.forEach((m, i) => {
    lines.push(`${fmtCueTime(m.elapsedMs)} — Marker ${i + 1}`);
  });
  return lines.join("\n") + "\n";
}

export function extensionForMime(mime) {
  if (!mime) return "bin";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("webm")) return "webm";
  return "audio";
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
