/*
 * 포커 소리 — 배경음악 · 효과음 · 캐릭터 음성.
 *  파일이 있으면 파일(/poker/sound/…, manifest.json 에 적힌 것만)을 틀고, 없으면 Web Audio 로 즉석 합성한 소리로 대신한다.
 *  브라우저 자동재생 정책 때문에 첫 클릭·터치 이후에만 소리가 난다 (그 전에 틀려던 배경음악은 첫 입력 때 시작).
 *  음량은 세 줄(배경음악 · 효과음 · 음성) + 전체 음소거, localStorage 에 저장.
 *  실제 크기는 슬라이더 값 × 게임별 보정(lib/soundLevel.ts — 측정해서 맞춤), 효과음·음성은 리미터를 거쳐 겹쳐도 찢어지지 않게.
 */

import { LEVEL, limiter } from "@/lib/soundLevel";
import { lookChar } from "./rules";

const KEY = "poker_sound";
const BASE = "/poker/sound";

export interface SoundSettings {
  mute: boolean;
  bgm: number;
  sfx: number;
  voice: number;
  /** 로비 곡: 1 · 2 · 0 = 접속할 때마다 번갈아 */
  lobby: 0 | 1 | 2;
}
const DEFAULT: SoundSettings = { mute: false, bgm: 0.5, sfx: 0.8, voice: 0.9, lobby: 1 };
let settings: SoundSettings | null = null;
const listeners = new Set<() => void>();

export function getSound(): SoundSettings {
  if (!settings) {
    settings = { ...DEFAULT };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(settings, JSON.parse(raw) as Partial<SoundSettings>);
      else if (localStorage.getItem("poker_mute") === "1") settings.mute = true; // 예전 설정
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
  for (const l of listeners) l();
}
export function onSoundChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
/** 예전 코드 호환 */
export const isMuted = () => getSound().mute;
export const setMuted = (v: boolean) => setSound({ mute: v });

// ───────────── 파일 목록 ─────────────

/** manifest.json: { "sfx-deal": "sfx-deal.wav", "voice/jinwoo/jinwoo-call": "voice/jinwoo/jinwoo-call.mp3", … } */
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
/** 이름 → 파일 주소. "sfx-chip" 처럼 변형이 여러 개(sfx-chip-1, -2 …)면 그중 아무거나 */
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
    // (아이폰은 전화 · 다른 앱 소리 뒤에 "interrupted" 로 멈춰 있음)
    if (ctx.state === "suspended" || (ctx.state as string) === "interrupted") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** 첫 입력에서 오디오를 깨우고, 틀려던 배경음악을 시작 */
function unlock() {
  if (unlocked || typeof window === "undefined") return;
  unlocked = true;
  ac();
  if (wantBgm) void startBgm(wantBgm);
}
if (typeof window !== "undefined") {
  loadManifest();
  // 탭을 가리면 배경음악 멈춤, 돌아오면 이어서
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
    // 소리를 꺼 둔 채(오디오를 아직 안 깨운 채) 길이를 재러 먼저 받은 파일도 풀 수 있게 오디오는 여기서도 만듦.
    // 못 받았으면 기억하지 않음 — 예전엔 실패(null)를 기억해서 나중에 소리를 켜도 그 음성이 끝까지 안 나왔음
    const key = url;
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => {
        if (!ctx) {
          try {
            ctx = new AudioContext();
          } catch {}
        }
        return ctx ? ctx.decodeAudioData(b) : null;
      })
      .catch(() => null)
      .then((buf) => {
        if (!buf) buffers.delete(key);
        return buf;
      });
    buffers.set(url, p);
  }
  return p;
}

/** 파일을 틂 (있을 때만). 성공하면 true */
function playFile(name: string, vol: number, onEnd?: () => void): boolean {
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
    g.connect(limiter(c));
    src.start();
    if (onEnd) src.onended = onEnd;
  });
  return true;
}

// ───────────── 합성음 (파일 없을 때) ─────────────

let noiseBuf: AudioBuffer | null = null;
function noise(c: AudioContext): AudioBufferSourceNode {
  if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
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
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * getSound().sfx * LEVEL.poker.sfx), at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  g.connect(limiter(c));
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
  at = c.currentTime
) {
  const n = noise(c);
  const f = c.createBiquadFilter();
  f.type = kind;
  f.frequency.value = freq;
  n.connect(f);
  f.connect(env(c, peak, 0.003, decay, at));
  n.start(at);
  n.stop(at + decay + 0.05);
}

