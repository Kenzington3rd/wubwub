#!/usr/bin/env python3
"""WAVECRAFT Club Collection Vol. 2 — twelve structured mini-tracks.

Engine upgrades over the Foundation Kit:
  * polyBLEP band-limited saw/square (no digital aliasing grit on leads/pads)
  * every track loudness-matched to the same RMS target, then peak-limited
  * Haas-widened pads, velocity-programmed hats, per-genre swing
  * DJ-friendly arrangement: beat-only intro/outro for mixing in and out,
    build, drop, breakdown, second drop — all on exact bar boundaries
  * keys spread around the Camelot wheel for harmonic-mixing practice

Everything is synthesized from oscillators/noise/filters. FLAC (lossless).
"""
import numpy as np
from scipy import signal
import soundfile as sf
import os, math

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "vol2")
os.makedirs(OUT, exist_ok=True)
RMS_TARGET_DB = -13.0  # master loudness target, then peak-limit to -1 dBFS


def t_axis(n):
    return np.arange(n) / SR

def sec(x):
    return int(round(x * SR))

def env_exp(n, tau):
    return np.exp(-t_axis(n) / tau)

def noise(n, seed):
    return np.random.default_rng(seed).standard_normal(n)

def butter(x, kind, freq, order=4):
    sos = signal.butter(order, np.clip(freq, 20, SR / 2 - 100), kind, fs=SR, output="sos")
    return signal.sosfilt(sos, x)

def drive(x, amount):
    return np.tanh(x * amount) / np.tanh(amount)

# ── band-limited oscillators (polyBLEP) ────────────────────────────────────

def _polyblep(ph, dt):
    dt = np.broadcast_to(np.asarray(dt), ph.shape)
    out = np.zeros_like(ph)
    m1 = ph < dt
    t1 = ph[m1] / dt[m1]
    out[m1] = 2 * t1 - t1 * t1 - 1
    m2 = ph > 1 - dt
    t2 = (ph[m2] - 1) / dt[m2]
    out[m2] = t2 * t2 + 2 * t2 + 1
    return out

def saw_bl(freq, n, phase=0.0):
    """polyBLEP sawtooth — clean top end even unfiltered."""
    f = np.full(n, freq) if np.isscalar(freq) else np.asarray(freq)
    dt = f / SR
    ph = (phase + np.cumsum(dt)) % 1
    return (2 * ph - 1) - _polyblep(ph, np.maximum(dt, 1e-6))

def square_bl(freq, n, phase=0.0):
    f = np.full(n, freq) if np.isscalar(freq) else np.asarray(freq)
    dt = np.maximum(f / SR, 1e-6)
    ph = (phase + np.cumsum(dt)) % 1
    sq = np.where(ph < 0.5, 1.0, -1.0)
    sq += _polyblep(ph, dt)
    sq -= _polyblep((ph + 0.5) % 1, dt)
    return sq

def sine(freq, n, phase=0.0):
    f = np.full(n, freq) if np.isscalar(freq) else np.asarray(freq)
    return np.sin(2 * np.pi * (phase + np.cumsum(f) / SR))

def swept_lp(x, cutoff, q=8.0, chunk=64):
    out = np.empty_like(x)
    zi = np.zeros(2)
    cutoff = np.asarray(cutoff)
    for i in range(0, len(x), chunk):
        fc = float(np.clip(cutoff[min(i, len(cutoff) - 1)], 40, 16000))
        w0 = 2 * math.pi * fc / SR
        alpha = math.sin(w0) / (2 * q)
        cw = math.cos(w0)
        b = np.array([(1 - cw) / 2, 1 - cw, (1 - cw) / 2])
        a = np.array([1 + alpha, -2 * cw, 1 - alpha])
        out[i : i + chunk], zi = signal.lfilter(b / a[0], a / a[0], x[i : i + chunk], zi=zi)
    return out

def synth_ir(seconds, seed, bright):
    n = sec(seconds)
    ir = noise(n, seed) * env_exp(n, seconds / 5)
    return butter(ir, "low", 2000 + bright * 8000, 2)

def reverb(x, mix, seconds=1.4, seed=7, bright=0.4):
    ir = synth_ir(seconds, seed, bright)
    ir /= np.max(np.abs(ir))
    wet = signal.fftconvolve(x, ir)[: len(x)]
    wet /= max(np.max(np.abs(wet)), 1e-9)
    return (1 - mix) * x + mix * wet * np.max(np.abs(x))

# ── music theory ───────────────────────────────────────────────────────────

