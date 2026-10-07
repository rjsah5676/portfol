/*
 * 포커 효과음 — Web Audio 로 즉석 합성 (파일 없음). 첫 클릭 이후에만 소리가 남(브라우저 자동재생 정책).
 */

const MUTE_KEY = "poker_mute";
let ctx: AudioContext | null = null;
let muted: boolean | null = null;

export function isMuted(): boolean {
  if (muted === null) {
    try {
      muted = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      muted = false;
    }
  }
  return muted;
}
export function setMuted(v: boolean) {
  muted = v;
  try {
    localStorage.setItem(MUTE_KEY, v ? "1" : "0");
  } catch {}
}

function ac(): AudioContext | null {
  if (typeof window === "undefined" || isMuted()) return null;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

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
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  g.connect(c.destination);
  return g;
}

function tone(c: AudioContext, type: OscillatorType, freq: number, peak: number, decay: number, at = c.currentTime, slideTo?: number) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, at + decay);
  o.connect(env(c, peak, 0.004, decay, at));
  o.start(at);
  o.stop(at + decay + 0.05);
}

function hiss(c: AudioContext, kind: BiquadFilterType, freq: number, peak: number, decay: number, at = c.currentTime) {
  const n = noise(c);
  const f = c.createBiquadFilter();
  f.type = kind;
  f.frequency.value = freq;
  n.connect(f);
  f.connect(env(c, peak, 0.003, decay, at));
  n.start(at);
  n.stop(at + decay + 0.05);
}

export const sfx = {
  /** 카드 한 장 */
  card() {
    const c = ac();
    if (c) hiss(c, "highpass", 2600, 0.12, 0.07);
  },
  /** 칩 놓기 */
  chip() {
    const c = ac();
    if (!c) return;
    tone(c, "triangle", 2100, 0.1, 0.05);
    tone(c, "triangle", 2700, 0.08, 0.06, c.currentTime + 0.045);
    hiss(c, "bandpass", 4200, 0.04, 0.04);
  },
  /** 체크: 테이블 두 번 톡톡 */
  check() {
    const c = ac();
    if (!c) return;
    tone(c, "sine", 190, 0.22, 0.07, c.currentTime, 110);
    tone(c, "sine", 190, 0.18, 0.07, c.currentTime + 0.11, 110);
  },
  fold() {
    const c = ac();
    if (c) hiss(c, "lowpass", 900, 0.1, 0.16);
  },
  /** 내 차례 */
  turn() {
    const c = ac();
    if (!c) return;
    tone(c, "sine", 880, 0.1, 0.16);
    tone(c, "sine", 1320, 0.09, 0.22, c.currentTime + 0.12);
  },
  /** 시간이 얼마 안 남음 */
  tick() {
    const c = ac();
    if (c) tone(c, "square", 1000, 0.035, 0.04);
  },
  allin() {
    const c = ac();
    if (!c) return;
    tone(c, "sawtooth", 110, 0.12, 0.35, c.currentTime, 330);
    for (let i = 0; i < 5; i++) tone(c, "triangle", 2000 + i * 180, 0.07, 0.05, c.currentTime + 0.05 + i * 0.04);
  },
  win() {
    const c = ac();
    if (!c) return;
    [523, 659, 784, 1047].forEach((f, i) => tone(c, "triangle", f, 0.11, 0.25, c.currentTime + i * 0.09));
    for (let i = 0; i < 6; i++) tone(c, "triangle", 2200 + (i % 3) * 300, 0.05, 0.05, c.currentTime + 0.3 + i * 0.05);
  },
  lose() {
    const c = ac();
    if (c) tone(c, "sine", 330, 0.09, 0.4, c.currentTime, 196);
  },
};
