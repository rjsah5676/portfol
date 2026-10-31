"use client";

/*
 * 니들이 한글을 알아? 소리 — 효과음(일레븐랩스, public/hangul/sfx/<이름>.mp3) · 배경음악(있으면 public/hangul/bgm/*.mp3)
 *  오늘의 용의자(lib/suspect/sound.ts)와 같은 구조: 첫 입력 이후에만 소리, 설정은 localStorage, 로딩 화면에서 미리 받음.
 *  효과음 후보(alt/<이름>-<번호>.mp3)는 ?review=sfx 화면에서 바꿔 들어 볼 수 있음 — 고른 번호는 이 브라우저에만 저장.
 *  같은 소리가 한꺼번에 몰리면(쏘기 · 처치) 간격을 두고, 높낮이를 살짝 흔들어 덜 기계적으로.
 */

import { LEVEL, limiter } from "@/lib/soundLevel";

export const SFX_NAMES = [
  "select",
  "merge",
  "syllable",
  "word",
  "place",
  "erase",
  "punct",
  "discard",
  "sent-best",
  "sent-good",
  "sent-meh",
  "link",
  "read",
  "shot",
  "kill",
  "hit",
  "wave",
  "boss",
  "warn",
  "over",
  "start",
  "switch",
  "click",
  "open",
  "like",
  "card",
  "drop",
] as const;
export type SfxName = (typeof SFX_NAMES)[number];

const KEY = "hangul_sound";
const PICK_KEY = "hangul_sfx_pick";
const BASE = "/hangul/sfx";

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
  for (const l of listeners) l();
}
export function onSoundChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 후보 고르기 (?review=sfx): 이름 → 후보 번호 (없으면 기본 파일) */
export function getPicks(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(PICK_KEY) || "{}") as Record<string, number>;
  } catch {
    return {};
  }
}
export function setPick(name: SfxName, n: number | null) {
  const p = getPicks();
  if (n == null) delete p[name];
  else p[name] = n;
  try {
    localStorage.setItem(PICK_KEY, JSON.stringify(p));
  } catch {}
}
const urlOf = (name: string, alt?: number) =>
  alt ? `${BASE}/alt/${name}-${alt}.mp3` : `${BASE}/${name}.mp3`;

let ctx: AudioContext | null = null;
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

/** 로딩 화면용: 효과음을 전부 미리 받아 둠 (받은 수, 전체 수) */
export async function preloadSounds(onEach?: (done: number, total: number) => void): Promise<void> {
  const picks = getPicks();
  const urls = SFX_NAMES.map((n) => urlOf(n, picks[n]));
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

// 같은 소리 최소 간격(초)과 높낮이 흔들기
const GAP: Partial<Record<SfxName, number>> = {
  shot: 0.07,
  kill: 0.06,
  hit: 0.06,
  place: 0.03,
  erase: 0.05,
  syllable: 0.04,
  merge: 0.04,
  word: 0.05,
  discard: 0.05,
};
const WOBBLE: Partial<Record<SfxName, number>> = {
  shot: 0.12,
  kill: 0.1,
  hit: 0.1,
  place: 0.06,
  syllable: 0.05,
  merge: 0.05,
  select: 0.04,
  click: 0.04,
  punct: 0.06,
};
const last = new Map<string, number>();

export function playSfx(name: SfxName, vol = 1, alt?: number) {
  const s = getSound();
  if (s.mute || s.sfx <= 0) return;
  const c = ac();
  if (!c) return;
  const now = c.currentTime;
  if (now - (last.get(name) ?? -1) < (GAP[name] ?? 0)) return;
  last.set(name, now);
  const url = urlOf(name, alt ?? getPicks()[name]);
  void buffer(c, url).then((buf) => {
    if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    const w = WOBBLE[name];
    if (w) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * w;
    const g = c.createGain();
    g.gain.value = vol * s.sfx * LEVEL.hangul.sfx;
    src.connect(g);
    g.connect(limiter(c));
    src.start();
  });
}
/** 게임이 이번 프레임에 낸 소리들 (game.ts g.sfx) */
export function playAll(names: string[]) {
  for (const n of new Set(names))
    if ((SFX_NAMES as readonly string[]).includes(n)) playSfx(n as SfxName);
}
