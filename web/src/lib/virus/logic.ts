// 바이러스 키우기 (방치형, 컴퓨터 바이러스) — 화면과 상관없는 규칙·수치
//
// 흐름: 내 바이러스(me.exe)가 코드 조각을 자동으로 쏴 파일을 감염 → 데이터 탈취 → 데이터로 내 바이러스를 강화
//       스테이지마다 파일 MOBS_PER_STAGE 개를 감염시키면 그 네트워크를 장악한 보스 바이러스가 나옴
//       제한 시간 안에 격퇴하면 다음 스테이지 + 그 바이러스의 코드 모듈(영구 능력)을 빼앗음
//       보스는 ROSTER 10종이 돌아가며 나오고, 처음 가 보는 스테이지에서 이길 때마다 모듈 버전이 오름
//       더 나아가기 힘들어지면 「시스템 포맷」(환생): 처음부터 다시 하는 대신 루트 권한을 받아 영구히 강해짐
//
// 성장 곡선 (scripts/virus-balance.ts 로 시뮬레이션해서 맞춤)
//   - 적 체력은 스테이지마다 BAL.hpGrowth 배, 보상은 체력에 비례 (Clicker Heroes 방식)
//   - 페이로드 피해는 레벨마다 고정 배율로 곱해지고, 25레벨마다 추가 배수 (AdVenture Capitalist 방식)
//   - 업그레이드 비용은 레벨마다 고정 배율로 오름
//   - 오버클럭·익스플로잇은 상한 없이, 올릴수록 효과가 줄어드는 소프트 캡
//   - 모듈은 버전마다 작은 배율로 곱해짐 (10스테이지마다 오르므로 크면 성장이 폭주)
//   - 루트 권한은 최고 스테이지의 거듭제곱 — 누적 데이터(지수적으로 늘어남)로 정하면 포맷마다 폭주함

/** 밸런스 수치 — 한곳에서 조정 */
export const BAL = {
  /** 1스테이지 파일의 보안 등급(체력) */
  hp0: 4,
  /**
   * 극초반 보정 — 첫 몇 스테이지만 체력을 낮추고 데이터를 더 줌 (스테이지마다 earlyDecay 배씩 사라짐, 40스테이지쯤 거의 없음 — 최적으로 하면 스테이지 30까지 약 5분)
   *   체력 ÷ (1 + earlyHp × earlyDecay^(스테이지-1)) · 데이터 × (1 + earlyData × earlyDecay^(스테이지-1))
   */
  earlyHp: 10,
  earlyData: 10,
  earlyDecay: 0.9,
  /** 상위 보스 체력 · 보상 = 같은 스테이지 보스의 몇 배 */
  apexHp: 2,
  apexData: 5,
  /** 최종 보스 체력 · 보상 = 마지막 스테이지 상위 보스의 몇 배 */
  finalHp: 3,
  finalData: 10,
  /** KILLSWITCH 를 잡을 때마다 다음 버전 체력 배율 */
  finalGrowth: 1.5,
  /** 커널 상점: 커널 패치 피해 · 권한 상승 루트 권한 획득 · 데이터 압축 데이터 · 인터럽트 지연 보스 시간(초) */
  corePatch: 1.25,
  coreEscal: 0.2,
  coreComp: 1.5,
  coreIrq: 5,
  /** 스테이지마다 체력 배율 (lateFrom 까지) · 그 뒤로는 hpGrowthLate */
  hpGrowth: 1.18,
  lateFrom: 100,
  hpGrowthLate: 1.18,
  /** 보스 체력 = 같은 스테이지 파일의 몇 배 */
  bossHp: 10,
  /** 보상 = 체력 ÷ 이 값 */
  dataRatio: 4,
  /** 보스 보상 = 같은 스테이지 파일 보상의 몇 배 */
  bossData: 10,
  /** 페이로드 1레벨당 피해 배율 */
  atkStep: 1.06,
  /** 페이로드 이 레벨마다 피해 ×atkMilestoneMul */
  atkMilestone: 25,
  atkMilestoneMul: 2,
  /** 오버클럭: 초당 발사 수가 1 → spdMax 로 점점 다가감 */
  spdMax: 8,
  spdK: 0.96,
  /** 익스플로잇: 확률이 5% → critMax 로 점점 다가감, 레벨마다 피해 +critMulStep */
  critMax: 0.5,
  critK: 0.95,
  critMulStep: 0.05,
  /** 시스템 포맷이 열리는 스테이지 */
  formatStage: 30,
  /** 루트 권한 합계 = ((최고 스테이지 - 1) ÷ rootDiv)^rootPow — 더 멀리 가야만 늘어남 */
  rootDiv: 10,
  /**
   * 루트 권한 합계 = ((최고 스테이지 - 1) ÷ rootDiv)^rootPow (× 100을 넘은 스테이지마다 rootLate)
   * 시뮬레이션(--auto --chal --rate, 최적 변이): 스테이지 100 ≈ 45분 · 500 ≈ 3시간 · 1000 ≈ 9.7시간 (변이 약 20번)
   */
  rootPow: 2.17,
  /** 스테이지 lateFrom 을 넘은 뒤 최고 스테이지 1마다 루트 권한 합계 ×rootLate */
  rootLate: 1.03,
  /** 루트 권한 1당 피해 +이 비율 */
  rootBonus: 0.03,
  /** 코드 모듈 공격 효과: 버전마다 상한까지 남은 거리가 이 배로 줄어듦 (v10 ≈ 37% · v50 ≈ 92% · v100 ≈ 99%) */
  fxK: 0.93,
  /** 코드 모듈 v → v+1 조각 = fragBase × fragGrowth^v · 우회 기술 v → v+1 키 = keyBase × keyGrowth^(v-1) */
  fragBase: 3,
  fragGrowth: 1.12,
  keyBase: 2,
  keyGrowth: 1.15,
  /** 다시 도는 스테이지: 보스를 이 초 이상 걸려 잡으면 조각 · 키 확률 100% (짧을수록 낮음) */
  revisitSecs: 20,
  /** 우회 기술 1버전 = 예전 공식(10스테이지마다 1버전)의 몇 버전어치 */
  bypScale: 4,
  /** 우회 기술 「암호화 터널」 발사 속도: ×1.15 에서 최대 ×1.15·modSpdMax 로 (버전마다 남은 거리 modSpdK 배) */
  modSpdMax: 3,
  modSpdK: 0.96,
  /** 우회 기술 버전 1당 배율 — 10스테이지마다 하나씩 오르므로 작게 (크면 성장이 폭주) */
  modDmg: 1.1,
  modData: 1.1,
  modCost: 0.97,
  modMobHp: 0.97,
  modBossHp: 0.97,
  modBossDmg: 1.15,
  /**
   * 버전마다 점점 덜 오르는 모듈 (상한이 없으면 후반에 오프라인이 온라인보다 커지고, 익스플로잇 확률이 업그레이드 없이 꽉 참)
   *   Zeus: 오프라인 효율 30% → 최대 offRateMax
   *   Conficker: 익스플로잇 확률 +0 → 최대 +modCritMax
   */
  offRateMax: 0.7,
  modCritMax: 0.25,
  /** 위 두 가지가 상한에 다가가는 빠르기 (버전마다 남은 거리의 이 비율만 남음) */
  modSoftK: 0.85,
  /** 오프라인 수익을 쌓는 최대 시간 (고정, 모듈과 상관없음) */
  offHours: 24,
  /** 페이로드 비용 배율 */
  atkCost: 1.25,
  /** 랜덤 강화 가격 = 오를 레벨 수(1~3)의 확률대로 평균 낸 비용 × 이 값 */
  randPrice: 0.95,
  /** 루트 권한 상점 — 레벨마다 효과 · 가격 배율 (가격 = base × growth^레벨) */
  shopRootkit: 1.3,
  shopMiner: 1.3,
  /** 폴리모픽 엔진: 랜덤 강화 3레벨 확률 +이만큼 (1레벨 확률에서 뺌) */
  shopPoly: 0.03,
  /** 업적 하나마다 피해 +이 비율 */
  achDmg: 0.02,
  /** 챌린지 「루트 차단」 보상: 루트 권한 1당 피해 +이만큼 더 */
  chalRoot: 0.01,
};

const x = (n: number) => `×${Number(n.toFixed(2))}`;

export const MOBS_PER_STAGE = 10;
export const BOSS_TIME = 30; // 초
/** 상위 보스 (10스테이지마다 보스 다음에 나오는 보안 시스템) 제한 시간 */
export const APEX_TIME = 45;
/** 최종 보스 제한 시간 */
export const FINAL_TIME = 60;
/** 마지막 스테이지 — 여기 상위 보스를 잡으면 최종 보스가 나오고, 더 나아가지 않음 */
export const MAX_STAGE = 1000;
export const SAVE_KEY = "virus-idle-v3";
/** 발사한 코드가 적에게 닿기까지 (ms) — 닿는 순간 피해 */
export const SHOT_MS = 380;

export type UpgKey = "atk" | "spd" | "crit";
export type ShopKey =
  | "rootkit"
  | "miner"
  | "poly"
  | "profiler"
  | "cron"
  | "daemon"
  | "kprof"
  | "autoc"
  | "kpatch"
  | "kescal"
  | "kcomp"
  | "kirq";

export interface Save {
  v: 3;
  /** 탈취한 데이터 (바이트) — 재화 */
  data: number;
  /** 지금까지 탈취한 데이터 합계 (포맷해도 유지) — 루트 권한 계산용 */
  lifetime: number;
  /** 지금 도전 중인 스테이지 (이번 포맷 이후) */
  stage: number;
  /** 가장 멀리 간 스테이지 (포맷해도 유지) — 모듈 버전은 이걸로 정해짐 */
  best: number;
  /** 이번 스테이지에서 감염시킨 파일 수 */
  kills: number;
  lv: Record<UpgKey, number>;
  /** 보스에게 져서 파일만 감염시키는 중 (재도전 버튼을 눌러야 보스가 다시 나옴) */
  bossFail: boolean;
  /** 이 스테이지(10의 배수)의 보스는 잡았고 상위 보스가 남음 */
  bossDone: boolean;
  /** 마지막 스테이지 상위 보스까지 잡았고 최종 보스가 남음 */
  finalReady: boolean;
  /** 최종 보스를 잡은 횟수 (변이해도 유지) — 다음 KILLSWITCH 는 v(clears+1) */
  clears: number;
  /** 아직 안 쓴 커널 코어 (최종 보스를 잡을 때마다 1, 변이해도 유지) */
  cores: number;
  /** 상위 보스를 처음 잡은 가장 높은 스테이지 (포맷해도 유지) — 특성 · 외형은 이걸로 정해짐 */
  apexBest: number;
  /** 받은 루트 권한 (합계 — 피해 보너스는 이걸로, 상점에 써도 줄지 않음) */
  root: number;
  /** 루트 권한 상점에 쓴 양 (남은 포인트 = root - rootSpent) */
  rootSpent: number;
  /** 루트 권한 상점 레벨 (포맷해도 유지) */
  shop: Record<ShopKey, number>;
  /** 자동 최적 업그레이드 켜짐 (크론 데몬이 있어야 동작) */
  auto: boolean;
  /** 포맷한 횟수 */
  formats: number;
  /** 누적 기록 (변이해도 유지) — 통계 화면 · 업적 */
  rec: Rec;
  /** 달성한 업적 id (달성한 순서) */
  ach: string[];
  /** 기록 창에서 이미 본 업적 수 — ach 앞에서부터 이만큼은 봤음 (나머지는 새 업적 · 느낌표) */
  achSeen: number;
  /** 코드 모듈 버전 (ROSTER 순서, 0 = 아직 컴파일 안 함) — 변이해도 유지 */
  mods: number[];
  /** 바이러스별 코드 조각 (ROSTER 순서) */
  frag: number[];
  /** 우회 기술 버전 (APEX 순서, 0 = 그 상위 보스를 아직 못 잡음) · 우회 키 */
  byp: number[];
  keys: number[];
  /** 이번 스테이지 보스 (pickBoss — -1 · -2 = 원시 바이러스, 0~ = ROSTER) */
  bossIdx: number;
  /** 이번 회차(변이 뒤)에 처음 오를 스테이지 — 이보다 낮은 스테이지는 「다시 도는 중」 */
  runTop: number;
  /** 스테이지 반복: 보스를 잡아도 다음 스테이지로 안 감 */
  repeat: boolean;
  /** 진행 중인 챌린지 변이 (없으면 null) */
  chal: ChalKey | null;
  /** 끝낸 챌린지 (보상은 영구) */
  chalDone: ChalKey[];
  savedAt: number;
}

