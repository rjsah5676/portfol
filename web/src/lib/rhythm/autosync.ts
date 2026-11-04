/**
 * 자동 싱크: 치는 동안 모은 "입력 − 가장 가까운 노트" 차이(초, 타격 싱크 적용 후)를 보고
 * 타격 싱크를 몇 ms 옮길지 정한다. 사용자에겐 안 보이고 시스템이 알아서 맞춘다.
 *
 * 두 단계:
 *  - 획득: 처음(또는 크게 어긋났을 때)엔 6탭마다 보고 크게(최대 80ms) 따라붙음 → 150ms 지연도 2~3마디 안에
 *  - 추적: 맞은 뒤엔 24탭마다 조금씩(최대 10ms)만 — 스트림에서 빨라지는 버릇까지 쫓아 출렁이지 않게
 * 움직일지는 중앙값이 "표본 오차"보다 뚜렷이 큰지로 판단(2·SE). 흔들림이 큰 초보도 n이 쌓이면 보정되고,
 * 숙련자는 작은 쏠림까지 보정된다. 완전히 엉망인 입력(MAD가 아주 큼)엔 움직이지 않는다.
 *
 * 위 두 단계는 처음(프로필이 아직 안 맞춰졌을 때)만. 한 번 맞춰진 뒤엔 고정(hold):
 *  - 판 도중엔 판정 기준을 안 옮김 — 스트림에서 당겨 치는 버릇까지 따라가면 기준이 흔들리고 FAST/SLOW 가 의미 없어짐
 *  - 판이 끝날 때 그 판의 쏠림(스트림 말고 띄엄띄엄한 노트 기준)만큼 다음 판을 조금 옮김
 *  - 판 도중에 이어폰을 바꾸는 경우: 출력 지연을 아는 브라우저는 Stage 가 지연 변화를 보고 시계를 고침(판정 기준은 그대로).
 *    여기선 그 밖의 경우(사파리 등)만 — 못 쳐서 어긋난 것과 헷갈리지 않게 아주 좁게:
 *    띄엄띄엄한 노트 16개씩 두 번 연속, 평소 기준보다 100ms 넘게(GREAT 창 90ms 밖) 늦거나 빠르면서 흔들림(MAD) 30ms 안.
 *    기준이 이미 그 사람 평소 쏠림에 맞춰져 있어서, 거기서 100ms 넘게 고르게 어긋나는 건 실력이 아니라 기기 쪽
 *  - 판 끝 조정도 보통은 한 판에 15ms 까지. 판 전체가 60ms 넘게 고르게(MAD 25 안) 어긋났을 때만 한 번에
 * 자동 싱크를 끄면(설정) 저장된 값 그대로 고정 — 직접 맞추는 사람용.
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
  /**
   * 고정 단계: 판 도중엔 안 옮김. 띄엄띄엄한 노트 every 개마다 중앙값이 breakMs 넘게 어긋나고 흔들림이 breakMad 안이면
   * 기기가 바뀐 걸로 의심 — breakHits 번 연속이면 그 쏠림만큼 한 번에 옮김 (계속 따라가지는 않음)
   */
  hold: { every: 16, breakMs: 100, breakMad: 30, breakHits: 2 },
  /**
   * 판 끝 조정: 그 판 쏠림 × gain (한 판에 stepMax 까지). 띄엄띄엄한 노트가 minSparse 개 안 되면 전체 minAll 개로.
   * 판 전체가 bigMs 넘게 고르게(MAD bigMad 안) 어긋났으면 기기가 바뀐 걸로 보고 한 번에
   */
  settle: { gain: 0.5, stepMax: 15, minMs: 3, minSparse: 24, minAll: 48, bigMs: 60, bigMad: 25 },
  /** 앞뒤 노트(다른 레인 포함) 간격이 이보다 좁으면 스트림 — 판 끝 조정에서 뺌(당겨 치는 버릇이 섞여서) */
  denseGap: 0.15,
} as const;

/** 자동 싱크가 들고 있는 값 — 사용자에겐 안 보임 */
export interface AutoSyncState {
  /** 타격 싱크(ms): 판정만 옮김 (손·입력 지연) */
  judge: number;
  /** 음악 싱크(ms): 노트 화면+판정을 같이 옮김 (소리 지연) */
  offset: number;
  /** 한 번 맞춰짐 → 다음 판부터 고정(판 도중엔 안 옮김). 없으면 값이 0이 아닐 때 맞춰진 걸로 봄(예전 저장값) */
  ready?: boolean;
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
  /** 스트림이 아닌(앞뒤 간격 넉넉한) 노트에서 나온 차이만 — 판 끝 조정용 */
  private sparse: number[] = [];
  /** hold: 이미 맞춰진 프로필 — 판 도중엔 안 옮기고 판 끝에 settleStep 만큼 */
  phase: AutoSyncPhase | "hold";
  private lockHits = 0;
  private breakHits = 0;
  private seen = 0;
  /** 꺼져 있으면(설정) 기록만 하고 안 옮김 */
  readonly enabled: boolean;
  /** 이 판에서 옮긴 합계(ms) */
  moved = 0;
  constructor(
    public judge: number,
    opt: { ready?: boolean; enabled?: boolean } = {}
  ) {
    this.enabled = opt.enabled ?? true;
    this.phase = opt.ready ? "hold" : "acquire";
  }

