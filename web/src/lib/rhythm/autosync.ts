/**
 * 자동 싱크: 치는 동안 모은 "입력 − 가장 가까운 노트" 차이(초, 타격 싱크 적용 후)를 보고
 * 타격 싱크를 몇 ms 옮길지 정한다. 사용자에겐 안 보이고 시스템이 알아서 맞춘다.
 *
 * 두 단계:
 *  - 획득: 처음(또는 크게 어긋났을 때)엔 6탭마다 보고 크게(최대 80ms) 따라붙음 → 150ms 지연도 2~3마디 안에
 *  - 추적: 맞은 뒤엔 24탭마다 조금씩(최대 10ms)만 — 스트림에서 빨라지는 버릇까지 쫓아 출렁이지 않게
 * 움직일지는 중앙값이 "표본 오차"보다 뚜렷이 큰지로 판단(2·SE). 흔들림이 큰 초보도 n이 쌓이면 보정되고,
 * 숙련자는 작은 쏠림까지 보정된다. 완전히 엉망인 입력(MAD가 아주 큼)엔 움직이지 않는다.
 */
export const AUTO_SYNC = {
  /** 가까운 노트를 찾는 범위(초): MISS여도 보정에 쓰이도록 판정 창보다 넓게 */
  near: 0.25,
  acquire: { every: 6, window: 12, gain: 0.8, stepMax: 80 },
  track: { every: 24, window: 48, gain: 0.3, stepMax: 10 },
  /** 이보다 작은 쏠림은 안 건드림(ms) */
  minMs: 5,
  /** 흔들림(MAD)이 이보다 크면 판단 보류 */
  madMax: 70,
  /** 남은 쏠림이 이 안이면 '맞았다' — 두 번 연속이면 추적 단계로 */
  lockMs: 15,
  /** 추적 중 이보다 크게 어긋나면 다시 획득 단계로 */
  unlockMs: 40,
  /** 손·입력 지연으로 볼 수 있는 타격 싱크 한계(ms). 넘는 몫은 소리 지연 → 음악 싱크로 */
  handCap: 60,
  /** 브라우저가 출력 지연(outputLatency)을 안 알려 주면(사파리) 소리 지연이 타격 싱크에 섞여 들어오니 더 낮게 */
  handCapNoLatency: 25,
  /** 판 시작 뒤 이만큼의 입력까지는 HP가 바닥나도 안 끝남 (싱크가 잡히기 전에 죽어 버리면 영영 못 맞춤) */
  graceTaps: 24,
  /** 그 유예도 곡 시작 뒤 이 시간(초)까지만 (가만히 있으면 안 죽는 일이 없게) */
  graceSec: 20,
  limit: 400,
} as const;

/** 자동 싱크가 들고 있는 값 — 둘 다 사용자에겐 안 보임 */
export interface AutoSyncState {
  /** 타격 싱크(ms): 판정만 옮김 (손·입력 지연) */
  judge: number;
  /** 음악 싱크(ms): 노트 화면+판정을 같이 옮김 (소리 지연) */
  offset: number;
}

/** 중앙값(ms)과 중앙값 주변 흔들림(MAD, ms) */
export function spreadOf(tapsSec: number[]): { med: number; mad: number } {
  const ms = tapsSec.map((d) => d * 1000).sort((a, b) => a - b);
  const n = ms.length;
  const mid = (arr: number[]) => (n % 2 ? arr[(n - 1) / 2] : (arr[n / 2 - 1] + arr[n / 2]) / 2);
  const med = mid(ms);
  const dev = ms.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  return { med, mad: mid(dev) };
}

export type AutoSyncPhase = "acquire" | "track";

/**
 * 이번에 타격 싱크를 옮길 양(ms). 0이면 그대로.
 * @param tapsSec 최근 입력 차이들(초, 타격 싱크 적용 후). 여기서 window만큼 잘라 씀
 * @param judge 현재 타격 싱크(ms) — ±limit 범위를 넘지 않게
 */
export function autoSyncStep(tapsSec: number[], judge: number, phase: AutoSyncPhase): number {
  const cfg = AUTO_SYNC[phase];
  const w = tapsSec.slice(-cfg.window);
  if (w.length < 4) return 0;
  const { med, mad } = spreadOf(w);
  if (mad > AUTO_SYNC.madMax) return 0;
  // 중앙값의 표준오차 ≈ 1.2533 × (1.4826 × MAD) / √n — 쏠림이 이보다 뚜렷해야 움직임
  const se = (1.858 * Math.max(mad, 4)) / Math.sqrt(w.length);
  if (Math.abs(med) < Math.max(AUTO_SYNC.minMs, 2 * se)) return 0;
  const step = Math.round(Math.max(-cfg.stepMax, Math.min(cfg.stepMax, med * cfg.gain)));
  const to = Math.max(-AUTO_SYNC.limit, Math.min(AUTO_SYNC.limit, judge + step));
  return to - judge;
}

