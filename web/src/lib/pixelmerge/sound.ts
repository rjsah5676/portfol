"use client";

/*
 * 픽셀 머지 소리 — 효과음(일레븐랩스) · 배경음악(제미나이), 파일: public/pixelmerge/sound (manifest.json)
 *  오늘의 사건 파일(lib/casefile/sound.ts)과 같은 구조: 파일이 없으면 짧은 합성음, 첫 입력 이후에만 소리, 설정은 localStorage.
 *  배경음악은 끊김 없이 돌게 Web Audio 버퍼 반복 (곡 자체가 80초 루프로 잘려 있음).
 */

import { LEVEL, limiter } from "@/lib/soundLevel";

const KEY = "pixelmerge_sound";
const BASE = "/pixelmerge/sound";

export interface SoundSettings {
  mute: boolean;
  bgm: number;
  sfx: number;
}
const DEFAULT: SoundSettings = { mute: false, bgm: 0.5, sfx: 0.8 };
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
  if (bgmGain) bgmGain.gain.value = bgmVolume();
  if (settings.mute) stopBgm();
  else if (wantBgm && unlocked) void startBgm();
  for (const l of listeners) l();
}
export function onSoundChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// ───────────── 파일 ─────────────

let manifest: Record<string, string> | null = null;
let manifestP: Promise<Record<string, string>> | null = null;
function loadManifest(): Promise<Record<string, string>> {
  if (!manifestP)
    manifestP = fetch(`${BASE}/manifest.json`, { cache: "no-cache" })
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : {}))
      .catch(() => ({}))
      .then((m) => (manifest = m));
  return manifestP;
}
const fileOf = (name: string) => (manifest?.[name] ? `${BASE}/${manifest[name]}` : null);

let ctx: AudioContext | null = null;
let unlocked = false;
const raw = new Map<string, Promise<ArrayBuffer | null>>();
const decoded = new Map<string, Promise<AudioBuffer | null>>();

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
const fetchRaw = (url: string) => {
  let p = raw.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    raw.set(url, p);
  }
  return p;
};
function buffer(c: AudioContext, url: string) {
  let p = decoded.get(url);
  if (!p) {
    p = fetchRaw(url).then((b) => (b ? c.decodeAudioData(b.slice(0)).catch(() => null) : null));
    decoded.set(url, p);
  }
  return p;
}

/** 로딩 화면용: 소리 파일을 전부 미리 받아 둠. onEach 는 하나 받을 때마다 (받은 수, 전체 수) */
export async function preloadSounds(onEach?: (done: number, total: number) => void): Promise<void> {
  const m = await loadManifest();
  const urls = Object.values(m).map((f) => `${BASE}/${f}`);
  let done = 0;
  onEach?.(0, urls.length);
  await Promise.all(
    urls.map((u) =>
      fetchRaw(u).then(() => {
        done++;
        onEach?.(done, urls.length);
      })
    )
  );
}

function unlock() {
  if (unlocked || typeof window === "undefined") return;
  unlocked = true;
  ac();
  if (wantBgm) void startBgm();
}
if (typeof window !== "undefined") {
  void loadManifest();
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend().catch(() => {});
    else if (!getSound().mute) void ctx.resume().catch(() => {});
  });
  for (const ev of ["pointerdown", "keydown", "touchstart"])
    window.addEventListener(ev, unlock, { once: true, passive: true });
}

// ───────────── 효과음 ─────────────

/** drop 떨어뜨림 · merge 합침(음높이는 단계마다) · combo 연쇄 · 기술 9종 · over 끝 · tap 단추 */
export type SfxName =
  | "drop"
  | "merge"
  | "combo"
  | "bubble"
  | "fire"
  | "wind"
  | "zap"
  | "whip"
  | "encore"
  | "quake"
  | "pause"
  | "trophy"
  | "over"
  | "tap";