/** 누적 기록 — 화면에서 일어난 일을 셈 (변이해도 유지) */
export interface Rec {
  /** 게임 화면에서 보낸 시간 (초) */
  play: number;
  /** 감염시킨 파일 */
  files: number;
  /** 격퇴한 보스 (상위 · 최종 보스 빼고) */
  bosses: number;
  /** 처치한 상위 보스 */
  apexes: number;
  /** 보스에게 차단당한 횟수 */
  fails: number;
  /** 남은 시간 1초 이하에서 보스 격퇴 */
  clutch: number;
  /** 산 업그레이드 레벨 합계 (랜덤 강화 포함) */
  ups: number;
  /** 랜덤 강화 횟수 · 그중 3레벨(잭팟) */
  rands: number;
  jackpots: number;
  /** 한 번에 준 가장 큰 피해 */
  maxHit: number;
  /** KILLSWITCH 를 가장 빨리 잡은 시간 (초, 0 = 아직 없음) */
  bestFinal: number;
  /** 한 번에 가장 오래 비운 시간 (초) · 오프라인으로 번 데이터 합계 */
  offMax: number;
  offData: number;
  /** 가장 높이 간 진화 단계 */
  evo: number;
}

export function newRec(): Rec {
  return {
    play: 0,
    files: 0,
    bosses: 0,
    apexes: 0,
    fails: 0,
    clutch: 0,
    ups: 0,
    rands: 0,
    jackpots: 0,
    maxHit: 0,
    bestFinal: 0,
    offMax: 0,
    offData: 0,
    evo: 0,
  };
}

const zeros = () => Array.from({ length: 10 }, () => 0);

export function newSave(): Save {
  return {
    v: 3,
    data: 0,
    lifetime: 0,
    stage: 1,
    best: 1,
    kills: 0,
    lv: { atk: 0, spd: 0, crit: 0 },
    bossFail: false,
    bossDone: false,
    finalReady: false,
    clears: 0,
    apexBest: 0,
    root: 0,
    rootSpent: 0,
    shop: {
      rootkit: 0,
      miner: 0,
      poly: 0,
      profiler: 0,
      cron: 0,
      daemon: 0,
      kprof: 0,
      autoc: 0,
      kpatch: 0,
      kescal: 0,
      kcomp: 0,
      kirq: 0,
    },
    cores: 0,
    auto: false,
    formats: 0,
    rec: newRec(),
    ach: [],
    achSeen: 0,
    mods: zeros(),
    frag: zeros(),
    byp: zeros(),
    keys: zeros(),
    bossIdx: -1,
    runTop: 1,
    repeat: false,
    chal: null,
    chalDone: [],
    savedAt: Date.now(),
  };
}

/** 저장본의 모듈 · 조각 · 우회 기술 — 없으면 (v0.6 까지: 최고 스테이지로 정해지던 때) 만난 바이러스 · 잡은 상위 보스는 v1 */
function codeOf(s: Partial<Save>, best: number, apexBest: number) {
  const arr = (a: unknown) =>
    Array.isArray(a) && a.length === 10
      ? a.map((v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0))
      : null;
  const mods = arr(s.mods) ?? ROSTER.map((v) => (best > v.join ? 1 : 0));
  const byp = arr(s.byp) ?? APEX.map((_, i) => (i < apexCount(apexBest) ? 1 : 0));
  return {
    mods,
    frag: arr(s.frag) ?? zeros(),
    byp,
    keys: arr(s.keys) ?? zeros(),
  };
}

/** 저장본이 깨졌거나 옛 버전이면 새로 시작 */
export function parseSave(raw: string | null): Save {
  try {
    const s = JSON.parse(raw ?? "") as Save;
    if (s?.v !== 3 || !(s.stage >= 1) || !s.lv) return newSave();
    const lv = newSave().lv;
    for (const k of Object.keys(lv) as UpgKey[]) if (s.lv[k] >= 0) lv[k] = s.lv[k];
    const old = (s.shop ?? {}) as Partial<Record<string, number>>;
    const shop = newSave().shop;
    for (const k of Object.keys(shop) as ShopKey[]) if ((old[k] ?? 0) > 0) shop[k] = old[k]!;
    // 없어진 골든 이미지(기본 60 · ×1.8)에 쓴 루트 권한은 돌려줌
    let refund = 0;
    for (let i = 0; i < (old.golden ?? 0); i++) refund += Math.ceil(60 * 1.8 ** i);
    const rootSpent = Math.max(0, (s.rootSpent ?? 0) - refund);
    // 스테이지 상한: 넘은 저장본은 MAX_STAGE 로 (best = MAX_STAGE + 1 은 마지막 스테이지까지 통과)
    let stage = Math.min(s.stage, MAX_STAGE);
    let best = Math.min(Math.max(s.best || 1, s.stage), MAX_STAGE + 1);
    const apexBest = Math.min(s.apexBest || 0, MAX_STAGE);
    let finalReady = s.stage > MAX_STAGE || !!s.finalReady;
    // v0.5 까지는 스테이지 100이 끝 — 거기서 최종 보스를 기다리던 저장본은 101부터 이어서
    if (finalReady && stage < MAX_STAGE) {
      finalReady = false;
      stage += 1;
      best = Math.max(best, stage);
    }
    const oldCap = !!s.finalReady && s.stage <= 100;
    // 기록 · 업적 · 챌린지 (v0.5에서 생김 — 없으면 빈 값, 모르는 값은 버림)
    const rec = newRec();
    for (const k of Object.keys(rec) as (keyof Rec)[]) {
      const v = (s.rec as Partial<Rec> | undefined)?.[k];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) rec[k] = v;
    }
    const achIds = new Set(ACH.map((a) => a.id));
    const ach = Array.isArray(s.ach) ? [...new Set(s.ach.filter((id) => achIds.has(id)))] : [];
    const isChal = (k: unknown): k is ChalKey => CHAL.some((c) => c.key === k);
    const chal = isChal(s.chal) ? s.chal : null;
    const chalDone = Array.isArray(s.chalDone) ? [...new Set(s.chalDone.filter(isChal))] : [];
    return {
      ...newSave(),
      ...s,
      lv,
      shop,
      rootSpent,
      stage,
      best,
      apexBest,
      finalReady,
      kills: s.stage > MAX_STAGE || oldCap ? 0 : s.kills,
      bossDone: oldCap ? false : !!s.bossDone,
      rec,
      ach,
      achSeen: Math.min(ach.length, Math.max(0, Math.floor(Number(s.achSeen) || 0))),
      ...codeOf(s, best, apexBest),
      runTop: Math.max(stage, Math.min(Number(s.runTop) || stage, best)),
      repeat: !!s.repeat,
      bossIdx:
        Number.isInteger(s.bossIdx) && s.bossIdx! >= -2 && s.bossIdx! < ROSTER.length
          ? s.bossIdx!
          : pickBoss(stage, best),
      chal,
      chalDone,
    };
  } catch {
    return newSave();
  }
}

// ── 보스 바이러스 · 코드 모듈 ──
// 코드 모듈 = 공격 자체에 붙는 특수 효과 (추가 투사체 · 점화 · 약점 중첩 …). 버전이 오를수록 상한(cap)에 다가감.
// 피해 · 속도 · 데이터 같은 능력치는 상위 보스에게서 빼앗는 「우회 기술」이 맡음 (아래 APEX).

export interface VirusDef {
  id: string;
  name: string;
  /** 처음 퍼진 해 */
  year: number;
  /** 대표 색 */
  color: string;
  /** 빼앗는 코드 모듈 이름 · 아이콘 */
  module: string;
  icon: string;
  /** 어떤 공격 효과인지 (버전과 상관없이) */
  effect: string;
  /** 버전 v 의 수치 (예: "추가 발사 32%") */
  cur: (v: number) => string;
  /** 도감 설명 (실제 사건 요약) */
  desc: string;
  /** 이 스테이지부터 보스로 나옴 (네트워크에 합류) */
  join: number;
}

/** 모듈 버전 v 의 수치 — v1 값에서 시작해 버전마다 상한(cap)까지 남은 거리가 BAL.fxK 배로 줄어듦 (0 = 없음) */
export function fxCurve(v: number, v1: number, cap: number) {
  return v > 0 ? cap - (cap - v1) * BAL.fxK ** (v - 1) : 0;
}

/** 점화가 타는 시간 (초) · 취약점 노출이 이어지는 시간 (ms) */
export const BURN_SECS = 3;
export const BUFF_MS = 4000;

/** 코드 모듈 효과 수치 (없는 모듈은 0) */
export interface Fx {
  /** Brain: 새 적에게 맞히는 첫 발의 피해 배율 */
  first: number;
  /** Morris: 발사할 때 한 발 더 쏠 확률 · 늘 더 쏘는 발 수 */
  extraP: number;
  extraN: number;
  /** ILOVEYOU: 명중마다 (준 피해 ÷ 적 체력) × 이 비율만큼 그 적의 데이터를 미리 빼냄 */
  leech: number;
  /** CIH: 점화 — 명중하면 BURN_SECS 동안 초당 피해 × 이 값 */
  burn: number;
  /** Melissa: 이 발수마다 2발 더 */
  burstEvery: number;
  /** Zeus: 적을 쓰러뜨리고 남은 피해를 다음 적에게 넘기는 비율 */
  carry: number;
  /** Stuxnet: 같은 적을 맞힐 때마다 받는 피해 +stack (stackMax 번까지) */
  stack: number;
  stackMax: number;
  /** Conficker: 익스플로잇이 터지면 BUFF_MS 동안 모든 피해 +buff */
  buff: number;
  /** WannaCry: 익스플로잇이 보스에게 터질 때마다 제한 시간 +lockT 초 (한 전투에 lockCap 초까지) */
  lockT: number;
  lockCap: number;
  /** Mydoom: ddosEvery 초마다 초당 피해 × ddosMul 한 방 */
  ddosEvery: number;
  ddosMul: number;
}

/** 모듈 버전 → 공격 효과 수치 */
export function fxOf(m: number[]): Fx {
  const c = (i: number, v1: number, cap: number) => fxCurve(m[i], v1, cap);
  return {
    first: c(0, 6, 20),
    extraP: c(1, 0.35, 1),
    extraN: Math.floor(m[1] / 20),
    leech: c(2, 0.35, 1),
    burn: c(3, 0.4, 1.5),
    burstEvery: m[4] ? Math.max(3, Math.round(c(4, 6, 3))) : 0,
    carry: c(5, 0.4, 1),
    stack: c(6, 0.02, 0.05),
    stackMax: Math.round(c(6, 20, 60)),
    buff: c(7, 0.35, 1),
    lockT: c(8, 0.2, 0.5),
    lockCap: c(8, 6, 20),
    ddosEvery: c(9, 8, 3),
    ddosMul: c(9, 5, 15),
  };
}

const pc = (n: number) => `${Math.round(n * 100)}%`;
const fxAt = (i: number, v: number) => fxOf(ROSTER.map((_, k) => (k === i ? v : 0)));