const synth: Record<string, (c: AudioContext) => void> = {
  "sfx-deal": (c) => hiss(c, "highpass", 2600, 0.12, 0.07),
  "sfx-flip": (c) => {
    hiss(c, "highpass", 1800, 0.14, 0.05);
    tone(c, "triangle", 1400, 0.05, 0.05, c.currentTime + 0.03);
  },
  "sfx-shuffle": (c) => {
    for (let i = 0; i < 7; i++)
      hiss(c, "highpass", 2200 + i * 150, 0.07, 0.05, c.currentTime + i * 0.07);
  },
  "sfx-chip": (c) => {
    tone(c, "triangle", 2100, 0.1, 0.05);
    tone(c, "triangle", 2700, 0.08, 0.06, c.currentTime + 0.045);
    hiss(c, "bandpass", 4200, 0.04, 0.04);
  },
  "sfx-chip-big": (c) => {
    for (let i = 0; i < 6; i++)
      tone(c, "triangle", 1900 + (i % 3) * 350, 0.07, 0.05, c.currentTime + i * 0.05);
    hiss(c, "bandpass", 3800, 0.05, 0.25);
  },
  "sfx-collect": (c) => {
    for (let i = 0; i < 5; i++)
      tone(c, "triangle", 2300 + (i % 2) * 400, 0.06, 0.04, c.currentTime + i * 0.06);
  },
  "sfx-pot": (c) => {
    for (let i = 0; i < 8; i++)
      tone(c, "triangle", 2000 + (i % 4) * 300, 0.06, 0.05, c.currentTime + i * 0.05);
    hiss(c, "bandpass", 3600, 0.05, 0.3, c.currentTime + 0.1);
  },
  "sfx-check": (c) => {
    tone(c, "sine", 190, 0.22, 0.07, c.currentTime, 110);
    tone(c, "sine", 190, 0.18, 0.07, c.currentTime + 0.11, 110);
  },
  "sfx-fold": (c) => hiss(c, "lowpass", 900, 0.1, 0.16),
  "sfx-turn": (c) => {
    tone(c, "sine", 880, 0.1, 0.16);
    tone(c, "sine", 1320, 0.09, 0.22, c.currentTime + 0.12);
  },
  "sfx-tick": (c) => tone(c, "square", 1000, 0.035, 0.04),
  "sfx-tick-last": (c) => tone(c, "square", 1400, 0.045, 0.06),
  "sfx-click": (c) => tone(c, "sine", 1200, 0.05, 0.03),
  "sfx-emote": (c) => tone(c, "sine", 700, 0.08, 0.1, c.currentTime, 1100),
  "sfx-coin": (c) => {
    tone(c, "triangle", 2200, 0.09, 0.08);
    tone(c, "triangle", 3300, 0.07, 0.14, c.currentTime + 0.06);
  },
  "sfx-join": (c) => {
    tone(c, "sine", 1760, 0.06, 0.2);
    tone(c, "sine", 2200, 0.05, 0.25, c.currentTime + 0.05);
  },
  /** 족보 도장 "쾅" */
  "sfx-stamp": (c) => {
    tone(c, "sine", 160, 0.25, 0.12, c.currentTime, 60);
    hiss(c, "lowpass", 700, 0.12, 0.08);
  },
  "jingle-allin": (c) => {
    tone(c, "sawtooth", 110, 0.12, 0.35, c.currentTime, 330);
    for (let i = 0; i < 5; i++)
      tone(c, "triangle", 2000 + i * 180, 0.07, 0.05, c.currentTime + 0.05 + i * 0.04);
  },
  "jingle-win": (c) => {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone(c, "triangle", f, 0.11, 0.25, c.currentTime + i * 0.09)
    );
    for (let i = 0; i < 6; i++)
      tone(c, "triangle", 2200 + (i % 3) * 300, 0.05, 0.05, c.currentTime + 0.3 + i * 0.05);
  },
  "jingle-bigwin": (c) => {
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      tone(c, "triangle", f, 0.12, 0.3, c.currentTime + i * 0.09)
    );
    for (let i = 0; i < 12; i++)
      tone(c, "triangle", 2000 + (i % 4) * 300, 0.05, 0.05, c.currentTime + 0.35 + i * 0.05);
  },
  "jingle-lose": (c) => tone(c, "sine", 330, 0.09, 0.4, c.currentTime, 196),
  "jingle-made": (c) => {
    [880, 1109, 1319, 1760].forEach((f, i) =>
      tone(c, "sine", f, 0.07, 0.18, c.currentTime + i * 0.06)
    );
  },
  "jingle-entry": (c) => {
    tone(c, "sine", 1319, 0.08, 0.3);
    tone(c, "sine", 1760, 0.07, 0.4, c.currentTime + 0.1);
  },
  /** 쇼다운 직전 두근두근 */
  "sfx-drum": (c) => {
    for (let i = 0; i < 2; i++) tone(c, "sine", 120, 0.2, 0.14, c.currentTime + i * 0.22, 50);
  },
};

