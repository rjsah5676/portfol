// 바이러스 키우기 (방치형, 컴퓨터 바이러스) — 화면과 상관없는 규칙·수치
//
// 흐름: 해커(나)가 바이러스 코드를 자동으로 발사해 파일을 감염 → 데이터 탈취 → 데이터로 강화
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
  /** 스테이지마다 체력 배율 */
  hpGrowth: 1.17,
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
  rootPow: 3,
  /** 루트 권한 1당 피해 +이 비율 */
  rootBonus: 0.1,
  /** 모듈 버전 1당 배율 — 10스테이지마다 하나씩 오르므로 작게 (크면 성장이 폭주) */
  modDmg: 1.1,
  modSpd: 1.05,
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
};

const x = (n: number) => `×${Number(n.toFixed(2))}`;

export const MOBS_PER_STAGE = 10;
export const BOSS_TIME = 30; // 초
export const SAVE_KEY = "virus-idle-v3";
/** 발사한 코드가 적에게 닿기까지 (ms) — 닿는 순간 피해 */
export const SHOT_MS = 380;

export type UpgKey = "atk" | "spd" | "crit";

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
  /** 받은 루트 권한 */
  root: number;
  /** 포맷한 횟수 */
  formats: number;
  savedAt: number;
}

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
    root: 0,
    formats: 0,
    savedAt: Date.now(),
  };
}

/** 저장본이 깨졌거나 옛 버전이면 새로 시작 */
export function parseSave(raw: string | null): Save {
  try {
    const s = JSON.parse(raw ?? "") as Save;
    if (s?.v !== 3 || !(s.stage >= 1) || !s.lv) return newSave();
    const lv = newSave().lv;
    for (const k of Object.keys(lv) as UpgKey[]) if (s.lv[k] >= 0) lv[k] = s.lv[k];
    return { ...newSave(), ...s, lv, best: Math.max(s.best || 1, s.stage) };
  } catch {
    return newSave();
  }
}

// ── 보스 바이러스 · 코드 모듈 ──

export interface VirusDef {
  id: string;
  name: string;
  /** 처음 퍼진 해 */
  year: number;
  /** 대표 색 */
  color: string;
  /** 빼앗는 모듈 이름과 버전(레벨)당 효과 설명 */
  module: string;
  effect: string;
  /** 버전마다 덜 오르는 모듈은 지금 값 (예: "효율 54% · 최대 9.9시간") */
  cur?: (v: number) => string;
  /** 도감 설명 (실제 사건 요약) */
  desc: string;
}

export const ROSTER: VirusDef[] = [
  {
    id: "brain",
    name: "Brain",
    year: 1986,
    color: "#7dd3fc",
    module: "부트 섹터 장악",
    effect: `일반 파일 보안 등급 ${x(BAL.modMobHp)}`,
    desc: "IBM PC에서 처음으로 널리 퍼진 바이러스로 알려져 있어요. 파키스탄의 두 형제가 만들었고, 플로피 디스크의 부트 섹터를 감염시켰어요.",
  },
  {
    id: "morris",
    name: "Morris Worm",
    year: 1988,
    color: "#a78bfa",
    module: "자가 복제",
    effect: `발사 속도 ${x(BAL.modSpd)}`,
    desc: "대학원생 로버트 모리스가 퍼뜨린 초기 인터넷 웜이에요. 스스로 복제하다 통제를 벗어나, 당시 인터넷에 연결된 컴퓨터 상당수를 마비시켰어요.",
  },
  {
    id: "iloveyou",
    name: "ILOVEYOU",
    year: 2000,
    color: "#f472b6",
    module: "러브레터 미끼",
    effect: `데이터 탈취 ${x(BAL.modData)}`,
    desc: "필리핀에서 시작된 이메일 웜이에요. 'LOVE-LETTER-FOR-YOU' 첨부 파일을 열면 주소록 전체로 자신을 보내, 며칠 만에 전 세계 수천만 대를 감염시켰어요.",
  },
  {
    id: "cih",
    name: "CIH (체르노빌)",
    year: 1998,
    color: "#f87171",
    module: "BIOS 덮어쓰기",
    effect: `페이로드 피해 ${x(BAL.modDmg)}`,
    desc: "대만에서 만들어진 바이러스로, 일부 변종이 체르노빌 사고일인 4월 26일에 발동해 '체르노빌 바이러스'라고 불려요. 하드디스크를 덮어쓰고 일부 PC의 BIOS까지 지웠어요.",
  },
  {
    id: "melissa",
    name: "Melissa",
    year: 1999,
    color: "#34d399",
    module: "매크로 자동화",
    effect: `업그레이드 비용 ${x(BAL.modCost)}`,
    desc: "워드 문서 매크로에 숨어 있던 바이러스예요. 문서를 열면 아웃룩 주소록의 처음 50명에게 자신을 메일로 보내, 여러 회사의 메일 서버를 멈추게 했어요.",
  },
  {
    id: "zeus",
    name: "Zeus",
    year: 2007,
    color: "#fbbf24",
    module: "백도어 상주",
    effect: `오프라인 효율 증가 (최대 ${Math.round(BAL.offRateMax * 100)}%)`,
    cur: (v) => `오프라인 효율 ${Math.round(offlineRateOf(v) * 100)}%`,
    desc: "은행 계정 정보를 몰래 훔치는 트로이 목마예요. 감염된 PC를 묶어 거대한 봇넷을 만들었고, 소스 코드가 유출된 뒤 수많은 변종이 나왔어요.",
  },
  {
    id: "stuxnet",
    name: "Stuxnet",
    year: 2010,
    color: "#94a3b8",
    module: "탐지 우회",
    effect: `보스 보안 등급 ${x(BAL.modBossHp)}`,
    desc: "이란 핵시설의 원심분리기를 제어하는 PLC를 노린 웜이에요. 여러 개의 제로데이 취약점을 동시에 쓰고, 들키지 않게 정상 값을 보여 주며 장비를 망가뜨렸어요.",
  },
  {
    id: "conficker",
    name: "Conficker",
    year: 2008,
    color: "#fb923c",
    module: "취약점 스캐너",
    effect: `익스플로잇 확률 증가 (최대 +${Math.round(BAL.modCritMax * 100)}%p)`,
    cur: (v) => `익스플로잇 확률 +${(modCritOf(v) * 100).toFixed(1)}%p`,
    desc: "윈도의 네트워크 취약점을 이용해 수백만 대를 감염시킨 웜이에요. 업데이트를 막고 비밀번호를 무작위로 대입하며 퍼졌어요.",
  },
  {
    id: "wannacry",
    name: "WannaCry",
    year: 2017,
    color: "#ef4444",
    module: "암호화 폭주",
    effect: "익스플로잇 피해 +0.5",
    desc: "파일을 암호화하고 비트코인을 요구한 랜섬웨어예요. 이터널블루 취약점으로 스스로 퍼져 150여 개국의 병원·기업 컴퓨터를 멈췄어요.",
  },
  {
    id: "mydoom",
    name: "Mydoom",
    year: 2004,
    color: "#facc15",
    module: "DDoS 봇넷",
    effect: `보스에게 주는 피해 ${x(BAL.modBossDmg)}`,
    desc: "가장 빠르게 퍼진 이메일 웜 중 하나로 꼽혀요. 감염된 PC들을 동원해 특정 웹사이트에 DDoS 공격을 퍼부었어요.",
  },
];