export const ROSTER: VirusDef[] = [
  {
    id: "brain",
    icon: "🥾",
    join: 60,
    name: "Brain",
    year: 1986,
    color: "#7dd3fc",
    module: "부트 선점",
    effect: "새 적에게 맞히는 첫 발이 강타",
    cur: (v) => `첫 발 피해 ×${fxAt(0, v).first.toFixed(1)}`,
    desc: "IBM PC에서 처음으로 널리 퍼진 바이러스로 알려져 있어요. 파키스탄의 두 형제가 만들었고, 플로피 디스크의 부트 섹터를 감염시켰어요.",
  },
  {
    id: "morris",
    icon: "🪱",
    join: 11,
    name: "Morris Worm",
    year: 1988,
    color: "#a78bfa",
    module: "자가 복제",
    effect: "쏠 때마다 확률로 코드 한 발 더 (25버전마다 늘 한 발 더)",
    cur: (v) => {
      const f = fxAt(1, v);
      return `추가 발사 ${pc(f.extraP)}${f.extraN ? ` + 늘 ${f.extraN}발` : ""}`;
    },
    desc: "대학원생 로버트 모리스가 퍼뜨린 초기 인터넷 웜이에요. 스스로 복제하다 통제를 벗어나, 당시 인터넷에 연결된 컴퓨터 상당수를 마비시켰어요.",
  },
  {
    id: "iloveyou",
    icon: "💌",
    join: 800,
    name: "ILOVEYOU",
    year: 2000,
    color: "#f472b6",
    module: "러브레터 미끼",
    effect: "맞힐 때마다 그 적의 데이터를 미리 빼냄 (보상과 별도)",
    cur: (v) => `데이터 +${pc(fxAt(2, v).leech)} (명중마다 나눠서)`,
    desc: "필리핀에서 시작된 이메일 웜이에요. 'LOVE-LETTER-FOR-YOU' 첨부 파일을 열면 주소록 전체로 자신을 보내, 며칠 만에 전 세계 수천만 대를 감염시켰어요.",
  },
  {
    id: "cih",
    icon: "🔥",
    join: 25,
    name: "CIH (체르노빌)",
    year: 1998,
    color: "#f87171",
    module: "BIOS 과열",
    effect: `맞히면 점화 — ${BURN_SECS}초 동안 불타며 계속 피해 (맞힐 때마다 갱신)`,
    cur: (v) => `점화: 초당 피해의 ${pc(fxAt(3, v).burn)}`,
    desc: "대만에서 만들어진 바이러스로, 일부 변종이 체르노빌 사고일인 4월 26일에 발동해 '체르노빌 바이러스'라고 불려요. 하드디스크를 덮어쓰고 일부 PC의 BIOS까지 지웠어요.",
  },
  {
    id: "melissa",
    icon: "📜",
    join: 100,
    name: "Melissa",
    year: 1999,
    color: "#34d399",
    module: "매크로 연사",
    effect: "몇 발마다 매크로가 2발을 덤으로 쏨",
    cur: (v) => `${fxAt(4, v).burstEvery}발마다 +2발`,
    desc: "워드 문서 매크로에 숨어 있던 바이러스예요. 문서를 열면 아웃룩 주소록의 처음 50명에게 자신을 메일로 보내, 여러 회사의 메일 서버를 멈추게 했어요.",
  },
  {
    id: "zeus",
    icon: "🚪",
    join: 600,
    name: "Zeus",
    year: 2007,
    color: "#fbbf24",
    module: "백도어 이월",
    effect: "적을 쓰러뜨리고 남은 피해를 다음 적에게 넘김",
    cur: (v) => `남은 피해 ${pc(fxAt(5, v).carry)} 이월`,
    desc: "은행 계정 정보를 몰래 훔치는 트로이 목마예요. 감염된 PC를 묶어 거대한 봇넷을 만들었고, 소스 코드가 유출된 뒤 수많은 변종이 나왔어요.",
  },
  {
    id: "stuxnet",
    icon: "🎯",
    join: 200,
    name: "Stuxnet",
    year: 2010,
    color: "#94a3b8",
    module: "약점 분석",
    effect: "같은 적을 맞힐수록 받는 피해가 쌓임 (보스에게 강함)",
    cur: (v) => {
      const f = fxAt(6, v);
      return `명중마다 +${(f.stack * 100).toFixed(1)}% (최대 ${f.stackMax}번)`;
    },
    desc: "이란 핵시설의 원심분리기를 제어하는 PLC를 노린 웜이에요. 여러 개의 제로데이 취약점을 동시에 쓰고, 들키지 않게 정상 값을 보여 주며 장비를 망가뜨렸어요.",
  },
  {
    id: "conficker",
    icon: "🔓",
    join: 300,
    name: "Conficker",
    year: 2008,
    color: "#fb923c",
    module: "취약점 노출",
    effect: `익스플로잇이 터지면 ${BUFF_MS / 1000}초 동안 모든 피해 증가`,
    cur: (v) => `${BUFF_MS / 1000}초 동안 피해 +${pc(fxAt(7, v).buff)}`,
    desc: "윈도의 네트워크 취약점을 이용해 수백만 대를 감염시킨 웜이에요. 업데이트를 막고 비밀번호를 무작위로 대입하며 퍼졌어요.",
  },
  {
    id: "wannacry",
    icon: "🔐",
    join: 450,
    name: "WannaCry",
    year: 2017,
    color: "#ef4444",
    module: "암호화 잠금",
    effect: "익스플로잇이 보스에게 터질 때마다 제한 시간이 늘어남",
    cur: (v) => {
      const f = fxAt(8, v);
      return `+${f.lockT.toFixed(2)}초씩 (전투당 최대 ${f.lockCap.toFixed(0)}초)`;
    },
    desc: "파일을 암호화하고 비트코인을 요구한 랜섬웨어예요. 이터널블루 취약점으로 스스로 퍼져 150여 개국의 병원·기업 컴퓨터를 멈췄어요.",
  },
  {
    id: "mydoom",
    icon: "💣",
    join: 40,
    name: "Mydoom",
    year: 2004,
    color: "#facc15",
    module: "DDoS 폭격",
    effect: "몇 초마다 봇넷이 일제 사격 — 초당 피해의 몇 배를 한 방에",
    cur: (v) => {
      const f = fxAt(9, v);
      return `${f.ddosEvery.toFixed(1)}초마다 초당 피해 ×${f.ddosMul.toFixed(1)}`;
    },
    desc: "가장 빠르게 퍼진 이메일 웜 중 하나로 꼽혀요. 감염된 PC들을 동원해 특정 웹사이트에 DDoS 공격을 퍼부었어요.",
  },
];

// ── 상위 보스 (보안 시스템) · 우회 기술 ──
// 10스테이지마다 그 스테이지 보스를 잡으면 그 네트워크를 지키는 보안 시스템이 나옴 (100스테이지마다 같은 순서로 다시, v2 · v3 …).
// 처음 잡으면 우회 기술(능력치) + 내 바이러스 외형. 우회 기술 버전은 같은 번호의 코드 모듈처럼 최고 스테이지로 오름.

export interface ApexDef {
  id: string;
  name: string;
  /** 무엇을 하는 보안 시스템인지 */
  role: string;
  icon: string;
  color: string;
  /** 빼앗는 우회 기술 이름 · 어떤 능력치인지 */
  trait: string;
  effect: string;
  /** 버전 v 의 수치 */
  cur: (v: number) => string;
  /** 내 바이러스에 생기는 모양 */
  look: string;
}

/** 우회 기술 「암호화 터널」 버전별 발사 속도 배율 (×1.15 → 최대 ×1.15·modSpdMax) */
export function tunnelSpd(v: number) {
  return 1.15 * (1 + (BAL.modSpdMax - 1) * (1 - BAL.modSpdK ** v));
}

export const APEX: ApexDef[] = [
  {
    id: "sentinel",
    name: "Sentinel",
    role: "백신 엔진",
    icon: "🛡️",
    color: "#38bdf8",
    trait: "서명 위조",
    effect: "일반 파일 보안 등급 감소",
    cur: (n) => {
      const v = n * BAL.bypScale;
      return `일반 파일 보안 등급 ${x(0.85 * BAL.modMobHp ** v)}`;
    },
    look: "회로 링",
  },
  {
    id: "bastion",
    name: "Bastion",
    role: "방화벽",
    icon: "🧱",
    color: "#f97316",
    trait: "포트 스캔",
    effect: "페이로드 피해 증가",
    cur: (n) => {
      const v = n * BAL.bypScale;
      return `피해 ${x(1.5 * BAL.modDmg ** v)}`;
    },
    look: "안테나 한 쌍",
  },
  {
    id: "argus",
    name: "Argus",
    role: "침입 탐지 시스템",
    icon: "👁️",
    color: "#a3e635",
    trait: "로그 삭제",
    effect: "보스 보안 등급 감소 · 보스 제한 시간 +5초",
    cur: (n) => {
      const v = n * BAL.bypScale;
      return `보스 보안 등급 ${x(BAL.modBossHp ** v)} · 시간 +5초`;
    },
    look: "반투명 외피",
  },
  {
    id: "hydra",
    name: "Hydra",
    role: "스팸 필터",
    icon: "🐍",
    color: "#22d3ee",
    trait: "스팸 폭탄",
    effect: "데이터 탈취 증가",
    cur: (n) => {
      const v = n * BAL.bypScale;
      return `데이터 ${x(1.5 * BAL.modData ** v)}`;
    },
    look: "촉수 3개",
  },
  {
    id: "warden",
    name: "Warden",
    role: "샌드박스",
    icon: "⛓️",
    color: "#e879f9",
    trait: "샌드박스 탈출",
    effect: "익스플로잇 피해 증가",
    cur: (n) => {
      const v = n * BAL.bypScale;
      return `익스플로잇 피해 +${(1 + 0.5 * v).toFixed(1)}`;
    },
    look: "결정 가시",
  },
  {
    id: "soc",
    name: "SOC",
    role: "보안 관제 센터",
    icon: "🏛️",
    color: "#facc15",
    trait: "관제 우회",
    effect: "보스에게 주는 피해 증가",
    cur: (n) => {
      const v = n * BAL.bypScale;
      return `보스에게 주는 피해 ${x(BAL.modBossDmg ** v)}`;
    },
    look: "왕관",
  },
  {
    id: "tracker",
    name: "Tracker",
    role: "EDR 추적기",
    icon: "🔍",
    color: "#fb7185",
    trait: "프로세스 은닉",
    effect: "오프라인 효율 증가",
    cur: (n) => {
      const v = n * BAL.bypScale;
      return `오프라인 효율 ${Math.round((offlineRateOf(v) + 0.15) * 100)}%`;
    },
    look: "잔상",
  },
  {
    id: "mimic",
    name: "Mimic",
    role: "허니팟",
    icon: "🍯",
    color: "#fbbf24",
    trait: "미끼 역이용",
    effect: "익스플로잇 확률 증가 · 루트 권한 획득 ×1.25",
    cur: (n) => {
      const v = n * BAL.bypScale;
      return `익스플로잇 확률 +${(modCritOf(v) * 100).toFixed(1)}%p · 루트 권한 ×1.25`;
    },
    look: "날개",
  },
  {
    id: "leviathan",
    name: "Leviathan",
    role: "심층 패킷 검사",
    icon: "🌊",
    color: "#60a5fa",
    trait: "암호화 터널",
    effect: "발사 속도 증가",
    cur: (n) => {
      const v = n * BAL.bypScale;
      return `발사 속도 ${x(tunnelSpd(v))}`;
    },
    look: "이중 궤도 링",
  },
  {
    id: "oracle",
    name: "Oracle",
    role: "AI 보안 시스템",
    icon: "🔮",
    color: "#c084fc",
    trait: "자가 학습",
    effect: "업그레이드 비용 감소",
    cur: (n) => {
      const v = n * BAL.bypScale;
      return `업그레이드 비용 ${x(0.85 * BAL.modCost ** v)}`;
    },
    look: "오라 · 세 번째 눈",
  },
];

