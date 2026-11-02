/*
 * 주식게임 소리 — 전용 파일만 씀 (/stock/sound/*.mp3). 다른 게임 소리 엔진 · 설정과 섞지 않음.
 *  · 효과음: 첫 입력 뒤 Web Audio 로 (겹쳐 울려도 끊기지 않게) · 배경음악: <audio> 한 개 반복, 탭이 가려지면 멈춤
 *  · 설정(음소거 · 음량)은 localStorage "stock:sound"
 */

type Key = "press" | "tab" | "buy" | "sell" | "next" | "fast" | "order" | "fill" | "win" | "lose" | "big" | "liq" | "coin" | "enter" | "exit" | "shock" | "tick" | "tickLast" | "warn";

/** [파일, 음량] */
const FILE: Record<Key, [string, number]> = {
  press: ["sfx-stk-press", 0.7],
  tab: ["sfx-stk-tick", 0.5],
  buy: ["sfx-stk-buy", 1],
  sell: ["sfx-stk-sell", 1],
  next: ["sfx-stk-candle", 0.8],
  fast: ["sfx-stk-candle", 0.6],
  order: ["sfx-stk-tick", 0.8],
  fill: ["sfx-stk-fill", 1],
  win: ["jingle-stk-win", 1],
  lose: ["jingle-stk-lose", 1],
  big: ["jingle-stk-big", 1],
  liq: ["sfx-stk-liq", 1],
  coin: ["sfx-stk-coin", 1],
  enter: ["sfx-stk-press", 0.8],
  exit: ["sfx-stk-press", 0.5],
  shock: ["sfx-stk-shock", 1],
  tick: ["sfx-stk-tick", 0.8],
  tickLast: ["sfx-stk-tick", 1],
  warn: ["sfx-stk-liq", 0.5],
};

export type Bgm = "trade" | "coin" | "battle";

const KEY = "stock:sound";
interface Settings {
  mute: boolean;
  sfx: number;
  bgm: number;
}
let settings: Settings = { mute: false, sfx: 0.8, bgm: 0.45 };
try {
  if (typeof window !== "undefined") settings = { ...settings, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
} catch {
  /* 저장 안 되는 브라우저 */
}
const listeners = new Set<() => void>();
export const getSound = () => settings;
export function setSound(p: Partial<Settings>) {
  settings = { ...settings, ...p };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* 무시 */
  }
  applyBgmVolume();
  listeners.forEach((f) => f());
}
export const onSound = (f: () => void) => (listeners.add(f), () => void listeners.delete(f));

const url = (f: string) => `/stock/sound/${f}.mp3`;

// ── 효과음 ──
let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}
function load(f: string): Promise<AudioBuffer | null> {
  let p = buffers.get(f);
  if (!p) {
    const a = audio();
    p = a
      ? fetch(url(f))
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
          .then((b) => a.decodeAudioData(b))
          .catch(() => null)
      : Promise.resolve(null);
    buffers.set(f, p);
  }
  return p;
}

export function sfx(k: Key, gain = 1) {
  if (settings.mute || settings.sfx <= 0) return;
  const a = audio();
  if (!a) return;
  const [f, g] = FILE[k];
  void load(f).then((buf) => {
    if (!buf || settings.mute) return;
    const src = a.createBufferSource();
    const vol = a.createGain();
    vol.gain.value = Math.min(1, g * gain * settings.sfx);
    src.buffer = buf;
    src.connect(vol).connect(a.destination);
    src.start();
  });
}

// ── 배경음악 ──
let el: HTMLAudioElement | null = null;
let want: Bgm | null = null;
let unlocked = false;
const bgmVol = () => (settings.mute ? 0 : settings.bgm * 0.6);
function applyBgmVolume() {
  if (el) el.volume = bgmVol();
  if (el && settings.mute) el.pause();
  else if (el && want && unlocked && document.visibilityState === "visible") void el.play().catch(() => {});
}
function startBgm() {
  if (typeof window === "undefined" || !want || !unlocked || settings.mute) return;
  const src = url(`bgm-stk-${want}`);
  if (!el) {
    el = new Audio();
    el.loop = true;
    el.preload = "auto";
  }
  if (!el.src.endsWith(src)) el.src = src;
  el.volume = bgmVol();
  if (document.visibilityState === "visible") void el.play().catch(() => {});
}

/** 화면마다 배경음악 (null 이면 멈춤). 첫 입력 전에는 기다렸다가 입력이 오면 바로 */
export function bgm(name: Bgm | null) {
  want = name;
  if (!name) {
    el?.pause();
    return;
  }
  startBgm();
}

if (typeof window !== "undefined") {
  const unlock = () => {
    unlocked = true;
    audio();
    startBgm();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  document.addEventListener("visibilitychange", () => {
    if (!el) return;
    if (document.visibilityState === "hidden") el.pause();
    else if (want && unlocked && !settings.mute) void el.play().catch(() => {});
  });
}

/** 손익 결과에 맞는 징글 */
export function resultSound(ret: number) {
  if (ret >= 0.3) sfx("big");
  else if (ret > 0) sfx("win");
  else sfx("lose");
}
