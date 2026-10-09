"use client";

/*
 * 스케치 퀴즈 소리 — 배경음악 · 징글 · 효과음 · 진행 음성(☆).
 *  파일이 있으면 파일(/sketch/sound/…, manifest.json 에 적힌 것만)을 틀고, 없으면 Web Audio 합성음으로 대신한다.
 *  (배경음악 · 진행 음성은 파일이 있을 때만)
 *  브라우저 자동재생 정책 때문에 첫 클릭·터치·키 입력 이후에만 소리가 난다 (그 전에 틀려던 배경음악은 첫 입력 때 시작).
 *  설정: 전체 음소거 + 배경음악 · 효과음 음량, localStorage 에 저장.
 *  manifest.json 예: { "bgm-lobby": "bgm-lobby.mp3", "sfx-correct": "sfx-correct.wav", "sfx-pop-1": "sfx-pop-1.wav", … }
 */

const KEY = "sketch_sound";
const BASE = "/sketch/sound";

export interface SoundSettings {
  mute: boolean;
  bgm: number;
  sfx: number;
}
const DEFAULT: SoundSettings = { mute: false, bgm: 0.45, sfx: 0.8 };
let settings: SoundSettings | null = null;
const listeners = new Set<() => void>();

export function getSound(): SoundSettings {
  if (!settings) {
    settings = { ...DEFAULT };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(settings, JSON.parse(raw) as Partial<SoundSettings>);
    } catch {}
  }
  return settings;
}
export function setSound(patch: Partial<SoundSettings>) {
  settings = { ...getSound(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
  applyBgmVolume();
  if (!settings.mute && wantBgm && unlocked) void startBgm(wantBgm);
  for (const l of listeners) l();
}
export function onSoundChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// ───────────── 파일 목록 ─────────────

let manifest: Record<string, string> | null = null;
let manifestLoading: Promise<void> | null = null;
function loadManifest() {
  if (manifest || manifestLoading || typeof window === "undefined") return;
  manifestLoading = fetch(`${BASE}/manifest.json`, { cache: "no-cache" })
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : {}))
    .then((m) => {
      manifest = m;
    })
    .catch(() => {
      manifest = {};
    });
}
/** 이름 → 파일 주소. 변형이 여러 개(sfx-pop-1, -2 …)면 그중 아무거나 */
function fileOf(name: string): string | null {
  if (!manifest) return null;
  if (manifest[name]) return `${BASE}/${manifest[name]}`;
  const alts: string[] = [];
  for (let i = 1; manifest[`${name}-${i}`]; i++) alts.push(manifest[`${name}-${i}`]);
  return alts.length ? `${BASE}/${alts[Math.floor(Math.random() * alts.length)]}` : null;
}

// ───────────── 재생 ─────────────

let ctx: AudioContext | null = null;
let unlocked = false;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function ac(): AudioContext | null {
  if (typeof window === "undefined" || getSound().mute) return null;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function unlock() {
  if (unlocked || typeof window === "undefined") return;
  unlocked = true;
  ac();
  if (wantBgm) void startBgm(wantBgm);
}
if (typeof window !== "undefined") {
  loadManifest();
  document.addEventListener("visibilitychange", () => {
    for (const el of live.keys()) {
      if (document.hidden) el.pause();
      else if (wantBgm) void el.play().catch(() => {});
    }
  });
  for (const ev of ["pointerdown", "keydown", "touchstart"])
    window.addEventListener(ev, unlock, { once: true, passive: true });
}

function buffer(url: string): Promise<AudioBuffer | null> {
  let p = buffers.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => (ctx ? ctx.decodeAudioData(b) : null))
      .catch(() => null);
    buffers.set(url, p);
  }
  return p;
}

function playFile(name: string, vol: number): boolean {
  const url = fileOf(name);
  if (!url) return false;
  const c = ac();
  if (!c) return false;
  void buffer(url).then((buf) => {
    if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(g);
    g.connect(c.destination);
    src.start();
  });
  return true;
}

// ───────────── 합성음 (파일 없을 때) ─────────────

let noiseBuf: AudioBuffer | null = null;
function noise(c: AudioContext): AudioBufferSourceNode {
  if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.6, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  return src;
}
function env(c: AudioContext, peak: number, attack: number, decay: number, at: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * getSound().sfx), at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  g.connect(c.destination);
  return g;
}
function tone(
  c: AudioContext,
  type: OscillatorType,
  freq: number,
  peak: number,
  decay: number,
  at = c.currentTime,
  slideTo?: number
) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, at + decay);
  o.connect(env(c, peak, 0.004, decay, at));
  o.start(at);
  o.stop(at + decay + 0.05);
}
function hiss(
  c: AudioContext,
  kind: BiquadFilterType,
  freq: number,
  peak: number,
  decay: number,
  at = c.currentTime,
  attack = 0.003
) {
  const n = noise(c);
  const f = c.createBiquadFilter();
  f.type = kind;
  f.frequency.value = freq;
  n.connect(f);
  f.connect(env(c, peak, attack, decay, at));
  n.start(at);
  n.stop(at + attack + decay + 0.05);
}
const arp = (
  c: AudioContext,
  notes: number[],
  gap: number,
  type: OscillatorType = "triangle",
  peak = 0.1,
  decay = 0.22
) => notes.forEach((f, i) => tone(c, type, f, peak, decay, c.currentTime + i * gap));

