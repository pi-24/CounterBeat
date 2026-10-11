"""Generate all original audio for the CounterBeat game.

Everything here is synthesised from scratch with numpy - no sampled or
downloaded material - so the assets are original work.
"""
import numpy as np
import wave
import os

SR = 44100
OUT = "./audio_raw"
os.makedirs(OUT, exist_ok=True)

rng = np.random.default_rng(20261106)


# ---------------------------------------------------------------- helpers
def env(n, a=0.005, d=0.1, s=0.0, r=0.05, sustain_len=None):
    """Simple ADSR envelope of length n samples."""
    a_n = max(1, int(a * SR))
    d_n = max(1, int(d * SR))
    r_n = max(1, int(r * SR))
    s_n = n - a_n - d_n - r_n
    if s_n < 0:
        s_n = 0
    out = np.concatenate([
        np.linspace(0, 1, a_n),
        np.linspace(1, s, d_n),
        np.full(s_n, s),
        np.linspace(s, 0, r_n),
    ])
    return out[:n] if len(out) >= n else np.pad(out, (0, n - len(out)))


def exp_env(n, tau):
    return np.exp(-np.arange(n) / (tau * SR))


def osc(freq, n, kind="sine", detune=0.0):
    t = np.arange(n) / SR
    f = freq * (1.0 + detune)
    ph = 2 * np.pi * f * t
    if kind == "sine":
        return np.sin(ph)
    if kind == "square":
        return np.sign(np.sin(ph))
    if kind == "saw":
        return 2.0 * ((f * t) % 1.0) - 1.0
    if kind == "tri":
        return 2.0 * np.abs(2.0 * ((f * t) % 1.0) - 1.0) - 1.0
    raise ValueError(kind)


def lowpass(x, cutoff):
    """One-pole lowpass."""
    a = np.exp(-2 * np.pi * cutoff / SR)
    try:
        from scipy.signal import lfilter
        return lfilter([1 - a], [1, -a], x)
    except ImportError:  # pragma: no cover - slow fallback
        y = np.empty_like(x)
        acc = 0.0
        for i in range(len(x)):
            acc = (1 - a) * x[i] + a * acc
            y[i] = acc
        return y


def highpass(x, cutoff):
    return x - lowpass(x, cutoff)


def soft_clip(x, drive=1.0):
    return np.tanh(x * drive)


def note(semitones_from_a4):
    return 440.0 * (2.0 ** (semitones_from_a4 / 12.0))


def place(buf, sound, start_sec, gain=1.0):
    i = int(start_sec * SR)
    j = min(len(buf), i + len(sound))
    if i >= len(buf):
        return
    buf[i:j] += sound[: j - i] * gain


# ---------------------------------------------------------------- drums
def kick(length=0.34, f_start=150.0, f_end=45.0, click=0.6):
    n = int(length * SR)
    t = np.arange(n) / SR
    pitch = f_end + (f_start - f_end) * np.exp(-t * 28)
    phase = 2 * np.pi * np.cumsum(pitch) / SR
    body = np.sin(phase) * exp_env(n, 0.09)
    tick = rng.normal(0, 1, n) * exp_env(n, 0.002) * click
    return soft_clip(body * 0.9 + tick * 0.25, 1.4)


def snare(length=0.22, tone=190.0):
    n = int(length * SR)
    noise = highpass(rng.normal(0, 1, n), 1200) * exp_env(n, 0.055)
    body = osc(tone, n, "tri") * exp_env(n, 0.035) * 0.5
    return soft_clip(noise * 0.75 + body, 1.1)


def hat(length=0.06, open_hat=False):
    n = int((0.22 if open_hat else length) * SR)
    noise = highpass(rng.normal(0, 1, n), 6500)
    return noise * exp_env(n, 0.07 if open_hat else 0.012) * 0.55


def clap(length=0.25):
    n = int(length * SR)
    out = np.zeros(n)
    for offset, g in ((0.0, 0.6), (0.011, 0.8), (0.023, 1.0)):
        i = int(offset * SR)
        seg = highpass(rng.normal(0, 1, n - i), 1000) * exp_env(n - i, 0.03)
        out[i:] += seg * g
    return out * 0.5


# ---------------------------------------------------------------- tonal
def bass(freq, length, kind="saw", cutoff=420.0, drive=1.6):
    n = int(length * SR)
    raw = osc(freq, n, kind) * 0.6 + osc(freq * 0.5, n, "sine") * 0.4
    shaped = lowpass(raw, cutoff) * env(n, 0.004, 0.08, 0.55, 0.05)
    return soft_clip(shaped, drive) * 0.8