/** 상위 보스가 나오는 스테이지인지 (10의 배수) */
export function isApexStage(stage: number) {
  return stage % 10 === 0;
}

/** 이 스테이지의 상위 보스 (몇 바퀴째인지 tier 1부터) */
export function apexOf(stage: number) {
  const n = stage / 10 - 1;
  const i = ((n % APEX.length) + APEX.length) % APEX.length;
  return { def: APEX[i], index: i, tier: Math.floor(n / APEX.length) + 1 };
}

/** 지금까지 처음 잡은 상위 보스 수 (0~10) — 그만큼 우회 기술 · 외형이 열림 */
export function apexCount(apexBest: number) {
  return Math.min(APEX.length, Math.floor(apexBest / 10));
}

/** 최종 보스: 인터넷 전체를 끊어 버리는 마지막 차단 스위치 */
export const FINAL = {
  id: "killswitch",
  name: "KILLSWITCH",
  role: "글로벌 차단 스위치",
  icon: "☢️",
  color: "#f43f5e",
} as const;

/** 원시 바이러스 — 처음부터 나오는 보스 (해를 끼치지 않던 장난 프로그램이라 빼앗을 코드가 없음 — 데이터 · 도감 기록만) */
export const PRIMITIVES: { id: string; name: string; year: number; color: string; desc: string }[] =
  [
    {
      id: "creeper",
      name: "Creeper",
      year: 1971,
      color: "#86efac",
      desc: '최초의 자기 복제 프로그램으로 꼽혀요. 아파넷의 컴퓨터를 옮겨 다니며 "I\'m the creeper, catch me if you can!"을 띄우기만 했어요.',
    },
    {
      id: "elkcloner",
      name: "Elk Cloner",
      year: 1982,
      color: "#fda4af",
      desc: "15살 학생이 만든 애플 II 바이러스예요. 플로피 디스크로 퍼졌고, 50번째 부팅마다 짧은 시를 띄웠어요.",
    },
  ];

/** 이 스테이지에 나올 수 있는 보스 — 원시 바이러스(-1 · -2) + 지금까지 해금된 바이러스 (최고 스테이지까지 합류한 것) */
export function bossPool(stage: number, best: number) {
  const reach = Math.max(stage, best - 1);
  return [-1, -2, ...ROSTER.flatMap((v, i) => (v.join <= reach ? [i] : []))];
}

/**
 * 이 스테이지의 보스 뽑기 — 바이러스가 합류하는 스테이지에 처음 오면 그 바이러스,
 * 아니면 해금된 바이러스 중 무작위 (원시 바이러스 포함, 모두 같은 확률)
 */
export function pickBoss(stage: number, best: number, rand: () => number = Math.random) {
  const joined = ROSTER.findIndex((v) => v.join === stage);
  if (joined >= 0 && stage >= best) return joined;
  const pool = bossPool(stage, best);
  return pool[Math.floor(rand() * pool.length)];
}

/** 보스 번호 → 정보 (-1 · -2 = 원시 바이러스) */
export function bossDef(index: number) {
  const p = index < 0 ? PRIMITIVES[-index - 1] : null;
  return { def: p ?? ROSTER[index], index: p ? -1 : index, primitive: !!p };
}

/** 지금 스테이지의 보스 (저장본에 뽑아 둔 것) */
export function bossOf(s: Save) {
  return bossDef(s.bossIdx);
}

/** 다음 스테이지로 (또는 변이 · 챌린지로 스테이지가 바뀌면) 새 보스를 뽑음 */
export function rollBoss(s: Save, rand: () => number = Math.random) {
  s.bossIdx = pickBoss(s.stage, s.best, rand);
}

/** 지금까지 합류한 바이러스 (최고 스테이지 기준) */
export function joinedCount(best: number) {
  return ROSTER.filter((v) => v.join <= best).length;
}

// ── 코드 조각 · 우회 키 · 컴파일 ──
// 보스를 잡으면 그 바이러스의 코드 조각 (원시 바이러스는 없음), 상위 보스는 그 보안 시스템의 우회 키.
// 처음 가 보는 스테이지면 DROP_NEW 개, 변이 뒤 다시 잡으면 DROP_AGAIN 개. 모이면 컴파일해서 버전을 올림.

export const DROP_NEW = 3;
export const DROP_AGAIN = 1;

/**
 * 조각 · 키를 얼마나 주는 처치인지
 *  - new: 처음 가 보는 스테이지 (최고 스테이지) → DROP_NEW
 *  - run: 이번 회차에 처음 오르는 스테이지 (변이 뒤 다시 오르기) → DROP_AGAIN
 *  - again: 이번 회차에 이미 지나온 스테이지 (반복 · 스테이지 되돌리기) → 보스를 잡는 데 걸린 시간에 비례한 확률로 1개
 *    (낮은 스테이지에서 순식간에 잡히는 보스의 조각 · 키를 무한히 모으지 못하게)
 */
export type DropKind = "new" | "run" | "again";
export function dropKind(s: Save): DropKind {
  return s.stage >= s.best ? "new" : s.stage >= s.runTop ? "run" : "again";
}
/** 다시 도는 스테이지에서 조각이 나올 확률 — 보스를 잡는 데 걸린 시간 ÷ BAL.revisitSecs (최대 1) */
export function revisitChance(fightSecs: number) {
  return Math.min(1, Math.max(0, fightSecs / BAL.revisitSecs));
}
/** 처치 종류 · 전투 시간 → 받을 개수 */
function dropCount(kind: DropKind, fightSecs: number, rand: () => number) {
  if (kind === "new") return DROP_NEW;
  if (kind === "run") return DROP_AGAIN;
  return rand() < revisitChance(fightSecs) ? 1 : 0;
}

/** 코드 모듈 v → v+1 에 드는 조각 (v0 → v1 이 모듈 획득) */
export function fragCost(v: number) {
  return Math.ceil(BAL.fragBase * BAL.fragGrowth ** v);
}
/** 우회 기술 v → v+1 에 드는 우회 키 (v1 은 상위 보스를 처음 잡으면 바로) */
export function keyCost(v: number) {
  return Math.ceil(BAL.keyBase * BAL.keyGrowth ** (v - 1));
}

/** 보스를 잡으면 조각 — 어느 모듈의 조각인지 · 몇 개 (원시 바이러스는 index -1 · 0개) */
export function dropFrag(s: Save, kind: DropKind, fightSecs = 0, rand: () => number = Math.random) {
  const index = s.bossIdx;
  const n = dropCount(kind, fightSecs, rand);
  if (index < 0) return { index, n: 0 };
  s.frag[index] += n;
  return { index, n };
}

/** 상위 보스를 잡으면 — 처음이면 우회 기술 v1 (opened), 아니면 우회 키 */
export function dropKey(s: Save, kind: DropKind, fightSecs = 0, rand: () => number = Math.random) {
  const { index } = apexOf(s.stage);
  if (!s.byp[index]) {
    s.byp[index] = 1;
    return { index, n: 0, opened: true };
  }
  const n = dropCount(kind, fightSecs, rand);
  s.keys[index] += n;
  return { index, n, opened: false };
}

/** 스테이지 고르기 (1 ~ 이번 회차에 오른 가장 높은 스테이지) — 파일부터 다시, 보스는 새로 뽑음 */
export function gotoStage(s: Save, stage: number) {
  const n = Math.max(1, Math.min(stage, s.runTop, MAX_STAGE));
  if (n === s.stage) return false;
  s.stage = n;
  s.kills = 0;
  s.bossFail = false;
  s.bossDone = false;
  if (n < MAX_STAGE) s.finalReady = false;
  rollBoss(s);
  return true;
}

export interface CompileItem {
  kind: "mod" | "byp";
  /** ROSTER · APEX 번호 */
  i: number;
  /** 컴파일 뒤 버전 */
  to: number;
}

/** 이 모듈을 열거나 올릴 수 있는 상태인지 (그 바이러스의 조각을 한 번이라도 얻었음) */
export function modOpenable(s: Save, i: number) {
  return s.mods[i] > 0 || s.frag[i] > 0;
}

/** 모듈 i 를 가진 조각으로 몇 버전까지 올릴 수 있나 · 쓰는 조각 */
export function planMod(s: Save, i: number) {
  let v = s.mods[i];
  let own = s.frag[i];
  for (let k = 0; k < 500 && own >= fragCost(v); k++) {
    own -= fragCost(v);
    v++;
  }
  return { to: v, own: s.frag[i] - own };
}

/** 모듈 i 를 가진 조각으로 올릴 수 있는 만큼 — 오른 버전 수 */
export function compileMod(s: Save, i: number) {
  const p = planMod(s, i);
  const gained = p.to - s.mods[i];
  if (gained <= 0) return 0;
  s.frag[i] -= p.own;
  s.mods[i] = p.to;
  return gained;
}

/** 우회 기술 i 를 가진 키로 올릴 수 있는 만큼 — 오른 버전 수 */
export function compileByp(s: Save, i: number) {
  let n = 0;
  while (s.byp[i] > 0 && s.keys[i] >= keyCost(s.byp[i]) && n < 500) {
    s.keys[i] -= keyCost(s.byp[i]);
    s.byp[i]++;
    n++;
  }
  return n;
}

/** 지금 컴파일하면 오를 것 (모듈 · 우회 기술 — 각각 올라갈 버전까지) */
export function compileReady(s: Save): CompileItem[] {
  const out: CompileItem[] = [];
  ROSTER.forEach((_, i) => {
    const p = planMod(s, i);
    if (p.to > s.mods[i]) out.push({ kind: "mod", i, to: p.to });
  });
  APEX.forEach((_, i) => {
    let v = s.byp[i];
    let k = s.keys[i];
    while (v > 0 && k >= keyCost(v)) {
      k -= keyCost(v);
      v++;
    }
    if (v > s.byp[i]) out.push({ kind: "byp", i, to: v });
  });
  return out;
}

/** 할 수 있는 컴파일을 전부 (컴파일 막대 · 자동 컴파일러 · 시뮬레이터) */
export function compileAll(s: Save): CompileItem[] {
  const out: CompileItem[] = [];
  ROSTER.forEach((_, i) => compileMod(s, i) && out.push({ kind: "mod", i, to: s.mods[i] }));
  APEX.forEach((_, i) => compileByp(s, i) && out.push({ kind: "byp", i, to: s.byp[i] }));
  return out;
}

const ZONES = [
  "개인 PC",
  "공유기",
  "사내 LAN",
  "메일 서버",
  "서버실",
  "은행 전산망",
  "클라우드",
  "데이터센터",
  "통신사 백본",
  "루트 DNS",
];
/** 스테이지 101부터: 100스테이지마다 바뀌는 더 깊은 네트워크 (10스테이지마다 구역) */
const WORLDS = [
  "다크넷",
  "국방망",
  "위성 통신망",
  "전력망",
  "국제 결제망",
  "해저 케이블",
  "양자 연구소",
  "궤도 정거장",
  "글로벌 코어",
];
/** 네트워크 이름 (1~100은 10스테이지마다, 그 뒤로는 100스테이지마다 + 구역) */
export function zoneOf(stage: number) {
  const z = Math.floor((stage - 1) / 10);
  if (z < ZONES.length) return ZONES[z];
  const w = Math.min(WORLDS.length - 1, Math.floor((stage - 1) / 100) - 1);
  return `${WORLDS[w]} ${(z % 10) + 1}구역`;
}

/** 같은 바이러스를 다시 만나면 변종 버전 표시 (v2, v3 …) */
export function tierLabel(tier: number) {
  return tier > 1 ? ` v${tier}` : "";
}