const synth: Record<string, (c: AudioContext) => void> = {
  // 버튼 · 화면
  "sfx-click": (c) => tone(c, "sine", 1100, 0.05, 0.035),
  "sfx-open": (c) => tone(c, "sine", 520, 0.07, 0.1, c.currentTime, 880),
  "sfx-close": (c) => tone(c, "sine", 820, 0.06, 0.09, c.currentTime, 480),
  "sfx-copy": (c) => {
    tone(c, "square", 1800, 0.03, 0.03);
    tone(c, "sine", 1320, 0.07, 0.15, c.currentTime + 0.05);
  },
  "sfx-error": (c) => {
    tone(c, "square", 220, 0.05, 0.09);
    tone(c, "square", 180, 0.05, 0.12, c.currentTime + 0.1);
  },
  // 사람
  "sfx-join": (c) => {
    tone(c, "sine", 988, 0.07, 0.14);
    tone(c, "sine", 1319, 0.06, 0.22, c.currentTime + 0.08);
  },
  "sfx-leave": (c) => {
    tone(c, "sine", 1175, 0.05, 0.12);
    tone(c, "sine", 784, 0.05, 0.2, c.currentTime + 0.08);
  },
  "sfx-kick": (c) => {
    tone(c, "sine", 300, 0.14, 0.18, c.currentTime, 90);
    hiss(c, "lowpass", 800, 0.08, 0.1);
  },
  // 진행
  "sfx-turn": (c) => {
    tone(c, "sine", 660, 0.08, 0.14);
    tone(c, "sine", 990, 0.07, 0.2, c.currentTime + 0.1);
  },
  "sfx-pick": (c) => {
    tone(c, "triangle", 880, 0.09, 0.08);
    tone(c, "triangle", 1320, 0.08, 0.14, c.currentTime + 0.06);
  },
  "sfx-start": (c) => {
    hiss(c, "bandpass", 2400, 0.12, 0.22, c.currentTime, 0.04);
    tone(c, "triangle", 784, 0.07, 0.2, c.currentTime + 0.12, 1568);
  },
  "sfx-tick": (c) => tone(c, "square", 1000, 0.03, 0.035),
  "sfx-tick-last": (c) => tone(c, "square", 1500, 0.045, 0.06),
  "sfx-hint": (c) => arp(c, [1319, 1760, 2093], 0.05, "sine", 0.06, 0.16),
  "sfx-correct": (c) => {
    tone(c, "sine", 1047, 0.09, 0.16);
    tone(c, "sine", 1568, 0.08, 0.26, c.currentTime + 0.09);
  },
  "sfx-guess": (c) => tone(c, "sine", 540, 0.05, 0.06, c.currentTime, 380),
  "sfx-chat": (c) => tone(c, "sine", 900, 0.035, 0.05),
  "sfx-send": (c) => tone(c, "sine", 620, 0.05, 0.07, c.currentTime, 980),
  "sfx-ready": (c) => tone(c, "sine", 880, 0.08, 0.12),
  // 그리기 도구
  "sfx-tool": (c) => {
    tone(c, "square", 2400, 0.025, 0.02);
    tone(c, "triangle", 1600, 0.04, 0.04, c.currentTime + 0.02);
  },
  "sfx-color": (c) => tone(c, "sine", 1400, 0.04, 0.05, c.currentTime, 1700),
  "sfx-fill": (c) => {
    hiss(c, "lowpass", 1400, 0.12, 0.25, c.currentTime, 0.02);
    tone(c, "sine", 300, 0.06, 0.18, c.currentTime, 140);
  },
  "sfx-undo": (c) => tone(c, "sine", 900, 0.06, 0.1, c.currentTime, 500),
  "sfx-clear": (c) => {
    for (let i = 0; i < 6; i++)
      hiss(c, "bandpass", 1600 + (i % 3) * 700, 0.08, 0.05, c.currentTime + i * 0.05);
  },
  // 징글
  "jingle-start": (c) => arp(c, [523, 659, 784, 1047], 0.1, "triangle", 0.1, 0.24),
  "jingle-myturn": (c) => arp(c, [784, 988, 1175, 1568], 0.07, "triangle", 0.1, 0.22),
  "jingle-correct-me": (c) => {
    arp(c, [1047, 1319, 1568, 2093], 0.06, "triangle", 0.11, 0.24);
    for (let i = 0; i < 5; i++)
      tone(c, "sine", 2600 + (i % 2) * 500, 0.04, 0.06, c.currentTime + 0.28 + i * 0.05);
  },
  "jingle-allcorrect": (c) => arp(c, [784, 988, 1175, 1568, 1976], 0.07, "triangle", 0.1, 0.3),
  "jingle-reveal": (c) => {
    tone(c, "triangle", 659, 0.1, 0.18);
    tone(c, "triangle", 988, 0.1, 0.32, c.currentTime + 0.12);
  },
  "jingle-fail": (c) => {
    tone(c, "triangle", 392, 0.09, 0.2);
    tone(c, "triangle", 330, 0.09, 0.2, c.currentTime + 0.2);
    tone(c, "triangle", 262, 0.09, 0.4, c.currentTime + 0.4, 247);
  },
  "jingle-timeup": (c) => {
    tone(c, "square", 880, 0.05, 0.12);
    tone(c, "square", 880, 0.05, 0.12, c.currentTime + 0.16);
    tone(c, "square", 660, 0.05, 0.3, c.currentTime + 0.32);
  },
  "jingle-end": (c) => {
    arp(c, [523, 659, 784, 1047, 784, 1047, 1319], 0.1, "triangle", 0.1, 0.3);
  },
  "jingle-win": (c) => {
    arp(c, [523, 659, 784, 1047, 1319, 1568], 0.08, "triangle", 0.11, 0.32);
    for (let i = 0; i < 8; i++)
      tone(c, "sine", 2400 + (i % 3) * 400, 0.04, 0.06, c.currentTime + 0.5 + i * 0.05);
  },
};