  /** 아직 싱크가 잡히기 전인지 (이 동안은 HP가 바닥나도 안 끝남) */
  get grace() {
    return this.enabled && this.phase === "acquire" && this.taps.length < AUTO_SYNC.graceTaps;
  }

  /** 다음 판을 고정(hold)으로 시작해도 되는지 — 획득 단계를 벗어났으면 */
  get ready() {
    return this.phase !== "acquire";
  }

  /** @param sparse 스트림이 아닌 노트에서 나온 차이인지 (판 끝 조정에 씀) */
  push(dSec: number, sparse = true): number {
    this.taps.push(dSec);
    if (sparse) this.sparse.push(dSec);
    if (!this.enabled) return 0;
    if (this.phase === "hold") {
      // 스트림 노트는 당겨 치는 버릇이 섞여서 안 봄
      if (!sparse) return 0;
      const H = AUTO_SYNC.hold;
      if (this.sparse.length - this.seen < H.every) return 0;
      this.seen = this.sparse.length;
      const { med, mad } = spreadOf(this.sparse.slice(-H.every));
      if (mad > H.breakMad || Math.abs(med) <= H.breakMs) {
        this.breakHits = 0;
        return 0;
      }
      if (++this.breakHits < H.breakHits) return 0;
      this.breakHits = 0;
      // 기기가 바뀐 듯 → 그 쏠림만큼 한 번에 옮기고 다시 고정. 앞 기록은 옛 기기 것이라 버림(판 끝 조정에 안 섞이게)
      const m = spreadOf(this.sparse.slice(-H.every * H.breakHits)).med;
      const to = Math.max(-AUTO_SYNC.limit, Math.min(AUTO_SYNC.limit, this.judge + Math.round(m)));
      const step = to - this.judge;
      this.judge = to;
      this.moved += step;
      this.taps = [];
      this.sparse = [];
      this.seen = 0;
      return step;
    }
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
    for (let i = 0; i < this.sparse.length; i++) this.sparse[i] -= s;
    if (this.taps.length > 200) this.taps.splice(0, this.taps.length - 200);
  }