// ── 능력치 ──

export interface Stats {
  dmg: number;
  /** 초당 발사 횟수 (코드 모듈의 추가 발사 전) */
  aps: number;
  critChance: number;
  critMul: number;
  dataMul: number;
  costMul: number;
  mobHpMul: number;
  bossHpMul: number;
  /** 보스에게 주는 피해 배율 */
  bossDmgMul: number;
  /** 루트 권한으로 받는 피해 배율 */
  rootMul: number;
  /** 보스 제한 시간 (상위 보스는 여기에 +15초) */
  bossTime: number;
  /** 루트 권한 받는 양 배율 */
  rootGain: number;
  offlineRate: number;
  offlineHours: number;
  /** 보스 제한 시간 배율 (챌린지 「제로데이」는 절반) */
  timeMul: number;
  /** 랜덤 강화 가격 배율 */
  randMul: number;
  /** 업적으로 받는 피해 배율 */
  achMul: number;
  /** 코드 모듈 공격 효과 수치 */
  fx: Fx;
  /** 발사 한 번에 평균 몇 발 (추가 발사 · 매크로 연사) */
  shotsMul: number;
  /** 코드 모듈로 오르는 평균 초당 피해 배율 (발 수 · 점화 · 취약점 노출 · DDoS — 계산용 기댓값) */
  fxMul: number;
  /** 보스에게만 더 붙는 평균 배율 (약점 분석이 다 쌓였다고 봄 — 계산용 기댓값) */
  fxBossMul: number;
}

/** 버전 v일 때 상한 쪽으로 다가간 비율 (0 → 1) */
const soft = (v: number) => 1 - BAL.modSoftK ** v;
/** 「프로세스 은닉」 버전별 오프라인 효율 (30% → 최대 offRateMax, 여기에 +15%p) */
export function offlineRateOf(v: number) {
  return 0.3 + (BAL.offRateMax - 0.3) * soft(v);
}
/** 「미끼 역이용」 버전별 익스플로잇 확률 보너스 (최대 modCritMax) */
export function modCritOf(v: number) {
  return BAL.modCritMax * soft(v);
}

export function stats(s: Save): Stats {
  // 챌린지 「모듈 봉인」: 코드 모듈 · 우회 기술 · 세트 없음 / 「루트 차단」: 루트 권한 보너스 · 효율 강화 상품 없음
  const naked = s.chal === "naked";
  const noRoot = s.chal === "noroot";
  const zero = ROSTER.map(() => 0);
  const m = naked ? zero : s.mods;
  // 우회 기술: 버전 1 = 예전(최고 스테이지로 오르던 때) bypScale 버전만큼
  const b = (naked ? zero : s.byp).map((v) => v * BAL.bypScale);
  const has = (i: number) => b[i] > 0;
  const fx = fxOf(m);
  const done = (k: ChalKey) => s.chalDone.includes(k);
  const rootMul = noRoot ? 1 : 1 + (BAL.rootBonus + (done("noroot") ? BAL.chalRoot : 0)) * s.root;
  const shop = (k: "rootkit" | "miner") => (noRoot ? 0 : s.shop[k]);
  const achMul = 1 + BAL.achDmg * s.ach.length;
  const atk =
    BAL.atkStep ** s.lv.atk * BAL.atkMilestoneMul ** Math.floor(s.lv.atk / BAL.atkMilestone);
  const aps =
    (1 + (BAL.spdMax - 1) * (1 - BAL.spdK ** s.lv.spd)) *
    (has(8) ? tunnelSpd(b[8]) : 1) *
    (done("single") ? 1.2 : 1);
  const critChance = Math.min(
    0.9,
    0.05 + (BAL.critMax - 0.05) * (1 - BAL.critK ** s.lv.crit) + (has(7) ? modCritOf(b[7]) : 0)
  );
  // 코드 모듈 기댓값: 발 수 × 점화 × 취약점 노출(유지되는 비율) × DDoS
  const shotsMul = (1 + fx.extraP + fx.extraN) * (fx.burstEvery ? 1 + 2 / fx.burstEvery : 1);
  const uptime = 1 - Math.exp((-critChance * aps * shotsMul * BUFF_MS) / 1000);
  const fxMul =
    shotsMul *
    (1 + fx.burn) *
    (1 + fx.buff * uptime) *
    (fx.ddosEvery ? 1 + fx.ddosMul / fx.ddosEvery : 1);
  return {
    dmg:
      atk *
      (has(1) ? 1.5 * BAL.modDmg ** b[1] : 1) *
      rootMul *
      BAL.shopRootkit ** shop("rootkit") *
      BAL.corePatch ** s.shop.kpatch *
      achMul *
      (done("naked") ? 1.5 : 1),
    aps,
    critChance,
    critMul: 2 + BAL.critMulStep * s.lv.crit + (has(4) ? 1 + 0.5 * b[4] : 0),
    dataMul:
      (has(3) ? 1.5 * BAL.modData ** b[3] : 1) *
      BAL.shopMiner ** shop("miner") *
      BAL.coreComp ** s.shop.kcomp,
    costMul: has(9) ? 0.85 * BAL.modCost ** b[9] : 1,
    mobHpMul: has(0) ? 0.85 * BAL.modMobHp ** b[0] : 1,
    bossHpMul: has(2) ? BAL.modBossHp ** b[2] : 1,
    bossTime: BOSS_TIME + (has(2) ? 5 : 0) + BAL.coreIrq * s.shop.kirq + (done("rush") ? 5 : 0),
    rootGain: (has(7) ? 1.25 : 1) * (1 + BAL.coreEscal * s.shop.kescal),
    bossDmgMul: has(5) ? BAL.modBossDmg ** b[5] : 1,
    rootMul,
    offlineRate: has(6) ? offlineRateOf(b[6]) + 0.15 : 0.3,
    offlineHours: BAL.offHours,
    timeMul: s.chal === "rush" ? 0.5 : 1,
    randMul: done("lock") ? 0.85 : 1,
    achMul,
    fx,
    shotsMul,
    fxMul,
    fxBossMul: 1 + fx.stack * fx.stackMax,
  };
}

/** 보스 제한 시간 (상위 보스 · 최종 보스는 기본 시간이 더 길고, 늘어난 시간은 똑같이 더함) */
export function bossTimeOf(kind: "boss" | "apex" | "final", st: Stats) {
  const extra = st.bossTime - BOSS_TIME;
  const base = kind === "final" ? FINAL_TIME : kind === "apex" ? APEX_TIME : BOSS_TIME;
  return (base + extra) * st.timeMul;
}

/** 공격 한 번의 평균 피해 (익스플로잇 반영) */
export function avgHit(st: Stats) {
  return st.dmg * (1 + st.critChance * (st.critMul - 1));
}

/** 코드 모듈 효과 전 초당 피해 (발 수 · 취약점 노출만) — 점화 · DDoS 의 기준 */
export function baseDps(st: Stats) {
  const uptime = 1 - Math.exp((-st.critChance * st.aps * st.shotsMul * BUFF_MS) / 1000);
  return avgHit(st) * st.aps * st.shotsMul * (1 + st.fx.buff * uptime);
}

/** 초당 평균 피해 (코드 모듈 효과 기댓값까지) */
export function dps(st: Stats) {
  return avgHit(st) * st.aps * st.fxMul;
}

// ── 적 (보안 등급 = 체력) · 보상 ──

/** 스테이지 lateFrom 까지는 hpGrowth 배씩, 그 뒤로는 hpGrowthLate 배씩 */
function baseHp(stage: number) {
  const a = Math.min(stage, BAL.lateFrom) - 1;
  const b = Math.max(0, stage - BAL.lateFrom);
  return BAL.hp0 * BAL.hpGrowth ** a * BAL.hpGrowthLate ** b;
}
/** 극초반 보정이 남은 정도 (1스테이지 1 → 점점 0) */
const early = (stage: number) => BAL.earlyDecay ** (stage - 1);
export function mobHp(stage: number, st: Stats) {
  return (baseHp(stage) * st.mobHpMul) / (1 + BAL.earlyHp * early(stage));
}
export function bossHp(stage: number, st: Stats) {
  return (baseHp(stage) * BAL.bossHp * st.bossHpMul) / (1 + BAL.earlyHp * early(stage));
}
/** 보상은 (모듈로 줄이기 전) 체력에 비례 — 스테이지가 올라도 체력 대비 보상이 같음 */
export function mobData(stage: number, st: Stats) {
  return (baseHp(stage) / BAL.dataRatio) * st.dataMul * (1 + BAL.earlyData * early(stage));
}
export function bossData(stage: number, st: Stats) {
  return mobData(stage, st) * BAL.bossData;
}
/** 상위 보스: 같은 스테이지 보스의 apexHp 배 체력 · apexData 배 보상 */
export function apexHp(stage: number, st: Stats) {
  return bossHp(stage, st) * BAL.apexHp;
}
export function apexData(stage: number, st: Stats) {
  return bossData(stage, st) * BAL.apexData;
}
/** 최종 보스: 마지막 스테이지 상위 보스의 finalHp 배 체력 · finalData 배 보상 */
export function finalHp(st: Stats, clears: number) {
  return apexHp(MAX_STAGE, st) * BAL.finalHp * BAL.finalGrowth ** clears;
}
export function finalData(st: Stats) {
  return apexData(MAX_STAGE, st) * BAL.finalData;
}

/** 데이터를 얻음 (누적 합계도 같이) */
export function gainData(s: Save, amount: number) {
  s.data += amount;
  s.lifetime += amount;
}

/** 감염 대상 파일 종류 */
export const FILE_TYPES = [
  { ext: "txt", name: "메모", color: "#cbd5e1" },
  { ext: "doc", name: "보고서_최종", color: "#60a5fa" },
  { ext: "xls", name: "매출현황", color: "#4ade80" },
  { ext: "jpg", name: "가족사진", color: "#f9a8d4" },
  { ext: "zip", name: "백업", color: "#fcd34d" },
  { ext: "exe", name: "setup", color: "#f87171" },
  { ext: "dll", name: "kernel32", color: "#c4b5fd" },
  { ext: "sys", name: "driver", color: "#fb923c" },
  { ext: "db", name: "고객정보", color: "#67e8f9" },
];

// ── 내 바이러스의 진화 ──
// 업그레이드 총 레벨(페이로드 + 오버클럭 + 익스플로잇)이 늘면 형태가 바뀜. 포맷하면 레벨이 0이라 다시 1단계부터.

export const EVOLUTION = [
  { min: 0, name: "시드", en: "SEED" },
  { min: 40, name: "웜", en: "WORM" },
  { min: 120, name: "군체", en: "SWARM" },
  { min: 300, name: "오버마인드", en: "OVERMIND" },
];

/** 지금 진화 단계 (0부터) */
export function evoStage(lv: Record<UpgKey, number>) {
  const total = lv.atk + lv.spd + lv.crit;
  let i = 0;
  while (i + 1 < EVOLUTION.length && total >= EVOLUTION[i + 1].min) i++;
  return i;
}

// ── 업그레이드 ──

export interface UpgDef {
  key: UpgKey;
  name: string;
  icon: string;
  /** 이 업그레이드의 랜덤 강화(1~3레벨) 이름 */
  rand: string;
  base: number;
  growth: number;
  /** 현재 레벨에서의 효과 설명 */
  label: (st: Stats, lv: number) => string;
}

