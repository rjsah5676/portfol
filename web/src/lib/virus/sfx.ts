/**
 * 바이러스 키우기 효과음 — public/virus/sfx (ElevenLabs Sound Effects로 만든 소리, 2026-10-12)
 *   hit         일반 타격 (원본 2초 → 앞 0.12초만, 최대 -1 dBFS)
 *   exploit     익스플로잇 (원본 5초 → 첫 터짐 0.6초만)
 *   boss-appear 보스 등장 (2.9초)
 *   boss-down   보스 격퇴 (1.85초)
 *   boss-fail   격퇴 실패 · 차단 (원본 2초 → 1.95초, 끝 페이드)
 * 다듬기: 앞 무음 자르고 끝 페이드, 최대를 -1 dBFS 로 (원본은 public 밖에 백업).
 * 아래 GAIN 은 0.4초 창 최대 음량을 재서 맞춤 — hit -28 · exploit -20 LUFS 근처 (자주 나는 소리일수록 작게).
 * 보스 소리는 처음 0.5 · 0.6 → "타격음보다 더 크게"(2026-10-12)라서 1로 (+5 dB, 약 -8 LUFS · 최대 -1 dBFS — 리미터가 겹침을 막음).
 * hit 은 0.12초짜리 딱 소리라 0.4초 창 음량보다 크게 들림 (최대는 둘 다 -1 dBFS 근처).
 * 후반엔 초당 20발 넘게 맞아서, 같은 소리는 MIN_GAP 간격보다 자주 내지 않음 (뭉개지지 않게).
 * 다른 탭으로 가거나 창을 내리면 소리를 아예 멈춤 (게임은 뒤에서도 돌아서 타격 · 보스 소리가 들렸음).
 */
import { LEVEL, limiter } from "@/lib/soundLevel";

export type VirusSfx = "hit" | "exploit" | "boss-appear" | "boss-down" | "boss-fail";

const GAIN: Record<VirusSfx, number> = {
  hit: 0.9,
  exploit: 0.4,
  "boss-appear": 1,
  "boss-down": 1,
  /** 0.4초 창 -11.3 LUFS — 등장 · 격퇴보다 살짝 작게 (자주 지는 구간에서 반복돼도 덜 거슬리게) */
  "boss-fail": 0.85,
};
/** 같은 소리를 다시 낼 수 있는 최소 간격 (초) */
const MIN_GAP: Record<VirusSfx, number> = {
  hit: 0.1,
  exploit: 0.16,
  "boss-appear": 1,
  "boss-down": 1,
  "boss-fail": 1,
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.8;
const buffers = new Map<VirusSfx, AudioBuffer>();
const lastAt = new Map<VirusSfx, number>();
let loading = false;

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/** 화면이 가려지면 소리 장치를 멈추고, 돌아오면 다시 (이미 나고 있던 보스 소리도 같이 멈춤) */
function onVisibility() {
  if (!ctx) return;
  if (hidden()) void ctx.suspend();
  else void ctx.resume();
}

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = volume * LEVEL.virus.sfx;
      master.connect(limiter(ctx));
      document.addEventListener("visibilitychange", onVisibility);
    }
    if (ctx.state === "suspended" && !hidden()) void ctx.resume();
    if (!loading) {
      loading = true;
      const c = ctx;
      for (const name of Object.keys(GAIN) as VirusSfx[]) {
        fetch(`/virus/sfx/${name}.mp3`)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
          .then((b) => c.decodeAudioData(b))
          .then((buf) => buffers.set(name, buf))
          .catch(() => {});
      }
    }
    return ctx;
  } catch {
    return null;
  }
}

/** 사용자 입력(키·클릭) 안에서 불러야 소리가 남 — 미리 불러 두기도 함 */
export function unlockVirusSfx() {
  ac();
}

/** 효과음 크기 0~1 */
export function setVirusSfxVolume(v: number) {
  volume = v;
  if (master && ctx) master.gain.setValueAtTime(volume * LEVEL.virus.sfx, ctx.currentTime);
}

/** 효과음 재생 — 반복돼도 덜 질리게 음높이를 ±3% 흔듦 */
export function playVirusSfx(name: VirusSfx) {
  if (volume <= 0 || hidden()) return;
  const c = ac();
  const buf = buffers.get(name);
  if (!c || !buf || !master) return;
  const now = c.currentTime;
  if (now - (lastAt.get(name) ?? -1) < MIN_GAP[name]) return;
  lastAt.set(name, now);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.06;
  const g = c.createGain();
  g.gain.value = GAIN[name];
  src.connect(g).connect(master);
  src.start();
}