// ───────────── 배경음악 ─────────────
// 곡 끝이 페이드아웃이라 그냥 loop 하면 뚝 끊겨서, 끝나기 2.5초 전에 같은 곡을 처음부터 겹쳐 틀어 교차 페이드로 이음.

const XFADE = 2.5;
/** 지금 틀고 있는 곡 (bgm-lobby 는 설정에 따라 bgm-lobby1 / 2 로 바뀐 이름) */
let bgmName: string | null = null;
let wantBgm: string | null = null;
/** 살아 있는 오디오들과 각자의 섞는 비율(0~1) */
const live = new Map<HTMLAudioElement, number>();
let cur: HTMLAudioElement | null = null;
/** 로비 곡 "번갈아" 설정일 때 이번 접속에 고른 번호 */
let lobbyPick = 0;

const bgmTarget = () => (getSound().mute ? 0 : getSound().bgm * LEVEL.poker.bgm);
function applyBgmVolume() {
  const v = bgmTarget();
  for (const [el, mix] of live) el.volume = Math.min(1, v * mix);
}
/** el 의 섞는 비율을 to 까지 ms 동안 바꿈. 0 이 되면 멈추고 버림 */
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
function resolveBgm(name: string): string {
  if (name !== "bgm-lobby") return name;
  const l = getSound().lobby;
  if (l === 1 || l === 2) return `bgm-lobby${l}`;
  if (!lobbyPick) lobbyPick = Math.random() < 0.5 ? 1 : 2;
  return `bgm-lobby${lobbyPick}`;
}
async function startBgm(name: string) {
  const real = resolveBgm(name);
  const url = fileOf(real) ?? fileOf(name);
  if (!url) {
    // 목록이 아직 안 왔으면 조금 뒤에 다시
    if (!manifest) setTimeout(() => wantBgm === name && void startBgm(name), 400);
    return;
  }
  if (bgmName === real && cur && !cur.paused) return;
  bgmName = real;
  await spawn(url, real, 1200);
}
/** 새로 틀고 지금 곡은 페이드아웃 */
async function spawn(url: string, real: string, ms: number) {
  const el = new Audio(url);
  el.volume = 0;
  live.set(el, 0);
  try {
    await el.play();
  } catch {
    // 아직 입력 전 — 첫 입력 때 unlock 이 다시 부름
    live.delete(el);
    if (bgmName === real) bgmName = null;
    return;
  }
  if (bgmName !== real) {
    // 그새 다른 곡으로 바뀜
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
      void spawn(url, real, XFADE * 1000);
    }
  };
}

// ───────────── 공개 API ─────────────

/** 그 이름의 소리 파일이 있나 */
export const hasSound = (name: string) => !!fileOf(name);

/** 짧은 소리. 파일이 있으면 파일, 없으면 합성음 */
export function playSfx(name: string) {
  const s = getSound();
  if (s.mute || s.sfx <= 0) return;
  if (playFile(name, s.sfx * LEVEL.poker.sfx)) return;
  const c = ac();
  const f = synth[name];
  if (c && f) f(c);
}

/** 지금 나오는 캐릭터 음성 하나 (외침이 겹쳐 쌓이지 않게 새 외침이 오면 앞 것은 짧게 줄이고 끊음) */
let voiceNow: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
/**
 * 외침이 아닌 대사(족보 · 승리 · 패배 · 입장 …)는 줄을 세워 하나씩, 들어온 순서대로.
 * (파일을 받는 동안 뒤에 온 대사가 먼저 나오던 것 — 쇼다운에서 「투페어 → 승리 → 원페어」처럼)
 * 5초 넘게 기다린 대사는 버림
 */
const speakQ: { char: string; name: string; big: boolean; at: number }[] = [];
let speaking = false;
const BETS = new Set([
  "call",
  "bet",
  "raise",
  "allin",
  "ddadang",
  "quarter",
  "half",
  "bbing",
  "check",
  "fold",
  "die",
  "allin-call",
  "select",
]);
/** 그 캐릭터(스킨이면 스킨 전용 → 원래 캐릭터)의 음성 파일 주소 */
function voiceUrl(char: string, name: string, big = false): string | null {
  const find = (who: string) => {
    const key = `voice/${who}/${who}-${name}`;
    // 캐릭터 고를 때 대사(select)가 없으면 입장 인사로
    return (
      (big && fileOf(`${key}-big`)) ||
      fileOf(key) ||
      (name === "select" ? fileOf(`voice/${who}/${who}-hello`) : null)
    );
  };
  const base = lookChar(char);
  return (base !== char && find(char)) || find(base) || null;
}

