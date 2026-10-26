/**
 * 야구 효과음 — M1 은 파일 없이 Web Audio 즉석 합성 (나중에 일레븐랩스 효과음 파일로 교체).
 *   딱!(정타) · 툭(빗맞음) · 퍽(미트) · 휙(스윙) · 함성 · 홈런 팡파레 · 마구별 소리
 */
import { dbGain, LEVEL } from "@/lib/soundLevel";

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;

function ac() {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 5;
      out = ctx.createGain();
      out.gain.value = LEVEL.master * dbGain(-2);
      out.connect(comp).connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export const unlockAudio = () => void ac();
export const setMuted = (m: boolean) => {
  muted = m;
};
export const isMuted = () => muted;

function tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, when = 0) {
  const c = ac();
  if (!c || !out || muted) return;
  const t = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, f: number, q = 1, type: BiquadFilterType = "bandpass", when = 0, attack = 0.003) {
  const c = ac();
  if (!c || !out || !noiseBuf || muted) return;
  const t = c.currentTime + when;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const fl = c.createBiquadFilter();
  fl.type = type;
  fl.frequency.value = f;
  fl.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl).connect(g).connect(out);
  s.start(t, Math.random());
  s.stop(t + dur + 0.05);
}

export const sfx = {
  swing: () => noise(0.16, 0.25, 900, 0.8, "bandpass", 0, 0.04),
  /** 정타 (q 0 ~ 1) — 좋을수록 높고 단단한 "딱" */
  crack: (q: number, perfect = false) => {
    // 같은 소리 반복감 줄이기 ±5%
    const j = 0.95 + Math.random() * 0.1;
    if (perfect) {
      // 날카로운 「딱!」 + 묵직한 저음 + 0.25초 뒤 함성
      tone("square", 2900 * j, 900, 0.045, 0.5);
      noise(0.08, 0.85, 4200 * j, 1.6, "bandpass");
      tone("sine", 140 * j, 45, 0.22, 0.8);
      noise(1.4, 0.16, 1100, 0.4, "bandpass", 0.25, 0.25);
      return;
    }
    if (q < 0.35) {
      // 빗맞음: 둔탁
      noise(0.07, 0.45, 900 * j, 1.0, "bandpass");
      tone("triangle", 500 * j, 250, 0.05, 0.15);
      return;
    }
    tone("square", (1800 + q * 900) * j, 600, 0.05, 0.35 * (0.5 + q));
    noise(0.09, 0.6 * (0.5 + q * 0.5), (2600 + q * 1500) * j, 1.2, "bandpass");
    tone("sine", 160, 60, 0.14, 0.5 * q);
  },
  foul: () => {
    noise(0.06, 0.35, 1400, 1.4);
    tone("triangle", 700, 300, 0.05, 0.15);
  },
  mitt: () => {
    noise(0.07, 0.55, 500, 0.9, "lowpass");
    tone("sine", 120, 70, 0.09, 0.4);
  },
  catchBall: () => noise(0.05, 0.3, 700, 1, "lowpass"),
  throwBall: () => noise(0.12, 0.12, 1200, 0.7, "bandpass", 0, 0.03),
  bounce: () => noise(0.04, 0.15, 400, 1, "lowpass"),
  /** 함성 (크기 0 ~ 1) */
  cheer: (k = 1) => {
    noise(1.6 + k, 0.18 * k, 1100, 0.4, "bandpass", 0, 0.25);
    noise(1.2 + k, 0.1 * k, 2400, 0.6, "bandpass", 0.1, 0.3);
  },
  groan: () => noise(0.9, 0.12, 500, 0.6, "bandpass", 0, 0.15),
  homerun: () => {
    const n = [523, 659, 784, 1047, 784, 1047];
    n.forEach((f, i) => tone("square", f, f, 0.16, 0.12, i * 0.11));
    sfx.cheer(1.4);
  },
  strike: () => {
    tone("square", 880, 880, 0.08, 0.08);
    tone("square", 1320, 1320, 0.12, 0.08, 0.09);
  },
  ball: () => tone("triangle", 520, 520, 0.12, 0.08),
  out: () => {
    tone("square", 440, 220, 0.18, 0.1);
  },
  safe: () => tone("square", 660, 990, 0.14, 0.08),
  ui: () => tone("triangle", 1200, 1500, 0.04, 0.06),
  gaugeTick: () => tone("sine", 1800, 1800, 0.02, 0.03),
  gaugeMax: () => {
    tone("square", 1568, 2093, 0.1, 0.1);
  },
  cutin: () => {
    noise(0.5, 0.3, 3000, 0.5, "highpass", 0, 0.02);
    tone("sawtooth", 220, 880, 0.45, 0.12);
  },
  mission: () => {
    tone("square", 988, 988, 0.08, 0.07);
    tone("square", 1319, 1319, 0.14, 0.07, 0.09);
  },
  missionOk: () => [784, 988, 1175, 1568].forEach((f, i) => tone("square", f, f, 0.12, 0.08, i * 0.08)),
  missionNg: () => [400, 300].forEach((f, i) => tone("triangle", f, f * 0.9, 0.2, 0.1, i * 0.18)),
  pop: () => {
    tone("sine", 600, 1800, 0.08, 0.25);
    noise(0.05, 0.2, 3000, 2);
  },
  zap: () => {
    noise(0.06, 0.3, 4000, 3);
    tone("sawtooth", 1400, 300, 0.07, 0.08);
  },
  fire: () => noise(0.4, 0.2, 800, 0.5, "lowpass", 0, 0.05),
  glitch: () => {
    for (let i = 0; i < 4; i++) tone("square", 200 + Math.random() * 1600, 100 + Math.random() * 900, 0.03, 0.06, i * 0.04);
  },
  tick: () => tone("square", 2400, 2400, 0.02, 0.05),
  wind: () => noise(0.5, 0.18, 600, 0.6, "bandpass", 0, 0.1),
  charge: () => tone("sawtooth", 80, 400, 0.5, 0.08),
  stun: () => {
    tone("square", 300, 120, 0.2, 0.1);
    noise(0.15, 0.2, 900, 1);
  },
};
