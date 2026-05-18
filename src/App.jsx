import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useMatchMedia from "./hooks/useMatchMedia.js";
import Deck from "./components/Deck.jsx";
import Crossfader from "./components/Crossfader.jsx";
import MasterBus from "./components/MasterBus.jsx";
import TheoryPanel from "./components/TheoryPanel.jsx";
import Looper from "./components/Looper.jsx";
import SamplePad from "./components/SamplePad.jsx";
import MidiPanel from "./components/MidiPanel.jsx";
import { crossfadeGains } from "./audio/crossfade.js";
import {
  createMasterRecorder,
  downloadBlob,
  extensionForMime,
} from "./audio/recorder.js";
import { enableMidi, mapCcToValue, MIDI_SUPPORTED } from "./midi/midiMap.js";
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
  const [isRecording, setIsRecording] = useState(false);
  const [recordStartedAt, setRecordStartedAt] = useState(null);
  const [recordSupported, setRecordSupported] = useState(true);
  const [workletReady, setWorkletReady] = useState(false);
  const [midiEnabled, setMidiEnabled] = useState(false);
  const [midiError, setMidiError] = useState("");
  const [midiInputName, setMidiInputName] = useState("");
  const [midiMappings, setMidiMappings] = useState({});
  const [learnTarget, setLearnTarget] = useState(null);

  // ── Refs ──
  const audioCtxRef = useRef(null);
  const masterCompressorRef = useRef(null);
  const masterGainRef = useRef(null);
  const workletNodeRef = useRef(null);
  const recorderRef = useRef(null);
  const midiUnsubRef = useRef(null);
  const deckARef = useRef(null);
  const deckBRef = useRef(null);
  const samplePadRef = useRef(null);
  const focusedRef = useRef(null);
  const effectiveBpmRef = useRef(128);
  const mappingsRef = useRef({});
  const learnTargetRef = useRef(null);
  const masterVolRef = useRef(0.85);
  const workletLoadingRef = useRef(null);
  const recordTogglingRef = useRef(false);
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
        if (blob && blob.size > 0) {
          const ext = extensionForMime(mime);
          const ts = new Date()
            .toISOString()
            .replace(/[:.]/g, "-")
            .replace("T", "_")
            .slice(0, 19);
          downloadBlob(blob, `wavecraft-mix-${ts}.${ext}`);
        }
        return;
      }
      const ctx = await ensureMasterCtx();
      // Bail if the component unmounted during the await — otherwise the
      // recorder + MediaStreamDestination tap below would leak.
      if (!mountedRef.current) return;
      if (!ctx || !masterCompressorRef.current) return;
      const rec = createMasterRecorder(ctx, masterCompressorRef.current);
      if (!rec) {
        setRecordSupported(false);
        return;
      }
      recorderRef.current = rec;
      rec.start();
      setIsRecording(true);
      setRecordStartedAt(Date.now());
    } finally {
      recordTogglingRef.current = false;
    }
  }, [isRecording, ensureMasterCtx]);

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

  // ── Cleanup ──
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      midiUnsubRef.current?.();
      recorderRef.current?.dispose?.();
      recorderRef.current = null;
      try { workletNodeRef.current?.disconnect(); } catch {}
      workletNodeRef.current = null;
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
            ensureMasterCtx={ensureMasterCtx}
            crossfadeGain={gainA}
            focused={focusedDeck === "A"}
            onFocus={focusA}
            onSync={() => onSyncDeck("A")}
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
            ensureMasterCtx={ensureMasterCtx}
            crossfadeGain={gainB}
            focused={focusedDeck === "B"}
            onFocus={focusB}
            onSync={() => onSyncDeck("B")}
          />
        </div>

        <Looper
          audioCtxRef={audioCtxRef}
          workletNodeRef={workletNodeRef}
          outputNodeRef={masterCompressorRef}
          workletReady={workletReady}
          effectiveBpmRef={effectiveBpmRef}
        />

        <SamplePad
          ref={samplePadRef}
          audioCtxRef={audioCtxRef}
          outputNodeRef={masterCompressorRef}
          ensureMasterCtx={ensureMasterCtx}
        />

        <TheoryPanel />

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
