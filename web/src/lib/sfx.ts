/*
 * 짧은 효과음을 Web Audio로 즉석 합성 (파일 없이).
 * 첫 사용자 입력 이후에만 소리가 나므로(브라우저 자동재생 정책) 게임 입력에서 호출하면 됨.
 */

let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** 노이즈 버퍼 (재사용) */
let noiseBuf: AudioBuffer | null = null;
function noise(c: AudioContext): AudioBuffer {
  if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function env(c: AudioContext, peak: number, attack: number, decay: number, at = c.currentTime) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  g.connect(c.destination);
  return g;
}

/*
 * 체스·장기 착수음 (녹음 파일: public/audio/sfx/*.mp3)
 * move-self 내 수 · move-opponent 상대 수 · capture 잡기 · castle 캐슬링
 * check 체크/장군 · promote 승진 · premove 한수쉼
 * set을 주면 public/audio/sfx/{set}/ 에서 ("chess" — 나무 기물 소리 녹음을 잘라 만든 세트, 체스·장기·오목 공통)
 */
export type PieceSound =
  "move-self" | "move-opponent" | "capture" | "castle" | "check" | "promote" | "premove";
const PIECE_SOUNDS: PieceSound[] = [
  "move-self",
  "move-opponent",
  "capture",
  "castle",
  "check",
  "promote",
  "premove",
];

const samples = new Map<string, Promise<AudioBuffer | null>>();
function sample(c: AudioContext, name: PieceSound, set?: string) {
  const path = `/audio/sfx/${set ? `${set}/` : ""}${name}.mp3`;
  let p = samples.get(path);
  if (!p) {
    p = fetch(path)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((b) => c.decodeAudioData(b))
      .catch(() => null);
    samples.set(path, p);
  }
  return p;
}

export function playPiece(name: PieceSound, vol = 1, set?: string) {
  const c = ac();
  if (!c) return;
  void sample(c, name, set).then((buf) => {
    if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(g).connect(c.destination);
    src.start();
  });
}

/** 첫 착수 때 늦지 않게 미리 받아 둠 */
export function preloadPieceSounds(set?: string) {
  const c = ac();
  if (!c) return;
  PIECE_SOUNDS.forEach((n) => void sample(c, n, set));
}

/** 깃발 꽂기 "톡" (뽑을 땐 음이 내려감) */
export function playFlag(on: boolean, vol = 1) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const o = c.createOscillator();
  o.type = "triangle";
  const [a, b] = on ? [520, 1040] : [900, 450];
  o.frequency.setValueAtTime(a, t);
  o.frequency.exponentialRampToValueAtTime(b, t + 0.08);
  o.connect(env(c, 0.3 * vol, 0.004, 0.11, t));
  o.start(t);
  o.stop(t + 0.14);
}

/** 칸 열기 "톡" — 짧고 부드러운 물방울 소리 */
export function playReveal(vol = 1) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const o = c.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(980, t);
  o.frequency.exponentialRampToValueAtTime(620, t + 0.05);
  o.connect(env(c, 0.28 * vol, 0.003, 0.07, t));
  o.start(t);
  o.stop(t + 0.09);
}

/** 좌우 동시 클릭(자동 열기) "또로롱" — 올라가는 짧은 3음 */
export function playChord(vol = 1) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime;
  [660, 880, 1175].forEach((f, i) => {
    const t = t0 + i * 0.045;
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(f, t);
    o.connect(env(c, 0.2 * vol, 0.003, 0.08, t));
    o.start(t);
    o.stop(t + 0.1);
  });
}

/** 지뢰 폭발 "콰광" — 저역 노이즈 + 떨어지는 저음 */
export function playExplosion(vol = 1) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const n = c.createBufferSource();
  n.buffer = noise(c);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(2400, t);
  lp.frequency.exponentialRampToValueAtTime(120, t + 0.9);
  n.connect(lp).connect(env(c, 0.9 * vol, 0.005, 1.0, t));
  n.start(t);
  n.stop(t + 1.1);
  const o = c.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(110, t);
  o.frequency.exponentialRampToValueAtTime(32, t + 0.6);
  o.connect(env(c, 0.8 * vol, 0.005, 0.7, t));
  o.start(t);
  o.stop(t + 0.75);
}