/**
 * 치는 동안의 자동 싱크 상태 기계. push(d)마다 옮길 양(ms)을 돌려줌(0이면 그대로).
 * 돌려준 만큼 호출한 쪽이 타격 싱크를 옮기고, 모아 둔 차이들도 그만큼 빼서 넘겨야 함(shift).
 */
export class AutoSyncTracker {
  taps: number[] = [];
  phase: AutoSyncPhase = "acquire";
  private lockHits = 0;
  private seen = 0;
  /** 이 판에서 옮긴 합계(ms) */
  moved = 0;
  constructor(public judge: number) {}

  /** 아직 싱크가 잡히기 전인지 (이 동안은 HP가 바닥나도 안 끝남) */
  get grace() {
    return this.phase === "acquire" && this.taps.length < AUTO_SYNC.graceTaps;
  }

  push(dSec: number): number {
    this.taps.push(dSec);
    const cfg = AUTO_SYNC[this.phase];
    if (this.taps.length - this.seen < cfg.every) return 0;
    this.seen = this.taps.length;
    const step = autoSyncStep(this.taps, this.judge, this.phase);
    if (step !== 0) this.shift(step);
    // 남은 쏠림으로 단계 전환
    const { med } = spreadOf(this.taps.slice(-cfg.window));
    if (this.phase === "acquire") {
      if (Math.abs(med) <= AUTO_SYNC.lockMs) {
        if (++this.lockHits >= 2) this.phase = "track";
      } else this.lockHits = 0;
    } else if (Math.abs(med) > AUTO_SYNC.unlockMs) {
      this.phase = "acquire";
      this.lockHits = 0;
    }
    return step;
  }

  private shift(stepMs: number) {
    this.judge += stepMs;
    this.moved += stepMs;
    const s = stepMs / 1000;
    for (let i = 0; i < this.taps.length; i++) this.taps[i] -= s;
    if (this.taps.length > 200) this.taps.splice(0, this.taps.length - 200);
  }
}

/**
 * 판이 끝날 때: 타격 싱크가 손 지연 한계를 넘었으면 넘는 몫을 음악 싱크로 옮김.
 * 둘의 합은 그대로라 판정은 안 바뀌고, 노트가 보이는 위치만 소리에 맞게 움직인다.
 * @param handCap 손 지연 한계(ms) — 출력 지연을 모르는 브라우저는 더 낮게
 */
export function splitSync(
  judge: number,
  offset: number,
  handCap: number = AUTO_SYNC.handCap
): AutoSyncState {
  const ex = judge - Math.max(-handCap, Math.min(handCap, judge));
  if (ex === 0) return { judge, offset };
  return {
    judge: judge - ex,
    offset: Math.max(-AUTO_SYNC.limit, Math.min(AUTO_SYNC.limit, offset + ex)),
  };
}

/** 자동 싱크 값은 기기·입력 방식별로 따로 (스피커↔블루투스, 키보드↔터치가 바뀌면 지연도 달라서) */
export const AUTO_SYNC_KEY = "rhythm.autosync.v1";
export type AutoSyncStore = Record<string, AutoSyncState>;

/** 프로필 키: 입력 방식 × 출력 지연(10ms 단위, 모르면 na) */
export function autoSyncProfile(touch: boolean, outputLatencySec: number | undefined) {
  const ol = outputLatencySec === undefined ? "na" : String(Math.round(outputLatencySec * 100));
  return `${touch ? "touch" : "key"}:${ol}`;
}

export function loadAutoSync(key: string): AutoSyncState {
  try {
    const all = JSON.parse(localStorage.getItem(AUTO_SYNC_KEY) ?? "null") as AutoSyncStore | null;
    const s = all?.[key];
    const clamp = (v: unknown) =>
      Math.max(-AUTO_SYNC.limit, Math.min(AUTO_SYNC.limit, Number(v) || 0));
    if (s) return { judge: clamp(s.judge), offset: clamp(s.offset) };
  } catch {}
  return { judge: 0, offset: 0 };
}

export function saveAutoSync(key: string, s: AutoSyncState) {
  try {
    const all =
      (JSON.parse(localStorage.getItem(AUTO_SYNC_KEY) ?? "null") as AutoSyncStore | null) ?? {};
    all[key] = { judge: Math.round(s.judge), offset: Math.round(s.offset) };
    localStorage.setItem(AUTO_SYNC_KEY, JSON.stringify(all));
  } catch {}
}