export const UPGRADES: UpgDef[] = [
  {
    key: "atk",
    name: "페이로드",
    icon: "💣",
    rand: "불안정 페이로드",
    base: 5,
    get growth() {
      return BAL.atkCost;
    },
    label: (st, lv) => {
      const next = BAL.atkMilestone - (lv % BAL.atkMilestone);
      return `피해 ${fmt(st.dmg)} · ${next}레벨 뒤 ×${BAL.atkMilestoneMul}`;
    },
  },
  {
    key: "spd",
    name: "오버클럭",
    icon: "⚡",
    rand: "클럭 스파이크",
    base: 15,
    growth: 1.15,
    label: (st) => `초당 ${st.aps.toFixed(2)}발 발사`,
  },
  {
    key: "crit",
    name: "익스플로잇",
    icon: "🔓",
    rand: "익스플로잇 체인",
    base: 40,
    growth: 1.17,
    label: (st) => `취약점 ${Math.round(st.critChance * 100)}% · ×${st.critMul.toFixed(2)}`,
  },
];

export function upgCost(u: UpgDef, lv: number, st: Stats) {
  return Math.ceil(u.base * u.growth ** lv * st.costMul);
}

// ── 랜덤 강화 (업그레이드별로 1~3레벨 무작위) ──
// 업그레이드마다 따로 있고 (불안정 페이로드 · 클럭 스파이크 · 익스플로잇 체인), 값을 치르면 그 업그레이드가 1~3레벨 무작위로 오름.

/** 오르는 레벨 수별 확률 (1 · 2 · 3) */
export const RAND_ODDS = [0.5, 0.35, 0.15];

/** key 업그레이드를 지금부터 n레벨 올리는 데 원래 드는 비용 합계 */
function levelsCost(s: Save, key: UpgKey, n: number, st: Stats) {
  const u = UPGRADES.find((x) => x.key === key)!;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += upgCost(u, s.lv[key] + i, st);
  return sum;
}

/** 랜덤 강화 가격: 오를 레벨 수의 확률대로 평균 낸 비용 × BAL.randPrice */
export function randPrice(s: Save, key: UpgKey) {
  const st = stats(s);
  const avg = RAND_ODDS.reduce((sum, p, i) => sum + p * levelsCost(s, key, i + 1, st), 0);
  return Math.ceil(avg * BAL.randPrice * st.randMul);
}

/** 실제 뽑기 확률 — 폴리모픽 엔진 레벨만큼 1레벨 확률을 3레벨로 옮김 (가격은 기본 확률 그대로라 순수한 이득) */
export function randOdds(s: Save) {
  const poly = s.chal === "noroot" ? 0 : s.shop.poly;
  const move = Math.min(RAND_ODDS[0] - 0.1, BAL.shopPoly * poly);
  return [RAND_ODDS[0] - move, RAND_ODDS[1], RAND_ODDS[2] + move];
}

/** 오를 레벨 수 뽑기 (rand는 시험용으로 바꿀 수 있음) */
export function rollRand(rand: () => number = Math.random, odds: number[] = RAND_ODDS) {
  let r = rand();
  for (let i = 0; i < odds.length; i++) {
    if (r < odds[i]) return i + 1;
    r -= odds[i];
  }
  return odds.length;
}

/** 랜덤 강화 실행: 값을 치르고 그 업그레이드를 1~3레벨 올림. 오른 레벨 수, 돈이 모자라면 0 */
export function randUpgrade(s: Save, key: UpgKey, rand: () => number = Math.random) {
  if (randLocked(s, key)) return 0;
  const price = randPrice(s, key);
  if (s.data < price) return 0;
  s.data -= price;
  const n = rollRand(rand, randOdds(s));
  s.lv[key] += n;
  s.rec.rands++;
  s.rec.ups += n;
  if (n === RAND_ODDS.length) s.rec.jackpots++;
  return n;
}

/** 챌린지 때문에 이 업그레이드를 못 사는지 (「업그레이드 봉인」은 전부 · 「단일 스레드」는 오버클럭) */
export function upgLocked(s: Save, key: UpgKey) {
  return s.chal === "lock" || (s.chal === "single" && key === "spd");
}
/** 랜덤 강화를 못 하는지 (「단일 스레드」의 클럭 스파이크) */
export function randLocked(s: Save, key: UpgKey) {
  return s.chal === "single" && key === "spd";
}

/** 업그레이드 n번 사기 (n = Infinity 면 살 수 있는 만큼) — 산 레벨 수 */
export function buyUpgrade(s: Save, u: UpgDef, n: number) {
  if (upgLocked(s, u.key)) return 0;
  const { cost, count } = bulkCost(s, u, n);
  if (!count || s.data < cost) return 0;
  s.data -= cost;
  s.lv[u.key] += count;
  s.rec.ups += count;
  return count;
}

/** 랜덤 강화의 평균 초당 피해 증가 (로그) — 시뮬레이터가 일반 업그레이드와 비교할 때 씀 */
export function randExpectedGain(s: Save, key: UpgKey) {
  const base = Math.log(dps(stats(s)));
  return randOdds(s).reduce((sum, p, i) => {
    const lv = { ...s.lv, [key]: s.lv[key] + i + 1 };
    return sum + p * (Math.log(dps(stats({ ...s, lv }))) - base);
  }, 0);
}

// ── 시스템 포맷 (환생) ──

/**
 * 최고 스테이지에 따른 루트 권한 합계 — 100까지는 거듭제곱, 그 뒤로는 스테이지마다 rootLate 배씩 더
 * (적 체력이 지수로 늘어나는 후반에 거듭제곱만 쓰면 변이할수록 덜 밀려서 결국 벽에 막힘)
 */
export function rootTotal(best: number) {
  const late = Math.max(0, best - 1 - BAL.lateFrom);
  return Math.floor(((best - 1) / BAL.rootDiv) ** BAL.rootPow * BAL.rootLate ** late);
}

/** 지금 포맷하면 새로 받는 루트 권한 (전보다 더 멀리 가야 생김) */
export function pendingRoot(s: Save) {
  return Math.max(0, Math.floor(rootTotal(s.best) * stats(s).rootGain) - s.root);
}

/** 포맷할 수 있는지 (이번 회차에 formatStage 이상 + 받을 루트 권한이 있음) */
export function canFormat(s: Save) {
  return s.stage >= BAL.formatStage && pendingRoot(s) > 0;
}

/**
 * 포맷 뒤 시작 스테이지: 최고 스테이지의 절반을 10 단위로 내리고 +1, 최대 51 (예: 68 → 31, 30 → 11, 682 → 51)
 * — 업그레이드 없이 시작하니 깊은 곳에서 다시 시작하면 그대로 막힘. 초반은 빨리 지나가니 51부터 다시 퍼짐
 */
export function formatStart(best: number) {
  return Math.floor(Math.min(best, 100) / 2 / 10) * 10 + 1;
}

/** 포맷: 업그레이드·데이터는 처음으로, 스테이지는 formatStart 부터. 루트 권한·상점·모듈·누적 기록은 유지 */
export function format(s: Save): Save {
  const n: Save = {
    ...newSave(),
    stage: formatStart(s.best),
    lifetime: s.lifetime,
    best: s.best,
    apexBest: s.apexBest,
    clears: s.clears,
    cores: s.cores,
    root: s.root + pendingRoot(s),
    rootSpent: s.rootSpent,
    shop: { ...s.shop },
    auto: s.auto,
    formats: s.formats + 1,
    rec: { ...s.rec },
    ach: [...s.ach],
    achSeen: s.achSeen,
    mods: [...s.mods],
    frag: [...s.frag],
    byp: [...s.byp],
    keys: [...s.keys],
    chalDone: [...s.chalDone],
  };
  n.runTop = n.stage;
  rollBoss(n);
  return n;
}

// ── 루트 권한 상점 (포맷해서 받은 루트 권한을 써서 사는 영구 업그레이드) ──

export interface ShopDef {
  key: ShopKey;
  name: string;
  icon: string;
  base: number;
  growth: number;
  max?: number;
  /** 이 상품을 먼저 사야 열림 */
  req?: ShopKey;
  /** 효율 강화(power) · 편의성(util) · 커널(core — 커널 코어로 삼) */
  group: "power" | "util" | "core";
  desc: string;
  /** 지금 레벨의 효과 */
  label: (lv: number) => string;
}

export const SHOP: ShopDef[] = [
  {
    key: "rootkit",
    group: "power",
    name: "루트킷",
    icon: "🦠",
    base: 25,
    growth: 1.4,
    desc: "시스템 깊숙이 숨어 모든 공격을 강화",
    label: (lv) => `피해 ×${fmt(BAL.shopRootkit ** lv)}`,
  },
  {
    key: "miner",
    group: "power",
    name: "데이터 마이닝",
    icon: "⛏️",
    base: 25,
    growth: 1.4,
    desc: "감염시킨 파일에서 데이터를 더 많이 긁어 옴",
    label: (lv) => `데이터 ×${fmt(BAL.shopMiner ** lv)}`,
  },
  {
    key: "poly",
    group: "power",
    name: "폴리모픽 엔진",
    icon: "🧬",
    base: 40,
    growth: 1.7,
    max: 5,
    desc: "스스로 코드를 바꿔 랜덤 강화가 더 크게 터짐",
    label: (lv) => `랜덤 강화 3레벨 확률 ${Math.round((RAND_ODDS[2] + BAL.shopPoly * lv) * 100)}%`,
  },
  {
    key: "profiler",
    group: "util",
    name: "프로파일러",
    icon: "📊",
    base: 40,
    growth: 1,
    max: 1,
    desc: "코드 성능을 재서, 데이터를 쓴 만큼 초당 피해가 가장 많이 오르는 업그레이드를 알려 줌",
    label: (lv) => (lv ? "업그레이드 추천 켜짐" : "업그레이드 탭에서 효율 1등 추천"),
  },
  {
    key: "cron",
    group: "util",
    name: "크론잡",
    icon: "⏱️",
    base: 60,
    growth: 1,
    max: 1,
    req: "profiler",
    desc: "가진 데이터를 모두 써서 초당 피해가 가장 많이 오르는 조합으로 한 번에 업그레이드하는 예약 작업",
    label: (lv) => (lv ? "⚡ 최적 업그레이드 버튼 사용 가능" : "⚡ 최적 업그레이드 버튼 열기"),
  },
  {
    key: "daemon",
    group: "util",
    name: "크론 데몬",
    icon: "🔁",
    base: 150,
    growth: 1,
    max: 1,
    req: "cron",
    desc: "크론잡을 백그라운드에 상주시켜, 데이터가 모일 때마다 최적 업그레이드를 알아서 실행",
    label: (lv) => (lv ? "자동 최적 업그레이드 사용 가능" : "크론잡을 1초마다 자동 실행"),
  },
  {
    key: "kprof",
    group: "util",
    name: "커널 프로파일러",
    icon: "🧠",
    base: 300,
    growth: 1,
    max: 1,
    req: "daemon",
    desc: "루트 권한을 쓴 만큼 초당 피해가 가장 많이 오르는 상품(루트킷 · 데이터 마이닝 · 폴리모픽 엔진)을 알려 줌",
    label: (lv) => (lv ? "루트 상점 추천 켜짐" : "루트 상점에서 효율 1등 추천"),
  },
  {
    key: "autoc",
    group: "util",
    name: "자동 컴파일러",
    icon: "🧬",
    base: 120,
    growth: 1,
    max: 1,
    req: "daemon",
    desc: "코드 조각 · 우회 키가 모이면 알림 없이 바로 컴파일",
    label: (lv) => (lv ? "자동 컴파일 켜짐" : "조각이 모이면 바로 컴파일"),
  },
  // ── 커널 (최종 보스에게서 얻은 커널 코어로 삼 · 가격 = 레벨 + 1 코어) ──
  {
    key: "kpatch",
    group: "core",
    name: "커널 패치",
    icon: "🩹",
    base: 1,
    growth: 1,
    desc: "운영체제 커널을 직접 고쳐 모든 공격을 강화",
    label: (lv) => `피해 ×${fmt(BAL.corePatch ** lv)}`,
  },
  {
    key: "kescal",
    group: "core",
    name: "권한 상승",
    icon: "👑",
    base: 1,
    growth: 1,
    desc: "더 높은 권한을 빼앗아, 같은 최고 스테이지에서도 루트 권한을 더 받음 (다시 변이할 수 있게 됨)",
    label: (lv) => `루트 권한 획득 +${Math.round(BAL.coreEscal * 100 * lv)}%`,
  },
  {
    key: "kcomp",
    group: "core",
    name: "데이터 압축",
    icon: "🗜️",
    base: 1,
    growth: 1,
    desc: "훔친 데이터를 압축해 한 번에 더 많이 빼냄",
    label: (lv) => `데이터 ×${fmt(BAL.coreComp ** lv)}`,
  },
  {
    key: "kirq",
    group: "core",
    name: "인터럽트 지연",
    icon: "⏳",
    base: 1,
    growth: 1,
    max: 3,
    desc: "보안 시스템의 인터럽트를 늦춰 보스와 싸울 시간을 늘림",
    label: (lv) => `보스 제한 시간 +${BAL.coreIrq * lv}초`,
  },
];

