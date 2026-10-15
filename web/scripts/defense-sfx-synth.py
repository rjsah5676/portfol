"""
픽셀 운빨 디펜스 — 보스 2페이즈 효과음 합성 (임시, 일레븐랩스로 바꾸기 전까지)
  python3 defense-sfx-synth.py <출력 폴더>   → boss-phase · tele-warn · tele-{wave,whip,bolt,fire,grab,wind}.mp3
numpy · scipy · ffmpeg 필요. 결정론(시드 고정)이라 다시 돌려도 같은 소리.
음량: 최대 -18 dBFS (기존 효과음 -16 ~ -22 dB 와 비슷하게).
"""
import subprocess, sys, os
import numpy as np
from scipy import signal

SR = 44100
rng = np.random.default_rng(7)


def t(d):
    return np.arange(int(SR * d)) / SR


def env(n, a, d, sus=0.0, curve=4.0):
    """a 초 올라가고 나머지 동안 지수로 줄어듦"""
    na = max(1, int(SR * a))
    e = np.ones(n)
    e[:na] = np.linspace(0, 1, na)
    rest = n - na
    if rest > 0:
        x = np.linspace(0, 1, rest)
        e[na:] = sus + (1 - sus) * np.exp(-curve * x / max(d, 1e-3) * (rest / SR))
    return e


def sweep(f0, f1, d, kind="sine", exp=True):
    n = int(SR * d)
    f = np.geomspace(f0, f1, n) if exp else np.linspace(f0, f1, n)
    ph = 2 * np.pi * np.cumsum(f) / SR
    if kind == "square":
        return np.sign(np.sin(ph))
    if kind == "saw":
        return 2 * ((ph / (2 * np.pi)) % 1) - 1
    return np.sin(ph)


def noise(d):
    return rng.standard_normal(int(SR * d))


def filt(x, kind, f, order=4):
    if kind == "band":
        sos = signal.butter(order, [f[0] / (SR / 2), f[1] / (SR / 2)], "band", output="sos")
    else:
        sos = signal.butter(order, f / (SR / 2), kind, output="sos")
    return signal.sosfilt(sos, x)


def crush(x, bits=6, keep=3):
    """도트 게임 느낌: 비트 줄이고 샘플 반복"""
    q = 2 ** bits
    y = np.round(x * q) / q
    y = np.repeat(y[::keep], keep)[: len(x)]
    return y


def mix(n, *parts):
    out = np.zeros(n)
    for off, p in parts:
        p = p.copy()
        k = min(len(p), int(SR * 0.03))  # 조각 끝을 30ms 로 부드럽게 (뚝 끊김 방지)
        p[-k:] *= np.linspace(1, 0, k)
        i = int(SR * off)
        m = min(len(p), n - i)
        if m > 0:
            out[i : i + m] += p[:m]
    return out


def fade(x, ms=8):
    k = int(SR * ms / 1000)
    x[-k:] *= np.linspace(1, 0, k)
    return x


def norm(x, peak_db=-18.0):
    x = x - np.mean(x)
    return x / (np.max(np.abs(x)) + 1e-9) * 10 ** (peak_db / 20)


# ── 소리들 ──

def warn():
    d = 0.75
    n = int(SR * d)
    b1 = np.sign(np.sin(2 * np.pi * 1320 * t(0.09))) * env(int(SR * 0.09), 0.003, 0.08)
    b2 = np.sign(np.sin(2 * np.pi * 1760 * t(0.09))) * env(int(SR * 0.09), 0.003, 0.08)
    up = sweep(420, 1300, 0.38, "square") * np.linspace(0.15, 0.55, int(SR * 0.38))
    return mix(n, (0, b1), (0.13, b2), (0.3, up))


def phase():
    d = 1.5
    n = int(SR * d)
    boom = filt(noise(0.6), "low", 260) * env(int(SR * 0.6), 0.004, 0.35) * 3
    sub = sweep(95, 38, 1.2, "sine") * env(int(SR * 1.2), 0.01, 0.9) * 1.2
    roar = filt(sweep(70, 55, 1.3, "saw") + 0.4 * noise(1.3), "low", 900) * env(int(SR * 1.3), 0.2, 1.0) * 0.8
    roar = np.tanh(roar * 3)
    crack = np.zeros(int(SR * 1.2))
    for k in range(40):
        i = int(rng.uniform(0.25, 1.15) * SR)
        crack[i : i + 60] += rng.uniform(0.3, 1) * rng.choice([-1, 1]) * np.exp(-np.arange(60) / 12)
    crack = filt(crack, "high", 1800) * np.linspace(0.2, 1.2, len(crack))
    y = mix(n, (0, boom), (0, sub), (0.05, roar), (0.2, crack * 0.8))
    # 글리치 끊김: 30ms 조각을 몇 군데 반복
    for st in (0.55, 0.9):
        i = int(st * SR)
        sl = y[i : i + int(0.03 * SR)].copy()
        for r in range(3):
            j = i + r * len(sl)
            y[j : j + len(sl)] = sl
    return crush(y, 12, 2)


def bolt():
    d = 0.8
    n = int(SR * d)
    zap = sweep(2400, 180, 0.16, "square") * env(int(SR * 0.16), 0.002, 0.16) * 0.7
    hiss = filt(noise(0.25), "high", 2500) * env(int(SR * 0.25), 0.002, 0.08) * 1.4
    crackle = np.zeros(int(SR * 0.3))
    for k in range(25):
        i = int(rng.uniform(0, 0.28) * SR)
        crackle[i : i + 40] += rng.choice([-1, 1]) * np.exp(-np.arange(40) / 8)
    snap = filt(noise(0.06), "high", 600) * env(int(SR * 0.06), 0.001, 0.02) * 2.2
    thunder = filt(noise(0.6), "low", 220) * env(int(SR * 0.6), 0.02, 0.35) * 2.5
    return crush(mix(n, (0, hiss), (0, zap), (0.04, crackle * 0.9), (0.15, snap), (0.17, thunder)), 12, 2)


