"use client";

/*
 * 오늘의 용의자 소리 — 배경음악(제미나이) · 효과음(일레븐랩스), 파일: public/suspect/sound/*.mp3 (manifest.json)
 *  DOODLE PARTY(lib/sketch/sfx.ts)와 같은 구조: 파일이 없으면 짧은 합성음, 첫 입력 이후에만 소리, 설정은 localStorage.
 *  preloadSounds() 로 로딩 화면에서 미리 받아 둠 (진행률 표시용으로 받은 수를 알려 줌).
 */

import { LEVEL, limiter } from "@/lib/soundLevel";

const KEY = "suspect_sound";
const BASE = "/suspect/sound";

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
  if (bgmEl) bgmEl.volume = bgmVolume();
  if (settings.mute) bgmEl?.pause();
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

/**
 * 로딩 화면용: 소리 파일을 전부 미리 받아 둠. onEach 는 하나 받을 때마다 (받은 수, 전체 수)
 * 배경음악도 같이 받아서 처음 틀 때 끊기지 않게 (브라우저 캐시에 들어감)
 */
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
    if (!bgmEl) return;
    if (document.hidden) bgmEl.pause();
    else if (wantBgm && !getSound().mute) void bgmEl.play().catch(() => {});
  });
  for (const ev of ["pointerdown", "keydown", "touchstart"])
    window.addEventListener(ev, unlock, { once: true, passive: true });
}

// ───────────── 효과음 ─────────────

export type SfxName =
  "sfx-tap" | "sfx-stamp" | "sfx-wrong" | "sfx-hint" | "sfx-flip" | "jingle-clear";

function env(c: AudioContext, peak: number, attack: number, decay: number, at: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(
    Math.max(0.0002, peak * getSound().sfx * LEVEL.suspect.sfx),
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
  "sfx-tap": (c) => tone(c, "sine", 1100, 0.05, 0.035),
  "sfx-stamp": (c) => tone(c, "sine", 180, 0.3, 0.12, c.currentTime, 90),
  "sfx-wrong": (c) => {
    tone(c, "triangle", 260, 0.12, 0.1);
    tone(c, "triangle", 200, 0.12, 0.16, c.currentTime + 0.09);
  },
  "sfx-hint": (c) =>
    [1319, 1760].forEach((f, i) => tone(c, "sine", f, 0.07, 0.18, c.currentTime + i * 0.07)),
  "sfx-flip": (c) => tone(c, "triangle", 520, 0.05, 0.08, c.currentTime, 900),
  "jingle-clear": (c) =>
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      tone(c, "triangle", f, 0.1, 0.3, c.currentTime + i * 0.08)
    ),
};

export function playSfx(name: SfxName, vol = 1) {
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
    const g = c.createGain();
    g.gain.value = vol * s.sfx * LEVEL.suspect.sfx;
    src.connect(g);
    g.connect(limiter(c));
    src.start();
  });
}

// ───────────── 배경음악 (한 곡 반복) ─────────────

let wantBgm = false;
let bgmEl: HTMLAudioElement | null = null;
const bgmVolume = () => (getSound().mute ? 0 : Math.min(1, getSound().bgm * LEVEL.suspect.bgm));

async function startBgm() {
  await loadManifest();
  const url = fileOf("bgm-main");
  if (!url || !wantBgm || getSound().mute) return;
  if (!bgmEl) {
    bgmEl = new Audio(url);
    bgmEl.loop = true;
  }
  bgmEl.volume = bgmVolume();
  if (bgmEl.paused) await bgmEl.play().catch(() => {});
}

/** 배경음악 켜고 끄기 (게임 화면에 들어오면 on, 나가면 off) */
export function playBgm(on: boolean) {
  wantBgm = on;
  if (!on) {
    bgmEl?.pause();
    return;
  }
  if (unlocked && !getSound().mute) void startBgm();
}
