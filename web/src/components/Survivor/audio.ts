/*
 * 픽셀 타운 서바이버 소리 — 파일이 있으면(public/survivor/sfx/<이름>.mp3) 그걸, 없으면 칩튠 합성음.
 * 젬 소리는 연달아 주울수록 음이 올라감 (뱀서식 손맛).
 */
import { LEVEL, limiter } from "@/lib/soundLevel";

export type Sfx = "gem" | "hit" | "kill" | "lvl" | "card" | "chest" | "reel" | "jackpot" | "boom" | "hurt" | "dash" | "ult" | "boss" | "warn" | "pick" | "fuse" | "win" | "dead" | "click" | "coin" | "bolt" | "throw" | "relic" | "bless" | "buy" | "trial" | "rage" | "slam" | "shield" | "curse" | "flag" | "ot";

let ctx: AudioContext | null = null;
let gated = false;
let unlocked = false;
const PREF = "pts-sound";
let vol = 0.8;
let muted = false;
try {
  const v = JSON.parse(localStorage.getItem(PREF) ?? "null");
  if (v) ({ vol, muted } = v);
} catch {}

export const soundPref = () => ({ vol, muted });
export function setSound(o: { vol?: number; muted?: boolean }) {
  if (o.vol !== undefined) vol = o.vol;
  if (o.muted !== undefined) muted = o.muted;
  try {
    localStorage.setItem(PREF, JSON.stringify({ vol, muted }));
  } catch {}
  if (bgmEl) bgmEl.volume = muted ? 0 : vol * 0.45;
}

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}
export function unlock() {
  unlocked = true;
  ac();
  if (bgmWant && bgmEl?.paused) void bgmEl.play().catch(() => {});
}
export function setGate(g: boolean) {
  gated = g;
  if (g) bgmEl?.pause();
  else if (bgmWant) void bgmEl?.play().catch(() => {});
}

