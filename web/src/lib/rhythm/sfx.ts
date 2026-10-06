/**
 * BEAT DASH 효과음·메뉴 BGM (public/rhythm/sfx, menu-bgm.mp3).
 * 오디오 컨텍스트는 게임 전체가 하나를 같이 씀 (곡 재생·타격음과 같은 시계).
 */

let sharedCtx: AudioContext | null = null;
/** 공용 오디오 컨텍스트 (처음 부를 때 만들고, 멈춰 있으면 깨움) */
export async function audio() {
  if (!sharedCtx) sharedCtx = new AudioContext({ latencyHint: "interactive" });
  if (sharedCtx.state !== "running") await sharedCtx.resume().catch(() => {});
  return sharedCtx;
}
/** 이미 만들어진 컨텍스트 (없으면 null) — 사용자 동작 전에 새로 만들지 않으려고 */
export const peekCtx = () => sharedCtx;

export const SFX = [
  "ui-move",
  "ui-select",
  "ui-back",
  "ui-open",
  "title-start",
  "song-decide",
  "countdown",
  "go",
  "combo-milestone",
  "combo-break",
  "fail",
  "rank-reveal",
  "clear",
  "fullcombo",
  "allperfect",
  "new-record",
] as const;
export type SfxName = (typeof SFX)[number];

const bufs = new Map<SfxName, AudioBuffer>();
let loading: Promise<void> | null = null;

/** 효과음 전부 미리 받아 둠 (여러 번 불러도 한 번만) */
export function loadSfx(): Promise<void> {
  if (loading) return loading;
  loading = audio().then((ctx) =>
    Promise.all(
      SFX.map((n) =>
        fetch(`/rhythm/sfx/${n}.mp3`)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
          .then((ab) => ctx.decodeAudioData(ab))
          .then((b) => void bufs.set(n, b))
          .catch(() => {})
      )
    ).then(() => {})
  );
  return loading;
}

/** 불러온 효과음 (아직이면 null) — 플레이 화면에서 정확한 시각에 예약할 때 */
export const sfxBuffer = (n: SfxName) => bufs.get(n) ?? null;

let master = 0.7;
/** 효과음 볼륨 0~1 */
export const setSfxVolume = (v: number) => {
  master = Math.max(0, Math.min(1, v));
};
export const sfxVolume = () => master;

/** 효과음 바로 재생 (at: 컨텍스트 시각에 예약). 반환값으로 멈출 수 있음 */
export function sfx(n: SfxName, gain = 1, at?: number): AudioBufferSourceNode | null {
  const ctx = sharedCtx;
  const b = bufs.get(n);
  if (!ctx || !b || master <= 0 || ctx.state !== "running") return null;
  const src = ctx.createBufferSource();
  src.buffer = b;
  const g = ctx.createGain();
  g.gain.value = master * gain;
  src.connect(g).connect(ctx.destination);
  src.start(at ?? 0);
  return src;
}

/** 아주 짧은 디지털 틱 (결과 화면 숫자 올라갈 때) — 파일 대신 합성 */
export function tick(gain = 0.25) {
  const ctx = sharedCtx;
  if (!ctx || master <= 0 || ctx.state !== "running") return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "square";
  o.frequency.value = 2400;
  g.gain.setValueAtTime(master * gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.04);
}

// ───────── 메뉴 BGM: 처음엔 0초부터, 그다음은 20.78~50.78초(128BPM 16마디)를 끊김 없이 반복 ─────────
const BGM_URL = "/rhythm/menu-bgm.mp3";
const LOOP = [20.782, 50.7815] as const;
let bgmBuf: Promise<AudioBuffer> | null = null;
let bgm: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let bgmVol = 0.5;
/** 틀어야 하는지 — 파일을 받거나 풀어서(모바일은 몇 초 걸림) 기다리는 사이 stopBgm이 불렸으면 틀지 않음 */
let bgmWant = false;

export async function playBgm(volume: number) {
  bgmVol = volume;
  bgmWant = true;
  const ctx = await audio();
  if (!bgmWant || ctx.state !== "running") return;
  if (bgm) {
    const t = ctx.currentTime;
    bgm.gain.gain.cancelScheduledValues(t);
    bgm.gain.gain.setValueAtTime(bgm.gain.gain.value, t);
    bgm.gain.gain.linearRampToValueAtTime(volume * 0.45, t + 0.4);
    return;
  }
  if (!bgmBuf)
    bgmBuf = fetch(BGM_URL)
      .then((r) => r.arrayBuffer())
      .then((ab) => ctx.decodeAudioData(ab));
  let buf: AudioBuffer;
  try {
    buf = await bgmBuf;
  } catch {
    bgmBuf = null;
    return;
  }
  // 기다리는 사이 다른 호출이 이미 틀었거나, 화면이 바뀌어 꺼야 하면 그냥 끝
  if (bgm || !bgmWant) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.loopStart = LOOP[0];
  src.loopEnd = LOOP[1];
  const gain = ctx.createGain();
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(bgmVol * 0.45, t + 0.8);
  src.connect(gain).connect(ctx.destination);
  src.start(t);
  bgm = { src, gain };
}

export function stopBgm(fade = 0.5) {
  bgmWant = false;
  const b = bgm;
  const ctx = sharedCtx;
  bgm = null;
  if (!b || !ctx) return;
  const t = ctx.currentTime;
  try {
    b.gain.gain.cancelScheduledValues(t);
    b.gain.gain.setValueAtTime(b.gain.gain.value, t);
    b.gain.gain.linearRampToValueAtTime(0, t + fade);
    b.src.stop(t + fade + 0.05);
  } catch {}
}
