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

/** 바람 소리: 필터 주파수가 f0 → f1(peak 에서 최고) → f2 로 휩쓸림 · 볼륨도 peak 에서 최고 */
function sweep(dur: number, vol: number, f0: number, f1: number, f2: number, peak: number, q = 1.2, when = 0) {
  const c = ac();
  if (!c || !out || !noiseBuf || muted) return;
  const t = c.currentTime + when;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const fl = c.createBiquadFilter();
  fl.type = "bandpass";
  fl.Q.value = q;
  fl.frequency.setValueAtTime(f0, t);
  fl.frequency.exponentialRampToValueAtTime(f1, t + peak);
  fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + peak);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl).connect(g).connect(out);
  s.start(t, Math.random());
  s.stop(t + dur + 0.05);
}

/** 짧게 울리는 공명 (나무 배트 「딱」의 몸통) */
function ring(f: number, dur: number, vol: number, when = 0) {
  const c = ac();
  if (!c || !out || muted) return;
  const t = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  /** 스윙 「휙」: 0.07초(임팩트 자리)에서 가장 크고 높게 — 세게 돌릴수록(k) 굵게 */
  swing: (k = 1) => {
    sweep(0.26, 0.32 * k, 380, 1700, 520, 0.07, 1.1);
    sweep(0.2, 0.14 * k, 900, 3800, 1200, 0.065, 2.2);
  },
  /** 헛스윙: 바람만 길게 빠져나가는 소리 */
  whiff: () => {
    sweep(0.32, 0.22, 1500, 700, 260, 0.02, 0.9);
  },
  /** 정타 (q 0 ~ 1) — 좋을수록 높고 단단한 "딱" */
  crack: (q: number, perfect = false) => {
    // 같은 소리 반복감 줄이기 ±5%
    const j = 0.95 + Math.random() * 0.1;
    if (q < 0.35 && !perfect) {
      // 빗맞음: 「턱」 — 짧고 낮은 나무 소리, 손 울림
      noise(0.04, 0.55, 700 * j, 1.1, "bandpass");
      ring(420 * j, 0.06, 0.25);
      ring(190 * j, 0.09, 0.2);
      return;
    }
    // 나무 배트 「딱!」: 1ms 고역 파열음 + 몇 개의 짧은 공명 + 몸통 저음
    const k = perfect ? 1 : 0.55 + q * 0.4;
    noise(0.018, 1.0 * k, 5200 * j, 0.7, "highpass", 0, 0.001);
    noise(0.05, 0.75 * k, 2600 * j, 1.4, "bandpass", 0, 0.001);
    ring(1180 * j, 0.05 + q * 0.03, 0.4 * k);
    ring(2320 * j, 0.035 + q * 0.02, 0.3 * k);
    ring(3550 * j, 0.025, 0.18 * k);
    tone("sine", 150 * j, 48, 0.16 + q * 0.08, 0.7 * k);
    // 구장 메아리 (멀리서 한 번 더)
    noise(0.05, 0.16 * k, 2000, 1.2, "bandpass", 0.11, 0.004);
    if (perfect) {
      // 묵직한 쿵 + 0.25초 뒤 함성
      tone("sine", 70, 32, 0.32, 0.9);
      noise(0.06, 0.2, 2000, 1.2, "bandpass", 0.2, 0.004);
      noise(1.4, 0.16, 1100, 0.4, "bandpass", 0.25, 0.25);
    }
  },
  foul: () => {
    noise(0.06, 0.35, 1400, 1.4);
    tone("triangle", 700, 300, 0.05, 0.15);
  },
  /** 미트 「퍽!」 — hard = 헛스윙 · 삼진처럼 크게 */
  mitt: (hard = false) => {
    noise(0.012, hard ? 0.7 : 0.4, 3000, 0.8, "highpass", 0, 0.001);
    noise(0.08, hard ? 0.85 : 0.55, 520, 0.9, "lowpass", 0, 0.001);
    tone("sine", hard ? 140 : 120, 60, hard ? 0.13 : 0.09, hard ? 0.6 : 0.4);
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