/** 커널 코어로 사는 상품인지 */
export function isCoreItem(d: ShopDef) {
  return d.group === "core";
}

/** 남은 루트 권한 포인트 */
export function rootLeft(s: Save) {
  return s.root - s.rootSpent;
}

export function shopCost(d: ShopDef, lv: number) {
  if (isCoreItem(d)) return lv + 1;
  return Math.ceil(d.base * d.growth ** lv);
}

/** 이 상품 값을 낼 수 있는지 (루트 권한 또는 커널 코어) */
export function canAffordShop(s: Save, d: ShopDef) {
  const cost = shopCost(d, s.shop[d.key]);
  return isCoreItem(d) ? s.cores >= cost : rootLeft(s) >= cost;
}

/** 상점에서 사기 — 성공하면 true */
/** 먼저 사야 하는 상품이 아직 없어서 잠겨 있는지 */
export function shopLocked(s: Save, d: ShopDef) {
  return d.req != null && !s.shop[d.req];
}

export function buyShop(s: Save, key: ShopKey) {
  const d = SHOP.find((x) => x.key === key)!;
  if (shopLocked(s, d)) return false;
  const lv = s.shop[key];
  if (d.max != null && lv >= d.max) return false;
  const cost = shopCost(d, lv);
  if (!canAffordShop(s, d)) return false;
  if (isCoreItem(d)) s.cores -= cost;
  else s.rootSpent += cost;
  s.shop[key] = lv + 1;
  return true;
}

// ── 업그레이드 추천 (프로파일러) ──

export interface Advice {
  /** "atk" · "spd" · "crit" 는 업그레이드, "rand:atk" 처럼 앞에 rand: 가 붙으면 랜덤 강화 */
  id: string;
  /** 사면 초당 피해가 몇 % 오르나 (랜덤 강화는 평균) */
  gain: number;
  /** 데이터 1당 오르는 정도 (ln 배율 ÷ 값) — 크게 오르는 것과 작게 오르는 것을 공평하게 비교 */
  score: number;
}

/** 업그레이드 · 랜덤 강화 6가지의 초당 피해 상승과 데이터 대비 효율 (n = 한 번에 살 개수, Infinity = 최대) */
export function upgradeAdvice(s: Save, n: number): { list: Advice[]; best: string | null } {
  const st = stats(s);
  const now = dps(st);
  const list: Advice[] = [];
  for (const u of UPGRADES) {
    const b = bulkCost(s, u, n);
    const count = b.count || 1;
    const cost = b.count ? b.cost : upgCost(u, s.lv[u.key], st);
    const after = dps(stats({ ...s, lv: { ...s.lv, [u.key]: s.lv[u.key] + count } }));
    const g = Math.log(after / now);
    if (!upgLocked(s, u.key))
      list.push({ id: u.key, gain: (after / now - 1) * 100, score: g / cost });
    if (randLocked(s, u.key)) continue;
    const eg = randExpectedGain(s, u.key);
    list.push({
      id: `rand:${u.key}`,
      gain: (Math.exp(eg) - 1) * 100,
      score: eg / randPrice(s, u.key),
    });
  }
  let best: string | null = null;
  let top = -Infinity;
  for (const a of list)
    if (a.score > top) {
      top = a.score;
      best = a.id;
    }
  return { list, best };
}

// ── 루트 상점 추천 (커널 프로파일러) ──

/**
 * 데이터를 f배 더 버는 것을 초당 피해 배율로 환산 — 늘어난 데이터를 업그레이드 한 줄에 몰아넣는다고 보고
 * (가격이 레벨마다 일정 배율로 오르니 ln(f) ÷ ln(가격 배율)레벨 더), 세 줄 중 가장 많이 오르는 값
 */
function dataToDps(s: Save, f: number) {
  const now = dps(stats(s));
  let best = 1;
  for (const u of UPGRADES) {
    const after = dps(stats({ ...s, lv: { ...s.lv, [u.key]: s.lv[u.key] + 1 } }));
    best = Math.max(best, (after / now) ** (Math.log(f) / Math.log(u.growth)));
  }
  return best;
}

/** 랜덤 강화의 효율 (받는 가치 ÷ 가격, 페이로드 기준) — 폴리모픽 엔진 레벨에 따라 */
function randEfficiency(s: Save) {
  const st = stats(s);
  const u = UPGRADES[0];
  const sum = (n: number) => {
    let c = 0;
    for (let i = 0; i < n; i++) c += upgCost(u, s.lv[u.key] + i, st);
    return c;
  };
  return randOdds(s).reduce((a, p, i) => a + p * sum(i + 1), 0) / randPrice(s, u.key);
}

export interface RootAdvice {
  key: ShopKey;
  /** 다음 레벨을 사면 초당 피해가 몇 배 (환산 포함) */
  mul: number;
  /** 루트 권한 100당 초당 피해 상승 % */
  per100: number;
  /** 직접 오르는 게 아니라 데이터 · 랜덤 강화 효율을 환산한 값 */
  converted: boolean;
  score: number;
}

/** 루트킷 · 데이터 마이닝 · 폴리모픽 엔진 중 루트 권한 1당 초당 피해가 가장 많이 오르는 것 (다 산 것은 뺌) */
export function rootAdvice(s: Save): { list: RootAdvice[]; best: ShopKey | null } {
  const list: RootAdvice[] = [];
  for (const key of ["rootkit", "miner", "poly"] as ShopKey[]) {
    const d = SHOP.find((x) => x.key === key)!;
    if (d.max != null && s.shop[key] >= d.max) continue;
    let mul: number;
    if (key === "rootkit") mul = BAL.shopRootkit;
    else if (key === "miner") mul = dataToDps(s, BAL.shopMiner);
    else {
      const next = { ...s, shop: { ...s.shop, poly: s.shop.poly + 1 } };
      mul = dataToDps(s, randEfficiency(next) / randEfficiency(s));
    }
    const cost = shopCost(d, s.shop[key]);
    list.push({
      key,
      mul,
      per100: ((mul - 1) * 100 * 100) / cost,
      converted: key !== "rootkit",
      score: Math.log(mul) / cost,
    });
  }
  let best: ShopKey | null = null;
  let top = -Infinity;
  for (const a of list)
    if (a.score > top) {
      top = a.score;
      best = a.key;
    }
  return { list, best };
}

// ── 여러 번 사기 · 크론잡(최적 업그레이드) ──

/** u 를 최대 n번 산 값과 횟수 (n = Infinity 면 살 수 있는 만큼) — 사지는 않음 */
export function bulkCost(s: Save, u: UpgDef, n: number) {
  const st = stats(s);
  let sum = 0;
  let k = 0;
  while (k < n && k < 1000) {
    const c = upgCost(u, s.lv[u.key] + k, st);
    if (n === Infinity && sum + c > s.data) break;
    sum += c;
    k++;
  }
  return { cost: sum, count: k };
}

export interface Plan {
  /** 업그레이드마다 더 살 레벨 */
  add: Record<UpgKey, number>;
  cost: number;
  /** 다 사면 초당 피해가 몇 배가 되나 */
  mul: number;
  count: number;
}

/**
 * 크론잡: 가진 데이터를 다 써서 초당 피해가 가장 많이 오르는 조합 —
 * 살 수 있는 업그레이드 중 「데이터 1당 초당 피해 상승(ln 배율 ÷ 값)」이 가장 큰 것을 한 레벨씩 계속 고름.
 * (가격이 레벨마다 일정 배율로 오르는 구조라 이렇게 고르면 거의 최적. 랜덤 강화는 결과가 무작위라 뺌)
 */
export function optimalPlan(s: Save, maxSteps = 5000): Plan {
  const sim: Save = { ...s, lv: { ...s.lv } };
  const add: Record<UpgKey, number> = { atk: 0, spd: 0, crit: 0 };
  const start = dps(stats(sim));
  let data = s.data;
  let cost = 0;
  let count = 0;
  for (let step = 0; step < maxSteps; step++) {
    const st = stats(sim);
    const now = dps(st);
    let pick: { key: UpgKey; n: number; cost: number } | null = null;
    let best = -Infinity;
    for (const u of UPGRADES) {
      if (upgLocked(s, u.key)) continue;
      // 후보: 1레벨 · (페이로드는) 다음 「25레벨마다 ×2」까지 한 묶음 — 한 칸씩만 보면 큰 도약을 놓침
      const ns = [1];
      if (u.key === "atk") {
        const k = BAL.atkMilestone - (sim.lv.atk % BAL.atkMilestone);
        if (k > 1) ns.push(k);
      }
      for (const n of ns) {
        let c = 0;
        for (let i = 0; i < n; i++) c += upgCost(u, sim.lv[u.key] + i, st);
        if (c > data) continue;
        sim.lv[u.key] += n;
        const score = Math.log(dps(stats(sim)) / now) / c;
        sim.lv[u.key] -= n;
        if (score > best) {
          best = score;
          pick = { key: u.key, n, cost: c };
        }
      }
    }
    if (!pick) break;
    data -= pick.cost;
    cost += pick.cost;
    sim.lv[pick.key] += pick.n;
    add[pick.key] += pick.n;
    count += pick.n;
  }
  return { add, cost, mul: dps(stats(sim)) / start, count };
}

/** 계획대로 사기 */
export function applyPlan(s: Save, p: Plan) {
  if (!p.count || s.data < p.cost) return false;
  s.data -= p.cost;
  for (const k of Object.keys(p.add) as UpgKey[]) s.lv[k] += p.add[k];
  s.rec.ups += p.count;
  return true;
}

// ── 오프라인 수익 ──

/** 자리를 비운 동안 훔친 데이터 (파일만 감염시켰다고 보고, 효율은 offlineRate) */
export function offlineGain(s: Save, seconds: number) {
  const st = stats(s);
  const secs = Math.min(seconds, st.offlineHours * 3600);
  if (secs < 60) return { data: 0, secs: 0 };
  // 연쇄 감염은 평균만큼 파일을 더 감염시킨다고 봄
  // 러브레터 미끼(명중마다 미리 빼내는 데이터)도 평균만큼
  const perSec = (dps(st) / mobHp(s.stage, st)) * mobData(s.stage, st) * (1 + st.fx.leech);
  return { data: perSec * secs * st.offlineRate, secs };
}

// ── 챌린지 변이 (스테이지 100 돌파 뒤 열림) ──
// 스테이지 1부터 제약을 걸고 다시 퍼짐. 목표 스테이지를 넘으면 제약이 풀리고 영구 보상 + 커널 코어. 그냥 변이하면 챌린지는 끝남.

export type ChalKey = "lock" | "rush" | "naked" | "single" | "noroot";

export interface ChalDef {
  key: ChalKey;
  name: string;
  icon: string;
  rule: string;
  /** 이 스테이지의 보스(10의 배수면 상위 보스까지)를 넘으면 성공 */
  goal: number;
  reward: string;
}