def pluck(freq, length, cutoff=2600.0):
    n = int(length * SR)
    raw = osc(freq, n, "saw") * 0.5 + osc(freq, n, "square", 0.004) * 0.3
    return lowpass(raw, cutoff) * exp_env(n, 0.10) * 0.55


def pad(freqs, length, cutoff=1100.0):
    n = int(length * SR)
    acc = np.zeros(n)
    for f in freqs:
        acc += osc(f, n, "saw", 0.003) + osc(f, n, "saw", -0.004)
    acc /= max(1, len(freqs) * 2)
    return lowpass(acc, cutoff) * env(n, 0.25, 0.35, 0.6, 0.6) * 0.5


# ---------------------------------------------------------------- writing
def normalise(x, peak=0.89):
    m = np.max(np.abs(x))
    return x if m == 0 else x / m * peak


def write_wav(path, data, sr=SR):
    data = np.clip(data, -1.0, 1.0)
    pcm = (data * 32767).astype(np.int16)
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


# ---------------------------------------------------------------- tracks
# A natural minor.  Degrees given in semitones from A4.
A_MINOR = [0, 2, 3, 5, 7, 8, 10]


def scale_note(degree, octave=0):
    """degree 0 == A, supports values outside 0..6 by wrapping octaves."""
    o, d = divmod(degree, 7)
    return note(A_MINOR[d] + 12 * (o + octave))


def build_level_one(bpm=90.0, bars=24):
    spb = 60.0 / bpm
    total = bars * 4 * spb + 2.0
    buf = np.zeros(int(total * SR))

    chords = [
        [scale_note(0, -2), scale_note(2, -2), scale_note(4, -2)],   # Am
        [scale_note(5, -3), scale_note(0, -2), scale_note(2, -2)],   # F
        [scale_note(2, -2), scale_note(4, -2), scale_note(6, -2)],   # C
        [scale_note(4, -2), scale_note(6, -2), scale_note(1, -1)],   # Em
    ]
    bass_roots = [scale_note(0, -3), scale_note(5, -4), scale_note(2, -3), scale_note(4, -3)]
    melody = [4, 6, 5, 4, 2, 4, 3, 2]

    for bar in range(bars):
        t0 = bar * 4 * spb
        chord = chords[bar % 4]
        root = bass_roots[bar % 4]

        if bar >= 2:
            place(buf, pad(chord, 4 * spb * 0.98), t0, 0.30)

        for beat in range(4):
            tb = t0 + beat * spb
            if beat in (0, 2):
                place(buf, kick(), tb, 0.95)
            if beat == 2 and bar % 4 == 3:
                place(buf, kick(), tb + spb * 0.5, 0.6)
            if beat in (1, 3):
                place(buf, snare(), tb, 0.55)
            # eighth note hats
            place(buf, hat(), tb, 0.35)
            place(buf, hat(open_hat=(beat == 3)), tb + spb * 0.5, 0.28)
            if bar >= 1:
                place(buf, bass(root, spb * 0.85), tb, 0.55)

        if bar >= 6:
            for i, deg in enumerate(melody):
                tm = t0 + i * spb * 0.5
                place(buf, pluck(scale_note(deg, 0), spb * 0.55), tm, 0.26)

    return normalise(buf)


def build_level_two(bpm=120.0, bars=32):
    spb = 60.0 / bpm
    total = bars * 4 * spb + 2.0
    buf = np.zeros(int(total * SR))

    prog = [0, 5, 3, 4]  # scale degrees for the root
    arp = [0, 4, 2, 4, 6, 4, 2, 4]

    for bar in range(bars):
        t0 = bar * 4 * spb
        root_deg = prog[bar % 4]
        root = scale_note(root_deg, -3)

        for beat in range(4):
            tb = t0 + beat * spb
            place(buf, kick(), tb, 1.0)                       # four on the floor
            if beat in (1, 3):
                place(buf, clap(), tb, 0.6)
                place(buf, snare(), tb, 0.35)
            for s in range(4):                                # 16th hats
                place(buf, hat(open_hat=(s == 2 and beat == 3)),
                      tb + s * spb * 0.25, 0.20 if s % 2 else 0.30)
            place(buf, bass(root, spb * 0.45, cutoff=520), tb, 0.6)
            place(buf, bass(root, spb * 0.35, cutoff=520), tb + spb * 0.5, 0.45)

        if bar >= 4:
            for i, deg in enumerate(arp):
                tm = t0 + i * spb * 0.5
                place(buf, pluck(scale_note(deg + root_deg, 1), spb * 0.45, 3200), tm, 0.22)

    return normalise(buf)