// ───────────── 배경음악 (파일만) ─────────────
// 곡 끝 2.5초 전에 같은 곡을 겹쳐 틀어 이음 (끝이 페이드아웃이어도 끊기지 않게)

const XFADE = 2.5;
let bgmName: string | null = null;
let wantBgm: string | null = null;
const live = new Map<HTMLAudioElement, number>();
let cur: HTMLAudioElement | null = null;

const bgmTarget = () => (getSound().mute ? 0 : getSound().bgm);
function applyBgmVolume() {
  const v = bgmTarget();
  for (const [el, mix] of live) el.volume = Math.min(1, v * mix);
}
function fade(el: HTMLAudioElement, to: number, ms: number) {
  const from = live.get(el) ?? 0;
  const t0 = performance.now();
  const step = () => {
    if (!live.has(el)) return;
    const k = Math.min(1, (performance.now() - t0) / ms);
    const mix = from + (to - from) * k;
    live.set(el, mix);
    el.volume = Math.min(1, bgmTarget() * mix);
    if (k < 1) requestAnimationFrame(step);
    else if (to === 0) {
      el.pause();
      live.delete(el);
    }
  };
  requestAnimationFrame(step);
}
async function startBgm(name: string) {
  const url = fileOf(name);
  if (!url) {
    if (!manifest) setTimeout(() => wantBgm === name && void startBgm(name), 400);
    return;
  }
  if (bgmName === name && cur && !cur.paused) return;
  bgmName = name;
  await spawn(url, name, 1000);
}
async function spawn(url: string, name: string, ms: number) {
  const el = new Audio(url);
  el.volume = 0;
  live.set(el, 0);
  try {
    await el.play();
  } catch {
    live.delete(el);
    if (bgmName === name) bgmName = null;
    return;
  }
  if (bgmName !== name) {
    live.delete(el);
    el.pause();
    return;
  }
  const old = cur;
  cur = el;
  fade(el, 1, ms);
  if (old) fade(old, 0, ms);
  el.ontimeupdate = () => {
    if (cur !== el || !el.duration || el.dataset.next) return;
    if (el.duration - el.currentTime <= XFADE) {
      el.dataset.next = "1";
      void spawn(url, name, XFADE * 1000);
    }
  };
}

// ───────────── 공개 API ─────────────

export type BgmName = "bgm-title" | "bgm-lobby" | "bgm-draw" | "bgm-result";

/** 짧은 소리. 파일이 있으면 파일, 없으면 합성음 */
export function playSfx(name: string) {
  const s = getSound();
  if (s.mute || s.sfx <= 0) return;
  if (playFile(name, s.sfx)) return;
  const c = ac();
  const f = synth[name];
  if (c && f) f(c);
}

/** 진행 음성 (☆, 파일이 있을 때만) — "시작!", "정답!" 같은 한마디 */
export function playVoice(name: string) {
  const s = getSound();
  if (s.mute || s.sfx <= 0) return;
  playFile(`voice-${name}`, Math.min(1, s.sfx * 1.1));
}

/** 배경음악 바꾸기 (null = 끔). 파일이 없으면 조용히 아무것도 안 함 */
export function playBgm(name: BgmName | null) {
  wantBgm = name;
  if (!name) {
    for (const el of live.keys()) fade(el, 0, 600);
    cur = null;
    bgmName = null;
    return;
  }
  if (unlocked && !getSound().mute) void startBgm(name);
}
