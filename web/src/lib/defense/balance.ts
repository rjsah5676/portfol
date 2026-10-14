/**
 * 픽셀 글리치 디펜스 밸런스 수치 — 밸런스는 전부 여기(+ units.ts · enemies.ts 의 유닛 · 적 수치)에서만 만짐.
 *
 * 시뮬(결정론)이라 수치가 바뀌면 같은 시드 · 같은 입력이라도 결과가 달라짐 → 랭킹 검증이 버전별로 갈림.
 * 그래서 수치를 바꾸면 BALANCE_VER 를 올릴 것 (서버는 기록에 버전을 같이 저장하고, 다른 버전 기록은 따로 봄).
 *
 * 시간 단위는 tick (1초 = TPS tick). 거리 단위는 칸 (필드 8 × 5칸).
 */

export const BALANCE_VER = "beta5";

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
  hp: { base: 26, lin: 0.4, mult: 1.068, mult2: 1.15, from2: 20, mult3: 1.07, from3: 50 },
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
  /** 판매 골드 (등급별: 노말 · 레어 · 에픽 · 레전드 · 신화 · 히든) */
  sell: [8, 20, 50, 120, 250, 300, 500] as number[],
  /** 판매 행운석 (레전드부터) */
  sellStones: [0, 0, 0, 1, 2, 2, 3] as number[],
  /** 세력 강화: 비용 = base + step × lv, 피해 +perLv (곱 아닌 합) */
  up: {
    knight: { base: 30, step: 10 },
    mech: { base: 30, step: 10 },
    arcane: { base: 20, step: 7 },
    /** 히든 — 피해 대신 히든 고유 효과(정화 · 삭제 비율 · 방어 깎기 · 보스 배수)가 Lv 당 hiddenFx 만큼 (비쌈) */
    hidden: { base: 80, step: 30 },
    hiddenFx: 0.08,
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
  /** 행운석 도박 — from 웨이브부터 (초반에 행운석으로 에픽 · 레전드를 바로 뽑아 쉽게 넘기지 못하게) */
  gamble: { E: { cost: 1, p: 0.5, from: 5 }, L: { cost: 2, p: 0.2, from: 10 } },

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
    /** S: 30웨이브부터, 아주 단단함 */
    S: { hp: 320, stones: 8, gold: 160, from: 30 },
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

/**
 * 치트 코드 보정: 치트가 나오는 보스(10 · 20 · 30 · 40 · 50)를 지날 때마다 적 체력 +cheatHp (합) — 치트로 세진 만큼 판 길이 · 난이도를 맞춤.
 * 고른 치트와 상관없이 웨이브로만 정함 (모두 같은 적). 밸런스 시뮬이 --cheathp 로 바꿔 볼 수 있게 객체로 둠.
 */
export const TUNE = {
  cheatHp: 0.15,
  /**
   * 순혈 프로토콜 · 치트 「단일 세력 코드」 · 유물 「순수 혈통」: 필드에서 가장 많은 세력의 비율(히든도 전체에 셈, 보관함 안 셈)이
   * pureFrom 이상이면 켜짐 (밑이면 꺼짐) → 그 비율에서 세기 pureBase, 100% 에서 1 (사이는 비례).
   * 세기 1 일 때 그 세력 피해 ×pureDmg · 강화 비용 ×pureUp. 순수 혈통 유물은 켜지기만 하면 전부
   */
  pureFrom: 0.7,
  pureBase: 0.5,
  pureDmg: 2.4,
  pureUp: 0.7,
  /** 이자 패치: 가진 골드 % · 최대 */
  interestPct: 0.05,
  interestMax: 16,
  /** 이자: 웨이브 골드 × (안 모아 두는 사람도 이득이 있게) */
  interestWave: 1.6,
  /** 도박사: 도박 성공률 + */
  gamblerP: 0.2,
};

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
