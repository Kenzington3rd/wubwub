import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Worklet source is imported as a raw string so both the multi-file build and
// the single-file (`vite-plugin-singlefile`) build inline it as JS rather than
// shipping a sibling `worklets/looper-worklet.js` file. At runtime we wrap the
// source in a Blob and pass the resulting object URL to `addModule`. This
// also makes the worklet load correctly from `file://`, where the previous
// `"/worklets/looper-worklet.js"` absolute path resolved to the drive root.
import looperWorkletSrc from "./worklets/looper-worklet.js?raw";
import useMatchMedia from "./hooks/useMatchMedia.js";
import Deck from "./components/Deck.jsx";
import Crossfader from "./components/Crossfader.jsx";
import MasterBus from "./components/MasterBus.jsx";
import TheoryPanel from "./components/TheoryPanel.jsx";
import Looper from "./components/Looper.jsx";
import SamplePad from "./components/SamplePad.jsx";
import MidiPanel from "./components/MidiPanel.jsx";
import Crate from "./components/Crate.jsx";
import { crossfadeGains } from "./audio/crossfade.js";
import {
  createMasterRecorder,
  downloadBlob,
  extensionForMime,
  buildCueSheet,
} from "./audio/recorder.js";
import {
  enableMidi,
  mapCcToValue,
  applyRelative,
  decodeRelative2c,
  decodeSignedMag,
  MIDI_SUPPORTED,
} from "./midi/midiMap.js";
import { serializeSettings } from "./settings.js";
import { SAMPLE_PAD_KEYS } from "./data.js";