function env(c: AudioContext, peak: number, attack: number, decay: number, at: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(
    Math.max(0.0002, peak * getSound().sfx * LEVEL.pixelmerge.sfx),
    at + attack
  );
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  g.connect(limiter(c));
  return g;
}
function tone(
  c: AudioContext,
  type: OscillatorType,
  f: number,
  peak: number,
  decay: number,
  at = c.currentTime,
  to?: number
) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, at);
  if (to) o.frequency.exponentialRampToValueAtTime(to, at + decay);
  o.connect(env(c, peak, 0.004, decay, at));
  o.start(at);
  o.stop(at + decay + 0.05);
}
/** 파일이 없을 때 대신 쓰는 합성음 */
const synth: Record<SfxName, (c: AudioContext) => void> = {
  drop: (c) => tone(c, "sine", 420, 0.12, 0.08, c.currentTime, 220),
  merge: (c) => tone(c, "square", 660, 0.06, 0.1, c.currentTime, 990),
  combo: (c) =>
    [880, 1175, 1568].forEach((f, i) =>
      tone(c, "triangle", f, 0.07, 0.1, c.currentTime + i * 0.05)
    ),
  bubble: (c) => tone(c, "sine", 500, 0.1, 0.12, c.currentTime, 1100),
  fire: (c) => tone(c, "sawtooth", 160, 0.08, 0.25, c.currentTime, 60),
  wind: (c) => tone(c, "triangle", 900, 0.04, 0.3, c.currentTime, 300),
  zap: (c) => tone(c, "square", 1800, 0.05, 0.12, c.currentTime, 600),
  whip: (c) => tone(c, "square", 1600, 0.06, 0.06, c.currentTime, 400),
  encore: (c) =>
    [988, 1319].forEach((f, i) => tone(c, "square", f, 0.05, 0.12, c.currentTime + i * 0.08)),
  quake: (c) => tone(c, "sawtooth", 70, 0.15, 0.5, c.currentTime, 40),
  pause: (c) =>
    [660, 440].forEach((f, i) => tone(c, "square", f, 0.06, 0.15, c.currentTime + i * 0.12)),
  trophy: (c) =>
    [523, 659, 784, 1047].forEach((f, i) =>
      tone(c, "square", f, 0.06, 0.18, c.currentTime + i * 0.09)
    ),
  over: (c) =>
    [400, 300, 220].forEach((f, i) => tone(c, "square", f, 0.06, 0.25, c.currentTime + i * 0.16)),
  tap: (c) => tone(c, "sine", 1100, 0.05, 0.035),
};

/** rate = 재생 빠르기 (1보다 크면 높은 소리) */
export function playSfx(name: SfxName, vol = 1, rate = 1) {
  const s = getSound();
  if (s.mute || s.sfx <= 0) return;
  const c = ac();
  if (!c) return;
  const url = fileOf(name);
  if (!url) return synth[name](c);
  void buffer(c, url).then((buf) => {
    if (!buf) return synth[name](c);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = vol * s.sfx * LEVEL.pixelmerge.sfx;
    src.connect(g);
    g.connect(limiter(c));
    src.start();
  });
}

// ───────────── 배경음악 (한 곡 반복, 끊김 없이) ─────────────

let wantBgm = false;
let bgmSrc: AudioBufferSourceNode | null = null;
let bgmGain: GainNode | null = null;
const bgmVolume = () => (getSound().mute ? 0 : Math.min(1, getSound().bgm * LEVEL.pixelmerge.bgm));

function stopBgm() {
  try {
    bgmSrc?.stop();
  } catch {}
  bgmSrc = null;
}
async function startBgm() {
  await loadManifest();
  const url = fileOf("bgm-main");
  const c = ac();
  if (!url || !c || !wantBgm || getSound().mute || bgmSrc) return;
  const buf = await buffer(c, url);
  if (!buf || !wantBgm || bgmSrc) return;
  bgmGain ??= c.createGain();
  bgmGain.gain.value = bgmVolume();
  bgmGain.connect(c.destination);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.connect(bgmGain);
  src.start();
  bgmSrc = src;
}

/** 배경음악 켜고 끄기 (판을 하는 동안 on) */
export function playBgm(on: boolean) {
  wantBgm = on;
  if (!on) return stopBgm();
  if (unlocked && !getSound().mute) void startBgm();
}
