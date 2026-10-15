/**
 * DICE TOWN 소리 — 효과음(Web Audio) · 배경음(<audio> 반복) · 음량 설정.
 * 파일: public/marble/sfx/<이름>.mp3 · public/marble/bgm/<이름>.mp3 (목록은 아래 SFX · BGM).
 * 파일이 아직 없거나 못 불러오면 효과음은 짧은 합성음(삑 · 딸깍)으로 대신하고, 배경음은 조용히 넘어감.
 * 첫 누르기에서 unlock() (Stage 가 부름). 음량 · 끄기는 이 기기에 저장.
 */

export interface AudioPrefs {
  bgm: number;
  sfx: number;
  mute: boolean;
}
const KEY = "mb_audio";
const DEFAULT: AudioPrefs = { bgm: 0.45, sfx: 0.7, mute: false };

/** 효과음 이름 → 파일 (없으면 합성음). 일레븐랩스로 만든 것을 같은 이름으로 넣으면 바로 바뀜 */
export const SFX: Record<string, { gain?: number; synth: Synth }> = {
  click: { synth: { f: 660, d: 0.04, type: "square", v: 0.12 } },
  hover: { synth: { f: 990, d: 0.02, type: "square", v: 0.05 } },
  dice: { synth: { f: 220, d: 0.25, type: "noise", v: 0.25 } },
  "dice-land": { synth: { f: 330, d: 0.08, type: "square", v: 0.18, to: 180 } },
  step: { synth: { f: 520, d: 0.05, type: "triangle", v: 0.18, to: 700 } },
  coin: { synth: { f: 988, d: 0.12, type: "square", v: 0.12, to: 1318 } },
  pay: { synth: { f: 420, d: 0.18, type: "square", v: 0.14, to: 260 } },
  build: { synth: { f: 330, d: 0.18, type: "square", v: 0.16, to: 660 } },
  landmark: { synth: { f: 523, d: 0.45, type: "square", v: 0.16, to: 1046 } },
  acquire: { synth: { f: 392, d: 0.3, type: "sawtooth", v: 0.12, to: 784 } },
  card: { synth: { f: 740, d: 0.2, type: "triangle", v: 0.18, to: 1100 } },
  skill: { synth: { f: 300, d: 0.35, type: "sawtooth", v: 0.13, to: 900 } },
  jail: { synth: { f: 200, d: 0.3, type: "square", v: 0.14, to: 120 } },
  warp: { synth: { f: 200, d: 0.4, type: "sine", v: 0.2, to: 1200 } },
  fest: { synth: { f: 659, d: 0.3, type: "triangle", v: 0.18, to: 988 } },
  news: { synth: { f: 784, d: 0.25, type: "triangle", v: 0.16, to: 523 } },
  rotate: { synth: { f: 150, d: 0.6, type: "sawtooth", v: 0.1, to: 300 } },
  mono: { synth: { f: 523, d: 0.5, type: "square", v: 0.15, to: 1568 } },
  bankrupt: { synth: { f: 300, d: 0.6, type: "square", v: 0.15, to: 80 } },
  win: { synth: { f: 523, d: 0.7, type: "square", v: 0.15, to: 1046 } },
  lose: { synth: { f: 392, d: 0.6, type: "triangle", v: 0.15, to: 196 } },
  turn: { synth: { f: 880, d: 0.12, type: "triangle", v: 0.14, to: 1175 } },
  deny: { synth: { f: 160, d: 0.12, type: "square", v: 0.12 } },
  "gacha-pull": { synth: { f: 200, d: 0.7, type: "sawtooth", v: 0.1, to: 900 } },
  "gacha-r": { synth: { f: 660, d: 0.12, type: "triangle", v: 0.15 } },
  "gacha-sr": { synth: { f: 784, d: 0.25, type: "triangle", v: 0.17, to: 1046 } },
  "gacha-ssr": { synth: { f: 523, d: 0.8, type: "square", v: 0.16, to: 2093 } },
  "gacha-ur": { synth: { f: 392, d: 1.1, type: "square", v: 0.16, to: 2349 } },
  upgrade: { synth: { f: 440, d: 0.4, type: "square", v: 0.14, to: 1320 } },
  ready: { synth: { f: 660, d: 0.1, type: "square", v: 0.12, to: 990 } },
  join: { synth: { f: 523, d: 0.15, type: "triangle", v: 0.14, to: 784 } },
};

/** 배경음 (주인이 만들어 넣음 — 없으면 조용) */
export const BGM: Record<string, string> = {
  lobby: "/marble/bgm/lobby.mp3",
  town: "/marble/bgm/town.mp3",
  cross: "/marble/bgm/cross.mp3",
  orgel: "/marble/bgm/orgel.mp3",
  gacha: "/marble/bgm/gacha.mp3",
  win: "/marble/bgm/win.mp3",
};

interface Synth {
  f: number;
  d: number;
  type: OscillatorType | "noise";
  v: number;
  to?: number;
}