const DEFAULT_DECK_A_COLOR = "#00f5d4";
const DEFAULT_DECK_B_COLOR = "#a78bfa";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export default function App() {
  // ── Global state ──
  const [crossfade, setCrossfade] = useState(0.5);
  const [crossfadeCurve, setCrossfadeCurve] = useState("equal-power");
  const [masterVol, setMasterVol] = useState(0.85);
  const [deckAColor, setDeckAColor] = useState(DEFAULT_DECK_A_COLOR);
  const [deckBColor, setDeckBColor] = useState(DEFAULT_DECK_B_COLOR);
  const [focusedDeck, setFocusedDeck] = useState(null);
  // Detected Camelot key per deck — lifted from each Deck via onKeyDetected so
  // the TheoryPanel Camelot wheel can highlight the focused deck's key live.
  const [deckKeys, setDeckKeys] = useState({ A: null, B: null });
  const [isRecording, setIsRecording] = useState(false);
  const [recordStartedAt, setRecordStartedAt] = useState(null);
  const [recordSupported, setRecordSupported] = useState(true);
  // W1.7 — which point the MediaRecorder taps. "post" = after the shared
  // master compressor (radio-style, current behavior); "pre" = the summed
  // pre-limiter signal (clean). Only changeable while idle.
  const [recordTapMode, setRecordTapMode] = useState("post");
  // W1.3 — count of cue markers dropped during the current recording. Live
  // UI only; the timestamps themselves live in markersRef (in-memory).
  const [markerCount, setMarkerCount] = useState(0);
  const [workletReady, setWorkletReady] = useState(false);
  const [midiEnabled, setMidiEnabled] = useState(false);
  const [midiError, setMidiError] = useState("");
  const [midiInputName, setMidiInputName] = useState("");
  const [midiMappings, setMidiMappings] = useState({});
  const [learnTarget, setLearnTarget] = useState(null);
  // R17 Q1 — inline hint surfaced beside the active Learn row when an
  // incoming message can't be captured. Specifically: a Note On arrives, the
  // panel can't route note triggers yet (note-target runtime routing is
  // deferred), so instead of silently capturing a mapping that does nothing
  // at runtime we tell the user to use a CC for now. Cleared on cancel, on a
  // successful CC capture, and on Learn-mode exit.
  const [learnHint, setLearnHint] = useState("");
  // Map of MIDIInput.id → display name, learned the first time we see a
  // message from each input. The MidiPanel uses this to disambiguate mapping
  // rows by controller name when more than one input has bound mappings, so
  // two controllers' ch1/cc7 can be told apart.
  const [midiInputNames, setMidiInputNames] = useState({});
  // W1.5 — session crate. An in-memory list of decoded tracks: each entry is
  // { id, name, bpm, camelot, _buffer }. The decoded AudioBuffer is kept off
  // the rendered object (`crateBuffersRef`) so it never accidentally ends up
  // in serialized state. The crate is empty on every fresh load and is NEVER
  // persisted to disk / localStorage / IndexedDB.
  const [crate, setCrate] = useState([]);

  // ── Refs ──
  const audioCtxRef = useRef(null);
  const masterCompressorRef = useRef(null);
  // A1 — fixed trim GainNode between the limiter and the master gain; gives
  // the brickwall limiter extra headroom so the destination never clips.
  const masterTrimRef = useRef(null);
  const masterGainRef = useRef(null);
  // W1.7 — parallel pre-limiter sum node. Every deck's analyser fans out into
  // this in addition to the master compressor; it carries the summed deck
  // signal *before* the compressor for the "Clean" recorder tap.
  const recordTapRef = useRef(null);
  // W1.7 — AnalyserNode on the master output, used by the clip meter.
  const clipAnalyserRef = useRef(null);
  const workletNodeRef = useRef(null);
  const recorderRef = useRef(null);
  // W1.3 — cue markers for the in-progress recording: array of { elapsedMs }.
  // In memory only; never persisted. Reset when a new recording starts.
  const markersRef = useRef([]);
  // W1.3 — recording-start timestamp, the source of truth for marker math.
  // Written synchronously in onToggleRecord the moment the recording starts,
  // so an `M` keypress in the gap before the recordStartedAt-state effect
  // flushes still sees a non-null value (the state mirror can lag a render).
  const recordStartedAtRef = useRef(null);
  const midiUnsubRef = useRef(null);
  const deckARef = useRef(null);
  const deckBRef = useRef(null);
  const samplePadRef = useRef(null);
  const focusedRef = useRef(null);
  const effectiveBpmRef = useRef(128);
  const mappingsRef = useRef({});
  const learnTargetRef = useRef(null);
  // Running value per target, used only by the relative-encoder path. Seeded
  // lazily from the target's absolute default the first time a relative tick
  // arrives, then mutated in place as deltas accumulate. The user setting an
  // absolute mapping on the same target overrides this on the next CC; for a
  // pure-relative jog wheel we just need somewhere to remember "where the
  // dial is now".
  const relativeStateRef = useRef({});
  // W1.5 — decoded AudioBuffers for crate entries, keyed by entry id. Held in
  // a ref (not state) so the buffers stay out of render data and are dropped
  // for GC the moment an entry is removed / the crate is cleared.
  const crateBuffersRef = useRef(new Map());
  // Monotonic id source for crate entries.
  const crateIdRef = useRef(0);
  const masterVolRef = useRef(0.85);
  const workletLoadingRef = useRef(null);
  const recordTogglingRef = useRef(false);
  // Stable handle to the latest onDropMarker so the keydown handler (deps: [])
  // can call it without re-binding the window listener on every render.
  const dropMarkerRef = useRef(() => {});
  // True while mounted. Used to bail out of async work (e.g. record toggle)
  // if the component unmounts mid-await — otherwise a recorder + MediaStream
  // tap created after unmount leaks (no JS reference, still tapping master).
  const mountedRef = useRef(true);

  // Keep masterVolRef in sync so ensureMasterCtx doesn't need masterVol in deps.
  useEffect(() => { masterVolRef.current = masterVol; }, [masterVol]);

  const isMobile = useMatchMedia("(max-width: 720px)");

  // ── Derived: crossfade gains ──
  const { gainA, gainB } = useMemo(
    () => crossfadeGains(crossfade, crossfadeCurve),
    [crossfade, crossfadeCurve]
  );

  // ── Master audio chain ──
  // Lazily constructed on first user gesture. Returns the audio context.
  // No dependency on `masterVol` state — read via masterVolRef so callback
  // identity stays stable across volume changes.
  const ensureMasterCtx = useCallback(async () => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    const ctx = audioCtxRef.current;

    if (!masterCompressorRef.current) {
      // A1 — true brickwall safety-net limiter. Both decks + bass drop + 4
      // looper slots + 8 sample pads all sum into this single compressor; the
      // old gentle settings (threshold -6 dB, ratio 4) let the summed signal
      // run far past full scale and clip at the destination. Brickwall config:
      //   threshold -9 dB  — start limiting before the sum reaches 0 dBFS
      //   ratio     20     — near-infinite ratio = hard ceiling, not a knee
      //   knee      0      — abrupt onset (a true limiter, not a soft comp)
      //   attack    0.003  — fast enough to catch transients
      //   release   0.1    — quick recovery without audible pumping
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -9;
      comp.knee.value = 0;
      comp.ratio.value = 20;
      comp.attack.value = 0.003;
      comp.release.value = 0.1;
      // A1 — fixed make-up trim *down* between the limiter and the master
      // gain. Even a brickwall limiter passes a peak slightly above threshold
      // during its short attack window; a 0.65 trim guarantees the signal
      // reaching the destination stays below full scale under worst-case
      // simultaneous playback. The user's master volume is applied after this.
      const trim = ctx.createGain();
      trim.gain.value = 0.65;
      const gain = ctx.createGain();
      gain.gain.value = masterVolRef.current;
      comp.connect(trim);
      trim.connect(gain);
      gain.connect(ctx.destination);
      masterCompressorRef.current = comp;
      masterTrimRef.current = trim;
      masterGainRef.current = gain;

      // W1.7 — parallel pre-limiter record tap. Decks fan their analyser
      // output into this as well as the compressor; it sums the deck signal
      // before the limiter. It has no downstream connection (it is only a
      // tap source for createMediaStreamDestination), so it never reaches
      // ctx.destination and cannot double the audible signal.
      recordTapRef.current = ctx.createGain();
      recordTapRef.current.gain.value = 1;

      // W1.7 — clip meter analyser on the master output. Reads peak sample
      // level for the clip indicator. fftSize kept small — peak detection
      // doesn't need resolution.
      const clipAnalyser = ctx.createAnalyser();
      clipAnalyser.fftSize = 1024;
      gain.connect(clipAnalyser);
      clipAnalyserRef.current = clipAnalyser;
    }

    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* user will retry */
      }
    }

    // Load looper worklet once. Gate with a promise ref so two concurrent
    // ensureMasterCtx calls don't both pass the null-check + create
    // duplicate worklet nodes (the first would leak: still connected to
    // the master compressor with no JS reference).
    if (!workletNodeRef.current && !workletLoadingRef.current) {
      workletLoadingRef.current = (async () => {
        // Wrap the imported worklet source in a Blob and hand the resulting
        // object URL to `addModule`. Works in dev, the PWA build, the single
        // -file build, and from `file://`. The URL is revoked immediately
        // after registration succeeds — the worklet code has already been
        // copied into the AudioWorkletGlobalScope by then.
        let workletUrl = null;
        try {
          try {
            workletUrl = URL.createObjectURL(
              new Blob([looperWorkletSrc], { type: "text/javascript" }),
            );
            await ctx.audioWorklet.addModule(workletUrl);
          } finally {
            if (workletUrl) {
              try { URL.revokeObjectURL(workletUrl); } catch { /* noop */ }
            }
          }
          if (workletNodeRef.current) return; // someone got there first
          const node = new AudioWorkletNode(ctx, "looper-processor", {
            numberOfInputs: 1,
            numberOfOutputs: 0,
            processorOptions: { seconds: 60 },
          });
          masterCompressorRef.current.connect(node);
          workletNodeRef.current = node;
          setWorkletReady(true);
        } catch (err) {
          console.warn("Looper worklet failed to load — looper disabled.", err);
          workletLoadingRef.current = null; // allow retry
        }
      })();
    }
    if (workletLoadingRef.current) await workletLoadingRef.current;

    return ctx;
  }, []);

  // iOS Safari sometimes refuses to unlock the AudioContext from async paths.
  // Belt-and-suspenders: synchronously create + resume on the first user gesture.
  useEffect(() => {
    const kick = () => {
      try {
        if (!audioCtxRef.current) {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          audioCtxRef.current = new Ctx();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === "suspended") {
          ctx.resume().catch(() => {});
        }
      } catch {
        /* ignore — full setup happens lazily via ensureMasterCtx */
      }
    };
    const opts = { once: true, passive: true };
    window.addEventListener("pointerdown", kick, opts);
    window.addEventListener("touchend", kick, opts);
    window.addEventListener("keydown", kick, opts);
    return () => {
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("touchend", kick);
      window.removeEventListener("keydown", kick);
    };
  }, []);

  // ── Apply master volume ──
  useEffect(() => {
    const ctx = audioCtxRef.current;
    const g = masterGainRef.current;
    if (g && ctx) g.gain.setTargetAtTime(masterVol, ctx.currentTime, 0.02);
  }, [masterVol]);

  // ── Detect MediaRecorder support ──
  useEffect(() => {
    if (typeof MediaRecorder === "undefined") setRecordSupported(false);
  }, []);

  // ── Track effective BPM for looper ──
  useEffect(() => {
    const tick = () => {
      const a = deckARef.current?.getEffectiveBpm?.() ?? 128;
      const b = deckBRef.current?.getEffectiveBpm?.() ?? 128;
      effectiveBpmRef.current = (a + b) / 2;
    };
    const id = setInterval(tick, 750);
    return () => clearInterval(id);
  }, []);

  // ── Focus ──
  const focusA = useCallback(() => {
    focusedRef.current = "A";
    setFocusedDeck("A");
  }, []);
  const focusB = useCallback(() => {
    focusedRef.current = "B";
    setFocusedDeck("B");
  }, []);

  // ── Detected key per deck ──
  const onKeyDetectedA = useCallback(
    (camelot) => setDeckKeys((k) => (k.A === camelot ? k : { ...k, A: camelot })),
    []
  );
  const onKeyDetectedB = useCallback(
    (camelot) => setDeckKeys((k) => (k.B === camelot ? k : { ...k, B: camelot })),
    []
  );

  // ── Sync ──
  const onSyncDeck = useCallback((id) => {
    const own = id === "A" ? deckARef : deckBRef;
    const other = id === "A" ? deckBRef : deckARef;
    const otherBpm = other.current?.getBpm?.();
    own.current?.syncTo?.(otherBpm);
  }, []);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (!t) return;
      const tag = (t.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable) {
        return;
      }
      const focused = focusedRef.current;
      const ownRef = focused === "B" ? deckBRef : focused === "A" ? deckARef : null;
      const otherRef = focused === "A" ? deckBRef : focused === "B" ? deckARef : null;

      // Sample pad keys (active when NO deck is focused, no focus required).
      // Skip key-repeat to avoid retriggering during key-hold.
      //
      // `S` collides: it is both sample pad 6 and the deck-sync shortcut.
      // Resolution: when a deck IS focused, `S` syncs that deck (deck-scoped
      // shortcuts win); sample pad 6 is still reachable by pressing `S` with
      // no deck focused. The other pad keys (Q W E R A D F) are not deck
      // shortcuts, so they always trigger their pad.
      if (
        !e.repeat &&
        SAMPLE_PAD_KEYS.includes(e.key.toLowerCase()) &&
        !e.ctrlKey &&
        !e.metaKey &&
        !(focused && e.key.toLowerCase() === "s")
      ) {
        samplePadRef.current?.triggerByKey(e.key.toLowerCase());
        return;
      }

      if (e.key === " " && !e.repeat) {
        e.preventDefault();
        // If a button is focused (e.g. user just clicked PLAY), blur it.
        // Otherwise browser synthesizes a click on keyup → double-trigger.
        if (tag === "button" && typeof t.blur === "function") t.blur();
        ownRef?.current?.togglePlay?.();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (e.shiftKey) setCrossfade(0);
        else setCrossfade((v) => clamp(v - 0.05, 0, 1));
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) setCrossfade(1);
        else setCrossfade((v) => clamp(v + 0.05, 0, 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        ownRef?.current?.nudgeVolume?.(0.05);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        ownRef?.current?.nudgeVolume?.(-0.05);
        return;
      }
      const lower = e.key.toLowerCase();
      if (lower === "s") {
        // Only reachable when a deck is focused — the sample-pad branch above
        // intercepts `S` when no deck is focused (sample pad 6).
        e.preventDefault();
        const otherBpm = otherRef?.current?.getBpm?.();
        ownRef?.current?.syncTo?.(otherBpm);
        return;
      }
      if (lower === "c") {
        e.preventDefault();
        ownRef?.current?.setCue?.();
        return;
      }
      // W1.3 — `M` drops a recording cue marker. Not deck-scoped (it marks the
      // master mix), not a sample-pad key, so it works regardless of focus.
      // No-op unless a recording is in progress (guarded inside onDropMarker).
      if (lower === "m" && !e.repeat && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        dropMarkerRef.current();
        return;
      }
      if (/^[1-8]$/.test(e.key)) {
        e.preventDefault();
        ownRef?.current?.jumpCue?.(parseInt(e.key, 10) - 1);
        return;
      }
      // P11 (R16) — keyboard NUDGE on the focused deck (WCAG 2.1.1). Hold-to-
      // bend semantics: keydown applies the bend, keyup releases. `e.repeat`
      // tail-clicks are ignored so the bend isn't re-applied each tick while
      // held. Deck-scoped — no-op when no deck is focused.
      if ((e.key === "," || e.key === ".") && !e.ctrlKey && !e.metaKey) {
        if (!ownRef) return;
        e.preventDefault();
        if (e.repeat) return;
        const dir = e.key === "," ? -1 : 1;
        ownRef.current?.startNudge?.(dir);
        return;
      }
    };
    const onKeyUp = (e) => {
      const t = e.target;
      if (t) {
        const tag = (t.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable) {
          return;
        }
      }
      // Release any held nudge — bound to either deck, since a keydown on the
      // focused deck installs the bend on that deck's ref.
      if (e.key === "," || e.key === ".") {
        const focused = focusedRef.current;
        const ownRef = focused === "B" ? deckBRef : focused === "A" ? deckARef : null;
        ownRef?.current?.endNudge?.();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // ── Recording ──
  // Gated by `recordTogglingRef` so a rapid double-click doesn't create
  // two recorders (the first would leak: still tapping the master output
  // with no JS reference in `recorderRef`).
  const onToggleRecord = useCallback(async () => {
    if (recordTogglingRef.current) return;
    recordTogglingRef.current = true;
    try {
      if (isRecording) {
        const rec = recorderRef.current;
        if (!rec) return;
        const mime = rec.mime;
        // Q1 — keep recorderRef.current pointed at `rec` across the entire
        // stop+dispose sequence. If the component unmounts during the
        // `await rec.stop()` below, the unmount cleanup still sees a non-null
        // recorderRef and disposes the recorder (releasing the MediaStream
        // tap). dispose() is idempotent, so the dispose() call here is then a
        // safe no-op — the tap is freed exactly once either way. Only null
        // the ref AFTER both stop() and dispose() have completed.
        const blob = await rec.stop();
        rec.dispose();
        recorderRef.current = null;
        setIsRecording(false);
        setRecordStartedAt(null);
        recordStartedAtRef.current = null;
        // Snapshot markers, then clear them — a new recording starts fresh.
        const markers = markersRef.current;
        markersRef.current = [];
        setMarkerCount(0);
        if (blob && blob.size > 0) {
          const ext = extensionForMime(mime);
          const ts = new Date()
            .toISOString()
            .replace(/[:.]/g, "-")
            .replace("T", "_")
            .slice(0, 19);
          const base = `wavecraft-mix-${ts}`;
          downloadBlob(blob, `${base}.${ext}`);
          // W1.3 — if the user dropped any markers, export a cue sheet that
          // shares the audio file's base name so the two pair up on disk.
          if (markers.length > 0) {
            const cueText = buildCueSheet(markers, `${base}.${ext}`);
            downloadBlob(
              new Blob([cueText], { type: "text/plain" }),
              `${base}.cue.txt`
            );
          }
        }
        return;
      }
      const ctx = await ensureMasterCtx();
      // Bail if the component unmounted during the await — otherwise the
      // recorder + MediaStreamDestination tap below would leak.
      if (!mountedRef.current) return;
      if (!ctx || !masterCompressorRef.current) return;
      // W1.7 — tap the chosen node. "pre" = the parallel pre-limiter sum;
      // "post" = the master compressor (radio). Fall back to post if the
      // pre-limiter node somehow isn't ready.
      const tapNode =
        recordTapMode === "pre" && recordTapRef.current
          ? recordTapRef.current
          : masterCompressorRef.current;
      const rec = createMasterRecorder(ctx, tapNode);
      if (!rec) {
        setRecordSupported(false);
        return;
      }
      recorderRef.current = rec;
      // Fresh recording — discard any markers from a previous take.
      markersRef.current = [];
      setMarkerCount(0);
      rec.start();
      // Stamp the start time into a ref synchronously — before the state
      // update commits — so onDropMarker always has a valid reference even if
      // an `M` keypress lands before the recordStartedAt-state effect flushes.
      const startedAt = Date.now();
      recordStartedAtRef.current = startedAt;
      setIsRecording(true);
      setRecordStartedAt(startedAt);
    } finally {
      recordTogglingRef.current = false;
    }
  }, [isRecording, recordTapMode, ensureMasterCtx]);

  // ── W1.3 — drop a cue marker at the current recording elapsed time ──
  // No-op unless a recording is in progress. Stores the elapsed ms relative
  // to the recording-start timestamp; in memory only, never persisted.
  // Reads recordStartedAtRef (written synchronously when recording starts)
  // rather than the recordStartedAt *state* — the state mirror can lag a
  // render after a start/restart, which would drop a marker dropped in that
  // gap. The ref is the source of truth and also serves as the "is a
  // recording active" guard (it is null whenever no recording is in flight).
  const onDropMarker = useCallback(() => {
    const startedAt = recordStartedAtRef.current;
    if (!startedAt) return;
    markersRef.current = [
      ...markersRef.current,
      { elapsedMs: Date.now() - startedAt },
    ];
    setMarkerCount(markersRef.current.length);
  }, []);

  // Keep the stable ref pointed at the latest onDropMarker.
  useEffect(() => { dropMarkerRef.current = onDropMarker; }, [onDropMarker]);

  // ── MIDI ──
  useEffect(() => { mappingsRef.current = midiMappings; }, [midiMappings]);
  useEffect(() => { learnTargetRef.current = learnTarget; }, [learnTarget]);

  // Default value to seed a target's relative-state ref the first time a
  // relative tick arrives for it (no current-value getter on the Deck/master,
  // so we pick a sensible mid-range starting point).
  const defaultForTarget = (targetId) => {
    switch (targetId) {
      case "deckA.filterFreq":
      case "deckB.filterFreq":
        return 20000; // fully open
      case "deckA.speed":
      case "deckB.speed":
        return 1; // normal speed
      default:
        return 0.5; // crossfade / volume / master volume mid-range
    }
  };

  const dispatchTargetValue = useCallback((targetId, val) => {
    // Mirror into the relative ref so a later relative tick continues from
    // wherever absolute moves left things.
    relativeStateRef.current[targetId] = val;
    switch (targetId) {
      case "crossfade":
        setCrossfade(val);
        break;
      case "masterVol":
        setMasterVol(val);
        break;
      case "deckA.volume":
        deckARef.current?.setVolume?.(val);
        break;
      case "deckA.filterFreq":
        deckARef.current?.setFilterFreq?.(val);
        break;
      case "deckA.speed":
        deckARef.current?.setSpeed?.(val);
        break;
      case "deckB.volume":
        deckBRef.current?.setVolume?.(val);
        break;
      case "deckB.filterFreq":
        deckBRef.current?.setFilterFreq?.(val);
        break;
      case "deckB.speed":
        deckBRef.current?.setSpeed?.(val);
        break;
      default:
        break;
    }
  }, []);

  // R17 Q2 — read the live value of a target from the deck/master state. The
  // relative-encoder branch calls this on every tick so deltas are applied
  // against where the parameter actually is right now, not against a stale
  // running ref that only mirrors dispatched-MIDI absolute writes. Without
  // this, a user who moved a slider on screen would see the first jog twist
  // teleport the parameter back to the relative ref's last value (often the
  // default — e.g. speed 1.0). Falls back to the per-target default if a
  // deck ref isn't yet wired (no buffer loaded, etc.).
  const liveValueForTarget = useCallback((targetId) => {
    switch (targetId) {
      case "crossfade":
        return crossfade;
      case "masterVol":
        return masterVol;
      case "deckA.volume":
        return deckARef.current?.getVolume?.() ?? defaultForTarget(targetId);
      case "deckA.filterFreq":
        return (
          deckARef.current?.getFilterFreq?.() ?? defaultForTarget(targetId)
        );
      case "deckA.speed":
        return deckARef.current?.getSpeed?.() ?? defaultForTarget(targetId);
      case "deckB.volume":
        return deckBRef.current?.getVolume?.() ?? defaultForTarget(targetId);
      case "deckB.filterFreq":
        return (
          deckBRef.current?.getFilterFreq?.() ?? defaultForTarget(targetId)
        );
      case "deckB.speed":
        return deckBRef.current?.getSpeed?.() ?? defaultForTarget(targetId);
      default:
        return defaultForTarget(targetId);
    }
  }, [crossfade, masterVol]);

  const applyMidiCc = useCallback(
    (targetId, mapping, ccValue) => {
      const mode = mapping.mode || "absolute";
      if (mode === "absolute") {
        dispatchTargetValue(targetId, mapCcToValue(ccValue, targetId));
        return;
      }
      // Relative mode — accumulate against the *live* value. R17 Q2: reseed
      // the relative ref from the deck/master each tick so the first twist
      // after a UI-side change of the same parameter doesn't snap back to
      // the default. (The mirror-from-dispatchTargetValue path still helps
      // when consecutive absolute MIDI writes interleave with relative.)
      const current = liveValueForTarget(targetId);
      relativeStateRef.current[targetId] = current;
      const delta =
        mode === "relative2c"
          ? decodeRelative2c(ccValue)
          : decodeSignedMag(ccValue);
      dispatchTargetValue(targetId, applyRelative(current, delta, targetId));
    },
    [dispatchTargetValue, liveValueForTarget]
  );

  const onMidiMessage = useCallback(
    (message, inputId, inputName) => {
      setMidiInputName(inputName || "");
      // Remember this input's name keyed by id so the panel can disambiguate
      // mapping rows when more than one controller is bound. Only writes on
      // change to avoid pointless re-renders.
      if (inputId && inputName) {
        setMidiInputNames((prev) =>
          prev[inputId] === inputName ? prev : { ...prev, [inputId]: inputName }
        );
      }
      // Learn mode: capture the first CC message. Note On is intentionally
      // rejected here while runtime routing for note triggers is deferred —
      // the lower-level midiMap still forwards `kind:"noteon"` (other
      // consumers may use it), but capturing a note as a mapping would
      // produce a row labelled "ch1 note36" that silently does nothing at
      // runtime. The DJ + QA reviewers flagged that as misleading. Instead
      // we leave the learn target active and surface a hint so the user
      // knows to twist a CC. Note Off is ignored during learn so a button
      // release doesn't replace the press the user just made.
      if (learnTargetRef.current) {
        if (message.kind === "cc") {
          const targetId = learnTargetRef.current;
          setMidiMappings((prev) => ({
            ...prev,
            [targetId]: {
              inputId,
              channel: message.channel,
              kind: "cc",
              number: message.cc,
              mode: "absolute",
            },
          }));
          learnTargetRef.current = null;
          setLearnTarget(null);
          setLearnHint("");
        } else if (message.kind === "noteon") {
          // R17 Q1 — DO NOT capture; the broader note-routing overhaul is
          // pending. Tell the user inline. The learn target stays armed so a
          // following CC still captures.
          setLearnHint(
            "Note triggers aren't routed yet — coming in the MIDI overhaul. Use a CC for now."
          );
        }
        return;
      }
      const map = mappingsRef.current;
      for (const [targetId, mapping] of Object.entries(map)) {
        // Match by inputId (when both sides know it), channel, kind, number.
        // A v1-imported mapping with inputId=undefined matches any input —
        // best-effort behavior so a settings file from the old shape still
        // works after re-plugging the controller.
        if (
          mapping.channel !== message.channel ||
          (mapping.kind || "cc") !== message.kind
        ) {
          continue;
        }
        if (mapping.inputId !== undefined && mapping.inputId !== inputId) {
          continue;
        }
        if (message.kind === "cc") {
          if (mapping.number !== message.cc) continue;
          applyMidiCc(targetId, mapping, message.value);
        } else if (message.kind === "noteon") {
          if (mapping.number !== message.note) continue;
          // Routing a note trigger to a target value is part of the deferred
          // MIDI controller overhaul. For now, surface that the trigger was
          // received so a developer debugging the panel can see Learn captured
          // the right note even though runtime application is not wired yet.
          // eslint-disable-next-line no-console
          console.debug(
            `[wavecraft] MIDI note trigger received for "${targetId}" ` +
              `(ch${message.channel + 1} note${message.note}) — runtime ` +
              `routing for note mappings is deferred to a later round.`
          );
        }
        // noteoff is intentionally not applied (button-up shouldn't change a value).
      }
    },
    [applyMidiCc]
  );

  const onEnableMidi = async () => {
    if (!MIDI_SUPPORTED) {
      setMidiError("Web MIDI not supported.");
      return;
    }
    try {
      await ensureMasterCtx();
      const unsub = await enableMidi(onMidiMessage);
      midiUnsubRef.current = unsub;
      setMidiEnabled(true);
      setMidiError("");
    } catch (err) {
      setMidiError(err.message || String(err));
    }
  };

  const onDisableMidi = () => {
    midiUnsubRef.current?.();
    midiUnsubRef.current = null;
    setMidiEnabled(false);
    setLearnTarget(null);
    setLearnHint("");
    setMidiInputName("");
  };

  const onClearMidiMapping = (targetId) => {
    setMidiMappings((prev) => {
      const next = { ...prev };
      delete next[targetId];
      return next;
    });
  };

  // Per-mapping CC mode change ("absolute" / "relative2c" / "signedMag").
  // No-op on a note mapping — note triggers don't have a relative/absolute
  // axis. The MidiPanel hides the dropdown for note mappings.
  const onChangeMidiMode = (targetId, mode) => {
    setMidiMappings((prev) => {
      const existing = prev[targetId];
      if (!existing) return prev;
      return { ...prev, [targetId]: { ...existing, mode } };
    });
  };

  // ── W1.5 — session crate ──
  // Decode a picked/dropped file once and add it as a crate entry. The decoded
  // AudioBuffer is stashed in crateBuffersRef (off render data). Rejects on a
  // decode failure so Crate.jsx can surface an inline error. In memory only.
  const onCrateAdd = useCallback(
    async (file) => {
      const ctx = await ensureMasterCtx();
      if (!ctx) throw new Error("audio engine unavailable");
      const audioBuf = await ctx.decodeAudioData(await file.arrayBuffer());
      const id = ++crateIdRef.current;
      // Q3 — store the name alongside the buffer so onCrateLoadToDeck can read
      // it without depending on `crate` state (keeps the load buttons stable).
      crateBuffersRef.current.set(id, { buffer: audioBuf, name: file.name });
      setCrate((c) => [...c, { id, name: file.name, bpm: null, camelot: null }]);
    },
    [ensureMasterCtx]
  );

  // Remove one entry — drop the buffer reference so it can be GC'd. A deck
  // already playing that buffer keeps its own reference and is unaffected.
  const onCrateRemove = useCallback((id) => {
    crateBuffersRef.current.delete(id);
    setCrate((c) => c.filter((e) => e.id !== id));
  }, []);

  // Clear the whole crate — drop every buffer reference.
  const onCrateClear = useCallback(() => {
    crateBuffersRef.current.clear();
    setCrate([]);
  }, []);

  // Quick-load a crate entry onto a deck via the deck's loadBuffer imperative
  // method — hands over the already-decoded buffer (no re-decode). Q3 — reads
  // the track name from crateBuffersRef ({ buffer, name }) rather than the
  // `crate` state, so this callback has stable identity and the per-entry
  // load buttons don't churn when the crate list changes.
  const onCrateLoadToDeck = useCallback((deckId, entryId) => {
    const stored = crateBuffersRef.current.get(entryId);
    if (!stored) return;
    const deckRef = deckId === "A" ? deckARef : deckBRef;
    deckRef.current?.loadBuffer?.(stored.buffer, stored.name || "crate track");
  }, []);

  // ── W1.4 — settings export / import ──
  // Serialize the current config to a versioned JSON file and download it via
  // the existing downloadBlob helper. Config only — no audio.
  const onExportSettings = useCallback(() => {
    const json = serializeSettings({
      deckAColor,
      deckBColor,
      crossfadeCurve,
      midiMappings,
      recordTapMode,
    });
    const ts = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);
    downloadBlob(
      new Blob([json], { type: "application/json" }),
      `wavecraft-settings-${ts}.json`
    );
  }, [deckAColor, deckBColor, crossfadeCurve, midiMappings, recordTapMode]);

  // Apply a validated config object (from parseSettings) to live state. Only
  // the fields present are applied — parseSettings has already dropped any
  // unknown / malformed fields, so this never throws on bad input.
  const onImportSettings = useCallback((config) => {
    if (!config) return;
    if (config.deckAColor) setDeckAColor(config.deckAColor);
    if (config.deckBColor) setDeckBColor(config.deckBColor);
    if (config.crossfadeCurve) setCrossfadeCurve(config.crossfadeCurve);
    if (config.recordTapMode) setRecordTapMode(config.recordTapMode);
    if (config.midiMappings) setMidiMappings(config.midiMappings);
  }, []);

  // ── Cleanup ──
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      crateBuffersRef.current.clear();
      midiUnsubRef.current?.();
      recorderRef.current?.dispose?.();
      recorderRef.current = null;
      try { workletNodeRef.current?.disconnect(); } catch {}
      workletNodeRef.current = null;
      try { recordTapRef.current?.disconnect(); } catch {}
      recordTapRef.current = null;
      try { clipAnalyserRef.current?.disconnect(); } catch {}
      clipAnalyserRef.current = null;
      try { masterCompressorRef.current?.disconnect(); } catch {}
      try { masterTrimRef.current?.disconnect(); } catch {}
      try { masterGainRef.current?.disconnect(); } catch {}
      try { audioCtxRef.current?.close(); } catch {}
      audioCtxRef.current = null;
      masterCompressorRef.current = null;
      masterTrimRef.current = null;
      masterGainRef.current = null;
    };
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(160deg, #070a14 0%, #0d1225 30%, #0f0a20 70%, #080c18 100%)",
        color: "#ccd6f6",
        fontFamily: "'Exo 2', sans-serif",
        overflow: "auto",
      }}
    >
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(ellipse at 20% 50%, rgba(0,245,212,0.03) 0%, transparent 60%), radial-gradient(ellipse at 80% 50%, rgba(167,139,250,0.03) 0%, transparent 60%)",
        }}
      />

      <div
        style={{
          position: "relative",
          maxWidth: 1180,
          margin: "0 auto",
          padding: "16px 16px 40px",
        }}
      >
        <header style={{ textAlign: "center", padding: "20px 0 12px" }}>
          <h1
            style={{
              fontFamily: "'Audiowide', sans-serif",
              fontSize: 28,
              color: deckAColor,
              letterSpacing: 6,
              margin: 0,
              textShadow: `0 0 30px ${deckAColor}55`,
            }}
          >
            WAVECRAFT
          </h1>
          <p
            style={{
              fontSize: 11,
              color: "#8892b0",
              letterSpacing: 4,
              marginTop: 4,
              textTransform: "uppercase",
            }}
          >
            Free Local DJ Mix Deck — No Subscriptions, No Limits
          </p>
        </header>

        <MasterBus
          masterVol={masterVol}
          onMasterVolChange={setMasterVol}
          deckAColor={deckAColor}
          deckBColor={deckBColor}
          onDeckAColorChange={setDeckAColor}
          onDeckBColorChange={setDeckBColor}
          isRecording={isRecording}
          onToggleRecord={onToggleRecord}
          recordSupported={recordSupported}
          recordStartedAt={recordStartedAt}
          recordTapMode={recordTapMode}
          onRecordTapModeChange={setRecordTapMode}
          markerCount={markerCount}
          onDropMarker={onDropMarker}
          clipAnalyserRef={clipAnalyserRef}
          onExportSettings={onExportSettings}
          onImportSettings={onImportSettings}
        />

        <div
          className="wc-deck-row"
          style={{ display: "flex", gap: 12, flexWrap: "wrap" }}
        >
          <Deck
            ref={deckARef}
            id="A"
            color={deckAColor}
            audioCtxRef={audioCtxRef}
            masterCompressorRef={masterCompressorRef}
            recordTapRef={recordTapRef}
            ensureMasterCtx={ensureMasterCtx}
            crossfadeGain={gainA}
            focused={focusedDeck === "A"}
            onFocus={focusA}
            onSync={() => onSyncDeck("A")}
            onKeyDetected={onKeyDetectedA}
          />

          <Crossfader
            value={crossfade}
            onChange={setCrossfade}
            isMobile={isMobile}
            curve={crossfadeCurve}
            onCurveChange={setCrossfadeCurve}
            deckAColor={deckAColor}
            deckBColor={deckBColor}
          />

          <Deck
            ref={deckBRef}
            id="B"
            color={deckBColor}
            audioCtxRef={audioCtxRef}
            masterCompressorRef={masterCompressorRef}
            recordTapRef={recordTapRef}
            ensureMasterCtx={ensureMasterCtx}
            crossfadeGain={gainB}
            focused={focusedDeck === "B"}
            onFocus={focusB}
            onSync={() => onSyncDeck("B")}
            onKeyDetected={onKeyDetectedB}
          />
        </div>

        <Crate
          entries={crate}
          onAdd={onCrateAdd}
          onRemove={onCrateRemove}
          onClear={onCrateClear}
          onLoadToDeck={onCrateLoadToDeck}
          deckAColor={deckAColor}
          deckBColor={deckBColor}
        />

        <Looper
          audioCtxRef={audioCtxRef}
          workletNodeRef={workletNodeRef}
          outputNodeRef={masterCompressorRef}
          recordTapRef={recordTapRef}
          workletReady={workletReady}
          effectiveBpmRef={effectiveBpmRef}
        />

        <SamplePad
          ref={samplePadRef}
          audioCtxRef={audioCtxRef}
          outputNodeRef={masterCompressorRef}
          recordTapRef={recordTapRef}
          ensureMasterCtx={ensureMasterCtx}
        />

        <TheoryPanel
          deckKeys={deckKeys}
          focusedDeck={focusedDeck}
          deckAColor={deckAColor}
          deckBColor={deckBColor}
        />

        <MidiPanel
          enabled={midiEnabled}
          onEnable={onEnableMidi}
          onDisable={onDisableMidi}
          mappings={midiMappings}
          inputNames={midiInputNames}
          learnTarget={learnTarget}
          onStartLearn={(id) => {
            // R17 Q1 — entering Learn for a new target clears any stale hint
            // from a prior target's note-rejection.
            setLearnHint("");
            setLearnTarget(id);
          }}
          onCancelLearn={() => {
            setLearnTarget(null);
            setLearnHint("");
          }}
          onClearMapping={onClearMidiMapping}
          onChangeMode={onChangeMidiMode}
          inputName={midiInputName}
          error={midiError}
          learnHint={learnHint}
        />

        <footer style={{ textAlign: "center", padding: "20px 0 8px" }}>
          <p style={{ fontSize: 10, color: "#8892b0", letterSpacing: 2 }}>
            100% FREE · 100% LOCAL · NO DATA LEAVES YOUR DEVICE · MAKE MUSIC, NOT
            PAYMENTS
          </p>
        </footer>
      </div>
    </div>
  );
}
