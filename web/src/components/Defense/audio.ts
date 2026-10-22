/**
 * 픽셀 글리치 디펜스 소리 — 효과음(Web Audio) · 배경음(<audio> 반복) · 음량 설정.
 * 파일 목록은 lib/defense/assets.ts (SFX · BGM). 파일이 없거나 못 불러오면 그 소리만 조용히 넘어감.
 *
 *  - 브라우저는 사용자가 한 번 누르기 전엔 소리를 막음 → 첫 누르기에서 unlock() (Stage 가 부름)
 *  - 자주 나는 소리(타격 · 처치)는 종류마다 간격 제한 + 한 번에 겹치는 수 제한 (배속에서도 시끄럽지 않게)
 *  - 음량 · 끄기는 이 기기에 저장 (localStorage)
 *  - 시뮬과 상관없음 (화면 쪽 전용)
 */
import { BGM, SFX } from "@/lib/defense/assets";

export interface AudioPrefs {
  bgm: number;
  sfx: number;
  mute: boolean;
  /** 마우스 커서 크기 (1 기본 · 2 크게 · 3 아주 크게 · 0 시스템 커서) — 소리와 같이 이 기기에 저장 */
  cursor: number;
}
const KEY = "dfn_audio";
const DEFAULT: AudioPrefs = { bgm: 0.5, sfx: 0.7, mute: false, cursor: 1 };

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
    /* 저장소를 못 쓰는 환경: 기본값 */
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
  applyBgmVolume();
  for (const l of listeners) l(prefs);
}
export function onPrefs(fn: (p: AudioPrefs) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/* ───────── 효과음 ───────── */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<string, AudioBuffer | null>();
const loading = new Map<string, Promise<void>>();
const lastAt = new Map<string, number>();
interface Voice {
  src: AudioBufferSourceNode;
  g: GainNode;
  combat: boolean;
}
const voices: Voice[] = [];
let speed = 1;
/** 판 안에서 끝없이 나는 전투음 — 따로 수를 줄이고, 다른 소리가 들어올 자리를 내 줌 */
const COMBAT = new Set(["hit-phys", "hit-mech", "hit-magic", "die", "ult"]);
const COMBAT_VOICES = 6;

/** 종류별 최소 간격(ms) · 같이 울릴 수 있는 수 — 없으면 기본 40ms */
const GAP: Record<string, number> = {
  "hit-phys": 70,
  "hit-mech": 70,
  "hit-magic": 70,
  die: 60,
  "ui-hover": 45,
  "ui-click": 30,
  deny: 150,
  ult: 120,
  summon: 50,
  merge: 80,
  wave: 400,
};
const MAX_VOICES = 14;

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.connect(ctx.destination);
  return ctx;
}

/** 효과음 파일만 받아 둠 — 소리 엔진 없이 (사용자가 누르기 전, 로딩 화면에서). 못 받으면 null */
const raw = new Map<string, Promise<ArrayBuffer | null>>();
export function fetchSfx(name: string): Promise<ArrayBuffer | null> {
  let p = raw.get(name);
  if (!p) {
    const def = SFX[name];
    p = def
      ? fetch(def.src).then(
          (r) => (r.ok ? r.arrayBuffer() : null),
          () => null
        )
      : Promise.resolve(null);
    raw.set(name, p);
  }
  return p;
}

function load(name: string): Promise<void> {
  const have = loading.get(name);
  if (have) return have;
  const def = SFX[name];
  const c = ensureCtx();
  const p =
    def && c
      ? fetchSfx(name)
          .then((ab) => (ab ? c.decodeAudioData(ab) : Promise.reject(new Error("no sfx"))))
          .then(
            (buf) => void buffers.set(name, buf),
            () => void buffers.set(name, null)
          )
      : Promise.resolve(void buffers.set(name, null));
  loading.set(name, p);
  return p;
}

/** 화면이 가려지면(다른 앱 · 탭 · 홈 화면) 소리 엔진과 배경음을 멈춰 배터리를 아낌 */
let visHooked = false;
function hookVisibility() {
  if (visHooked || typeof document === "undefined") return;
  visHooked = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      void ctx?.suspend().catch(() => {});
      bgm?.pause();
    } else {
      void ctx?.resume().catch(() => {});
      if (bgmWanted && bgm?.paused) void bgm.play().catch(() => {});
    }
  });
}

/** 효과음 미리 불러오기 (게임 시작 때) */
export function preloadSfx() {
  hookVisibility();
  if (!ensureCtx()) return;
  for (const n of Object.keys(SFX)) void load(n);
}

/** 사용자가 처음 누를 때 — 소리 잠금 풀기 + 미리 불러오기 + 배경음 시작 */
export function unlock() {
  const c = ensureCtx();
  if (c && c.state === "suspended") void c.resume();
  preloadSfx();
  if (bgmWanted && bgm?.paused) void bgm.play().catch(() => {});
}

/**
 * 효과음 재생. vol 은 0~1 (종류 기본 음량에 곱함), rate 는 재생 속도(살짝 흔들어 덜 단조롭게).
 * 아직 안 불러왔으면 불러오고 이번엔 넘어감 (늦게 나는 소리는 어색해서).
 */
