import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { enableMidi, mapCcToValue, MIDI_SUPPORTED } from "./midi/midiMap.js";
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
  // W1.5 — session crate. An in-memory list of decoded tracks: each entry is
  // { id, name, bpm, camelot, _buffer }. The decoded AudioBuffer is kept off
  // the rendered object (`crateBuffersRef`) so it never accidentally ends up
  // in serialized state. The crate is empty on every fresh load and is NEVER
  // persisted to disk / localStorage / IndexedDB.
  const [crate, setCrate] = useState([]);

  // ── Refs ──
  const audioCtxRef = useRef(null);
  const masterCompressorRef = useRef(null);
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
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -6;
      comp.knee.value = 4;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.05;
      const gain = ctx.createGain();
      gain.gain.value = masterVolRef.current;
      comp.connect(gain);
      gain.connect(ctx.destination);
      masterCompressorRef.current = comp;
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
        try {
          await ctx.audioWorklet.addModule("/worklets/looper-worklet.js");
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

  const applyMidiTarget = useCallback((targetId, cc127) => {
    const val = mapCcToValue(cc127, targetId);
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

  const onMidiCc = useCallback(
    (channel, cc, value, inputName) => {
      setMidiInputName(inputName || "");
      if (learnTargetRef.current) {
        const targetId = learnTargetRef.current;
        setMidiMappings((prev) => ({ ...prev, [targetId]: { channel, cc } }));
        learnTargetRef.current = null;
        setLearnTarget(null);
        return;
      }
      const map = mappingsRef.current;
      for (const [targetId, mapping] of Object.entries(map)) {
        if (mapping.channel === channel && mapping.cc === cc) {
          applyMidiTarget(targetId, value);
        }
      }
    },
    [applyMidiTarget]
  );

  const onEnableMidi = async () => {
    if (!MIDI_SUPPORTED) {
      setMidiError("Web MIDI not supported.");
      return;
    }
    try {
      await ensureMasterCtx();
      const unsub = await enableMidi(onMidiCc);
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
    setMidiInputName("");
  };

  const onClearMidiMapping = (targetId) => {
    setMidiMappings((prev) => {
      const next = { ...prev };
      delete next[targetId];
      return next;
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
      crateBuffersRef.current.set(id, audioBuf);
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
  // method — hands over the already-decoded buffer (no re-decode).
  const onCrateLoadToDeck = useCallback((deckId, entryId) => {
    const buffer = crateBuffersRef.current.get(entryId);
    if (!buffer) return;
    const entry = crate.find((e) => e.id === entryId);
    const deckRef = deckId === "A" ? deckARef : deckBRef;
    deckRef.current?.loadBuffer?.(buffer, entry?.name || "crate track");
  }, [crate]);

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
      try { masterGainRef.current?.disconnect(); } catch {}
      try { audioCtxRef.current?.close(); } catch {}
      audioCtxRef.current = null;
      masterCompressorRef.current = null;
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
          learnTarget={learnTarget}
          onStartLearn={setLearnTarget}
          onCancelLearn={() => setLearnTarget(null)}
          onClearMapping={onClearMidiMapping}
          inputName={midiInputName}
          error={midiError}
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