def build_level_three(bpm=150.0, bars=40):
    spb = 60.0 / bpm
    total = bars * 4 * spb + 2.0
    buf = np.zeros(int(total * SR))

    prog = [0, 0, 5, 4]
    arp = [0, 2, 4, 6, 4, 2, 4, 0, 2, 4, 7, 6, 4, 2, 0, 2]

    for bar in range(bars):
        t0 = bar * 4 * spb
        root_deg = prog[bar % 4]
        root = scale_note(root_deg, -3)

        for beat in range(4):
            tb = t0 + beat * spb
            place(buf, kick(f_start=190, f_end=48), tb, 1.0)
            place(buf, kick(length=0.22, f_start=170, f_end=50), tb + spb * 0.75, 0.55)
            if beat in (1, 3):
                place(buf, snare(tone=215), tb, 0.7)
                place(buf, clap(), tb, 0.35)
            for s in range(4):
                place(buf, hat(open_hat=(s == 3 and beat == 3)),
                      tb + s * spb * 0.25, 0.26 if s % 2 else 0.34)
            place(buf, bass(root, spb * 0.42, cutoff=700, drive=2.6), tb, 0.65)
            place(buf, bass(root * 1.5, spb * 0.3, cutoff=700, drive=2.6), tb + spb * 0.5, 0.4)

        if bar >= 4:
            for i, deg in enumerate(arp):
                tm = t0 + i * spb * 0.25
                place(buf, pluck(scale_note(deg + root_deg, 1), spb * 0.28, 4200), tm, 0.20)

    return normalise(buf)


def chord_degrees(root_deg, kind="minor"):
    """Triad built on a scale degree (diatonic, so it stays in key)."""
    return [root_deg, root_deg + 2, root_deg + 4]