let prefs: AudioPrefs = { ...DEFAULT };
let loaded = false;
const listeners = new Set<(p: AudioPrefs) => void>();
function loadPrefs() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) prefs = { ...DEFAULT, ...(JSON.parse(raw) as Partial<AudioPrefs>) };
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
}
export function getPrefs(): AudioPrefs {
  loadPrefs();
  return prefs;
}
export function setPrefs(p: Partial<AudioPrefs>) {
  loadPrefs();
  prefs = { ...prefs, ...p };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* 무시 */
  }
  if (bgmEl) bgmEl.volume = prefs.mute ? 0 : prefs.bgm * 0.6;
  for (const l of listeners) l(prefs);
}
export function onPrefs(fn: (p: AudioPrefs) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

let ctx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer | null>();
const loading = new Map<string, Promise<void>>();
const lastAt = new Map<string, number>();

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

function load(name: string): Promise<void> {
  const have = loading.get(name);
  if (have) return have;
  const c = ensureCtx();
  const p = c
    ? fetch(`/marble/sfx/${name}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((ab) => c.decodeAudioData(ab))
        .then(
          (buf) => void buffers.set(name, buf),
          () => void buffers.set(name, null)
        )
    : Promise.resolve(void buffers.set(name, null));
  loading.set(name, p);
  return p;
}

function synth(c: AudioContext, s: Synth, vol: number) {
  const t = c.currentTime;
  const g = c.createGain();
  g.gain.setValueAtTime(s.v * vol, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + s.d);
  g.connect(c.destination);
  if (s.type === "noise") {
    const len = Math.floor(c.sampleRate * s.d);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) * (i % 900 < 450 ? 1 : 0.4);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(g);
    src.start(t);
    return;
  }
  const o = c.createOscillator();
  o.type = s.type;
  o.frequency.setValueAtTime(s.f, t);
  if (s.to) o.frequency.exponentialRampToValueAtTime(s.to, t + s.d);
  o.connect(g);
  o.start(t);
  o.stop(t + s.d + 0.02);
}

/** 효과음 (같은 소리는 40ms 안에 두 번 안 남) */
export function sfx(name: string) {
  const p = getPrefs();
  if (p.mute || p.sfx <= 0 || quiet()) return;
  const c = ensureCtx();
  if (!c || c.state !== "running") return;
  const now = performance.now();
  if (now - (lastAt.get(name) ?? 0) < 40) return;
  lastAt.set(name, now);
  const def = SFX[name];
  const buf = buffers.get(name);
  if (buf) {
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = p.sfx * (def?.gain ?? 1);
    src.connect(g).connect(c.destination);
    src.start();
    return;
  }
  if (buf === undefined && FILES.includes(name)) void load(name);
  if (def) synth(c, def.synth, p.sfx);
}

/** 실제 파일이 있는 효과음 (없는 건 합성음) */
const FILES = ["dice", "step", "coin", "pay", "build", "landmark", "acquire", "skill", "jail", "news", "rotate", "mono", "bankrupt", "win", "lose", "gacha-pull", "gacha-ssr", "gacha-ur", "upgrade", "card", "warp", "fest", "turn", "gacha-sr", "click", "deny", "ready", "join"];

/* ───────── 배경음 ───────── */

let bgmEl: HTMLAudioElement | null = null;
let bgmName = "";
export function playBgm(name: string) {
  if (typeof window === "undefined" || name === bgmName) return;
  bgmName = name;
  const src = BGM[name];
  if (!src) return stopBgm();
  if (!bgmEl) {
    bgmEl = new Audio();
    bgmEl.loop = true;
  }
  bgmEl.src = src;
  bgmEl.loop = name !== "win";
  bgmEl.volume = getPrefs().mute ? 0 : getPrefs().bgm * 0.6;
  if (!quiet()) void bgmEl.play().catch(() => {});
}
export function stopBgm() {
  bgmName = "";
  bgmEl?.pause();
}

/* ───────── 조용히 해야 할 때 ─────────
 * 숨김: 폰 홈 · 앱 전환 · 탭 숨김 → 효과음 · 배경음 모두 멈춤 (포커와 같음)
 * 관문: 폰 「전체화면으로 플레이」· 「가로로 돌려 주세요」 안내 화면 → 소리 없음 */
let hidden = false;
let gated = false;
const quiet = () => hidden || gated;
function applyQuiet() {
  if (quiet()) {
    bgmEl?.pause();
    if (ctx && ctx.state === "running") void ctx.suspend().catch(() => {});
  } else {
    if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
    if (bgmEl && bgmName) void bgmEl.play().catch(() => {});
  }
}
/** 안내 화면(관문) 동안 소리 끔 — Stage 가 부름 */
export function setGate(on: boolean) {
  if (gated === on) return;
  gated = on;
  applyQuiet();
}
if (typeof document !== "undefined") {
  const onVis = () => {
    hidden = document.hidden;
    applyQuiet();
  };
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("pagehide", () => {
    hidden = true;
    applyQuiet();
  });
  window.addEventListener("pageshow", onVis);
}

/** 첫 누르기: 소리 잠금 풀기 + 자주 쓰는 소리 미리 불러오기 */
export function unlock() {
  const c = ensureCtx();
  for (const n of FILES) void load(n);
  if (quiet()) return;
  if (c && c.state !== "running") void c.resume().catch(() => {});
  if (bgmEl && bgmEl.paused && bgmName) void bgmEl.play().catch(() => {});
}