/** 음성 길이(초). 파일이 없거나 못 읽으면 null — 소리를 꺼 둬도 길이는 알려 줌 (연출 박자용) */
export async function voiceDuration(char: string, name: string): Promise<number | null> {
  const url = voiceUrl(char, name);
  if (!url) return null;
  const buf = await buffer(url);
  return buf ? buf.duration : null;
}

/** 음성 한 줄 재생 — 나오던 음성은 0.08초 만에 줄이고 끊음 (최신 행동이 항상 들림) */
function playBuf(c: AudioContext, buf: AudioBuffer, vol: number, onEnd?: () => void) {
  if (voiceNow) {
    const old = voiceNow;
    old.gain.gain.setTargetAtTime(0, c.currentTime, 0.03);
    old.src.stop(c.currentTime + 0.1);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = vol * LEVEL.poker.voice;
  src.connect(g);
  g.connect(limiter(c));
  const me = { src, gain: g };
  voiceNow = me;
  src.onended = () => {
    if (voiceNow === me) voiceNow = null;
    onEnd?.();
    if (!voiceNow) setTimeout(pumpSpeak, 150);
  };
  src.start();
}

/** 대사 줄에서 다음 것 (나오는 음성이 없을 때만) */
function pumpSpeak() {
  if (speaking || voiceNow || !speakQ.length) return;
  const next = speakQ.shift()!;
  const s = getSound();
  const url = voiceUrl(next.char, next.name, next.big);
  const c = ac();
  if (Date.now() - next.at > 5000 || !url || !c || s.mute || s.voice <= 0) return pumpSpeak();
  speaking = true;
  void buffer(url).then((buf) => {
    if (!buf) {
      speaking = false;
      return pumpSpeak();
    }
    playBuf(c, buf, s.voice * (next.big ? 1.15 : 1), () => {
      speaking = false;
    });
  });
}

/** 캐릭터 음성 (파일 있을 때만). big = 크게 외치는 버전(없으면 보통 버전) */
export function playVoice(char: string, name: string, big = false) {
  const s = getSound();
  if (s.mute || s.voice <= 0) return;
  // 스킨이면 스킨 전용 음성이 있을 때 그것, 없으면 원래 캐릭터 음성
  const url = voiceUrl(char, name, big);
  if (!url) return;
  const c = ac();
  if (!c) return;
  // 대사는 줄 서서 차례로 (다른 음성이 나오는 중이면 끝난 뒤에), 너무 많이 쌓이면 오래된 것부터 버림
  if (!BETS.has(name)) {
    speakQ.push({ char, name, big, at: Date.now() });
    if (speakQ.length > 4) speakQ.shift();
    pumpSpeak();
    return;
  }
  void buffer(url).then((buf) => {
    if (buf) playBuf(c, buf, s.voice * (big ? 1.15 : 1));
  });
}

/** 배경음악 바꾸기 (null = 끔). 파일이 없으면 조용히 아무것도 안 함 */
export function playBgm(name: string | null) {
  wantBgm = name;
  if (!name) {
    for (const el of live.keys()) fade(el, 0, 600);
    cur = null;
    bgmName = null;
    return;
  }
  if (unlocked) void startBgm(name);
}

/** 로비 곡 설정을 바꿨을 때 지금 로비면 바로 바꿔 틂 */
export function refreshBgm() {
  if (wantBgm && unlocked) void startBgm(wantBgm);
}

/** 큰 베팅 기준: 그 방 판돈의 100배 이상이면 "크게" 외침 */
export const BIG_X = 100;
export const isBig = (amt: number, ante: number) => amt >= ante * BIG_X;

/** 예전 호출 호환 */
export const sfx = {
  card: () => playSfx("sfx-deal"),
  flip: () => playSfx("sfx-flip"),
  chip: () => playSfx("sfx-chip"),
  chipBig: () => playSfx("sfx-chip-big"),
  collect: () => playSfx("sfx-collect"),
  pot: () => playSfx("sfx-pot"),
  check: () => playSfx("sfx-check"),
  fold: () => playSfx("sfx-fold"),
  turn: () => playSfx("sfx-turn"),
  tick: () => playSfx("sfx-tick"),
  tickLast: () => playSfx("sfx-tick-last"),
  click: () => playSfx("sfx-click"),
  emote: () => playSfx("sfx-emote"),
  coin: () => playSfx("sfx-coin"),
  join: () => playSfx("sfx-join"),
  stamp: () => playSfx("sfx-stamp"),
  drum: () => playSfx("sfx-drum"),
  allin: () => playSfx("jingle-allin"),
  win: () => playSfx("jingle-win"),
  bigwin: () => playSfx("jingle-bigwin"),
  lose: () => playSfx("jingle-lose"),
  made: () => playSfx("jingle-made"),
  entry: () => playSfx("jingle-entry"),
};