def build_drift(bpm=105.0, bars=28):
    """Lo-fi swing: lazy kick, swung hats, soft electric-piano chords."""
    spb = 60.0 / bpm
    total = bars * 4 * spb + 2.0
    buf = np.zeros(int(total * SR))
    swing = spb * 0.17
    prog = [0, 3, 5, 4]            # Am  Dm  F  Em  (degrees of A minor)
    melody = [[7, 6, 4, None, 5, 4, None, 2], [4, 5, 6, None, 7, None, 9, 8]]

    for bar in range(bars):
        t0 = bar * 4 * spb
        root_deg = prog[bar % 4]
        chord = [scale_note(d, -1) for d in chord_degrees(root_deg)]
        if bar >= 1:
            # Two stabs per bar, slightly late, like a sampled keys loop.
            place(buf, pad(chord, spb * 1.6, 1500), t0 + 0.015, 0.34)
            place(buf, pad(chord, spb * 1.2, 1300), t0 + spb * 2.5 + 0.02, 0.26)
        for beat in range(4):
            tb = t0 + beat * spb
            if beat == 0 or (beat == 2 and bar % 2 == 0):
                place(buf, kick(length=0.4, f_start=120, f_end=42, click=0.3), tb, 0.85)
            if beat == 2 and bar % 2 == 1:
                place(buf, kick(length=0.4, f_start=120, f_end=42, click=0.3), tb + spb * 0.5 + swing, 0.7)
            if beat in (1, 3):
                place(buf, snare(length=0.26, tone=170), tb, 0.42)
            place(buf, hat(length=0.05), tb, 0.22)
            place(buf, hat(length=0.05, open_hat=(beat == 1)), tb + spb * 0.5 + swing, 0.18)
            if bar >= 1 and beat in (0, 2):
                place(buf, bass(scale_note(root_deg, -3), spb * 1.3, "sine", 300, 1.2), tb, 0.62)
            if bar >= 1 and beat == 3:
                place(buf, bass(scale_note(root_deg + 4, -3), spb * 0.6, "sine", 300, 1.2), tb + swing, 0.45)
        if bar >= 4:
            line = melody[(bar // 2) % 2]
            for i, deg in enumerate(line):
                if deg is None:
                    continue
                tm = t0 + i * spb * 0.5 + (swing if i % 2 else 0)
                place(buf, pluck(scale_note(deg, 0), spb * 0.6, 1900), tm, 0.2)
    vinyl = highpass(rng.normal(0, 1, len(buf)), 3000) * 0.012
    return normalise(buf + vinyl)


def build_breakneck(bpm=135.0, bars=36):
    """Breakbeat: syncopated kicks, snare on the off-beats, stabbing saw chords."""
    spb = 60.0 / bpm
    total = bars * 4 * spb + 2.0
    buf = np.zeros(int(total * SR))
    s16 = spb * 0.25
    prog = [0, 0, 5, 6]
    kick_steps = [0, 6, 10, 11]          # in 16ths: 1 . . . . . x . . . x x . . . .
    snare_steps = [4, 12, 15]
    stab = [[0, 2, 4], [2, 4, 6]]

    for bar in range(bars):
        t0 = bar * 4 * spb
        root_deg = prog[bar % 4]
        for step in range(16):
            ts = t0 + step * s16
            if step in kick_steps or (bar % 4 == 3 and step == 14):
                place(buf, kick(length=0.3, f_start=175, f_end=50, click=0.7), ts, 1.0)
            if step in snare_steps:
                place(buf, snare(length=0.2, tone=205), ts, 0.7)
                place(buf, clap(), ts, 0.3)
            if step % 2 == 0:
                place(buf, hat(open_hat=(step == 14)), ts, 0.3)
            elif bar >= 2:
                place(buf, hat(length=0.04), ts, 0.14)
        if bar >= 1:
            for beat_pos, length in ((0.0, 0.9), (1.75, 0.5), (2.5, 0.6), (3.5, 0.4)):
                place(buf, bass(scale_note(root_deg, -3), spb * length, cutoff=600, drive=2.2), t0 + beat_pos * spb, 0.62)
        if bar >= 4:
            chord = [scale_note(d + root_deg, 0) for d in stab[(bar // 4) % 2]]
            for beat_pos in (1.0, 1.5, 3.25):
                place(buf, pad(chord, spb * 0.45, 2600), t0 + beat_pos * spb, 0.3)
        if bar >= 8 and bar % 2 == 1:
            for i, deg in enumerate([9, 7, 6, 4]):
                place(buf, pluck(scale_note(deg + root_deg, 1), spb * 0.3, 3600), t0 + (2 + i * 0.5) * spb, 0.18)
    return normalise(buf)


def build_overclock(bpm=170.0, bars=44):
    """Drum & bass two-step: kick on 1, snare on 2 and 4, rolling reese bass, 16th arp."""
    spb = 60.0 / bpm
    total = bars * 4 * spb + 2.0
    buf = np.zeros(int(total * SR))
    s16 = spb * 0.25
    prog = [0, 0, 3, 4]
    arp = [0, 4, 7, 4, 2, 4, 7, 9, 0, 4, 7, 4, 2, 6, 7, 9]

    for bar in range(bars):
        t0 = bar * 4 * spb
        root_deg = prog[bar % 4]
        root = scale_note(root_deg, -3)
        for step in range(16):
            ts = t0 + step * s16
            if step == 0 or step == 10 or (step == 7 and bar % 2):
                place(buf, kick(length=0.26, f_start=200, f_end=52, click=0.8), ts, 1.0)
            if step in (4, 12):
                place(buf, snare(length=0.19, tone=230), ts, 0.78)
            if step == 14 and bar % 4 == 3:
                place(buf, snare(length=0.14, tone=260), ts, 0.4)
            place(buf, hat(length=0.045, open_hat=(step == 6)), ts, 0.3 if step % 4 == 0 else 0.17)
        if bar >= 2:
            # Reese: two detuned saws, long sustain across the bar.
            n = int(spb * 3.8 * SR)
            reese = (osc(root, n, "saw", 0.006) + osc(root, n, "saw", -0.006)) * 0.5
            reese = lowpass(reese, 380) * env(n, 0.01, 0.2, 0.7, 0.2)
            place(buf, soft_clip(reese, 2.4) * 0.8, t0, 0.55)
            place(buf, bass(root * 2, spb * 0.4, cutoff=900, drive=2.8), t0 + spb * 2.5, 0.4)
        if bar >= 6:
            for i, deg in enumerate(arp):
                tm = t0 + i * s16
                place(buf, pluck(scale_note(deg + root_deg, 1), s16 * 1.1, 5000), tm, 0.16 if i % 2 else 0.21)
        if bar >= 14 and bar % 4 in (2, 3):
            chord = [scale_note(d + root_deg, 0) for d in (0, 2, 4)]
            place(buf, pad(chord, spb * 3.5, 1800), t0, 0.22)
    return normalise(buf)


def build_menu_theme(bpm=100.0, bars=16):
    spb = 60.0 / bpm
    buf = np.zeros(int((bars * 4 * spb + 2.0) * SR))
    chords = [
        [scale_note(0, -2), scale_note(2, -2), scale_note(4, -2)],
        [scale_note(4, -2), scale_note(6, -2), scale_note(1, -1)],
        [scale_note(5, -3), scale_note(0, -2), scale_note(2, -2)],
        [scale_note(2, -2), scale_note(4, -2), scale_note(6, -2)],
    ]
    for bar in range(bars):
        t0 = bar * 4 * spb
        place(buf, pad(chords[bar % 4], 4 * spb * 0.98, 900), t0, 0.5)
        for beat in range(4):
            tb = t0 + beat * spb
            if beat == 0:
                place(buf, kick(), tb, 0.45)
            place(buf, hat(), tb + spb * 0.5, 0.14)
        if bar >= 4:
            place(buf, pluck(scale_note(4, 0), spb * 0.8, 2200), t0 + spb * 2.5, 0.18)
    return normalise(buf, 0.7)


# ---------------------------------------------------------------- sfx
def sfx_shot():
    n = int(0.20 * SR)
    crack = highpass(rng.normal(0, 1, n), 2200) * exp_env(n, 0.012)
    body = lowpass(rng.normal(0, 1, n), 700) * exp_env(n, 0.05)
    tail = osc(120, n, "sine") * exp_env(n, 0.03) * 0.4
    return normalise(soft_clip(crack * 0.9 + body * 0.7 + tail, 1.8), 0.85)


def sfx_skid():
    n = int(0.16 * SR)
    sweep = np.linspace(5200, 900, n)
    noise = rng.normal(0, 1, n)
    out = np.zeros(n)
    acc = 0.0
    for i in range(n):
        a = np.exp(-2 * np.pi * sweep[i] / SR)
        acc = (1 - a) * noise[i] + a * acc
        out[i] = acc
    return normalise(out * exp_env(n, 0.05), 0.55)


def sfx_ping(freqs, length=0.3, tau=0.09, peak=0.7):
    n = int(length * SR)
    acc = np.zeros(n)
    for k, f in enumerate(freqs):
        acc += osc(f, n, "sine") * exp_env(n, tau * (0.8 ** k))
    return normalise(acc * env(n, 0.002, 0.05, 0.4, 0.1), peak)


def sfx_miss():
    n = int(0.26 * SR)
    tone = osc(150, n, "square") * 0.5 + osc(101, n, "saw") * 0.5
    return normalise(lowpass(tone, 600) * exp_env(n, 0.06), 0.5)


def sfx_ui():
    n = int(0.09 * SR)
    return normalise(osc(880, n, "tri") * exp_env(n, 0.02), 0.4)


def sfx_levelup():
    n = int(0.9 * SR)
    out = np.zeros(n)
    for i, deg in enumerate([0, 2, 4, 7]):
        seg = sfx_ping([scale_note(deg, 1), scale_note(deg, 2)], 0.45, 0.13, 0.8)
        place(out, seg, i * 0.11, 0.8)
    return normalise(out, 0.7)


def sfx_gameover():
    n = int(1.0 * SR)
    out = np.zeros(n)
    for i, deg in enumerate([4, 2, 0]):
        seg = sfx_ping([scale_note(deg, -1), scale_note(deg, 0)], 0.5, 0.16, 0.8)
        place(out, seg, i * 0.18, 0.8)
    return normalise(out, 0.6)


# ---------------------------------------------------------------- run
TRACKS = {
    "music-range": build_level_one,
    "music-drift": build_drift,
    "music-neon": build_level_two,
    "music-breakneck": build_breakneck,
    "music-vault": build_level_three,
    "music-overclock": build_overclock,
    "music-menu": build_menu_theme,
}
SFX = {
    "sfx-shot": sfx_shot,
    "sfx-skid": sfx_skid,
    "sfx-perfect": lambda: sfx_ping([scale_note(4, 1), scale_note(6, 1), scale_note(4, 2)], 0.34, 0.10, 0.75),
    "sfx-good": lambda: sfx_ping([scale_note(2, 1), scale_note(4, 1)], 0.26, 0.07, 0.6),
    "sfx-miss": sfx_miss,
    "sfx-ui": sfx_ui,
    "sfx-levelup": sfx_levelup,
    "sfx-gameover": sfx_gameover,
}

if __name__ == "__main__":
    import sys
    wanted = set(sys.argv[1:])
    for name, fn in TRACKS.items():
        if wanted and name not in wanted:
            continue
        data = fn()
        write_wav(os.path.join(OUT, name + ".wav"), data)
        print(f"{name}: {len(data)/SR:.1f}s")
    for name, fn in SFX.items():
        if wanted and name not in wanted:
            continue
        data = fn()
        write_wav(os.path.join(OUT, name + ".wav"), data)
        print(f"{name}: {len(data)/SR:.2f}s")
