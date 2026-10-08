/*
 * 포커 소리 — 배경음악 · 효과음 · 캐릭터 음성.
 *  파일이 있으면 파일(/poker/sound/…, manifest.json 에 적힌 것만)을 틀고, 없으면 Web Audio 로 즉석 합성한 소리로 대신한다.
 *  브라우저 자동재생 정책 때문에 첫 클릭·터치 이후에만 소리가 난다 (그 전에 틀려던 배경음악은 첫 입력 때 시작).
 *  음량은 세 줄(배경음악 · 효과음 · 음성) + 전체 음소거, localStorage 에 저장.
 */

const KEY = "poker_sound";
const BASE = "/poker/sound";

export interface SoundSettings {
  mute: boolean;
  bgm: number;
  sfx: number;
  voice: number;
}
const DEFAULT: SoundSettings = { mute: false, bgm: 0.5, sfx: 0.8, voice: 0.9 };
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
  manifestLoading = fetch(`${BASE}/manifest.json`, { cache: "force-cache" })
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : {}))
    .then((m) => {
      manifest = m;
    })
    .catch(() => {
      manifest = {};
    });
}
const fileOf = (name: string): string | null =>
  manifest && manifest[name] ? `${BASE}/${manifest[name]}` : null;

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

/** 첫 입력에서 오디오를 깨우고, 틀려던 배경음악을 시작 */
function unlock() {
  if (unlocked || typeof window === "undefined") return;
  unlocked = true;
  ac();
  if (wantBgm) void startBgm(wantBgm);
}
if (typeof window !== "undefined") {
  loadManifest();
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
    g.connect(c.destination);
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

let bgmEl: HTMLAudioElement | null = null;
let bgmName: string | null = null;
let wantBgm: string | null = null;
let fadeTimer: ReturnType<typeof setInterval> | null = null;

function applyBgmVolume() {
  if (!bgmEl) return;
  const s = getSound();
  bgmEl.volume = s.mute ? 0 : s.bgm;
  if (!s.mute && bgmEl.paused && wantBgm) void bgmEl.play().catch(() => {});
}
async function startBgm(name: string) {
  const url = fileOf(name);
  if (!url) {
    if (!manifest) {
      // 목록이 아직 안 왔으면 조금 뒤에 다시
      setTimeout(() => wantBgm === name && void startBgm(name), 400);
    }
    return;
  }
  if (bgmName === name && bgmEl) return;
  const old = bgmEl;
  const el = new Audio(url);
  el.loop = true;
  el.volume = 0;
  bgmEl = el;
  bgmName = name;
  try {
    await el.play();
  } catch {
    // 아직 입력 전 — 첫 입력 때 unlock 이 다시 부름
    bgmEl = null;
    bgmName = null;
    return;
  }
  // 교차 페이드
  if (fadeTimer) clearInterval(fadeTimer);
  const target = () => (getSound().mute ? 0 : getSound().bgm);
  let t = 0;
  fadeTimer = setInterval(() => {
    t = Math.min(1, t + 0.08);
    el.volume = target() * t;
    if (old) old.volume = Math.max(0, (old.volume || 0) * (1 - t));
    if (t >= 1) {
      if (fadeTimer) clearInterval(fadeTimer);
      fadeTimer = null;
      old?.pause();
    }
  }, 60);
}

// ───────────── 공개 API ─────────────

/** 짧은 소리. 파일이 있으면 파일, 없으면 합성음 */
export function playSfx(name: string) {
  const s = getSound();
  if (s.mute || s.sfx <= 0) return;
  if (playFile(name, s.sfx)) return;
  const c = ac();
  const f = synth[name];
  if (c && f) f(c);
}

const voicePlaying = new Set<string>();
/** 캐릭터 음성 (파일 있을 때만). big = 크게 외치는 버전(없으면 보통 버전) */
export function playVoice(char: string, name: string, big = false) {
  const s = getSound();
  if (s.mute || s.voice <= 0) return;
  const key = `voice/${char}/${char}-${name}`;
  const pick = big && fileOf(`${key}-big`) ? `${key}-big` : key;
  if (!fileOf(pick)) return;
  // 같은 캐릭터가 겹쳐 말하지 않게
  if (voicePlaying.has(char)) return;
  voicePlaying.add(char);
  if (!playFile(pick, s.voice, () => voicePlaying.delete(char))) voicePlaying.delete(char);
  else setTimeout(() => voicePlaying.delete(char), 3000);
}

/** 배경음악 바꾸기 (null = 끔). 파일이 없으면 조용히 아무것도 안 함 */
export function playBgm(name: string | null) {
  wantBgm = name;
  if (!name) {
    bgmEl?.pause();
    bgmEl = null;
    bgmName = null;
    return;
  }
  if (unlocked) void startBgm(name);
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