def grab():
    d = 0.8
    n = int(SR * d)
    thud = sweep(110, 42, 0.35, "sine") * env(int(SR * 0.35), 0.002, 0.25) * 1.6
    click = filt(noise(0.04), "low", 1200) * env(int(SR * 0.04), 0.001, 0.02) * 2
    squeeze = filt(noise(0.18), "band", (300, 1400)) * env(int(SR * 0.18), 0.05, 0.12) * 1.2
    tt = t(0.48)
    clank = sum(np.sin(2 * np.pi * f * tt) * np.exp(-tt * k) for f, k in ((520, 9), (1340, 12), (2310, 16))) * 0.35
    return crush(mix(n, (0, click), (0, thud), (0.12, squeeze), (0.3, clank)), 12, 2)


def wave():
    d = 0.85
    n = int(SR * d)
    swell = filt(noise(0.8), "band", (250, 2600)) * env(int(SR * 0.8), 0.18, 0.35)
    splash = filt(noise(0.25), "high", 1500) * env(int(SR * 0.25), 0.005, 0.1) * 1.2
    blips = np.zeros(int(SR * 0.6))
    for k in range(9):
        f0 = rng.uniform(500, 1100)
        b = sweep(f0, f0 * 1.8, 0.05) * env(int(SR * 0.05), 0.002, 0.04) * 0.35
        i = int(rng.uniform(0.0, 0.5) * SR)
        blips[i : i + len(b)] += b
    return crush(mix(n, (0, swell), (0.18, splash), (0.22, blips)), 12, 2)


def whip():
    d = 0.55
    n = int(SR * d)
    m = int(SR * 0.16)
    centers = np.geomspace(500, 3500, m)
    w = noise(0.16)
    swoosh = np.zeros(m)
    for k in range(0, m, 512):  # 대역을 올려 가며 쉭
        c = centers[k]
        seg = filt(w[k : k + 512], "band", (c * 0.7, min(c * 1.4, 20000)), 2)
        swoosh[k : k + len(seg)] = seg
    swoosh *= np.linspace(0.2, 1, m) * 1.4
    crackA = noise(0.012) * 3
    crackB = filt(noise(0.05), "high", 1200) * env(int(SR * 0.05), 0.001, 0.02) * 1.6
    y = mix(n, (0, swoosh), (0.16, crackA), (0.165, crackB))
    y += np.concatenate([np.zeros(int(SR * 0.09)), y[: n - int(SR * 0.09)]]) * 0.25  # 짧은 메아리
    return crush(y, 12, 2)


def fire():
    d = 0.9
    n = int(SR * d)
    roar = filt(noise(0.85), "low", 1100) * env(int(SR * 0.85), 0.12, 0.45) * 1.6
    low = np.sin(2 * np.pi * 70 * t(0.7)) * env(int(SR * 0.7), 0.05, 0.4) * 0.6
    pops = np.zeros(int(SR * 0.8))
    for k in range(30):
        i = int(rng.uniform(0.05, 0.75) * SR)
        pops[i : i + 80] += rng.uniform(0.3, 1) * rng.choice([-1, 1]) * np.exp(-np.arange(80) / 15)
    pops = filt(pops, "high", 900)
    whoosh = filt(noise(0.3), "band", (400, 3000)) * env(int(SR * 0.3), 0.1, 0.15) * 0.9
    return crush(mix(n, (0, whoosh), (0.05, roar), (0.05, low), (0.08, pops * 0.7)), 12, 2)


def wind():
    d = 0.9
    n = int(SR * d)
    m = int(SR * 0.6)
    w = noise(0.6)
    gust = np.zeros(m)
    cs = np.concatenate([np.geomspace(300, 1600, m // 2), np.geomspace(1600, 500, m - m // 2)])
    for k in range(0, m, 512):
        c = cs[k]
        seg = filt(w[k : k + 512], "band", (c * 0.6, c * 1.5), 2)
        gust[k : k + len(seg)] = seg
    gust *= np.sin(np.linspace(0, np.pi, m)) * 1.5
    thud = sweep(130, 50, 0.3) * env(int(SR * 0.3), 0.002, 0.2) * 1.3
    dust = filt(noise(0.25), "band", (800, 4000)) * env(int(SR * 0.25), 0.003, 0.1) * 0.8
    return crush(mix(n, (0, gust), (0.55, thud), (0.55, dust)), 12, 2)


SOUNDS = {
    "boss-phase": phase,
    "tele-warn": warn,
    "tele-wave": wave,
    "tele-whip": whip,
    "tele-bolt": bolt,
    "tele-fire": fire,
    "tele-grab": grab,
    "tele-wind": wind,
}

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out, exist_ok=True)
    from scipy.io import wavfile

    # 계속 울리는 소리(경고음 · 2페이즈)는 평균 음량이 커서 최대를 낮춤
    PEAK = {"tele-warn": -23.0, "boss-phase": -21.0}
    for name, fn in SOUNDS.items():
        y = fade(norm(fn(), PEAK.get(name, -18.0)))
        wav = os.path.join(out, name + ".wav")
        wavfile.write(wav, SR, (y * 32767).astype(np.int16))
        mp3 = os.path.join(out, name + ".mp3")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-ar", "44100", "-b:a", "128k", mp3], check=True)
        os.remove(wav)
        print(name, f"{len(y) / SR:.2f}s")
