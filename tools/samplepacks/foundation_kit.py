#!/usr/bin/env python3
"""WAVECRAFT Rave Foundation Kit — synthesized from scratch.

Every sound here is built the way the originals were: oscillators, noise,
filters and envelopes. Nothing is sampled from a recording. 44.1 kHz 16-bit
stereo WAVs; loops are bar-exact so they cycle seamlessly in a deck.
All tonal material is in A minor (Camelot 8A) so the whole kit inter-mixes.
"""
import numpy as np
from scipy import signal
import wave, os, math

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "pack")
os.makedirs(OUT, exist_ok=True)

# ── infrastructure ─────────────────────────────────────────────────────────

def t_axis(n):
    return np.arange(n) / SR

def sec(x):
    return int(round(x * SR))

def bar_len(bpm, bars):
    return int(round(bars * 4 * 60 / bpm * SR))

def norm(x, peak_db=-1.0):
    p = np.max(np.abs(x))
    if p == 0:
        return x
    return x * (10 ** (peak_db / 20) / p)

def to_stereo(x):
    if x.ndim == 1:
        return np.stack([x, x], axis=1)
    return x

def write_wav(name, x, peak_db=-1.0):
    x = to_stereo(norm(np.asarray(x, dtype=np.float64), peak_db))
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    path = os.path.join(OUT, name)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"  {name:44s} {len(x)/SR:6.2f}s")

def env_exp(n, tau):
    return np.exp(-t_axis(n) / tau)

def env_adsr(n, a, d, s_level, r, sustain_until=None):
    """Linear A, exp D to sustain, exp R from sustain_until (seconds)."""
    out = np.zeros(n)
    t = t_axis(n)
    a_n = max(1, sec(a))
    out[:a_n] = np.linspace(0, 1, a_n)
    rest = n - a_n
    if rest <= 0:
        return out
    dec = s_level + (1 - s_level) * np.exp(-(t[:rest]) / max(d, 1e-4))
    out[a_n:] = dec
    if sustain_until is not None:
        r0 = sec(sustain_until)
        if r0 < n:
            out[r0:] *= np.exp(-(t[: n - r0]) / max(r, 1e-4))
    return out

def saw(freq, n, phase=0.0):
    """Polyblep-free saw is fine here — we always lowpass afterwards."""
    if np.isscalar(freq):
        ph = phase + np.cumsum(np.full(n, freq)) / SR
    else:
        ph = phase + np.cumsum(freq) / SR
    return 2 * (ph % 1) - 1

def square(freq, n, duty=0.5):
    ph = np.cumsum(np.full(n, freq)) / SR
    return np.where((ph % 1) < duty, 1.0, -1.0)

def noise(n, seed):
    return np.random.default_rng(seed).standard_normal(n)

def butter(x, kind, freq, order=4):
    sos = signal.butter(order, np.clip(freq, 20, SR / 2 - 100), kind, fs=SR, output="sos")
    return signal.sosfilt(sos, x)

def swept_lp(x, cutoff, q=8.0, chunk=32):
    """Resonant lowpass with per-chunk time-varying cutoff (the 303 trick)."""
    out = np.empty_like(x)
    zi = np.zeros(2)
    for i in range(0, len(x), chunk):
        fc = float(np.clip(cutoff[min(i, len(cutoff) - 1)], 40, 16000))
        w0 = 2 * math.pi * fc / SR
        alpha = math.sin(w0) / (2 * q)
        cw = math.cos(w0)
        b = np.array([(1 - cw) / 2, 1 - cw, (1 - cw) / 2])
        a = np.array([1 + alpha, -2 * cw, 1 - alpha])
        b, a = b / a[0], a / a[0]
        out[i : i + chunk], zi = signal.lfilter(b, a, x[i : i + chunk], zi=zi)
    return out

def drive(x, amount):
    return np.tanh(x * amount) / np.tanh(amount)

def synth_ir(seconds=1.2, seed=7, bright=0.4):
    """Exponentially decaying noise IR — same recipe the app's reverb uses."""
    n = sec(seconds)
    ir = noise(n, seed) * env_exp(n, seconds / 5)
    ir = butter(ir, "low", 2000 + bright * 8000, 2)
    return ir / np.max(np.abs(ir))