/** 이 스테이지의 보스 (몇 바퀴째인지 tier 1부터) */
export function bossOf(stage: number) {
  const i = (stage - 1) % ROSTER.length;
  return { def: ROSTER[i], index: i, tier: Math.floor((stage - 1) / ROSTER.length) + 1 };
}

/** 모듈별 버전 — 가장 멀리 간 스테이지에서 바로 계산 (포맷해도 유지) */
export function moduleLevels(best: number): number[] {
  const cleared = best - 1;
  return ROSTER.map((_, i) =>
    cleared > i ? Math.floor((cleared - 1 - i) / ROSTER.length) + 1 : 0
  );
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
/** 10스테이지마다 바뀌는 네트워크 이름 */
export function zoneOf(stage: number) {
  const z = Math.floor((stage - 1) / 10);
  return z < ZONES.length ? ZONES[z] : `다크넷 ${z - ZONES.length + 1}층`;
}

/** 같은 바이러스를 다시 만나면 변종 버전 표시 (v2, v3 …) */
export function tierLabel(tier: number) {
  return tier > 1 ? ` v${tier}` : "";
}

// ── 능력치 ──

export interface Stats {
  dmg: number;
  /** 초당 공격 횟수 */
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
  offlineRate: number;
  offlineHours: number;
}

/** 버전 v일 때 상한 쪽으로 다가간 비율 (0 → 1) */
const soft = (v: number) => 1 - BAL.modSoftK ** v;
/** Zeus 버전별 오프라인 효율 (30% → 최대 offRateMax) */
export function offlineRateOf(v: number) {
  return 0.3 + (BAL.offRateMax - 0.3) * soft(v);
}
/** Conficker 버전별 익스플로잇 확률 보너스 (최대 modCritMax) */
export function modCritOf(v: number) {
  return BAL.modCritMax * soft(v);
}

export function stats(s: Save): Stats {
  const m = moduleLevels(s.best);
  const rootMul = 1 + BAL.rootBonus * s.root;
  const atk =
    BAL.atkStep ** s.lv.atk * BAL.atkMilestoneMul ** Math.floor(s.lv.atk / BAL.atkMilestone);
  return {
    dmg: atk * BAL.modDmg ** m[3] * rootMul,
    aps: (1 + (BAL.spdMax - 1) * (1 - BAL.spdK ** s.lv.spd)) * BAL.modSpd ** m[1],
    critChance: Math.min(
      0.9,
      0.05 + (BAL.critMax - 0.05) * (1 - BAL.critK ** s.lv.crit) + modCritOf(m[7])
    ),
    critMul: 2 + BAL.critMulStep * s.lv.crit + 0.5 * m[8],
    dataMul: BAL.modData ** m[2],
    costMul: BAL.modCost ** m[4],
    mobHpMul: BAL.modMobHp ** m[0],
    bossHpMul: BAL.modBossHp ** m[6],
    bossDmgMul: BAL.modBossDmg ** m[9],
    rootMul,
    offlineRate: offlineRateOf(m[5]),
    offlineHours: BAL.offHours,
  };
}

/** 공격 한 번의 평균 피해 (익스플로잇 반영) */
export function avgHit(st: Stats) {
  return st.dmg * (1 + st.critChance * (st.critMul - 1));
}

/** 초당 평균 피해 */
export function dps(st: Stats) {
  return avgHit(st) * st.aps;
}

// ── 적 (보안 등급 = 체력) · 보상 ──

function baseHp(stage: number) {
  return BAL.hp0 * BAL.hpGrowth ** (stage - 1);
}
export function mobHp(stage: number, st: Stats) {
  return baseHp(stage) * st.mobHpMul;
}
export function bossHp(stage: number, st: Stats) {
  return baseHp(stage) * BAL.bossHp * st.bossHpMul;
}
/** 보상은 (모듈로 줄이기 전) 체력에 비례 — 스테이지가 올라도 체력 대비 보상이 같음 */
export function mobData(stage: number, st: Stats) {
  return (baseHp(stage) / BAL.dataRatio) * st.dataMul;
}
export function bossData(stage: number, st: Stats) {
  return mobData(stage, st) * BAL.bossData;
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
  return Math.ceil(avg * BAL.randPrice);
}

/** 오를 레벨 수 뽑기 (rand는 시험용으로 바꿀 수 있음) */
export function rollRand(rand: () => number = Math.random) {
  let r = rand();
  for (let i = 0; i < RAND_ODDS.length; i++) {
    if (r < RAND_ODDS[i]) return i + 1;
    r -= RAND_ODDS[i];
  }
  return RAND_ODDS.length;
}

/** 랜덤 강화 실행: 값을 치르고 그 업그레이드를 1~3레벨 올림. 오른 레벨 수, 돈이 모자라면 0 */
export function randUpgrade(s: Save, key: UpgKey, rand: () => number = Math.random) {
  const price = randPrice(s, key);
  if (s.data < price) return 0;
  s.data -= price;
  const n = rollRand(rand);
  s.lv[key] += n;
  return n;
}

/** 랜덤 강화의 평균 초당 피해 증가 (로그) — 시뮬레이터가 일반 업그레이드와 비교할 때 씀 */
export function randExpectedGain(s: Save, key: UpgKey) {
  const base = Math.log(dps(stats(s)));
  return RAND_ODDS.reduce((sum, p, i) => {
    const lv = { ...s.lv, [key]: s.lv[key] + i + 1 };
    return sum + p * (Math.log(dps(stats({ ...s, lv }))) - base);
  }, 0);
}

// ── 시스템 포맷 (환생) ──

/** 최고 스테이지에 따른 루트 권한 합계 */
export function rootTotal(best: number) {
  return Math.floor(((best - 1) / BAL.rootDiv) ** BAL.rootPow);
}

/** 지금 포맷하면 새로 받는 루트 권한 (전보다 더 멀리 가야 생김) */
export function pendingRoot(s: Save) {
  return Math.max(0, rootTotal(s.best) - s.root);
}

/** 포맷할 수 있는지 (이번 회차에 formatStage 이상 + 받을 루트 권한이 있음) */
export function canFormat(s: Save) {
  return s.stage >= BAL.formatStage && pendingRoot(s) > 0;
}

/** 포맷: 스테이지·업그레이드·데이터는 처음으로, 루트 권한·모듈·누적 기록은 유지 */
export function format(s: Save): Save {
  return {
    ...newSave(),
    lifetime: s.lifetime,
    best: s.best,
    root: s.root + pendingRoot(s),
    formats: s.formats + 1,
  };
}

// ── 오프라인 수익 ──

/** 자리를 비운 동안 훔친 데이터 (파일만 감염시켰다고 보고, 효율은 offlineRate) */
export function offlineGain(s: Save, seconds: number) {
  const st = stats(s);
  const secs = Math.min(seconds, st.offlineHours * 3600);
  if (secs < 60) return { data: 0, secs: 0 };
  const perSec = (dps(st) / mobHp(s.stage, st)) * mobData(s.stage, st);
  return { data: perSec * secs * st.offlineRate, secs };
}

// ── 숫자 표시 ──

const UNITS = ["", "K", "M", "B", "T"];
/** 피해량 등 일반 숫자 */
export function fmt(n: number): string {
  if (n < 1000) return n < 10 && n % 1 ? n.toFixed(1) : Math.floor(n).toString();
  let u = 0;
  while (n >= 1000 && u < UNITS.length - 1) {
    n /= 1000;
    u++;
  }
  if (n >= 1000) return n.toExponential(2).replace("+", "");
  return `${n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0)}${UNITS[u]}`;
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