NOTE = {n: 440 * 2 ** ((i - 9) / 12) for i, n in enumerate(
    ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"])}
NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

MINOR = [0, 2, 3, 5, 7, 8, 10]
MAJOR = [0, 2, 4, 5, 7, 9, 11]

def note_hz(semitone_from_c0):
    return NOTE["C"] * 2 ** ((semitone_from_c0 - 48) / 12)  # C4 ref

def scale_degrees(root_name, mode, octave):
    root = NAMES.index(root_name) + 12 * octave
    ivs = MINOR if mode == "minor" else MAJOR
    return [root + iv for iv in ivs]

def chord(root_name, mode, octave, degree, voicing=(0, 2, 4)):
    """Diatonic triad on scale degree (0-based), as semitone numbers."""
    sc = scale_degrees(root_name, mode, octave) + [
        s + 12 for s in scale_degrees(root_name, mode, octave)]
    return [sc[degree + v] for v in voicing]

# ── instruments ────────────────────────────────────────────────────────────

def kick(style="house", length=0.4):
    n = sec(length)
    t = t_axis(n)
    if style == "hard":
        f = 52 + 260 * np.exp(-t / 0.018)
        body = drive(sine(f, n), 13)
        out = butter(body, "low", 220, 2) + butter(body, "high", 400, 2) * 0.65
        return out * env_exp(n, length / 2.6)
    if style == "deep":
        f = 46 + 90 * np.exp(-t / 0.05)
        return drive(sine(f, n) * env_exp(n, length / 3), 1.5)
    f = 52 + 120 * np.exp(-t / 0.04)
    body = sine(f, n) * env_exp(n, length / 4)
    click = butter(noise(n, 1) * env_exp(n, 0.0035), "high", 3200, 2) * 0.45
    return drive(body + click, 1.9)

def hat(closed=True, seed=5, tone=7800):
    n = sec(0.06 if closed else 0.42)
    metal = sum(square_bl(f, n) for f in [5623, 6748, 8133, 9273, 10743]) / 5
    x = butter(metal * 0.55 + noise(n, seed) * 0.6, "high", tone, 4)
    return x * env_exp(n, 0.011 if closed else 0.1)

def clap(seed=3):
    n = sec(0.42)
    burst = butter(noise(n, seed), "band", [850, 4800], 2)
    out = np.zeros(n)
    for i, d in enumerate([0, 0.010, 0.021, 0.030]):
        s = sec(d)
        out[s:] += burst[: n - s] * env_exp(n - s, 0.0055) * (0.85 + 0.15 * (i == 3))
    out += burst * env_exp(n, 0.085) * 0.45
    return reverb(out, 0.15, 0.5, seed=11, bright=0.6)

def snare(seed=4):
    n = sec(0.2)
    tone = sine(180, n) * env_exp(n, 0.045)
    hiss = butter(noise(n, seed), "high", 1900, 2) * env_exp(n, 0.055)
    return drive(tone * 0.55 + hiss, 1.6)

def ride(seed=6):
    n = sec(0.5)
    x = butter(noise(n, seed), "high", 6000, 2)
    return x * env_exp(n, 0.18) * 0.7

def sub_note(semi, dur, glide_from=None):
    n = sec(dur)
    f0 = note_hz(semi)
    f = np.full(n, f0)
    if glide_from is not None:
        g = min(sec(0.05), n)
        f[:g] = np.linspace(note_hz(glide_from), f0, g)
    x = sine(f, n) + 0.25 * sine(2 * f, n)
    e = env_exp(n, dur / 2.2)
    a = min(sec(0.004), n)
    e[:a] *= np.linspace(0, 1, a)
    return drive(x * e, 1.5)

def pluck(semi, dur, bright=2600, res=2.0, seed=0):
    """Filtered-saw pluck — the workhorse for arps and melodic techno lines."""
    n = sec(dur)
    x = saw_bl(note_hz(semi), n, phase=0.13 * seed) + 0.4 * square_bl(note_hz(semi) * 0.5, n)
    cut = 220 + bright * env_exp(n, dur / 5)
    x = swept_lp(x, cut, q=res)
    e = env_exp(n, dur / 3.5)
    a = min(sec(0.002), n)
    e[:a] *= np.linspace(0, 1, a)
    return x * e

def supersaw(semis, n, spread=14, voices=7, seed=21, hp=150):
    out_l, out_r = np.zeros(n), np.zeros(n)
    rng = np.random.default_rng(seed)
    for s0 in semis:
        f0 = note_hz(s0)
        for v in range(voices):
            cents = (v - voices // 2) * spread / max(voices // 2, 1)
            sig = saw_bl(f0 * 2 ** (cents / 1200), n, phase=rng.random())
            (out_l if v % 2 else out_r)[:] += sig
    norm = len(semis) * voices / 1.7
    l = butter(out_l / norm, "high", hp, 2)
    r = butter(out_r / norm, "high", hp, 2)
    # Haas widen
    d = sec(0.011)
    r = np.concatenate([np.zeros(d), r[:-d]])
    return np.stack([l, r], 1)

def acid_line(bpm, bars, patt_fn, root_semi, q=9.0, drv=3.0, seed=33):
    n = bar_len(bpm, bars)
    step_len = n // (bars * 16)
    freq = np.zeros(n); gate = np.zeros(n); acc = np.zeros(n)
    cur = note_hz(root_semi)
    for i in range(bars * 16):
        semi_off, a, slide, on = patt_fn(i)
        s, e = i * step_len, (i + 1) * step_len
        if on:
            target = note_hz(root_semi + semi_off)
            freq[s:e] = np.linspace(cur, target, e - s) if slide else target
            gate[s : e - step_len // 8] = 1
            acc[s:e] = a
            cur = target
        else:
            freq[s:e] = cur
    osc = saw_bl(freq, n)
    envs = np.zeros(n)
    for i in range(bars * 16):
        s = i * step_len
        seg = min(step_len * 2, n - s)
        if gate[s]:
            envs[s : s + seg] = np.maximum(envs[s : s + seg],
                                           (1 + 2.2 * acc[s]) * env_exp(seg, 0.085))
    return drive(swept_lp(osc * gate, 240 + envs * 2600, q=q), drv)

def riser(bpm, bars, seed=43, root=45):
    n = bar_len(bpm, bars)
    x = t_axis(n) / (n / SR)
    wash = swept_lp(noise(n, seed), 300 + 11000 * x**2, q=0.8, chunk=256) * x**1.6
    tone = (saw_bl(note_hz(root) * 2 ** (2.5 * x), n)) * x**2 * 0.35
    return (wash * 0.6 + tone)

def impact(seed=13):
    n = sec(2.0)
    thump = sine(28 + 90 * env_exp(n, 0.02), n) * env_exp(n, 0.5)
    air = butter(noise(n, seed), "low", 800, 2) * env_exp(n, 0.3)
    return reverb(drive(thump + 0.4 * air, 2.0), 0.3, 1.8, seed=17, bright=0.2)

# ── arrangement engine ─────────────────────────────────────────────────────

def bar_len(bpm, bars):
    return int(round(bars * 4 * 60 / bpm * SR))

def steps(bpm, bars, per_beat=4, swing=0.0):
    step = 60 / bpm / per_beat
    for i in range(bars * 4 * per_beat):
        t = i * step
        if swing and i % 2 == 1:
            t += swing * step
        yield i, sec(t)

def place(cv, snd, at, gain=1.0, pan=0.0):
    if snd.ndim == 1:
        snd = np.stack([snd, snd], 1)
    end = min(at + len(snd), cv.shape[0])
    if end <= at:
        return
    seg = snd[: end - at]
    l = math.cos((pan + 1) * math.pi / 4) * 1.414
    r = math.sin((pan + 1) * math.pi / 4) * 1.414
    cv[at:end, 0] += seg[:, 0] * gain * l
    cv[at:end, 1] += seg[:, 1] * gain * r

def duck(n, bpm, depth, recover=0.3):
    beat = int(round(60 / bpm * SR))
    e = np.ones(n)
    for b in range(0, n, beat):
        seg = min(sec(recover), n - b)
        e[b : b + seg] = 1 - depth * np.exp(-t_axis(seg) / (recover / 4))
    return e

class Track:
    def __init__(self, bpm, bars):
        self.bpm = bpm
        self.canvas = np.zeros((bar_len(bpm, bars), 2))

    def at_bar(self, bar):
        return bar_len(self.bpm, bar)

    def span(self, bar, bars):
        return self.at_bar(bar), self.at_bar(bar + bars)

def master(x, bpm=None):
    x = np.stack([butter(x[:, 0], "high", 28, 2), butter(x[:, 1], "high", 28, 2)], 1)
    x = drive(x / max(np.max(np.abs(x)), 1e-9) * 1.2, 1.6)  # glue
    # Converge on the RMS target: limiting a hot signal raises its RMS, so
    # re-measure after each limit pass and trim until both constraints hold.
    lim = 10 ** (-1 / 20)
    for _ in range(4):
        rms = np.sqrt((x**2).mean())
        x = x * (10 ** (RMS_TARGET_DB / 20) / max(rms, 1e-9))
        peak = np.max(np.abs(x))
        if peak <= lim:
            break
        x = np.tanh(x / peak * 2.2) / np.tanh(2.2) * lim
    return x

def write(name, x):
    sf.write(os.path.join(OUT, name), np.clip(x, -1, 1), SR, subtype="PCM_16", format="FLAC")
    print(f"  {name:56s} {len(x)/SR:6.1f}s")

# ── generic groove layers (parameterized per genre) ────────────────────────

def lay_four_floor(tr, bar0, bars, style="house", gain=1.0):
    k = kick(style)
    base = tr.at_bar(bar0)
    for i, s in steps(tr.bpm, bars):
        if i % 4 == 0:
            place(tr.canvas, k, base + s, gain)

def lay_hats(tr, bar0, bars, swing=0.0, off_open=True, gain=0.4, seed=5):
    hc, ho = hat(True, seed), hat(False, seed + 1)
    base = tr.at_bar(bar0)
    vel = [1.0, 0.5, 0.75, 0.55]
    for i, s in steps(tr.bpm, bars, 4, swing):
        if off_open and i % 4 == 2:
            place(tr.canvas, ho, base + s, gain * 1.05)
        elif i % 2 == 1 or not off_open:
            place(tr.canvas, hc, base + s, gain * vel[i % 4],
                  pan=0.22 if i % 8 < 4 else -0.22)

def lay_clap(tr, bar0, bars, gain=0.7, seed=3):
    c = clap(seed)
    base = tr.at_bar(bar0)
    for i, s in steps(tr.bpm, bars):
        if i % 8 == 4:
            place(tr.canvas, c, base + s, gain)

def lay_offbeat_bass(tr, bar0, bars, semi, gain=0.85):
    b = sub_note(semi, 60 / tr.bpm * 0.42)
    base = tr.at_bar(bar0)
    for i, s in steps(tr.bpm, bars, 2):
        if i % 2 == 1:
            place(tr.canvas, b, base + s, gain)

def lay_rolling_bass(tr, bar0, bars, semi, gain=0.8):
    b = sub_note(semi, 60 / tr.bpm / 4 * 0.9)
    base = tr.at_bar(bar0)
    for i, s in steps(tr.bpm, bars):
        if i % 4 != 0:
            place(tr.canvas, b, base + s, gain)

def lay_bassline_pattern(tr, bar0, bars, semis, rhythm, gain=0.85):
    """semis cycles per bar; rhythm = 16th indices to hit."""
    base = tr.at_bar(bar0)
    note_dur = 60 / tr.bpm / 4 * 1.4
    for bar in range(bars):
        semi = semis[bar % len(semis)]
        for r in rhythm:
            s = bar_len(tr.bpm, bar) + int(r * bar_len(tr.bpm, 1) / 16)
            place(tr.canvas, sub_note(semi, note_dur), base + s, gain)

def lay_pad(tr, bar0, bars, prog, octave, gain=0.5, spread=14, hp=160,
            duck_depth=0.5, root="A", mode="minor", seed=21):
    n = bar_len(tr.bpm, bars)
    per = bars // len(prog)
    out = np.zeros((n, 2))
    for ci, deg in enumerate(prog):
        semis = chord(root, mode, octave, deg)
        seg_n = bar_len(tr.bpm, per)
        seg = supersaw(semis, seg_n, spread=spread, seed=seed + ci, hp=hp)
        fade = min(sec(0.01), seg_n)
        seg[:fade] *= np.linspace(0, 1, fade)[:, None]
        seg[-fade:] *= np.linspace(1, 0, fade)[:, None]
        s0 = min(ci * seg_n, n)
        e0 = min(s0 + seg_n, n)
        out[s0:e0] = seg[: e0 - s0]
    out *= duck(n, tr.bpm, duck_depth)[:, None]
    place(tr.canvas, out * gain, tr.at_bar(bar0))

def lay_arp(tr, bar0, bars, prog, octave, gain=0.5, rate=4, bright=3200,
            root="A", mode="minor", pattern=(0, 1, 2, 1)):
    base = tr.at_bar(bar0)
    per = bars // len(prog)
    dur = 60 / tr.bpm / rate * 1.6
    for ci, deg in enumerate(prog):
        semis = chord(root, mode, octave, deg)
        for i, s in steps(tr.bpm, per, rate):
            semi = semis[pattern[i % len(pattern)] % len(semis)]
            place(tr.canvas, pluck(semi, dur, bright=bright, seed=i),
                  base + bar_len(tr.bpm, ci * per) + s, gain * (0.8 + 0.2 * (i % 4 == 0)),
                  pan=0.25 * math.sin(i * 0.9))

def lay_riser_into(tr, drop_bar, bars, gain=0.5, seed=47):
    r = riser(tr.bpm, bars, seed=seed)
    place(tr.canvas, r, tr.at_bar(drop_bar - bars), gain)

def lay_impact(tr, bar, gain=0.8):
    place(tr.canvas, impact(), tr.at_bar(bar), gain)

def lay_snare_roll(tr, drop_bar, bars=4, gain=0.55):
    sn = snare()
    base = tr.at_bar(drop_bar - bars)
    for phase, per_beat in enumerate([2, 4] if bars == 2 else [1, 2, 4, 8][:bars]):
        for i, s in steps(tr.bpm, 1, per_beat):
            pos = base + bar_len(tr.bpm, phase) + s
            place(tr.canvas, sn, pos, gain * (0.5 + 0.5 * phase / max(bars - 1, 1)))

# ── the twelve tracks ──────────────────────────────────────────────────────
# name, bpm, root, mode, camelot, builder

def build_deep_house(tr, root, mode):
    prog = [0, 3, 4, 3]  # i–iv–v–iv flavour
    lay_four_floor(tr, 0, 64, "deep")
    lay_hats(tr, 0, 64, swing=0.14, gain=0.34, seed=8)
    lay_clap(tr, 8, 48, gain=0.5)
    lay_offbeat_bass(tr, 4, 56, semi=scale_degrees(root, mode, 1)[0])
    lay_pad(tr, 16, 32, prog, 3, gain=0.4, spread=9, duck_depth=0.45,
            root=root, mode=mode, hp=200)
    lay_arp(tr, 24, 24, prog[:2] * 2, 4, gain=0.3, rate=2, bright=1800,
            root=root, mode=mode)
    lay_riser_into(tr, 16, 4, 0.25)

def build_classic_house(tr, root, mode):
    # Tonic-weighted progression + a root anchor each bar: the tonal centre
    # must survive blind key detection, not just be implied.
    prog = [0, 0, 3, 4]
    lay_four_floor(tr, 0, 64, "house")
    lay_hats(tr, 0, 64, swing=0.12, gain=0.42)
    lay_clap(tr, 4, 56, gain=0.7)
    lay_offbeat_bass(tr, 4, 56, semi=scale_degrees(root, mode, 1)[0])
    # M1-organ style stabs on the drops
    for bar0, bars in [(16, 16), (40, 16)]:
        base = tr.at_bar(bar0)
        for i, s in steps(tr.bpm, bars):
            if i % 8 == 6:
                semis = chord(root, mode, 3, [0, 0, 3, 4][(i // 16) % 4])
                st = sum(pluck(sm, 0.35, bright=4200, res=1.2) for sm in semis) / 3
                place(tr.canvas, st, base + s, 0.5, pan=0.3 if i % 32 < 16 else -0.3)
            if i % 16 == 0:
                anchor = pluck(scale_degrees(root, mode, 2)[0], 0.5, bright=1500, res=1.0)
                place(tr.canvas, anchor, base + s, 0.4)
    lay_snare_roll(tr, 40, 2)

def build_peak_techno(tr, root, mode):
    lay_four_floor(tr, 0, 64, "house", gain=1.05)
    lay_hats(tr, 0, 64, gain=0.36, off_open=True, seed=23)
    r_semi = scale_degrees(root, mode, 1)[0]
    lay_bassline_pattern(tr, 8, 48, [r_semi], rhythm=[2, 6, 7, 10, 14], gain=0.7)
    # dark stab
    for bar0, bars in [(16, 16), (40, 16)]:
        base = tr.at_bar(bar0)
        for i, s in steps(tr.bpm, bars):
            if i % 16 in (7, 15):
                semis = chord(root, mode, 2, 0, voicing=(0, 2, 4))
                st = sum(pluck(sm, 0.25, bright=2400, res=3.5) for sm in semis) / 2
                place(tr.canvas, st, base + s, 0.5, pan=-0.25)
    # low root drone through the drops pins the tonic
    for bar0, bars in [(16, 16), (40, 16)]:
        nn = bar_len(tr.bpm, bars)
        r2 = scale_degrees(root, mode, 2)[0]
        # root + minor third: the third is what separates Fmin from Fmaj to a
        # key detector (and to an ear) — the root alone is mode-ambiguous.
        dr = (sine(note_hz(r2), nn) + 0.55 * sine(note_hz(r2 + 15), nn)) * 0.26
        fade = sec(0.02)
        dr[:fade] *= np.linspace(0, 1, fade); dr[-fade:] *= np.linspace(1, 0, fade)
        place(tr.canvas, np.stack([dr, dr], 1), tr.at_bar(bar0))
    tr.canvas *= duck(len(tr.canvas), tr.bpm, 0.32)[:, None]
    lay_riser_into(tr, 40, 4, 0.35)
    lay_impact(tr, 40, 0.7)

def build_melodic_techno(tr, root, mode):
    prog = [0, 5, 1, 4]
    lay_four_floor(tr, 0, 64, "deep", gain=0.95)
    lay_hats(tr, 8, 56, gain=0.3, off_open=False, seed=31)
    lay_rolling_bass(tr, 8, 48, semi=scale_degrees(root, mode, 1)[0], gain=0.6)
    lay_pad(tr, 8, 48, prog, 3, gain=0.42, spread=10, duck_depth=0.55,
            root=root, mode=mode)
    lay_arp(tr, 16, 40, prog, 4, gain=0.42, rate=4, bright=3600,
            root=root, mode=mode, pattern=(0, 2, 1, 2, 0, 1, 2, 1))
    lay_riser_into(tr, 32, 4, 0.3, seed=53)

def build_acid(tr, root, mode):
    r = scale_degrees(root, mode, 1)[0]
    lay_four_floor(tr, 0, 64, "house")
    lay_hats(tr, 0, 64, gain=0.38)
    lay_clap(tr, 16, 32, gain=0.45)
    def patt(i):
        seqs = [(0, 1, 0, 1), (0, 0, 0, 1), (12, 0, 1, 1), (0, 0, 0, 1),
                (3, 1, 0, 1), (0, 0, 0, 1), (7, 0, 1, 1), (10, 0, 0, 1),
                (0, 1, 0, 1), (12, 0, 1, 1), (0, 0, 0, 1), (7, 0, 0, 1),
                (3, 0, 0, 1), (3, 1, 1, 1), (0, 0, 0, 1), (10, 0, 1, 1)]
        return seqs[i % 16]
    line = acid_line(tr.bpm, 48, patt, r + 12, seed=37)
    place(tr.canvas, np.stack([line, line], 1) * 0.62, tr.at_bar(8))
    tr.canvas *= duck(len(tr.canvas), tr.bpm, 0.3)[:, None]

def build_progressive(tr, root, mode):
    prog = [0, 3, 5, 4]
    lay_four_floor(tr, 0, 64, "house", gain=0.95)
    lay_hats(tr, 8, 56, swing=0.06, gain=0.36)
    lay_clap(tr, 8, 48, gain=0.5)
    lay_rolling_bass(tr, 8, 48, semi=scale_degrees(root, mode, 1)[0], gain=0.7)
    lay_pad(tr, 16, 48, prog, 3, gain=0.45, spread=12, duck_depth=0.5,
            root=root, mode=mode)
    lay_arp(tr, 32, 24, prog, 4, gain=0.35, rate=4, bright=3000,
            root=root, mode=mode, pattern=(0, 1, 2, 3, 2, 1))
    lay_riser_into(tr, 32, 4, 0.3)
    lay_impact(tr, 32, 0.6)

def build_trance(tr, root, mode):
    prog = [0, 5, 3, 6]
    lay_four_floor(tr, 0, 64, "house", gain=1.0)
    lay_hats(tr, 0, 64, gain=0.4)
    lay_rolling_bass(tr, 4, 56, semi=scale_degrees(root, mode, 1)[0], gain=0.85)
    lay_pad(tr, 16, 32, prog, 3, gain=0.5, spread=16, duck_depth=0.6,
            root=root, mode=mode)
    # lead over the second half of the pads
    lay_arp(tr, 32, 16, prog, 4, gain=0.45, rate=4, bright=4200,
            root=root, mode=mode, pattern=(2, 1, 0, 1, 2, 2, 1, 0))
    lay_snare_roll(tr, 48, 4, 0.5)
    lay_riser_into(tr, 48, 8, 0.35)
    lay_impact(tr, 48, 0.75)
    lay_pad(tr, 48, 16, prog, 4, gain=0.4, spread=18, duck_depth=0.65,
            root=root, mode=mode, seed=61)

def build_electro(tr, root, mode):
    lay_four_floor(tr, 0, 64, "house", gain=1.0)
    lay_hats(tr, 0, 64, gain=0.38, seed=41)
    lay_clap(tr, 8, 48, gain=0.65)
    r = scale_degrees(root, mode, 1)[0]
    lay_bassline_pattern(tr, 8, 48, [r, r, r + 3, r],
                         rhythm=[0, 3, 6, 10, 12], gain=0.75)
    # talky electro lead: detuned square pluck
    base = tr.at_bar(16)
    for i, s in steps(tr.bpm, 32):
        if i % 8 in (0, 3, 6):
            semi = [r + 12, r + 15, r + 19, r + 24][(i // 8) % 4]
            p = pluck(semi, 0.22, bright=5200, res=4.0, seed=i)
            place(tr.canvas, p, base + s, 0.42, pan=0.3 * math.sin(i))
    # same mode-pinning drone that fixed peak techno: root + minor third,
    # low in the mix, through the main section only
    nn = bar_len(tr.bpm, 40)
    r2 = scale_degrees(root, mode, 2)[0]
    dr = (sine(note_hz(r2), nn) + 0.55 * sine(note_hz(r2 + 15), nn)) * 0.24
    fade = sec(0.02)
    dr[:fade] *= np.linspace(0, 1, fade); dr[-fade:] *= np.linspace(1, 0, fade)
    place(tr.canvas, np.stack([dr, dr], 1), tr.at_bar(12))
    tr.canvas *= duck(len(tr.canvas), tr.bpm, 0.4)[:, None]

def build_dubstep(tr, root, mode):
    n = len(tr.canvas)
    k, sn = kick("house", 0.32), snare()
    for i, s in steps(tr.bpm, 64):
        b = i % 32
        if b in (0, 20):
            place(tr.canvas, k, s, 1.0)
        if b in (8, 24):
            place(tr.canvas, sn, s, 0.95)
        if b % 4 == 2:
            place(tr.canvas, hat(True, 29), s, 0.25, pan=0.2)
    r = scale_degrees(root, mode, 1)[0]
    osc = drive(saw_bl(note_hz(r), n) * 0.6 + square_bl(note_hz(r - 12), n) * 0.5, 2.0)
    rates = [1, 2, 2, 3, 1, 4, 2, 6]
    lfo = np.zeros(n)
    bl_1 = bar_len(tr.bpm, 1)
    for bi in range(64):
        s0 = bi * bl_1
        if s0 >= n: break
        rate = rates[bi % 8]
        tt = t_axis(min(bl_1, n - s0))
        lfo[s0 : s0 + len(tt)] = 0.5 - 0.5 * np.cos(2 * np.pi * rate * tt * tr.bpm / 60)
    wob = swept_lp(osc, 170 + lfo * 2400, q=4.0)
    sub = sine(note_hz(r - 12), n) * 0.5
    mask = np.ones(n)
    mask[: bar_len(tr.bpm, 8)] = 0          # drums-only intro
    mask[bar_len(tr.bpm, 56):] = 0          # drums-only outro
    layer = (wob * 0.7 + sub) * mask * duck(n, tr.bpm / 2, 0.5, 0.35)
    tr.canvas[:, 0] += layer
    tr.canvas[:, 1] += layer
    lay_riser_into(tr, 8, 4, 0.3, seed=59)
    lay_impact(tr, 8, 0.7)

def build_dnb(tr, root, mode):
    k, sn = kick("house", 0.2), snare()
    for i, s in steps(tr.bpm, 96):
        b = i % 16
        if b in (0, 10):
            place(tr.canvas, k, s, 1.0)
        if b in (4, 12):
            place(tr.canvas, sn, s, 0.9)
        if b in (7, 14):
            place(tr.canvas, sn, s, 0.22)
        if b % 2 == 0:
            place(tr.canvas, hat(True, 47), s, 0.26, pan=0.2 if b % 4 else -0.2)
    n = len(tr.canvas)
    r = scale_degrees(root, mode, 1)[0]
    reese = butter(saw_bl(note_hz(r) * 0.999, n) + saw_bl(note_hz(r) * 1.001, n),
                   "low", 340, 4)
    reese = drive(reese, 2.4) * 0.5
    mask = np.ones(n)
    mask[: bar_len(tr.bpm, 16)] = 0
    mask[bar_len(tr.bpm, 80):] = 0
    for bi in range(96):
        if bi % 8 in (6, 7):
            s0 = bar_len(tr.bpm, bi)
            mask[s0 : s0 + bar_len(tr.bpm, 1)] *= 0.15
    tr.canvas[:, 0] += reese * mask * 0.6
    tr.canvas[:, 1] += reese * mask * 0.6
    # atmospheric pad floats over the middle
    lay_pad(tr, 32, 32, [0, 5], 4, gain=0.22, spread=10, duck_depth=0.2,
            root=root, mode=mode, hp=300, seed=67)

def build_hardstyle(tr, root, mode):
    lay_four_floor(tr, 0, 64, "hard", gain=1.0)
    r = scale_degrees(root, mode, 2)[0]
    base0 = tr.at_bar(16)
    for i, s in steps(tr.bpm, 32):
        if i % 4 == 2:
            semis = chord(root, mode, 2, [0, 0, 5, 3][(i // 16) % 4], voicing=(0, 2))
            st = sum(pluck(sm + 12, 0.3, bright=5200, res=2.5) for sm in semis) / 2
            place(tr.canvas, drive(st, 2.5), base0 + s, 0.5)
    # screech lead in second drop
    base1 = tr.at_bar(48)
    for i, s in steps(tr.bpm, 16):
        if i % 2 == 0:
            semi = [r + 24, r + 27, r + 31, r + 24, r + 22, r + 27, r + 19, r + 24][ (i // 2) % 8]
            p = pluck(semi, 0.28, bright=6400, res=5.0, seed=i)
            place(tr.canvas, drive(p, 3.5), base1 + s, 0.32, pan=0.25 * math.sin(i))
    lay_snare_roll(tr, 48, 4, 0.6)
    lay_riser_into(tr, 48, 4, 0.4, seed=71)
    lay_impact(tr, 48, 0.8)

def build_breaks_chill(tr, root, mode):
    k, sn = kick("deep", 0.35), snare()
    for i, s in steps(tr.bpm, 64, 4, swing=0.18):
        b = i % 16
        if b in (0, 7, 10):
            place(tr.canvas, k, s, 0.9)
        if b in (4, 12):
            place(tr.canvas, sn, s, 0.6)
        if b % 2 == 1:
            place(tr.canvas, hat(True, 53), s, 0.3, pan=0.25 if b % 4 == 1 else -0.25)
    prog = [0, 5, 3, 4]
    lay_bassline_pattern(tr, 8, 48,
                         [chord(root, mode, 1, d)[0] for d in prog],
                         rhythm=[0, 7, 10], gain=0.7)
    lay_pad(tr, 8, 48, prog, 3, gain=0.4, spread=8, duck_depth=0.25,
            root=root, mode=mode, hp=180, seed=73)
    lay_arp(tr, 24, 24, prog, 4, gain=0.3, rate=2, bright=2200,
            root=root, mode=mode, pattern=(0, 2, 1))

TRACKS = [
    ("deep_house",      "01_deep_house_122bpm_Cmaj_8B.flac",       122, "C",  "major", 64, build_deep_house),
    ("classic_house",   "02_classic_house_126bpm_Amin_8A.flac",    126, "A",  "minor", 64, build_classic_house),
    ("peak_techno",     "03_peak_techno_132bpm_Fmin_4A.flac",      132, "F",  "minor", 64, build_peak_techno),
    ("melodic_techno",  "04_melodic_techno_124bpm_Gmin_6A.flac",   124, "G",  "minor", 64, build_melodic_techno),
    ("acid_techno",     "05_acid_techno_135bpm_Dmin_7A.flac",      135, "D",  "minor", 64, build_acid),
    ("uplifting_trance","06_uplifting_trance_138bpm_Emin_9A.flac", 138, "E",  "minor", 64, build_trance),
    ("progressive",     "07_progressive_house_128bpm_Bmin_10A.flac",128,"B",  "minor", 64, build_progressive),
    ("electro_house",   "08_electro_house_128bpm_Bbmin_3A.flac",   128, "Bb", "minor", 64, build_electro),
    ("dubstep",         "09_dubstep_140bpm_Ebmin_2A.flac",         140, "Eb", "minor", 64, build_dubstep),
    ("dnb",             "10_drum_and_bass_174bpm_Cmin_5A.flac",    174, "C",  "minor", 96, build_dnb),
    ("hardstyle",       "11_hardstyle_150bpm_Abmin_1A.flac",       150, "Ab", "minor", 64, build_hardstyle),
    ("chill_breaks",    "12_chill_breaks_110bpm_Dmaj_10B.flac",    110, "D",  "major", 64, build_breaks_chill),
]

if __name__ == "__main__":
    import sys
    only = sys.argv[1] if len(sys.argv) > 1 else None
    print("rendering:")
    for key, name, bpm, root, mode, bars, fn in TRACKS:
        if only and only != key:
            continue
        tr = Track(bpm, bars)
        fn(tr, root, mode)
        write(name, master(tr.canvas, bpm))
    print("done")
