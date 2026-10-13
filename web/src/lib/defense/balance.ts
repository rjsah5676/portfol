/**
 * 픽셀 글리치 디펜스 밸런스 수치 — 밸런스는 전부 여기(+ units.ts · enemies.ts 의 유닛 · 적 수치)에서만 만짐.
 *
 * 시뮬(결정론)이라 수치가 바뀌면 같은 시드 · 같은 입력이라도 결과가 달라짐 → 랭킹 검증이 버전별로 갈림.
 * 그래서 수치를 바꾸면 BALANCE_VER 를 올릴 것 (서버는 기록에 버전을 같이 저장하고, 다른 버전 기록은 따로 봄).
 *
 * 시간 단위는 tick (1초 = TPS tick). 거리 단위는 칸 (필드 8 × 5칸).
 */

export const BALANCE_VER = "b1";

export const TPS = 30;
/** 필드에 남은 적이 이 수에 닿으면 패배 */
export const CAP = 100;
/** 마지막 웨이브 (이 웨이브 보스를 잡으면 클리어) */
export const LAST_WAVE = 60;
/** 보스 웨이브 간격 */
export const BOSS_EVERY = 10;

export const B = {
  /** 첫 웨이브 전 준비 시간 */
  prepSec: 8,
  /** 일반 웨이브 길이 */
  waveSec: 20,
  /** 웨이브마다 나오는 적 수 — waveCountTo[i] 웨이브까지 waveCount[i] 마리 (초반은 적게, 중후반은 많이) · 나오는 간격 */
  waveCount: [12, 16, 20, 26, 32],
  waveCountTo: [3, 6, 20, 40, 999],
  spawnGap: 0.5,
  /** 보스 제한 시간 (못 잡으면 패배) */
  bossSec: 60,
  /** 보스를 잡고 다음 웨이브까지 */
  breakSec: 3,
  /** 적 체력: base × (1 + lin × w) × mult^w — from2 웨이브부터는 mult2 로 더 가파르게 (중후반 압박), from3 부터는 mult3 (끝판 숨 고르기) */
  hp: { base: 26, lin: 0.4, mult: 1.068, mult2: 1.15, from2: 20, mult3: 1.06, from3: 50 },
  /** 적 방어력 = perWave × w × 종류 배수 */
  armorPerWave: 1,
  /** 엘리트(5 · 15 · 25… 웨이브 마지막 한 마리) 체력 배수 */
  eliteHp: 8,
  /** 보스 체력 = 그 웨이브 적 체력 × 이 값 × 보스 배수 */
  bossHp: 5.5,
  /** 적 기본 이동 속도 (칸/초) — 한 바퀴 22칸 */
  enemySpd: 1.4,

  // ── 경제 ──
  startGold: 100,
  /** 소환 비용 = base + step × 지금까지 소환한 수 (max 까지) */
  summon: { base: 20, step: 1, max: 70 },
  /** 처치 골드 (+ 웨이브 / per 마다 1) */
  killGold: 2,
  killGoldPer: 15,
  /** 웨이브를 넘기면: base + per × w */
  waveGold: { base: 20, per: 2 },
  /** 판매 금액 (노말 · 레어 · 에픽) — 레전드부터 판매 불가 */
  sell: [8, 20, 50] as number[],
  /** 세력 강화: 비용 = base + step × lv, 피해 +perLv (곱 아닌 합) */
  up: {
    knight: { base: 30, step: 10 },
    mech: { base: 30, step: 10 },
    arcane: { base: 20, step: 7 },
    perLv: 0.1,
    max: 50,
  },
  /** 소환 확률 강화 (골드) — lv 별 비용 */
  luckCost: [100, 150, 220, 300, 400],
  /** 소환 확률 [노말, 레어, 에픽, 레전드] (luck lv 0~5) — 합 100 */
  odds: [
    [74, 22, 4, 0],
    [70, 24, 5.5, 0.5],
    [66, 26, 7, 1],
    [62, 28, 8.5, 1.5],
    [58, 30, 10, 2],
    [54, 32, 11.5, 2.5],
  ],
  /** 행운석 도박: cost 개 → p 확률로 그 등급 무작위 */
  gamble: { E: { cost: 1, p: 0.5 }, L: { cost: 2, p: 0.2 } },

  // ── 보스 보상 ──
  bossGold: { base: 60, per: 5 },
  bossStones: 2,
  /** 보스를 잡으면 받는 "골라 뽑기" 등급 (웨이브 → 등급 0N 1R 2E 3L) */
  bossTicket: { 10: 1, 20: 2, 30: 2, 40: 3, 50: 3 } as Record<number, number>,

  // ── 글리치 균열 (나랜디 랭크 미션 같은 것) ──
  rift: {
    C: { hp: 15, stones: 1, gold: 20 },
    B: { hp: 45, stones: 2, gold: 40 },
    A: { hp: 120, stones: 4, gold: 80 },
    /** 균열 적이 머무는 시간 (못 잡으면 그냥 사라짐) */
    sec: 30,
    /** 균열을 연 뒤 다음 균열까지 */
    cd: 45,
    /** 처음 열 수 있는 웨이브 */
    from: 3,
  },

  /** 둔화 상한 */
  slowCap: 0.75,
  /** 보스 피해 감소: 둔화 · 기절이 보스에겐 이만큼만 */
  bossCc: 0.4,
  /** 보스에게는 크기 상성이 이보다 나쁘지 않음 (기사단도 중 · 대형 보스를 칠 수 있게) */
  bossSizeFloor: 0.8,
} as const;

/** 웨이브별 일반 적 체력 (곱을 차례로 해서 미리 — Math.pow 는 엔진마다 끝자리가 다를 수 있어 안 씀) */
export const HP_TABLE: number[] = (() => {
  const out: number[] = [];
  let m = 1;
  for (let w = 0; w <= 400; w++) {
    out.push(Math.round(B.hp.base * (1 + B.hp.lin * w) * m));
    m *= w >= B.hp.from3 ? B.hp.mult3 : w >= B.hp.from2 ? B.hp.mult2 : B.hp.mult;
  }
  return out;
})();
export const hpOf = (w: number) => HP_TABLE[Math.min(HP_TABLE.length - 1, Math.max(0, w))];

/** 그 웨이브에 나오는 적 수 */
export const countOf = (w: number) => {
  for (let i = 0; i < B.waveCountTo.length; i++) if (w <= B.waveCountTo[i]) return B.waveCount[i];
  return B.waveCount[B.waveCount.length - 1];
};

export const sec = (s: number) => Math.round(s * TPS);