def reverb(x, mix=0.25, seconds=1.2, seed=7, bright=0.4):
    wet = signal.fftconvolve(x, synth_ir(seconds, seed, bright))[: len(x)]
    return (1 - mix) * x + mix * norm(wet, 0)

def duck_env(n, bpm, depth=0.7, recover=0.28):
    """Sidechain pump: dip on every beat, exponential recovery."""
    beat = int(round(60 / bpm * SR))
    e = np.ones(n)
    for b in range(0, n, beat):
        seg = min(sec(recover), n - b)
        e[b : b + seg] = 1 - depth * np.exp(-t_axis(seg) / (recover / 4))
    return e

def place(canvas, snd, at_samp, gain=1.0, pan=0.0):
    """Mix a mono sound into a stereo canvas at a sample offset."""
    end = min(at_samp + len(snd), canvas.shape[0])
    seg = snd[: end - at_samp]
    l, r = math.cos((pan + 1) * math.pi / 4), math.sin((pan + 1) * math.pi / 4)
    canvas[at_samp:end, 0] += seg * gain * l * 1.414
    canvas[at_samp:end, 1] += seg * gain * r * 1.414

NOTE = {n: 440 * 2 ** ((i - 9) / 12) for i, n in enumerate(
    ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"])}

def hz(name, octave):
    return NOTE[name] * 2 ** (octave - 4)

# ── one-shot drums ─────────────────────────────────────────────────────────

def kick_909(length=0.35, f_hi=170, f_lo=52, sweep=0.045, punch=1.0):
    n = sec(length)
    t = t_axis(n)
    f = f_lo + (f_hi - f_lo) * np.exp(-t / sweep)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(n, length / 4)
    click = butter(noise(n, 1) * env_exp(n, 0.004), "high", 3000, 2) * 0.5 * punch
    return drive(body + click, 1.8)

def kick_808(length=1.1):
    n = sec(length)
    t = t_axis(n)
    f = 38 + 70 * np.exp(-t / 0.03)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(n, length / 3.2)
    return drive(body, 1.4)

def kick_hardstyle(length=0.42):
    n = sec(length)
    t = t_axis(n)
    f = 55 + 240 * np.exp(-t / 0.02)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR)
    dist = drive(body, 14)  # the screamy mid "toc" comes from brutal drive
    mid = butter(dist, "high", 350, 2) * 0.7
    low = butter(dist, "low", 200, 2)
    return (low + mid) * env_exp(n, length / 2.6)

def clap_909():
    n = sec(0.45)
    burst = butter(noise(n, 3), "band", [900, 4500], 2)
    out = np.zeros(n)
    for i, d in enumerate([0, 0.011, 0.023, 0.031]):
        s = sec(d)
        out[s:] += burst[: n - s] * env_exp(n - s, 0.006) * (0.8 + 0.2 * (i == 3))
    out += burst * env_exp(n, 0.09) * 0.5  # body tail
    return reverb(out, 0.18, 0.5, seed=11, bright=0.6)

def snare_909():
    n = sec(0.22)
    tone = np.sin(2 * np.pi * 185 * t_axis(n)) * env_exp(n, 0.05)
    hiss = butter(noise(n, 4), "high", 1800, 2) * env_exp(n, 0.06)
    return drive(tone * 0.6 + hiss, 1.5)

def hat(closed=True, seed=5):
    n = sec(0.07 if closed else 0.45)
    metal = sum(square(f, n) for f in [5623, 6748, 8133, 9273, 10743]) / 5
    x = butter(metal * 0.6 + noise(n, seed) * 0.6, "high", 7500, 4)
    return x * env_exp(n, 0.012 if closed else 0.11)

# ── one-shot synths / FX ───────────────────────────────────────────────────

def hoover(root=hz("A", 2), length=0.9):
    """The Alpha-Juno 'mentasm' stab — detuned saws swooping down an octave."""
    n = sec(length)
    t = t_axis(n)
    bend = 2 ** (np.maximum(0, 1 - t / 0.14))  # octave fall in 140 ms
    out = np.zeros(n)
    for cents in [-31, -18, -6, 0, 7, 19, 33]:
        f = root * bend * 2 ** (cents / 1200)
        out += saw(f, n, phase=cents)
    for mult, g in [(0.5, 0.7)]:  # sub octave
        out += square(root * mult, n) * g
    out = butter(out / 8, "low", 3800, 2)
    # chorus: two modulated delay taps
    lfo = (np.sin(2 * np.pi * 0.9 * t) * 0.004 + 0.006) * SR
    idx = np.clip(np.arange(n) - lfo.astype(int), 0, n - 1)
    out = out + 0.6 * out[idx]
    return drive(out, 2.2) * env_adsr(n, 0.004, 0.5, 0.7, 0.12, length * 0.72)

def supersaw_chord(freqs, n, spread=12, voices=7, seed=21):
    out_l, out_r = np.zeros(n), np.zeros(n)
    rng = np.random.default_rng(seed)
    for f0 in freqs:
        for v in range(voices):
            cents = (v - voices // 2) * spread / (voices // 2 or 1)
            f = f0 * 2 ** (cents / 1200)
            ph = rng.random()
            s = saw(f, n, phase=ph)
            if v % 2:
                out_l += s
            else:
                out_r += s
    st = np.stack([out_l, out_r], 1) / (len(freqs) * voices / 1.6)
    st = np.stack([butter(st[:, 0], "high", 140, 2), butter(st[:, 1], "high", 140, 2)], 1)
    return st

def organ_stab(freqs, length=0.5):
    """M1-ish house chord stab: bright additive partials, percussive env."""
    n = sec(length)
    out = np.zeros(n)
    for f0 in freqs:
        for mult, g in [(1, 1), (2, 0.5), (3, 0.22), (4, 0.12)]:
            out += np.sin(2 * np.pi * f0 * mult * t_axis(n) + 0.1 * mult) * g
    out /= len(freqs) * 1.8
    return drive(out, 1.6) * env_adsr(n, 0.002, 0.3, 0.35, 0.06, length * 0.6)

def laser_zap(length=0.4):
    n = sec(length)
    f = 4000 * np.exp(-t_axis(n) / 0.07) + 120
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(n, 0.09)

def impact_boom(length=2.2):
    n = sec(length)
    thump = np.sin(2 * np.pi * np.cumsum(30 + 90 * env_exp(n, 0.02)) / SR) * env_exp(n, 0.5)
    air = butter(noise(n, 9), "low", 900, 2) * env_exp(n, 0.35)
    return reverb(drive(thump + 0.4 * air, 2.0), 0.35, 2.0, seed=13, bright=0.2)

def downlifter(length=1.8):
    n = sec(length)
    f = 900 * np.exp(-t_axis(n) / 0.7) + 60
    tone = saw(f, n) * 0.5
    wash = butter(noise(n, 15), "band", [400, 6000], 2)
    x = (tone + wash) * env_adsr(n, 0.01, 1.2, 0.4, 0.3, length * 0.7)
    return reverb(x, 0.3, 1.4, seed=17)

# ── loop builders ──────────────────────────────────────────────────────────

def canvas(bpm, bars):
    return np.zeros((bar_len(bpm, bars), 2))

def steps(bpm, bars, per_beat=4, swing=0.0):
    """Yield (index, sample_pos) for a 16th grid with optional swing."""
    step = 60 / bpm / per_beat
    total = bars * 4 * per_beat
    for i in range(total):
        t = i * step
        if swing and i % 2 == 1:
            t += swing * step
        yield i, sec(t)

def acid_303(bpm, bars, pattern, seed=33):
    """TB-303: single saw, slides, accents, resonant envelope-swept lowpass."""
    n = bar_len(bpm, bars)
    step_len = n // (bars * 16)
    freq = np.zeros(n)
    accent = np.zeros(n)
    gate = np.zeros(n)
    cur = hz("A", 1)
    for i in range(bars * 16):
        note, acc, slide, on = pattern[i % len(pattern)]
        s, e = i * step_len, (i + 1) * step_len
        if on:
            target = note
            if slide:
                freq[s:e] = np.linspace(cur, target, e - s)
            else:
                freq[s:e] = target
            gate[s : e - step_len // 8] = 1
            accent[s:e] = 1.0 if acc else 0.0
            cur = target
        else:
            freq[s:e] = cur
    osc = saw(freq, n)
    envs = np.zeros(n)
    for i in range(bars * 16):
        s = i * step_len
        seg = min(step_len * 2, n - s)
        if gate[s]:
            a = 1.0 + 2.2 * accent[s]
            envs[s : s + seg] = np.maximum(envs[s : s + seg], a * env_exp(seg, 0.09))
    cutoff = 260 + envs * 2400
    x = swept_lp(osc * gate, cutoff, q=9.0)
    return drive(x, 3.2)

def build_house(bpm=124, bars=8):
    c = canvas(bpm, bars)
    k, cl, hc, ho = kick_909(), clap_909(), hat(True), hat(False)
    bass_note = organ = None
    for i, s in steps(bpm, bars, 4, swing=0.12):
        beat16 = i % 16
        if beat16 % 4 == 0:
            place(c, k, s, 1.0)
        if beat16 % 8 == 4:
            place(c, cl, s, 0.75)
        if beat16 % 4 == 2:
            place(c, ho, s, 0.5)
        else:
            place(c, hc, s, 0.32 if beat16 % 2 else 0.42, pan=0.25 if beat16 % 4 else -0.15)
    # offbeat bass (A1) — the "boots-n-cats" pump
    bn = sec(60 / bpm * 0.45)
    b = drive(np.sin(2 * np.pi * hz("A", 1) * t_axis(bn)) + 0.3 * np.sin(2 * np.pi * hz("A", 2) * t_axis(bn)), 1.6) * env_adsr(bn, 0.004, 0.3, 0.6, 0.05, 0.35)
    for i, s in steps(bpm, bars, 2):
        if i % 2 == 1:
            place(c, b, s, 0.8)
    # sparse organ stab on the 2-and of every second bar
    st = organ_stab([hz("A", 3), hz("C", 4), hz("E", 4)], 0.4)
    for i, s in steps(bpm, bars, 4):
        if i % 32 == 22:
            place(c, st, s, 0.5, pan=0.3)
    return c

def build_techno(bpm=132, bars=8):
    c = canvas(bpm, bars)
    k = kick_909(punch=1.3)
    # rumble: the kick smeared through reverb, lowpassed, sidechained
    rum = butter(reverb(k, 0.95, 0.8, seed=19, bright=0.1), "low", 150, 4)
    hc = hat(True, seed=23)
    for i, s in steps(bpm, bars, 4):
        if i % 4 == 0:
            place(c, k, s, 1.0)
            place(c, rum, s + sec(0.02), 1.3)
        if i % 2 == 1:
            place(c, hc, s, 0.35, pan=0.2 if i % 4 == 1 else -0.2)
    cl = clap_909()
    for i, s in steps(bpm, bars, 4):
        if i % 16 == 8:
            place(c, cl, s, 0.4)
    dark = organ_stab([hz("A", 2), hz("E", 3)], 0.25)
    for i, s in steps(bpm, bars, 4):
        if i % 16 in (7, 15):
            place(c, dark, s, 0.4, pan=-0.3)
    c *= duck_env(len(c), bpm, 0.35, 0.2)[:, None]
    return c

def build_acid(bpm=130, bars=8):
    A1, C2, E2, G2, A2 = hz("A", 1), hz("C", 2), hz("E", 2), hz("G", 2), hz("A", 2)
    patt = [
        (A1, 1, 0, 1), (A1, 0, 0, 1), (A2, 0, 1, 1), (A1, 0, 0, 1),
        (C2, 1, 0, 1), (A1, 0, 0, 1), (E2, 0, 1, 1), (G2, 0, 0, 1),
        (A1, 1, 0, 1), (A2, 0, 1, 1), (A1, 0, 0, 1), (E2, 0, 0, 1),
        (C2, 0, 0, 1), (C2, 1, 1, 1), (A1, 0, 0, 1), (G2, 0, 1, 1),
    ]
    line = acid_303(bpm, bars, patt)
    c = canvas(bpm, bars)
    c[:, 0] = line
    c[:, 1] = line
    k = kick_909()
    for i, s in steps(bpm, bars, 4):
        if i % 4 == 0:
            place(c, k, s, 0.95)
    c *= duck_env(len(c), bpm, 0.3, 0.22)[:, None]
    return c

def build_trance(bpm=138, bars=8):
    n = bar_len(bpm, bars)
    c = np.zeros((n, 2))
    prog = [["A", "C", "E"], ["F", "A", "C"], ["C", "E", "G"], ["G", "B", "D"]]
    two_bars = bar_len(bpm, 2)
    for ci, chord in enumerate(prog):
        freqs = [hz(p, 3 + (1 if p in ("C", "D") and pi else 0)) for pi, p in enumerate(chord)]
        seg = supersaw_chord(freqs, two_bars)
        s = ci * two_bars
        c[s : s + two_bars] += seg * 0.8
    # rolling 16th bass, offbeat emphasis
    bn = sec(60 / bpm / 4 * 0.9)
    root = drive(np.sin(2 * np.pi * hz("A", 1) * t_axis(bn)), 1.5) * env_exp(bn, 0.05)
    for i, s in steps(bpm, bars, 4):
        if i % 4 != 0:
            place(c, root, s, 0.85)
    k = kick_909(f_hi=200, punch=1.1)
    for i, s in steps(bpm, bars, 4):
        if i % 4 == 0:
            place(c, k, s, 1.0)
    c *= duck_env(n, bpm, 0.55, 0.3)[:, None]
    return c

def build_dnb(bpm=174, bars=8):
    c = canvas(bpm, bars)
    k = kick_909(length=0.2, f_hi=190, f_lo=55)
    sn = snare_909()
    hc = hat(True, seed=29)
    for i, s in steps(bpm, bars, 4):
        b = i % 16
        if b in (0, 10):
            place(c, k, s, 1.0)
        if b in (4, 12):
            place(c, sn, s, 0.9)
        if b in (7, 14):
            place(c, sn, s, 0.25)  # ghosts
        if b % 2 == 0:
            place(c, hc, s, 0.3, pan=0.2 if b % 4 else -0.2)
    # Reese bass: two detuned saws, slow phasing, lowpassed
    n = len(c)
    r = butter(saw(hz("A", 1) * 0.999, n) + saw(hz("A", 1) * 1.001, n), "low", 320, 4)
    r = drive(r, 2.5) * 0.5
    patt = np.ones(n)
    for i, s in steps(bpm, bars, 1):
        if i % 8 in (6, 7):
            patt[s : s + sec(60 / bpm)] = 0  # breathe every 2 bars
    c[:, 0] += r * patt * 0.55
    c[:, 1] += r * patt * 0.55
    return c

def build_dubstep(bpm=140, bars=8):
    n = bar_len(bpm, bars)
    c = np.zeros((n, 2))
    k = kick_909(length=0.3, f_hi=150)
    sn = snare_909()
    for i, s in steps(bpm, bars, 4):
        b = i % 32  # halftime: pattern spans 2 bars
        if b in (0, 20):
            place(c, k, s, 1.0)
        if b in (8, 24):
            place(c, sn, s, 1.0)
    # wobble: saw+square through LFO lowpass, rate changes per bar
    osc = drive(saw(hz("A", 1), n) * 0.6 + square(hz("A", 1) * 0.5, n) * 0.5, 2.0)
    rates = [1, 2, 2, 3, 1, 4, 2, 6]  # LFO cycles per beat, per bar
    lfo = np.zeros(n)
    bl = bar_len(bpm, 1)
    for bi, rate in enumerate(rates[:bars]):
        s = bi * bl
        tt = t_axis(min(bl, n - s))
        lfo[s : s + bl] = 0.5 - 0.5 * np.cos(2 * np.pi * rate * tt * bpm / 60)
    wob = swept_lp(osc, 180 + lfo * 2200, q=4.0)
    sub = np.sin(2 * np.pi * hz("A", 0) * t_axis(n)) * 0.5
    duck = duck_env(n, bpm / 2, 0.5, 0.35)
    c[:, 0] += (wob * 0.7 + sub) * duck
    c[:, 1] += (wob * 0.7 + sub) * duck
    return c

def build_hardstyle(bpm=150, bars=8):
    c = canvas(bpm, bars)
    k = kick_hardstyle()
    for i, s in steps(bpm, bars, 4):
        if i % 4 == 0:
            place(c, k, s, 1.0)
    hv = hoover(hz("A", 2), 0.35)
    for i, s in steps(bpm, bars, 4):
        if i % 4 == 2:
            place(c, hv, s, 0.45)
    return c

def build_snare_build(bpm=128, bars=8):
    c = canvas(bpm, bars)
    sn = snare_909()
    n = len(c)
    # roll density doubles every 2 bars: 1/4 → 1/8 → 1/16 → 1/32
    for phase, per_beat in enumerate([1, 2, 4, 8]):
        start_bar = phase * 2
        for i, s in steps(bpm, 2, per_beat):
            pos = bar_len(bpm, start_bar) + s
            if pos < n:
                g = 0.5 + 0.5 * (phase / 3) * (i / (2 * 4 * per_beat))
                place(c, sn, pos, g * 0.9)
    # rising noise + pitch riser underneath
    t = t_axis(n)
    # rising-lowpass on noise = the classic sweep-up (brightens as it opens)
    sweep = swept_lp(noise(n, 41), 400 + 9000 * (t / t[-1]) ** 2, q=0.8, chunk=256) * (t / t[-1]) ** 1.5
    f = hz("A", 2) * 2 ** (2 * (t / t[-1]))
    ris = saw(f, n) * (t / t[-1]) ** 2 * 0.4
    c[:, 0] += (sweep * 0.5 + ris)
    c[:, 1] += (sweep * 0.5 + ris)
    return c

def build_riser(bpm=128, bars=8):
    n = bar_len(bpm, bars)
    t = t_axis(n)
    x = t / t[-1]
    wash = swept_lp(noise(n, 43), 300 + 11000 * x**2, q=0.8, chunk=256) * x**1.6
    f = hz("A", 1) * 2 ** (3 * x)
    tone = (saw(f, n) + saw(f * 1.007, n)) * x**2 * 0.4
    out = np.stack([wash * 0.6 + tone, wash * 0.6 + tone], 1)
    return reverb(out[:, 0], 0.25, 1.5, seed=47)[:, None] * [1, 1]

def build_sub_drone(bars=4, bpm=124):
    n = bar_len(bpm, bars)
    x = np.sin(2 * np.pi * hz("A", 0) * t_axis(n)) + 0.4 * np.sin(2 * np.pi * hz("A", 1) * t_axis(n))
    fade = min(sec(0.02), n // 4)
    x[:fade] *= np.linspace(0, 1, fade)
    x[-fade:] *= np.linspace(1, 0, fade)
    return drive(x, 1.3)

# ── render everything ──────────────────────────────────────────────────────
print("one-shots:")
write_wav("oneshot_kick_909_punch.wav", kick_909())
write_wav("oneshot_kick_808_sub.wav", kick_808())
write_wav("oneshot_kick_hardstyle.wav", kick_hardstyle())
write_wav("oneshot_clap_909.wav", clap_909())
write_wav("oneshot_snare_909.wav", snare_909())
write_wav("oneshot_hat_closed_909.wav", hat(True))
write_wav("oneshot_hat_open_909.wav", hat(False))
write_wav("oneshot_stab_hoover_Am.wav", hoover())
write_wav("oneshot_stab_house_organ_Am.wav", organ_stab([hz("A", 3), hz("C", 4), hz("E", 4)], 0.6))
write_wav("oneshot_fx_laser_zap.wav", laser_zap())
write_wav("oneshot_fx_impact_boom.wav", impact_boom())
write_wav("oneshot_fx_downlifter.wav", downlifter())

print("loops (bar-exact, seamless):")
write_wav("loop_house_groove_124bpm_Am_8bar.wav", build_house())
write_wav("loop_techno_rumble_132bpm_Am_8bar.wav", build_techno())
write_wav("loop_acid_303_130bpm_Am_8bar.wav", build_acid())
write_wav("loop_trance_supersaw_138bpm_Am_8bar.wav", build_trance())
write_wav("loop_dnb_break_174bpm_Am_8bar.wav", build_dnb())
write_wav("loop_dubstep_wobble_140bpm_Am_8bar.wav", build_dubstep())
write_wav("loop_hardstyle_150bpm_Am_8bar.wav", build_hardstyle())
write_wav("loop_snare_build_128bpm_8bar.wav", build_snare_build())
write_wav("loop_fx_riser_128bpm_8bar.wav", build_riser())
write_wav("loop_sub_drone_A_124bpm_4bar.wav", build_sub_drone())
print("done")
