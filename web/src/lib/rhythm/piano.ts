/**
 * 피아노 음 샘플을 직접 계산해서 만든다 (음 높이마다 한 번, 이후 재사용).
 *
 * 진짜 피아노처럼 들리게 하는 요소:
 * - 배음이 정수배보다 조금씩 높아짐(현의 강성 → 비조화성)
 * - 해머가 현의 1/8 지점을 쳐서 8배음 근처가 약함
 * - 높은 배음일수록 빨리 사그라들고, 소리가 "빠르게 한 번 → 천천히 길게" 두 단계로 줄어듦
 * - 한 음에 현이 2~3개라 살짝 어긋난 음정끼리 맥놀이(울렁임)
 * - 해머가 부딪히는 짧은 "톡" 소리
 */

const SR = 44100;
const cache = new Map<number, AudioBuffer>();

function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

export function pianoSample(midi: number): AudioBuffer {
  const hit = cache.get(midi);
  if (hit) return hit;

  const f0 = 440 * Math.pow(2, (midi - 69) / 12);
  const r = rand(midi * 7919 + 13);
  // 음이 낮을수록 길게 울림
  const sustain = Math.max(0.9, Math.min(7, 7 * Math.pow(2, -(midi - 33) / 16)));
  const len = Math.floor(SR * Math.min(4.5, sustain * 1.2 + 0.3));
  const L = new Float32Array(len);
  const R = new Float32Array(len);

  const B = 0.00012 * Math.pow(2, (midi - 48) / 20); // 비조화성 계수
  const bright = 2400 + f0 * 5; // 이 위 배음은 약하게 (해머 펠트)
  const maxN = Math.min(20, Math.floor(9000 / f0));
  // 현 개수와 서로 어긋난 정도(센트): 낮은 음은 2현, 나머지 3현
  const strings = midi < 40 ? [-0.6, 0.6] : [-0.9, 0.15, 0.8];

  for (let n = 1; n <= maxN; n++) {
    const fn = n * f0 * Math.sqrt(1 + B * n * n);
    if (fn > 12000) break;
    const strike = Math.abs(Math.sin((Math.PI * n) / 8)) + 0.08;
    const amp = strike / Math.pow(n, 0.85) / (1 + Math.pow(fn / bright, 2));
    if (amp < 0.002) continue;
    // 두 단계 감쇠: 빠른 부분(치는 순간의 밝음) + 느린 부분(남는 울림)
    const slow = sustain / (1 + 0.22 * (n - 1));
    const fast = slow * 0.12;
    const mixFast = Math.min(0.85, 0.45 + n * 0.03);
    const dSlow = Math.exp(-1 / (slow * SR));
    const dFast = Math.exp(-1 / (fast * SR));
    // 배음마다 좌우 위치를 조금 다르게 (공간감)
    const pan = 0.5 + (r() - 0.5) * 0.5;
    const gl = Math.cos((pan * Math.PI) / 2);
    const gr = Math.sin((pan * Math.PI) / 2);
    for (const cents of strings) {
      const f = fn * Math.pow(2, (cents * (1 + n * 0.02)) / 1200);
      const w = (2 * Math.PI * f) / SR;
      // 회전 벡터로 사인 계산 (Math.sin 대신 곱셈만)
      const cw = Math.cos(w);
      const sw = Math.sin(w);
      const ph = r() * Math.PI * 2;
      let c = Math.cos(ph);
      let s = Math.sin(ph);
      let eS = (1 - mixFast) / strings.length;
      let eF = mixFast / strings.length;
      const a = amp;
      const end = Math.min(len, Math.floor(SR * slow * 7));
      for (let i = 0; i < end; i++) {
        const v = s * a * (eS + eF);
        L[i] += v * gl;
        R[i] += v * gr;
        const nc = c * cw - s * sw;
        s = s * cw + c * sw;
        c = nc;
        eS *= dSlow;
        eF *= dFast;
      }
    }
  }

  // 해머 소리: 아주 짧은 노이즈를 음 높이 근처로 걸러서
  let lp = 0;
  let lp2 = 0;
  const k = Math.min(0.6, (2 * Math.PI * Math.min(4000, f0 * 6)) / SR);
  for (let i = 0; i < SR * 0.03; i++) {
    const t = i / SR;
    lp += (r() * 2 - 1 - lp) * k;
    lp2 += (lp - lp2) * k;
    const v = lp2 * Math.exp(-t * 180) * 0.35;
    L[i] += v;
    R[i] += v;
  }

  // 시작 2ms 페이드인 (딸깍 방지), 끝 페이드아웃, 음량 맞춤
  const atk = Math.floor(SR * 0.002);
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const g = i < atk ? i / atk : i > len - 2000 ? (len - i) / 2000 : 1;
    L[i] *= g;
    R[i] *= g;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  // 높은 음이 너무 쏘지 않게 음 높이별 보정 후 정규화
  const target = 0.9 * (midi > 72 ? Math.pow(2, -(midi - 72) / 36) : 1);
  const norm = peak > 0 ? target / peak : 1;
  for (let i = 0; i < len; i++) {
    L[i] *= norm;
    R[i] *= norm;
  }

  const buf = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: SR });
  buf.copyToChannel(L, 0);
  buf.copyToChannel(R, 1);
  cache.set(midi, buf);
  return buf;
}