export const CHAL: ChalDef[] = [
  {
    key: "single",
    name: "단일 스레드",
    icon: "🐌",
    rule: "오버클럭 · 클럭 스파이크를 살 수 없음 (발사 속도 고정)",
    goal: 90,
    reward: "발사 속도 ×1.2",
  },
  {
    key: "rush",
    name: "제로데이",
    icon: "⏱️",
    rule: "모든 보스 제한 시간이 절반",
    goal: 99,
    reward: "보스 제한 시간 +5초",
  },
  {
    key: "naked",
    name: "모듈 봉인",
    icon: "🧱",
    rule: "코드 모듈 · 우회 기술 · 모듈 세트 효과 없음",
    goal: 55,
    reward: "피해 ×1.5",
  },
  {
    key: "lock",
    name: "업그레이드 봉인",
    icon: "🔒",
    rule: "일반 업그레이드 · 크론잡을 쓸 수 없고 랜덤 강화만",
    goal: 95,
    reward: "랜덤 강화 가격 ×0.85",
  },
  {
    key: "noroot",
    name: "루트 차단",
    icon: "🚫",
    rule: "루트 권한 피해 보너스 · 루트킷 · 데이터 마이닝 · 폴리모픽 엔진 효과 없음",
    goal: 95,
    reward: `루트 권한 1당 피해 +${BAL.chalRoot * 100}%p`,
  },
];

/** 챌린지를 고를 수 있는지 (스테이지 100 돌파 뒤 — 루트 DNS 를 함락하면) */
export function chalOpen(s: Save) {
  return s.best > 100 || s.clears > 0;
}

/** 이 스테이지의 상위 보스를 처음 잡으면 커널 코어를 주는지 (100스테이지마다 · 마지막은 최종 보스가 줌) */
export function milestoneCore(stage: number) {
  return stage % 100 === 0 && stage < MAX_STAGE;
}

/** 챌린지 시작: 변이처럼 몸을 버리지만 스테이지 1부터 (받을 루트 권한이 있으면 같이 받음) */
export function startChal(s: Save, key: ChalKey): Save {
  const n: Save = { ...format(s), stage: 1, runTop: 1, chal: key };
  rollBoss(n);
  return n;
}

/** 챌린지 목표를 넘었으면 끝내고 보상 — 끝낸 챌린지 (처음이면 커널 코어 +1) */
export function checkChal(s: Save): ChalDef | null {
  const d = CHAL.find((c) => c.key === s.chal);
  if (!d || (s.stage <= d.goal && !s.finalReady)) return null;
  s.chal = null;
  if (!s.chalDone.includes(d.key)) {
    s.chalDone.push(d.key);
    s.cores++;
  }
  return d;
}

// ── 업적 ──
// 업적 하나마다 피해 +BAL.achDmg. 조건은 저장본만 보고 판단 (화면에서 일어난 일은 rec 에 셈).

export interface AchDef {
  id: string;
  icon: string;
  name: string;
  desc: string;
  /** [지금, 목표] — 지금이 목표 이상이면 달성 */
  prog: (s: Save) => [number, number];
  /** 진행 수치를 바이트로 보여 줄지 */
  bytes?: boolean;
}

const GB = 1024 ** 3;
const PB = 1024 ** 5;
const YB = 1024 ** 8;
const ach = (
  id: string,
  icon: string,
  name: string,
  desc: string,
  prog: AchDef["prog"],
  bytes = false
): AchDef => ({ id, icon, name, desc, prog, bytes });

export const ACH: AchDef[] = [
  // 진행
  ach("hello", "👋", "Hello, World", "처음으로 파일 감염", (s) => [s.rec.files, 1]),
  ach("st11", "🖥️", "개인 PC 탈출", "스테이지 10 돌파", (s) => [s.best - 1, 10]),
  ach("st31", "🏢", "사내 LAN 장악", "스테이지 30 돌파", (s) => [s.best - 1, 30]),
  ach("st51", "🏦", "은행 전산망 침투", "스테이지 50 돌파", (s) => [s.best - 1, 50]),
  ach("st81", "📡", "통신사 백본", "스테이지 80 돌파", (s) => [s.best - 1, 80]),
  ach("st101", "🌐", "루트 DNS 함락", "스테이지 100 돌파", (s) => [s.best - 1, 100]),
  ach("st201", "🕳️", "다크넷 장악", "스테이지 200 돌파", (s) => [s.best - 1, 200]),
  ach("st301", "🎖️", "국방망 침투", "스테이지 300 돌파", (s) => [s.best - 1, 300]),
  ach("st501", "🔌", "전력망 장악", "스테이지 500 돌파", (s) => [s.best - 1, 500]),
  ach("st701", "🌊", "해저 케이블 장악", "스테이지 700 돌파", (s) => [s.best - 1, 700]),
  ach("st1001", "🌍", "글로벌 코어 함락", "스테이지 1000 돌파", (s) => [s.best - 1, 1000]),
  ach("pure", "🧪", "순수 혈통", "변이하지 않고 스테이지 70 돌파", (s) => [
    s.formats ? 0 : s.best - 1,
    70,
  ]),
  ach("bypass5", "🛡️", "우회 전문가", "우회 기술 5개", (s) => [apexCount(s.apexBest), 5]),
  ach("compile1", "🧩", "첫 컴파일", "코드 모듈 하나를 컴파일", (s) => [
    s.mods.filter((v) => v > 0).length,
    1,
  ]),
  ach("compile10", "💠", "완성된 무기고", "코드 모듈 10종 모두 컴파일", (s) => [
    s.mods.filter((v) => v > 0).length,
    10,
  ]),
  ach("ks1", "☢️", "스위치 오프", "KILLSWITCH 격퇴", (s) => [s.clears, 1]),
  ach("ks5", "⚡", "연쇄 차단", "KILLSWITCH 5번 격퇴", (s) => [s.clears, 5]),
  ach("ks10", "🌑", "인터넷의 종말", "KILLSWITCH 10번 격퇴", (s) => [s.clears, 10]),
  ach("ksfast", "🏎️", "블리츠", "KILLSWITCH를 10초 안에 격퇴", (s) => [
    s.rec.bestFinal > 0 && s.rec.bestFinal <= 10 ? 1 : 0,
    1,
  ]),
  // 변이 · 챌린지
  ach("fmt1", "☣️", "첫 변이", "처음으로 변이", (s) => [s.formats, 1]),
  ach("fmt5", "🧫", "변종 다발", "변이 5번", (s) => [s.formats, 5]),
  ach("fmt10", "♾️", "끝없는 변이", "변이 10번", (s) => [s.formats, 10]),
  ach("root1k", "🔑", "관리자 권한", "루트 권한 1,000", (s) => [s.root, 1000]),
  ach("root1t", "👑", "시스템 소유자", "루트 권한 1T", (s) => [s.root, 1e12]),
  ach("chal1", "🎯", "챌린저", "챌린지 변이 하나 성공", (s) => [s.chalDone.length, 1]),
  ach("chalAll", "🏆", "완벽한 변종", "챌린지 변이 모두 성공", (s) => [
    s.chalDone.length,
    CHAL.length,
  ]),
  // 누적
  ach("files1k", "📂", "대량 감염", "파일 1,000개 감염", (s) => [s.rec.files, 1000]),
  ach("files100k", "🦠", "팬데믹", "파일 100,000개 감염", (s) => [s.rec.files, 100000]),
  ach("mod20", "🔧", "숙련된 코더", "코드 모듈 하나를 v20으로", (s) => [Math.max(...s.mods), 20]),
  ach("gb", "💾", "기가바이트 도둑", "데이터 1GB 탈취 (누적)", (s) => [s.lifetime, GB], true),
  ach("pb", "🗄️", "페타바이트 도둑", "데이터 1PB 탈취 (누적)", (s) => [s.lifetime, PB], true),
  ach("yb", "🏛️", "요타바이트 도둑", "데이터 1YB 탈취 (누적)", (s) => [s.lifetime, YB], true),
  ach("ups1k", "🔧", "튜닝 중독", "업그레이드 1,000레벨", (s) => [s.rec.ups, 1000]),
  ach("evo", "🧠", "오버마인드", "진화 마지막 단계", (s) => [s.rec.evo, EVOLUTION.length - 1]),
  // 도전
  ach("clutch", "😰", "아슬아슬", "남은 시간 1초 이하에서 보스 격퇴", (s) => [s.rec.clutch, 1]),
  ach("fails", "🔁", "불굴의 코드", "보스에게 10번 차단당함", (s) => [s.rec.fails, 10]),
  ach("jackpot", "🎰", "잭팟 중독", "랜덤 강화 잭팟(+3레벨) 10번", (s) => [s.rec.jackpots, 10]),
  ach("idle", "😴", "장기 잠복", "한 번에 8시간 넘게 자리 비우기", (s) => [s.rec.offMax, 8 * 3600]),
  ach("play", "⌛", "상주 프로세스", "게임 화면에서 10시간", (s) => [s.rec.play, 10 * 3600]),
];

/** 업적 확인 — 새로 달성한 것 (저장본에 기록함) */
export function checkAch(s: Save): AchDef[] {
  s.rec.evo = Math.max(s.rec.evo, evoStage(s.lv));
  const got: AchDef[] = [];
  for (const d of ACH) {
    if (s.ach.includes(d.id)) continue;
    const [cur, goal] = d.prog(s);
    if (cur >= goal) {
      s.ach.push(d.id);
      got.push(d);
    }
  }
  return got;
}

// ── 세이브 백업 (다른 브라우저 · 기기로 옮기기) ──

const BACKUP_TAG = "VIRUS1.";

/** 저장본 → 복사해 둘 수 있는 글자 (VIRUS1. + base64) */
export function exportSave(s: Save) {
  const bytes = new TextEncoder().encode(JSON.stringify(s));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return BACKUP_TAG + btoa(bin);
}

/** 백업 글자 → 저장본 (알아볼 수 없으면 null) — 그냥 JSON 을 붙여 넣어도 됨 */
export function importSave(code: string): Save | null {
  const t = code.trim().replace(/\s+/g, "");
  let json: string;
  try {
    if (t.startsWith(BACKUP_TAG)) {
      const bin = atob(t.slice(BACKUP_TAG.length));
      json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } else json = code.trim();
    const raw = JSON.parse(json) as Partial<Save>;
    if (raw?.v !== 3 || !(Number(raw.stage) >= 1) || !raw.lv) return null;
  } catch {
    return null;
  }
  return parseSave(json);
}

// ── 숫자 표시 ──

const UNITS = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
/** 피해량 등 일반 숫자 (Dc = 10^33 를 넘으면 1.23e45 처럼) */
export function fmt(n: number): string {
  if (n < 1000) return n < 10 && n % 1 ? n.toFixed(1) : Math.floor(n).toString();
  if (n >= 1000 ** UNITS.length) return n.toExponential(2).replace("+", "");
  let u = 0;
  let v = n;
  while (v >= 1000 && u < UNITS.length - 1) {
    v /= 1000;
    u++;
  }
  // 반올림으로 1000.0K 가 되면 다음 단위로
  if (Number(v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)) >= 1000 && u < UNITS.length - 1) {
    v /= 1000;
    u++;
  }
  return `${v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)}${UNITS[u]}`;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
/** 데이터(재화) — 바이트 단위로 */
export function fmtBytes(n: number): string {
  let u = 0;
  while (n >= 1024 && u < BYTE_UNITS.length - 1) {
    n /= 1024;
    u++;
  }
  if (n >= 1024) return `${n.toExponential(2).replace("+", "")} YB`;
  const d = u === 0 ? 0 : n < 10 ? 2 : n < 100 ? 1 : 0;
  return `${n.toFixed(d)} ${BYTE_UNITS[u]}`;
}

export function fmtTime(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h ? `${h}시간 ${m}분` : `${m}분`;
}