  /**
   * 판 끝 조정(ms): 고정(hold)으로 친 판의 쏠림만큼 다음 판 타격 싱크를 옮김 (판 도중엔 안 움직였으니 판 전체가 같은 기준).
   * 스트림에서 당겨 치는 버릇은 빼고 띄엄띄엄한 노트로 — 모자라면 전체로, 그것도 모자라면 안 옮김.
   * 몇 번 불러도(일시정지 → 끝) 그때까지 모인 걸로 다시 계산할 뿐 쌓이지 않음
   */
  settleStep(): number {
    if (!this.enabled || this.phase !== "hold") return 0;
    const S = AUTO_SYNC.settle;
    const pick =
      this.sparse.length >= S.minSparse
        ? this.sparse
        : this.taps.length >= S.minAll
          ? this.taps
          : null;
    if (!pick) return 0;
    const { med, mad } = spreadOf(pick);
    if (mad > AUTO_SYNC.madMax) return 0;
    const se = (1.858 * Math.max(mad, 3)) / Math.sqrt(pick.length);
    if (Math.abs(med) < Math.max(S.minMs, 2 * se)) return 0;
    const step =
      Math.abs(med) > S.bigMs && mad <= S.bigMad
        ? Math.round(med)
        : Math.round(Math.max(-S.stepMax, Math.min(S.stepMax, med * S.gain)));
    const to = Math.max(-AUTO_SYNC.limit, Math.min(AUTO_SYNC.limit, this.judge + step));
    return to - this.judge;
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

/**
 * 판 시작 때: 출력 지연을 아는 브라우저(크롬 등)는 소리 지연을 이미 빼서 계산하므로
 * 자동 음악 싱크가 쌓일 이유가 없음 — 예전에 쌓인 값은 판마다 절반씩 0으로 되돌림
 * (한 번에 0으로 만들면 판정이 확 바뀌어서). 출력 지연을 모르면(사파리) 그대로.
 */
export function decayOffset(offset: number, latencyKnown: boolean): number {
  if (!latencyKnown) return offset;
  const half = Math.trunc(offset / 2);
  return Math.abs(half) < 5 ? 0 : half;
}

/** 자동 싱크 값은 기기·입력 방식별로 따로 (스피커↔블루투스, 키보드↔터치가 바뀌면 지연도 달라서) */
// v2: v1 때 쌓인 음악 싱크가 어긋나 있어서 모두 0부터 다시 (v1은 지움)
export const AUTO_SYNC_KEY = "rhythm.autosync.v2";
try {
  if (typeof window !== "undefined") localStorage.removeItem("rhythm.autosync.v1");
} catch {}
export type AutoSyncStore = Record<string, AutoSyncState>;

/** 출력 지연이 이 이상이면 블루투스 등 무선 출력으로 봄(초) — 유선·내장은 10~50ms, 블루투스는 150ms 넘음 */
const WIRELESS_LATENCY = 0.1;

/**
 * 프로필 키: 입력 방식 × 출력 종류(wired · bt, 모르면 na).
 * 예전엔 출력 지연을 10ms 단위로 나눴는데, 같은 스피커도 outputLatency 가 경계(45ms 등)에서 판마다 흔들려
 * 프로필이 둘로 갈라졌음 → 곡을 시작할 때마다 다른 쪽 값을 불러와 첫 마디들 판정이 어긋남 (실제로 key:4 59ms · key:5 76ms)
 */
export function autoSyncProfile(touch: boolean, outputLatencySec: number | undefined) {
  const out =
    outputLatencySec === undefined ? "na" : outputLatencySec < WIRELESS_LATENCY ? "wired" : "bt";
  return `${touch ? "touch" : "key"}:${out}`;
}

/** 예전 10ms 단위 프로필(key:4 · key:5 …)을 wired · bt 로 합침 (같은 쪽끼리 평균) — 한 번만, 숫자 키가 없으면 그대로 */
function migrateLatencyBuckets() {
  const all = JSON.parse(localStorage.getItem(AUTO_SYNC_KEY) ?? "null") as AutoSyncStore | null;
  if (!all) return;
  const groups = new Map<string, AutoSyncState[]>();
  for (const [k, v] of Object.entries(all)) {
    const m = /^(key|touch):(\d+)$/.exec(k);
    if (!m) continue;
    const to = autoSyncProfile(m[1] === "touch", Number(m[2]) / 100);
    groups.set(to, [...(groups.get(to) ?? []), v]);
    delete all[k];
  }
  if (!groups.size) return;
  const avg = (xs: number[]) =>
    Math.round(xs.reduce((a, b) => a + (Number(b) || 0), 0) / xs.length);
  for (const [to, list] of groups) {
    // 새 키에 이미 값이 있으면(다른 탭에서 먼저 옮김) 그것도 같이 평균
    const withCur = all[to] ? [...list, all[to]] : list;
    all[to] = {
      judge: avg(withCur.map((s) => s.judge)),
      offset: avg(withCur.map((s) => s.offset)),
    };
  }
  localStorage.setItem(AUTO_SYNC_KEY, JSON.stringify(all));
}
try {
  if (typeof window !== "undefined") migrateLatencyBuckets();
} catch {}

export function loadAutoSync(key: string): AutoSyncState {
  try {
    const all = JSON.parse(localStorage.getItem(AUTO_SYNC_KEY) ?? "null") as AutoSyncStore | null;
    const s = all?.[key];
    const clamp = (v: unknown) =>
      Math.max(-AUTO_SYNC.limit, Math.min(AUTO_SYNC.limit, Number(v) || 0));
    if (s) {
      const judge = clamp(s.judge);
      const offset = clamp(s.offset);
      // ready 가 없는 예전 저장값: 값이 쌓여 있으면 맞춰진 걸로
      const ready = typeof s.ready === "boolean" ? s.ready : judge !== 0 || offset !== 0;
      return { judge, offset, ready };
    }
  } catch {}
  return { judge: 0, offset: 0, ready: false };
}

export function saveAutoSync(key: string, s: AutoSyncState) {
  try {
    const all =
      (JSON.parse(localStorage.getItem(AUTO_SYNC_KEY) ?? "null") as AutoSyncStore | null) ?? {};
    all[key] = { judge: Math.round(s.judge), offset: Math.round(s.offset), ready: !!s.ready };
    localStorage.setItem(AUTO_SYNC_KEY, JSON.stringify(all));
  } catch {}
}

/** 자동 싱크 초기화 (모든 기기·입력 방식 프로필) */
export function clearAutoSync() {
  try {
    localStorage.removeItem(AUTO_SYNC_KEY);
  } catch {}
}