export function sfx(name: string, vol = 1, rate = 1) {
  loadPrefs();
  if (prefs.mute || prefs.sfx <= 0) return;
  const c = ctx;
  if (!c || !master || c.state !== "running") return;
  const buf = buffers.get(name);
  if (buf === undefined) {
    void load(name);
    return;
  }
  if (!buf) return;
  const now = performance.now();
  const combat = COMBAT.has(name);
  // 배속이면 전투음 간격도 배속만큼 — 같은 시간에 소리가 몇 배로 겹쳐 뭉개지던 것
  const gap = (GAP[name] ?? 40) * (combat ? speed : 1);
  if (now - (lastAt.get(name) ?? -1e9) < gap) return;
  if (combat) {
    // 전투음은 따로 적게 — 꽉 차면 이번 것은 넘김 (꼬리가 쌓여 늦게 들리는 느낌 방지)
    if (voices.filter((v) => v.combat).length >= COMBAT_VOICES) return;
  } else if (voices.length >= MAX_VOICES) {
    // 버튼 · 소환 · 보스 같은 소리는 꼭 — 가장 오래된 전투음을 끊고 자리 만들기
    const old = voices.find((v) => v.combat);
    if (!old) return;
    stopVoice(old);
  }
  lastAt.set(name, now);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = c.createGain();
  const level = Math.max(0, Math.min(1.5, (SFX[name]?.vol ?? 1) * vol * prefs.sfx));
  g.gain.value = level;
  src.connect(g).connect(master);
  const v: Voice = { src, g, combat };
  voices.push(v);
  src.onended = () => {
    const i = voices.indexOf(v);
    if (i >= 0) voices.splice(i, 1);
    src.disconnect();
    g.disconnect();
  };
  src.start();
  // 배속에서는 전투음 꼬리를 짧게 (뒤늦게 울리는 느낌)
  if (combat && speed > 1) {
    const t = c.currentTime;
    const keep = Math.min(buf.duration / rate, 0.36 / speed);
    g.gain.setValueAtTime(level, t + keep * 0.6);
    g.gain.linearRampToValueAtTime(0, t + keep);
    src.stop(t + keep + 0.01);
  }
}

function stopVoice(v: Voice) {
  const i = voices.indexOf(v);
  if (i >= 0) voices.splice(i, 1);
  try {
    v.g.gain.setTargetAtTime(0, ctx!.currentTime, 0.01);
    v.src.stop(ctx!.currentTime + 0.04);
  } catch {
    /* 이미 멈춤 */
  }
}

/** 게임 배속 (전투음 간격 · 꼬리 길이에 씀) — GameView 가 바뀔 때 알려 줌 */
export function setSfxSpeed(n: number) {
  speed = Math.max(1, n);
}

/** 살짝 다른 높이로 (타격음처럼 자주 나는 소리) */
export const sfxVar = (name: string, vol = 1) => sfx(name, vol, 0.92 + Math.random() * 0.16);

/* ───────── 배경음 ───────── */

let bgm: HTMLAudioElement | null = null;
let bgmName: string | null = null;
let bgmWanted = false;
let fadeTimer = 0;
/** 판 결과 연출 동안 배경음을 잠깐 줄임 */
let duck = 1;

function bgmTarget() {
  loadPrefs();
  return prefs.mute ? 0 : prefs.bgm * duck;
}
function applyBgmVolume() {
  if (bgm) bgm.volume = Math.max(0, Math.min(1, bgmTarget()));
}

/** 배경음 바꾸기 (같은 곡이면 그대로). null 이면 서서히 멈춤 */
export function playBgm(name: string | null) {
  if (typeof window === "undefined") return;
  if (name === bgmName) return;
  bgmName = name;
  bgmWanted = !!name;
  const old = bgm;
  window.clearInterval(fadeTimer);
  // 옛 곡은 0.6초 동안 줄이고 멈춤
  if (old) {
    const v0 = old.volume;
    let k = 0;
    const t = window.setInterval(() => {
      k++;
      old.volume = Math.max(0, v0 * (1 - k / 12));
      if (k >= 12) {
        window.clearInterval(t);
        old.pause();
        old.src = "";
      }
    }, 50);
  }
  bgm = null;
  const src = name ? BGM[name] : null;
  if (!src) return;
  const a = new Audio(src);
  a.loop = true;
  a.preload = "auto";
  a.volume = 0;
  a.onerror = () => {
    if (bgm === a) bgm = null;
  };
  bgm = a;
  void a.play().catch(() => {
    /* 아직 사용자가 안 누름 → unlock() 때 시작 */
  });
  // 새 곡은 0.8초 동안 키움
  let k = 0;
  fadeTimer = window.setInterval(() => {
    k++;
    if (bgm !== a) return window.clearInterval(fadeTimer);
    a.volume = Math.max(0, Math.min(1, bgmTarget() * Math.min(1, k / 16)));
    if (k >= 16) window.clearInterval(fadeTimer);
  }, 50);
}

/** 결과 연출: 배경음을 줄이고 짧은 곡(클리어 · 게임 오버)을 냄 */
export function jingle(name: "clear" | "gameover") {
  duck = 0.25;
  applyBgmVolume();
  sfx(name);
  window.setTimeout(() => {
    duck = 1;
    applyBgmVolume();
  }, 5200);
}

/** 웨이브 · 보스 상태에 맞는 배경음 이름 */
export function bgmFor(phase: string, wave: number, lastWave: number) {
  if (phase === "boss") return wave >= lastWave ? "boss-final" : "boss";
  return wave >= 30 ? "wave-late" : "wave-early";
}