/* 파일 (있으면) */
const files = new Map<string, Promise<AudioBuffer | null>>();
function file(c: AudioContext, name: string) {
  let p = files.get(name);
  if (!p) {
    p = fetch(`/survivor/sfx/${name}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((b) => c.decodeAudioData(b))
      .catch(() => null);
    files.set(name, p);
  }
  return p;
}
const hasFile = new Map<string, AudioBuffer | null>();
const FILES = new Set<Sfx>(["lvl", "chest", "jackpot", "boom", "boss", "ult", "fuse", "win", "dead", "warn", "hurt", "dash", "pick", "card", "relic", "bless", "buy", "trial", "rage", "slam", "shield", "curse", "flag", "ot"]);
/** 파일 미리 받기 (처음 울릴 때 늦지 않게) */
export function preloadSfx() {
  const c = ac();
  if (!c) return;
  for (const n of FILES)
    if (!hasFile.has(n)) {
      hasFile.set(n, null);
      void file(c, n).then((b) => hasFile.set(n, b));
    }
}

/* 합성 */
function tone(c: AudioContext, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, at = 0) {
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * vol * LEVEL.mine), t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(limiter(c));
  o.start(t);
  o.stop(t + dur + 0.02);
}
let noiseBuf: AudioBuffer | null = null;
function noise(c: AudioContext, dur: number, peak: number, lp: number, at = 0) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + at;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = lp;
  const g = c.createGain();
  g.gain.setValueAtTime(peak * vol * LEVEL.mine, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(limiter(c));
  s.start(t);
  s.stop(t + dur + 0.02);
}

/** 같은 소리가 한 프레임에 수십 번 겹치지 않게 */
const last = new Map<string, number>();
const GAP: Partial<Record<Sfx, number>> = { gem: 0.035, hit: 0.045, kill: 0.04, coin: 0.05, throw: 0.06, boom: 0.06, bolt: 0.05 };

let gemStreak = 0;
let gemAt = 0;

export function sfx(name: Sfx) {
  if (muted || gated || !unlocked) return;
  const c = ac();
  if (!c) return;
  const now = c.currentTime;
  const gap = GAP[name] ?? 0.02;
  if (now - (last.get(name) ?? -1) < gap) return;
  last.set(name, now);
  // 파일이 있으면 파일 (ElevenLabs — public/survivor/sfx)
  if (FILES.has(name) && !hasFile.has(name)) {
    hasFile.set(name, null);
    void file(c, name).then((b) => hasFile.set(name, b));
  }
  const buf = hasFile.get(name);
  if (buf && name !== "gem") {
    const s = c.createBufferSource();
    s.buffer = buf;
    const g = c.createGain();
    g.gain.value = vol * LEVEL.mine;
    s.connect(g).connect(limiter(c));
    s.start();
    return;
  }
  switch (name) {
    case "gem": {
      if (now - gemAt > 0.5) gemStreak = 0;
      gemAt = now;
      gemStreak = Math.min(24, gemStreak + 1);
      const f = 880 * Math.pow(2, gemStreak / 24);
      tone(c, "square", f, f * 1.5, 0.05, 0.05);
      break;
    }
    case "hit":
      noise(c, 0.04, 0.12, 3000);
      break;
    case "kill":
      tone(c, "square", 300, 90, 0.07, 0.06);
      break;
    case "coin":
      tone(c, "square", 988, 988, 0.05, 0.07);
      tone(c, "square", 1319, 1319, 0.12, 0.07, 0.05);
      break;
    case "throw":
      tone(c, "triangle", 600, 300, 0.06, 0.05);
      break;
    case "lvl":
      [523, 659, 784, 1047].forEach((f, i) => tone(c, "square", f, f, 0.12, 0.08, i * 0.06));
      break;
    case "card":
      tone(c, "square", 660, 990, 0.08, 0.08);
      break;
    case "chest":
      [392, 523, 659].forEach((f, i) => tone(c, "triangle", f, f, 0.2, 0.12, i * 0.08));
      break;
    case "reel":
      tone(c, "square", 1200, 1200, 0.025, 0.05);
      break;
    case "jackpot":
      [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(c, "square", f, f, 0.16, 0.08, i * 0.07));
      noise(c, 0.5, 0.05, 8000, 0.1);
      break;
    case "boom":
      noise(c, 0.25, 0.3, 900);
      tone(c, "sine", 140, 40, 0.25, 0.25);
      break;
    case "bolt":
      noise(c, 0.15, 0.2, 5000);
      tone(c, "sawtooth", 900, 120, 0.12, 0.05);
      break;
    case "hurt":
      tone(c, "sawtooth", 220, 80, 0.15, 0.12);
      break;
    case "dash":
      noise(c, 0.12, 0.12, 2500);
      tone(c, "triangle", 400, 900, 0.1, 0.05);
      break;
    case "ult":
      tone(c, "sawtooth", 110, 880, 0.5, 0.12);
      noise(c, 0.6, 0.2, 2000, 0.05);
      break;
    case "boss":
      tone(c, "sawtooth", 80, 60, 1.2, 0.2);
      tone(c, "square", 160, 120, 1.2, 0.08);
      break;
    case "warn":
      [0, 0.18].forEach((d) => tone(c, "square", 880, 660, 0.14, 0.08, d));
      break;
    case "pick":
      tone(c, "square", 660, 1320, 0.1, 0.08);
      break;
    case "fuse":
      [392, 494, 587, 784, 988, 1175, 1568].forEach((f, i) => tone(c, "square", f, f, 0.14, 0.09, i * 0.06));
      break;
    case "win":
      [523, 523, 784, 1047].forEach((f, i) => tone(c, "square", f, f, 0.25, 0.1, i * 0.15));
      break;
    case "dead":
      [392, 330, 262, 196].forEach((f, i) => tone(c, "triangle", f, f * 0.98, 0.3, 0.12, i * 0.18));
      break;
    case "click":
      tone(c, "square", 880, 880, 0.03, 0.05);
      break;
    // 파일이 아직 없을 때 대신
    case "relic":
    case "bless":
    case "flag":
      [659, 784, 988, 1319].forEach((f, i) => tone(c, "triangle", f, f, 0.14, 0.09, i * 0.05));
      break;
    case "buy":
      tone(c, "square", 1319, 1319, 0.06, 0.07);
      tone(c, "square", 1760, 1760, 0.14, 0.07, 0.06);
      break;
    case "trial":
    case "ot":
      [0, 0.22].forEach((d) => tone(c, "sawtooth", 220, 330, 0.18, 0.08, d));
      break;
    case "rage":
      tone(c, "sawtooth", 90, 50, 0.7, 0.2);
      break;
    case "slam":
      noise(c, 0.3, 0.3, 600);
      tone(c, "sine", 120, 35, 0.3, 0.25);
      break;
    case "shield":
      tone(c, "sine", 1200, 600, 0.12, 0.1);
      break;
    case "curse":
      [523, 466, 392, 311].forEach((f, i) => tone(c, "triangle", f, f * 0.97, 0.16, 0.08, i * 0.07));
      break;
  }
}

/* 배경 음악 (파일이 있을 때만) */
let bgmEl: HTMLAudioElement | null = null;
let bgmWant: string | null = null;
export function playBgm(name: string | null) {
  bgmWant = name;
  if (typeof window === "undefined") return;
  if (!name) {
    bgmEl?.pause();
    return;
  }
  if (!bgmEl) {
    bgmEl = new Audio();
    bgmEl.loop = true;
  }
  const src = `/survivor/bgm/${name}.mp3`;
  if (!bgmEl.src.endsWith(src)) {
    bgmEl.src = src;
    bgmEl.onerror = () => {};
  }
  bgmEl.volume = muted ? 0 : vol * 0.45;
  if (unlocked && !gated) void bgmEl.play().catch(() => {});
}
