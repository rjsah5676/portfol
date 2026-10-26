/**
 * 격투게임 시뮬레이션 — 결정론적 순수 로직 (그림·소리·시간과 무관), 플랫폼 대전 (x·높이 h)
 *
 * 온라인 롤백 넷코드를 위해 지키는 규칙:
 *  - 상태(State)는 숫자·배열·평범한 객체만 → clone()으로 통째 저장/복원
 *  - 실수 연산 없이 정수만 (1px = 256), Math.random·Date 안 씀
 *  - 한 프레임 진행은 step(state, [p1입력, p2입력]) 하나 — 같은 상태+같은 입력이면 어디서 돌려도 같은 결과
 *  - 입력은 프레임마다 9비트 (방향 4 + 버튼 5)
 *
 * 좌표: x = 가로, h = 화면 아래에서 높이(위가 +). 화면 y = VIEW_H - h.
 * 발판은 한쪽 통과(밑에서 뚫고 올라감, 끝으로 걸어 내려감). 화면 밑으로 떨어지면
 * 위에서 잠깐 무적으로 다시 내려옴 (피해 없음).
 * 조작: 좌우로 걷고 그쪽을 봄, ←←/→→ 대시(공중 1번), 점프(공중에서 한 번 더),
 * ↓ 누르고 있으면 가드. 공중에선 약·발차기·아이덴티티 — 점프마다 2번까지.
 * 격투게임 시스템: 막혔을 때 프레임 이득(기술마다 onBlock), 잡기(약+발차기, 가드 불가, 풀기 가능),
 * 가드 반격(막는 중 발차기, 게이지 25), 저스트 가드(맞기 직전에 ↓ → 경직 반, 게이지), 카운터 히트(발동 중 맞으면 1.25배·경직 +).
 */
import {
  CHARS,
  GRAVITY,
  GUARD_COUNTER_COST,
  JUMP_VY,
  SUB,
  type Box,
  type CharDef,
  type MoveDef,
  type MoveId,
} from "./chars";
import { MAPS, type MapDef, type Plat } from "./maps";

/** 띄워진 상대 중력 (보통의 34%) — 띄우는 속도와 같은 비율로 줄여서, 덜 높이 뜨지만 떠 있는 시간은 그대로 */
const FLOAT_G = Math.trunc((GRAVITY * 34) / 100);
/** 띄워진 상대 최대 낙하 속도 */
const FLOAT_FALL = 825;
/** 정수 제곱근 (실수 연산 안 씀) */
function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = Math.trunc(n / 2) + 1;
  let y = Math.trunc((x + Math.trunc(n / x)) / 2);
  while (y < x) {
    x = y;
    y = Math.trunc((x + Math.trunc(n / x)) / 2);
  }
  return x;
}

export const VIEW_W = 1152;
export const VIEW_H = 648;
export const WALL_L = 16 * SUB;
export const WALL_R = (VIEW_W - 16) * SUB;
/** 이 아래로 떨어지면 낙하 */
const FALL_H = -90 * SUB;
/** 다시 내려오는 높이 (화면 위 밖) */
const RESPAWN_H = (VIEW_H + 40) * SUB;
/** 다시 내려온 뒤 무적 프레임 */
const RESPAWN_INV = 100;
/** 떨어진 뒤 땅에서 이만큼(프레임) 버티기 전에 또 떨어지면: 무적 없음 + 체력이 이만큼(%) 깎임 (낭떠러지에서 계속 떨어지며 버티기 방지) */
const FALL_GRACE = 240;
const FALL_DMG = 6;

/** 입력 비트 */
export const IN = {
  L: 1,
  R: 2,
  /** 위 (점프와 같음) */
  U: 4,
  /** 아래 — 누르고 있으면 가드 */
  D: 8,
  /** 약 (J) */
  A: 16,
  /** 발차기 (K) */
  B: 32,
  /** 아이덴티티 (L) — 캐릭터마다 다름 */
  C: 64,
  /** 필살기 (I, 게이지) */
  X: 128,
  /** 점프 */
  J: 256,
} as const;
const IN_MASK = 511;

const HIST = 24;
const INTRO = 100;
const ROUND_END = 170;
export const ROUND_SEC = 90;
export const WINS_NEEDED = 2;
const MAX_ROUNDS = 5;
const DOWN_T = 36;
const RISE_T = 14;
export const METER_MAX = 100;
const SUPER_FREEZE = 36;
const JUMP_V = -JUMP_VY;
/** 2단 점프 세기 */
const JUMP2_V = Math.trunc((JUMP_V * 88) / 100);
const MAX_FALL = 2600;
/** 공중 좌우 가속 */
const AIR_ACC = 70;
/** 저스트 가드 판정 프레임 (가드 올린 뒤 이 안에 막으면) */
const JUST_T = 5;
/** 잡힌 뒤 던져질 때까지 붙잡혀 있는 프레임 */
const THROW_TECH_T = 14;
/** 제나 공중 뇌격돌을 맞힌 뒤 상대 앞에 붙는 거리(px) */
const ZAP_AIR_GAP = 34;
/** 이반: 바닥에서 이 높이(px) 안쪽으로 떨어지는 중엔 L 이 곰 포옹이 아니라 착지 후 철곰권 */
const LAND_S_H = 60;
/** 착지 직후 철곰권 입력을 봐 주는 프레임 (공중에서 미리 누른 L) */
const LAND_S_BUF = 14;
/** 그중 풀 수 있는 앞쪽 프레임 (잡히는 순간의 히트스톱 10프레임 동안 누른 것도 인정 → 약 0.33초, 철권 수준). 풀면 피해 없음
 *  (10.12 4 → 10 · 붙잡는 시간 8 → 14: 보고 풀기엔 0.23초가 너무 짧아 0.1초 늘림) */
const THROW_TECH_WIN = 10;
/** 잡기 풀기: 잡은 쪽을 밀쳐 냄 — 밀려나는 속도 · 휘청이는 프레임 (10.14 풀자마자 바로 붙어 다시 잡고 푸는 게 끝없이 반복되던 것) */
const TECH_SHOVE_VX = 2600;
const TECH_SHOVE_T = 10;
/** 연속 동작 수: 약(L) 4단, 발차기(H) 2단 */
const CHAIN_MAX: Partial<Record<MoveId, number>> = { L: 4, H: 2 };
const CHAIN_STEP = 520;
/** 마지막 동작 뒤 추가 빈틈 (상대가 반격할 틈) */
const FINISH_REC: Partial<Record<MoveId, number>> = { L: 14, H: 16 };
/** 대시 길이 (프레임) */
const DASH_T = 13;
/** 돌진 잡기: 대시 중 J + K — 대시 속도로 파고들며 잡음 (막고 있는 상대를 멀리서 잡는 수단, 헛치면 빈틈이 큼) */
// 미끄러지듯 길게 파고듦: 시작 4 + 판정 10프레임 동안 DASH_GRAB_V로 (약 105px)
const DASH_GRAB: Partial<MoveDef> = { startup: 4, active: 10, recovery: 24, box: { x: 0, y: 56, w: 50, h: 44 } };
const DASH_GRAB_V = 1900;
/** 돌진 잡기에 드는 게이지 (가드 반격과 같음) */
const DASH_GRAB_COST = 25;
/** 점프마다 쓸 수 있는 공중 공격 수: 약 4번, 발차기 2번 (2단 점프하면 다시 채워짐, 내려찍기는 따로 1번) */
const AIR_J_MAX = 4;
const AIR_K_MAX = 2;
/** 공중 발차기로 띄운 상대를 맞히면 때린 쪽은 이만큼(%)만 따라감 → 상대가 살짝 더 밀려나 이어 치기 어려움 */
const AIR_K_FOLLOW = 75;
/** 마무리 내려찍기(공중 ↓ + K): 피해(%), 타격 정지, 내리꽂는 속도, 땅에서 튀는 세기 */
const SLAM_DMG = 140;
const SLAM_STOP = 16;
const SLAM_VH = 2600; // 최고 낙하 속도(MAX_FALL)에 잘리므로 그 값으로
const SLAM_BOUNCE = 1100;
/** 섞기 보상(공중 콤보): 다른 기술로 바꿔 맞히면 피해 %, 같은 기술을 연달아 맞히면 한 번마다 -%, 최저 % */
const MIX_BONUS = 110;
const MIX_REPEAT = 12;
const MIX_MIN = 55;
/** 공중 공격을 맞힌 뒤 다음 공중 공격으로 이어 치는 창 (판정 시작 +1 ~ 판정 끝 + 이만큼) — 짧아서 박자 맞춰야 함 */
const AIR_CHAIN_WIN = 3;
/** 막은 뒤 가드 반격을 받아 주는 여유 프레임 (막는 경직 + 이만큼) */
const GC_GRACE = 10;
/** 잡기 성공 후 위로 띄우는 세기와 그동안의 경직 */
const LAUNCH_VH = 1725;
const LAUNCH_STUN = 60;
/** 화상: BURN_EVERY 프레임마다 겹수 × 최대 체력 × 0.05% (= 겹마다 초당 0.2%), 지속 BURN_T, 최대 BURN_MAX 겹 */
const BURN_EVERY = 15;
const BURN_T = 300;
const BURN_MAX = 5;
/** 감전 처음 걸릴 때 짧게 기절 (경직 +) */
const SHOCK_STUN = 10;
/** 상태 이상(기절·방울·끌려옴·감전·일시정지·혼란)이 풀린 뒤 다시 안 걸리는 시간 (2초) — 그 사이엔 피해만 들어가고 IMMUNE */
const STATUS_IMM = 120;
/** 면역일 때 기절 대신 주는 경직 */
const DIZZY_IMM_STUN = 18;
/** 화상 중인 상대: 태울 수 있는 캐릭터(이그나)의 공격이 겹마다 이만큼(%) 더 아픔 */
const BURN_BONUS = 5;
/** 건모 Alt+Tab 뒤 공중에서 안 떨어지는 시간 (0.3초) */
const SWAP_HOLD = 18;
/** 대시가 끝난 뒤에도 이 프레임 안에 잡기를 누르면 돌진 잡기 */
const DASH_GRAB_GRACE = 10;
/** 약 4단 마무리로 띄우는 세기 */
const CHAIN_LAUNCH_VH = 1425;
/** 띄워진 상대를 공중에서 다시 때리면: 다시 떠오르는 세기, 밀림 비율(%), 최소 경직 */
const JUGGLE_VH = 950;
const JUGGLE_PUSH = 45;
const JUGGLE_STUN = 36;
/** 비눗방울에 갇힌 상대를 때려 터뜨리면 추가 피해 */
const BUBBLE_POP_DMG = 20;
/** 공중에서 띄운 상대를 맞히면 둘 다 이만큼 살짝 떠올랐다가 같이 천천히 내려옴 */
const JUGGLE_POP = 520;
/** 그때 때린 쪽이 느리게 떨어지는 프레임 (맞힐 때마다 다시) */
const JUGGLE_HANG = 45;
/** 건모 Alt+Tab: 자리를 바꾼 뒤 상대를 이 거리(px)까지 끌어옴 */
const SWAP_NEAR = 30;
/** 띄워진 지 이 프레임(2초)이 지나면 점점 빨리 떨어짐: RAMP 동안 보통 중력까지, 그 뒤 RAMP2 동안 중력 2배까지 */
const FLOAT_SOFT_T = 120;
const FLOAT_RAMP = 60;
const FLOAT_RAMP2 = 120;

export type FState =
  "idle" | "walk" | "dash" | "jump" | "atk" | "hit" | "block" | "down" | "rise" | "ko" | "win";
export type Phase = "intro" | "fight" | "roundEnd" | "over";

export interface Fighter {
  ch: number;
  x: number;
  /** 화면 아래에서 높이 */
  h: number;
  vx: number;
  /** 위로 +, 중력으로 줄어듦 */
  vh: number;
  face: 1 | -1;
  hp: number;
  meter: number;
  st: FState;
  /** 지금 상태로 들어온 지 몇 프레임 */
  t: number;
  mv: MoveId | "";
  /** 이번 기술이 이미 맞혔거나 막혔나 (0/1) */
  hit: number;
  stun: number;
  /** 이 캐릭터가 지금 연속으로 맞은 수 */
  combo: number;
  /** 착지하면 다운 */
  kd: number;
  /** 이번 공중에서 쓴 공중 약 수 */
  airUsed: number;
  /** 이번 공중에서 쓴 공중 발차기 수 */
  airK: number;
  /** 이번 공중에서 내려찍기(↓ + K) 썼나 */
  airS: number;
  /** 1 = 대시 중에 낸 잡기 = 돌진 잡기 (빠르게 파고들고 닿는 거리 김, 헛치면 빈틈 큼), 2 = 대시에서 낸 약·발차기 (곧바로 나머지 버튼을 누르면 돌진 잡기로 바뀜) */
  lg: number;
  /** 남은 대시 프레임 (땅·공중) */
  dashT: number;
  /** 이번 공중에서 대시 썼나 */
  airDash: number;
  /** 공중 내리꽂기 중 (착지 충격파용) */
  dive: number;
  /** 아이덴티티 남은 대기 프레임 */
  cd: number;
  /** 약·발차기 연속 동작 몇 번째인지 (1부터) */
  chain: number;
  /** 가드를 시작한 지 몇 프레임 (저스트 가드 판정, 255 = 오래됨) */
  guardT: number;
  /** 잡힌 상태: 남은 프레임 (0 = 아님). 앞쪽 THROW_TECH_WIN 프레임 안에 약+발차기 누르면 풀림 */
  grabbed: number;
  /** 잡기 피해 — 던져지는 순간에 들어감 (풀면 안 들어감) */
  grabDmg: number;
  /** 이번 콤보에서 누운 채로 잡혔나 (누운 상대 다시 잡기는 콤보마다 한 번) */
  otg: number;
  /** 떨어진 뒤 땅에서 더 버텨야 하는 프레임 (0이 되기 전에 또 떨어지면 무적 없이 체력이 깎임) */
  fell: number;
  /** 쓴 점프 수 (땅에 닿으면 0) */
  jumps: number;
  /** 가드 반격을 쓸 수 있는 남은 프레임 (공격을 막으면 채워짐) */
  gcT: number;
  /** 건모 Alt+F4 뒤 게이지 덜 얻는 남은 프레임 */
  mnerf: number;
  /** 띄워진 상태 (잡기·약 4단 마무리): 떨어지는 속도가 느려 공중 콤보를 넣기 쉬움, 땅에 닿으면 0 */
  float: number;
  /** 띄워진 채로 맞고 있는 프레임 (float 1·2, 땅에 닿으면 0) — 2초 넘으면 점점 빨리 떨어짐 */
  floatT: number;
  /** 공중에서 띄운 상대를 맞힌 뒤 남은 프레임: 그동안 때린 쪽도 상대와 같은 느린 중력으로 같이 내려옴 */
  juggle: number;
  /** 머리 위 표시: 1 ⏸ 일시정지, 2 💫 혼란 (맞는 동안만) */
  mark: number;
  /** 감전 남은 프레임: 걷기·대시가 느려지고, 감전시킨 캐릭터의 공격에 더 아픔 */
  shock: number;
  /** 화상 남은 프레임 (이그나 — 15프레임마다 체력이 조금씩 닳음, 화상으로는 안 죽음) */
  burn: number;
  /** 화상 겹수 (1~5) · 틱 피해 나머지(1/10000 체력) */
  burnN: number;
  burnAcc: number;
  /** 일섬 낙인: 남은 프레임 (0이 되는 순간 터짐) */
  zap: number;
  /** 일섬 시작 자리 (그림용) */
  zx: number;
  /** 건모 Alt+F4 강제 종료: 남은 멈춤 프레임 (그동안 맞아도 멈춤이 안 풀림) */
  frz: number;
  /** 이번 콤보에서 이미 강제 종료를 맞음 (콤보 초기화로 무한 반복 안 되게 — 다시 맞아도 피해만) */
  bsodd: number;
  /** 불 장판: 마지막으로 피해 · 화상 겹을 받은 프레임 (장판 여러 개가 겹쳐도 한 번만) */
  flT: number;
  flB: number;
  /** 지금 기술을 공중에서 시작했나 (공중 버전 기술용) */
  aerial: number;
  /** 아래로 내리꽂힌 상태: 땅에 닿으면 한 번 튀어 오름 */
  spiked: number;
  /** 지금 공중 발차기를 ↓ 누르고 냈나 (마무리 내려찍기) */
  dk: number;
  /** 섞기 보상: 이번 공중 콤보에서 마지막으로 맞은 기술(글자 코드)과 같은 기술 연달아 맞은 수 */
  mixM: number;
  mixN: number;
  /** 끌려오는 중: 남은 프레임과 도착할 x (그동안 매 프레임 남은 거리를 나눠서 이동) */
  pullT: number;
  pullX: number;
  /** 끌어당기기에 맞아 경직 중 (이 동안엔 잡기도 들어감) — 경직이 풀리면 0 */
  pulled: number;
  /** 비눗방울에 갇힌 남은 프레임 (둥실 떠 있고 못 움직임) */
  trapT: number;
  /** 공중에서 안 떨어지고 버티는 남은 프레임 (건모 Alt+Tab 뒤) */
  hold: number;
  /** 차지 기술로 모은 프레임 (이반 철곰권) */
  chg: number;
  /** 공중 잡기(이반 곰 포옹)로 상대를 안고 떨어지는 중 */
  hug: number;
  /** 이번 콤보에서 곰 포옹에 이미 잡혔음 (콤보마다 한 번) */
  hugd: number;
  /** 상태 이상에 걸려 있음 (풀리면 imm 시작) — 걸린 채 또 맞으면 상태 이상은 안 걸림 */
  cc: number;
  /** 상태 이상 면역 남은 프레임 */
  imm: number;
  /** 이번 프레임에 경직에서 풀림 — 이 프레임 안에 또 맞으면 같은 콤보(콤보 수·피해 보정 이어짐), 안 맞으면 프레임 끝에 콤보 0 */
  recov: number;
  /** 남은 무적 프레임 (다시 내려온 뒤) */
  inv: number;
  /** 최근 입력 (마지막이 이번 프레임) */
  hist: number[];
  /** 포르테 공중 「되감기 낙하」를 시작한 자리 (내리찍은 뒤 여기로 되돌아옴) */
  rwX: number;
  rwH: number;
  /** 시간 정지 남은 프레임 (포르테 되감기 낙하에 맞음): 그 자리에 멈춰 안 떨어지고 안 밀려남 */
  tsT: number;
  /** 앙코르 기록: 최근 내가 맞힌 타격 [프레임, 피해] 쌍 (오래된 건 지움) */
  enc: number[];
  /** 앙코르 진행 프레임 (0 = 아님) · 다시 넣을 타격 [몇 프레임째, 피해] 쌍 · 붙잡아 둔 상대 자리 */
  encT: number;
  encQ: number[];
  encX: number;
  encH: number;
}

export interface Proj {
  /** 0 = 날아가는 탄, 1 = 불기둥 (소환), 2 = 불 장판 (불기둥이 꺼진 자리) */
  k: number;
  /** 날아가는 탄을 만든 기술: 0 = 아이덴티티(S), 1 = 필살기(X) */
  mv: number;
  /** 남은 타격 수 (여러 번 맞는 탄) */
  n: number;
  /** 지난 프레임 */
  t: number;
  o: number;
  x: number;
  h: number;
  vx: number;
  /** 위아래 속도 (공중에서 쏘면 아래로 내리꽂힘) */
  vh: number;
  life: number;
  /** 부메랑 탄(태엽 팽이): 쏜 방향 · 맞힌 길 (1 가는 길, 2 오는 길) */
  d?: number;
  hb?: number;
}

export type EvKind =
  | "hit"
  | "block"
  | "ko"
  | "jump"
  | "proj"
  | "clash"
  | "super"
  | "round"
  | "fight"
  | "land"
  | "dash"
  | "fall"
  | "throw"
  | "launch"
  | "shock"
  | "burn"
  | "trap"
  | "pop"
  | "tech"
  | "just"
  | "counter"
  | "pause"
  | "swap"
  | "slam"
  /** 철곰권 기를 다 모음 · 가드 부숨 (이반) */
  | "charged"
  | "crush"
  /** 일섬 낙인 (제나) · 낙인이 터짐 · 일섬이 지나간 선 (x = 시작, v = 끝 x) */
  | "zapMark"
  | "zapBurst"
  | "bsod"
  | "zapLine"
  | "stun"
  | "immune"
  /** 포르테: 태엽 되감기 (p = 되감긴 쪽) · 돌아온 팽이 받음 · 앙코르 시작 */
  | "rewind"
  | "catch"
  | "encore"
  /** 시간 정지 (포르테 되감기 낙하) — v = 프레임 */
  | "timeStop";
export interface Ev {
  k: EvKind;
  /** 관련 플레이어 (hit/block은 때린 쪽) */
  p: number;
  x: number;
  h: number;
  /** 피해량 등 */
  v: number;
  m?: MoveId;
}

export interface State {
  f: number;
  phase: Phase;
  /** 페이즈 안에서 흐른 프레임 */
  pt: number;
  round: number;
  wins: [number, number];
  /** 남은 프레임 */
  timer: number;
  /** MAPS 인덱스 */
  map: number;
  p: [Fighter, Fighter];
  proj: Proj[];
  /** 히트스톱 (판 전체 멈춤) */
  stop: number;
  /** 초필살 연출 멈춤 */
  freeze: number;
  freezeBy: number;
  /** 이번 프레임에 생긴 일 (소리·이펙트용, 다음 step에서 비워짐) */
  ev: Ev[];
  /** 라운드 승자 0/1, 무승부 2, 진행중 -1 */
  roundWinner: number;
  /** 경기 승자 0/1, 무승부 2, 진행중 -1 */
  winner: number;
}

const charOf = (f: Fighter): CharDef => CHARS[f.ch];
const isFinisher = (f: Fighter) => !!f.mv && !!CHAIN_MAX[f.mv] && f.chain >= CHAIN_MAX[f.mv]!;
const finishRec = (f: Fighter) => (isFinisher(f) ? (FINISH_REC[f.mv as MoveId] ?? 0) : 0);
/** 지금 기술의 정의 (공중에서 시작했고 공중 버전이 있으면 그걸로) */
const moveOf = (f: Fighter): MoveDef | null => {
  if (!f.mv) return null;
  const m = charOf(f).moves[f.mv];
  if (f.mv === "T" && f.lg) return { ...m, ...DASH_GRAB };
  if (f.aerial && m.air) {
    const am = { ...m, ...m.air };
    // 급강하(카이 공중 질풍권)가 땅에 닿기 전 공중에서 맞히면 더 아픔
    return f.dive && am.rush?.airDmg ? { ...am, dmg: am.rush.airDmg } : am;
  }
  // 차지 기술: 모은 만큼 피해·경직·밀어내기가 커지고, 끝까지 모으면 가드 불가 + 다운
  if (m.charge && f.chg > 0) {
    const c = m.charge;
    const k = Math.min(f.chg, c.max);
    const full = k >= c.max;
    return {
      ...m,
      dmg: m.dmg + Math.trunc(((c.dmg - m.dmg) * k) / c.max),
      hitstun: m.hitstun + Math.trunc((14 * k) / c.max),
      push: m.push + Math.trunc((1200 * k) / c.max),
      hitstop: m.hitstop + Math.trunc((8 * k) / c.max),
      kd: full || m.kd,
      crush: full,
    };
  }
  return m;
};
const totalOf = (m: MoveDef) => m.startup + m.active + m.recovery;
const mapOf = (s: State): MapDef => MAPS[s.map] ?? MAPS[0];

const inX = (p: Plat, x: number) => x >= p.x0 * SUB && x <= p.x1 * SUB;

/** x에서 높이 h 이하로 가장 가까운 발판 (없으면 null) — 그림자·AI용 */
export function platBelow(map: MapDef, x: number, h: number): Plat | null {
  let best: Plat | null = null;
  for (const p of map.plats) {
    if (inX(p, x) && p.y * SUB <= h && (!best || p.y > best.y)) best = p;
  }
  return best;
}

/** 지금 딛고 선 발판 */
function standingOn(map: MapDef, f: Fighter): Plat | null {
  if (f.vh > 0) return null;
  for (const p of map.plats) if (inX(p, f.x) && p.y * SUB === f.h) return p;
  return null;
}

/** 화면에서 발 위치(px) */
export const screenX = (x: number) => x / SUB;
export const screenY = (h: number) => VIEW_H - h / SUB;

/** 시작 자리: 그 x의 가장 높은 바닥(solid) 위, 없으면 가장 높은 발판 */
function spawnAt(map: MapDef, xpx: number) {
  const x = xpx * SUB;
  let p: Plat | null = null;
  for (const q of map.plats) if (q.solid && inX(q, x) && (!p || q.y > p.y)) p = q;
  p ??= platBelow(map, x, VIEW_H * SUB);
  return { x, h: p ? p.y * SUB : 0 };
}

function newFighter(ch: number, side: 0 | 1, map: MapDef): Fighter {
  const { x, h } = spawnAt(map, map.spawn[side]);
  return {
    ch,
    x,
    h,
    vx: 0,
    vh: 0,
    face: side === 0 ? 1 : -1,
    hp: CHARS[ch].hp,
    meter: 0,
    st: "idle",
    t: 0,
    mv: "",
    hit: 0,
    stun: 0,
    combo: 0,
    kd: 0,
    airUsed: 0,
    airK: 0,
    airS: 0,
    lg: 0,
    dashT: 0,
    airDash: 0,
    dive: 0,
    cd: 0,
    chain: 0,
    guardT: 255,
    grabbed: 0,
    grabDmg: 0,
    otg: 0,
    fell: 0,
    jumps: 0,
    gcT: 0,
    mnerf: 0,
    float: 0,
    floatT: 0,
    juggle: 0,
    mark: 0,
    shock: 0,
    burn: 0,
    burnN: 0,
    burnAcc: 0,
    zap: 0,
    zx: 0,
    frz: 0,
    bsodd: 0,
    flT: -1,
    flB: -999,
    aerial: 0,
    spiked: 0,
    dk: 0,
    mixM: 0,
    mixN: 0,
    pullT: 0,
    pullX: 0,
    pulled: 0,
    trapT: 0,
    hold: 0,
    chg: 0,
    hug: 0,
    hugd: 0,
    cc: 0,
    imm: 0,
    recov: 0,
    inv: 0,
    hist: new Array(HIST).fill(0),
    rwX: x,
    rwH: h,
    tsT: 0,
    enc: [],
    encT: 0,
    encQ: [],
    encX: 0,
    encH: 0,
  };
}

export function newMatch(chars: [number, number], map = 0): State {
  const m = MAPS[map] ?? MAPS[0];
  return {
    f: 0,
    phase: "intro",
    pt: 0,
    round: 1,
    wins: [0, 0],
    timer: ROUND_SEC * 60,
    map: MAPS[map] ? map : 0,
    p: [newFighter(chars[0], 0, m), newFighter(chars[1], 1, m)],
    proj: [],
    stop: 0,
    freeze: 0,
    freezeBy: -1,
    ev: [{ k: "round", p: -1, x: 0, h: 0, v: 1 }],
    roundWinner: -1,
    winner: -1,
  };
}

function nextRound(s: State) {
  const meters = [s.p[0].meter, s.p[1].meter];
  const m = mapOf(s);
  s.p = [newFighter(s.p[0].ch, 0, m), newFighter(s.p[1].ch, 1, m)];
  // 게이지는 라운드를 넘어 유지
  s.p[0].meter = meters[0];
  s.p[1].meter = meters[1];
  s.round++;
  s.phase = "intro";
  s.pt = 0;
  s.timer = ROUND_SEC * 60;
  s.proj = [];
  s.roundWinner = -1;
  s.ev.push({ k: "round", p: -1, x: 0, h: 0, v: s.round });
}

/** 상태 통째 복사 (롤백 저장용) */
export function clone(s: State): State {
  return {
    ...s,
    wins: [s.wins[0], s.wins[1]],
    p: [cloneF(s.p[0]), cloneF(s.p[1])],
    proj: s.proj.map((p) => ({ ...p })),
    ev: s.ev.slice(),
  };
}
const cloneF = (f: Fighter): Fighter => ({ ...f, hist: f.hist.slice(), enc: f.enc.slice(), encQ: f.encQ.slice() });

/**
 * 이 빌드의 게임 데이터 지문 (캐릭터 성능·맵) — 온라인에서 서로 다른 빌드끼리 붙었는지 확인.
 * 계산 방식(sim.ts)만 바꿨을 땐 SIM_REV를 올릴 것.
 */
const SIM_REV = 35;
export const BUILD_ID = (() => {
  const str = SIM_REV + JSON.stringify(CHARS.map((c) => [c.hp, c.walk, c.jumpVx, c.dash, c.cd, c.glide, c.hurt, c.width, c.moves])) + JSON.stringify(MAPS.map((m) => [m.plats, m.spawn]));
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
})();

/** 동기화 확인용 해시 (온라인에서 양쪽 상태가 같은지 비교) */
export function hash(s: State): number {
  let h = 2166136261;
  const mix = (n: number) => {
    h = Math.imul(h ^ (n | 0), 16777619);
  };
  mix(s.f);
  mix(s.pt);
  mix(s.round);
  mix(s.timer);
  mix(s.stop);
  mix(s.freeze);
  mix(s.map);
  mix(s.wins[0]);
  mix(s.wins[1]);
  for (const f of s.p) {
    mix(f.x);
    mix(f.h);
    mix(f.vx);
    mix(f.vh);
    mix(f.face);
    mix(f.hp);
    mix(f.meter);
    mix(f.t);
    mix(f.stun);
    mix(f.combo);
    mix(f.encT);
    mix(f.tsT);
    mix(f.enc.length);
    mix(f.jumps);
    mix(f.dashT);
    mix(f.dive);
    mix(f.cd);
    mix(f.chain);
    mix(f.guardT);
    mix(f.grabbed);
    mix(f.grabDmg);
    mix(f.otg);
    mix(f.fell);
    mix(f.hit);
    mix(f.kd);
    mix(f.airDash);
    mix(f.airUsed);
    mix(f.airK);
    mix(f.airS);
    mix(f.lg);
    mix(f.gcT);
    mix(f.float);
    mix(f.floatT);
    mix(f.juggle);
    mix(f.mark);
    mix(f.shock);
    mix(f.burn);
    mix(f.burnN);
    mix(f.burnAcc);
    mix(f.zap);
    mix(f.zx);
    mix(f.frz);
    mix(f.bsodd);
    mix(f.flT);
    mix(f.flB);
    mix(f.aerial);
    mix(f.spiked);
    mix(f.dk);
    mix(f.mixM);
    mix(f.mixN);
    mix(f.pullT);
    mix(f.pullX);
    mix(f.pulled);
    mix(f.trapT);
    mix(f.hold);
    mix(f.chg);
    mix(f.hug);
    mix(f.hugd);
    mix(f.cc);
    mix(f.imm);
    mix(f.recov);
    mix(f.inv);
    mix(f.st.length * 31 + f.st.charCodeAt(0));
    mix(f.mv ? f.mv.charCodeAt(0) : 0);
  }
  for (const p of s.proj) {
    mix(p.o);
    mix(p.k);
    mix(p.mv);
    mix(p.n);
    mix(p.t);
    mix(p.x);
    mix(p.h);
    mix(p.vh);
    mix(p.life);
  }
  return h >>> 0;
}

// ───────────── 입력 해석 ─────────────
const cur = (f: Fighter) => f.hist[HIST - 1];

/** 최근 n프레임 안에 이 버튼을 새로 눌렀나 (선입력 버퍼) */
function pressed(f: Fighter, bits: number, n = 1) {
  for (let k = 0; k < n; k++) {
    const c = f.hist[HIST - 1 - k];
    const p = f.hist[HIST - 2 - k];
    if (c & bits & ~p) return true;
  }
  return false;
}

const holding = (f: Fighter, bit: number) => (cur(f) & bit) !== 0;

/** 같은 방향 두 번 톡톡 (←← / →→) */
function doubleTap(f: Fighter, bit: number) {
  if (!pressed(f, bit, 1)) return false;
  for (let k = 3; k < 14; k++) {
    const c = f.hist[HIST - 1 - k];
    const p = f.hist[HIST - 2 - k];
    if (c & bit & ~p) return true;
  }
  return false;
}
const JUMP_BITS = IN.J | IN.U;

// ───────────── 판정 ─────────────
/** 가로(l~r)·높이(lo~hi) 범위 (SUB) */
export interface Rect {
  l: number;
  r: number;
  lo: number;
  hi: number;
}

/** 박스(px, 오른쪽 기준)를 월드 좌표(SUB)로 */
export function boxRect(f: Fighter, b: Box): Rect {
  const l = f.face > 0 ? f.x + b.x * SUB : f.x - (b.x + b.w) * SUB;
  return { l, r: l + b.w * SUB, lo: f.h + (b.y - b.h) * SUB, hi: f.h + b.y * SUB };
}
const overlap = (a: Rect, b: Rect) => a.l < b.r && b.l < a.r && a.lo < b.hi && b.lo < a.hi;

/** 누워 있을 때 맞는 범위 (낮고 넓게) */
const DOWN_HURT: Box = { x: -28, y: 36, w: 56, h: 36 };

export function hurtRect(f: Fighter): Rect | null {
  if (f.st === "rise" || f.st === "ko" || f.inv > 0 || invincible(f)) return null;
  if (f.st === "down") return boxRect(f, DOWN_HURT);
  return boxRect(f, charOf(f).hurt);
}

/** 지금 판정이 살아 있는 공격 박스 */
export function hitRect(f: Fighter): Rect | null {
  const m = moveOf(f);
  if (f.st !== "atk" || !m || m.proj || m.summon || f.hit) return null;
  if (f.t < m.startup || f.t >= m.startup + m.active) return null;
  return boxRect(f, m.box);
}

/** 가드 반격 시작 동안 무적 */
const invincible = (f: Fighter) => f.st === "atk" && f.mv === "G" && f.t < charOf(f).moves.G.startup + 2;

/** 날아가는 탄의 정의 (아이덴티티 또는 필살기) */
export function projDef(p: Proj, s: State) {
  return CHARS[s.p[p.o].ch].moves[p.mv ? "X" : "S"].proj!;
}

export function projRect(p: Proj, s: State): Rect {
  if (p.k === 2) {
    // 불 장판: 발판 위 얇은 띠
    const fl = CHARS[s.p[p.o].ch].moves.X.summon!.floor!;
    return { l: p.x - (fl.w * SUB) / 2, r: p.x + (fl.w * SUB) / 2, lo: p.h - 4 * SUB, hi: p.h + 14 * SUB };
  }
  if (p.k === 1) {
    // 불기둥: 발판에서 위로
    const d = CHARS[s.p[p.o].ch].moves.X.summon!;
    return { l: p.x - (d.w * SUB) / 2, r: p.x + (d.w * SUB) / 2, lo: p.h, hi: p.h + d.h * SUB };
  }
  const d = projDef(p, s);
  return {
    l: p.x - (d.w * SUB) / 2,
    r: p.x + (d.w * SUB) / 2,
    lo: p.h - (d.h * SUB) / 2,
    hi: p.h + (d.h * SUB) / 2,
  };
}

// ───────────── 진행 ─────────────
const onGround = (s: State, f: Fighter) => standingOn(mapOf(s), f) !== null;
const airborneS = (s: State, f: Fighter) => !onGround(s, f);

/** 게이지 얻기 — 건모 Alt+F4 를 쓴 뒤 3초 동안은 30% 덜 (mnerf) */
function gainMeter(f: Fighter, n: number) {
  if (f.mnerf > 0) n = Math.trunc((n * 7) / 10);
  f.meter = Math.min(METER_MAX, f.meter + n);
}

function startMove(s: State, i: number, id: MoveId) {
  const f = s.p[i];
  // 같은 기술을 이어 누르면 다음 동작 (약 4단 · 발차기 2단)
  f.chain = f.st === "atk" && f.mv === id && CHAIN_MAX[id] ? f.chain + 1 : 1;
  // 대시 중에 낸 잡기 = 돌진 잡기 (게이지가 있을 때만, 없으면 그 자리 보통 잡기)
  // 대시에서 약·발차기를 먼저 냈으면 lg = 2로 표시해 두고, 곧바로 나머지 버튼이 오면 돌진 잡기로 바꿈 (control의 atk)
  const fromDash = f.st === "dash" || f.dashT < 0;
  const canGrab = (fromDash || (f.st === "atk" && f.lg === 2)) && f.meter >= DASH_GRAB_COST;
  f.lg = id === "T" && canGrab ? 1 : (id === "L" || id === "H") && fromDash && f.meter >= DASH_GRAB_COST ? 2 : 0;
  if (f.lg === 1) f.meter -= DASH_GRAB_COST;
  // 무적(다시 내려온 뒤)은 공격하면 끝
  f.inv = 0;
  f.st = "atk";
  f.mv = id;
  f.t = 0;
  f.hit = 0;
  f.aerial = airborneS(s, f) ? 1 : 0;
  const m = moveOf(f)!;
  if (f.aerial && m.hover) f.vh = Math.max(f.vh, m.hover);
  if (f.aerial && m.rwDive) ((f.rwX = f.x), (f.rwH = f.h));
  if (id === "S") f.cd = m.cd ?? charOf(f).cd; // (공중 버전만 재사용 대기가 다를 수 있음)
  f.chg = 0;
  if (id === "G") f.meter = Math.max(0, f.meter - GUARD_COUNTER_COST);
  if (id === "X" && m.mnerf) f.mnerf = m.mnerf;
  if (id === "T" || id === "G") f.vx = 0;
  f.dk = 0;
  if (airborneS(s, f)) {
    // 내려찍기(↓ + K)는 발차기 횟수와 따로, 점프마다 1번
    if (id === "K" && holding(f, IN.D) && f.airS === 0) ((f.dk = 1), (f.airS = 1));
    // 점프마다 공중 약 4번 + 발차기 2번 (2단 점프하면 다시 채워짐)
    else if (id === "J") f.airUsed++;
    else if (id === "K") f.airK++;
    f.dashT = 0;
    if (m.lunge) {
      f.vx = f.face * m.lunge;
      f.vh = Math.max(f.vh, 300);
    }
    // 건모 공중 Alt+Tab+F4: 판정 끝날 때까지 그 자리에 떠 있음
    if (m.bsod) ((f.vh = Math.min(f.vh, 0)), (f.vx = 0), (f.hold = m.startup + m.active));
  } else {
    // 대시 남은 프레임은 여기서 끝 (안 지우면 나중에 점프했을 때 공중 조작이 잠깐 안 먹음)
    f.dashT = 0;
    if (id === "S" || id === "X") f.vx = 0;
  }
  // 땅에서 약·강은 걷거나 대시하던 속도를 이어 감
  if (id === "X") {
    f.meter = 0;
    s.freeze = SUPER_FREEZE;
    s.freezeBy = i;
    s.ev.push({ k: "super", p: i, x: f.x, h: f.h, v: 0 });
  }
}


/** 공격·필살·초필살 시작을 시도 (서 있을 때와 캔슬 때 공통) */
function tryAttack(s: State, i: number, allow: MoveId[]): boolean {
  const f = s.p[i];
  const superIn =
    pressed(f, IN.X, 3) ||
    ((cur(f) & (IN.B | IN.C)) === (IN.B | IN.C) && pressed(f, IN.B | IN.C, 3));
  if (allow.includes("X") && f.meter >= METER_MAX && superIn) {
    startMove(s, i, "X");
    return true;
  }
  // 잡기: 약+발차기 동시 (땅에서만)
  // (캔슬로 이을 땐 조금 어긋나게 눌러도 인정: 최근 4프레임 안에 약·발차기를 둘 다 눌렀으면 —
  //  히트스톱 동안은 입력 기록이 안 밀리니 그때 누른 것도 여기 들어옴)
  // 대시 중·대시 직후(게이지 있을 때)엔 약·발차기를 3프레임 안에만 누르면 돌진 잡기 — 동시에 안 눌러도 됨
  const canceling = f.st === "atk" && !!f.hit;
  const dashing = (f.st === "dash" || f.dashT < 0) && f.meter >= DASH_GRAB_COST && !canceling;
  const throwIn = canceling
    ? pressed(f, IN.A, 4) && pressed(f, IN.B, 4)
    : dashing
      ? pressed(f, IN.A, 6) && pressed(f, IN.B, 6)
      : (cur(f) & (IN.A | IN.B)) === (IN.A | IN.B) && pressed(f, IN.A | IN.B, 2);
  if (allow.includes("T") && throwIn) {
    startMove(s, i, "T");
    return true;
  }
  // (대시 중 약·발차기 하나만 누르면 기다리지 않고 바로 나감 — 곧바로 나머지를 누르면 control의 atk에서 돌진 잡기로 바뀜)
  const late = 3;
  // 이반 철곰권: 착지 직전에 누른 L(공중 곰 포옹 대신 미리 누른 것)도 착지하자마자 나가게 — 착지 뒤 몇 프레임은 입력을 길게 봐 줌
  const sBuf = charOf(f).moves.S.charge && f.st === "idle" && f.t < 6 ? LAND_S_BUF : 3;
  if (allow.includes("S") && f.cd === 0 && pressed(f, IN.C, sBuf)) {
    startMove(s, i, "S");
    return true;
  }
  if (allow.includes("H") && pressed(f, IN.B, late)) {
    startMove(s, i, "H");
    return true;
  }
  if (allow.includes("L") && pressed(f, IN.A, late)) {
    startMove(s, i, "L");
    return true;
  }
  return false;
}

function jump(s: State, i: number, v: number) {
  const f = s.p[i];
  const c = charOf(f);
  f.st = "jump";
  f.t = 0;
  f.airUsed = 0;
  f.airK = 0;
  f.airS = 0;
  f.juggle = 0;
  // 공중에서 버티기(건모 Alt+Tab 뒤)는 점프하면 끝
  f.hold = 0;
  f.jumps++;
  f.vh = v;
  f.vx = holding(f, IN.R) ? spd(f, c.jumpVx) : holding(f, IN.L) ? -spd(f, c.jumpVx) : Math.trunc(f.vx / 2);
  if (holding(f, IN.R)) f.face = 1;
  else if (holding(f, IN.L)) f.face = -1;
  s.ev.push({ k: "jump", p: i, x: f.x, h: f.h, v: f.jumps });
}

/** 공중 좌우 조작 */
function airSteer(f: Fighter) {
  const max = charOf(f).jumpVx;
  if (holding(f, IN.R)) f.vx = Math.min(max, f.vx + AIR_ACC);
  else if (holding(f, IN.L)) f.vx = Math.max(-max, f.vx - AIR_ACC);
}

/** 공중 공격: 약 → J, 강 → K, 필살·초필살 */
function airAttack(s: State, i: number): boolean {
  const f = s.p[i];
  const turn = () => {
    if (holding(f, IN.R)) f.face = 1;
    else if (holding(f, IN.L)) f.face = -1;
  };
  if (f.meter >= METER_MAX && pressed(f, IN.X, 3)) {
    startMove(s, i, "X");
    return true;
  }
  // 이반: 떨어지다 바닥에 거의 닿았으면 곰 포옹 대신 착지해서 철곰권 (위 tryAttack 의 LAND_S_BUF)
  const nearLand = (() => {
    const am = charOf(f).moves.S;
    if (!am.charge || !am.air?.hug || f.vh >= 0) return false;
    const pl = platBelow(mapOf(s), f.x, f.h);
    return !!pl && f.h - pl.y * SUB < LAND_S_H * SUB;
  })();
  if (f.cd === 0 && pressed(f, IN.C, 3) && !nearLand) {
    turn();
    startMove(s, i, "S");
    return true;
  }
  if ((f.airK < AIR_K_MAX || (holding(f, IN.D) && f.airS === 0)) && pressed(f, IN.B, 3)) {
    turn();
    startMove(s, i, "K");
    return true;
  }
  if (f.airUsed < AIR_J_MAX && pressed(f, IN.A, 3)) {
    turn();
    startMove(s, i, "J");
    return true;
  }
  return false;
}

/** 감전 중이면 이동이 느림 (%) */
const spd = (f: Fighter, v: number) => (f.shock > 0 ? Math.trunc((v * 85) / 100) : v);

/** 좌우 중 하나만 누르고 있으면 그쪽을 봄 */
function steerFace(f: Fighter) {
  if (holding(f, IN.R) && !holding(f, IN.L)) f.face = 1;
  else if (holding(f, IN.L) && !holding(f, IN.R)) f.face = -1;
}

/** 가드 반격: 공격을 막은 동안·직후(gcT)에 발차기 + 게이지 25 (막는 경직·히트스톱 중 미리 눌러도 됨) */
function guardCounter(s: State, i: number): boolean {
  const f = s.p[i];
  if (f.gcT <= 0 || f.meter < GUARD_COUNTER_COST || !pressed(f, IN.B, 8)) return false;
  const o = s.p[1 - i];
  f.face = o.x >= f.x ? 1 : -1;
  f.gcT = 0;
  startMove(s, i, "G");
  return true;
}

function control(s: State, i: number) {
  const f = s.p[i];
  const c = charOf(f);
  const map = mapOf(s);
  f.t++;
  if (f.gcT > 0) f.gcT--;
  if (f.mnerf > 0) f.mnerf--;
  if (f.st !== "hit") ((f.mark = 0), (f.frz = 0), (f.tsT = 0));
  if (f.st !== "hit" && f.st !== "down") f.bsodd = 0;
  else if (f.frz > 0) {
    // 공중에서 맞으면 멈춘 채로 떨어지고, 땅에 닿은 뒤부터 1.5초가 줄어듦
    if (!airborneS(s, f)) f.frz--;
    f.stun = Math.max(f.stun, f.frz);
  }
  // 상태 이상이 다 풀리면(다시 움직일 수 있게 되면) 2초 면역
  if (f.imm > 0) f.imm--;
  if (f.cc && f.st !== "hit" && f.st !== "down" && f.st !== "rise" && f.trapT === 0 && f.grabbed === 0 && !s.p[1 - i].hug) {
    f.cc = 0;
    f.imm = STATUS_IMM;
  }
  switch (f.st) {
    case "idle":
    case "walk": {
      // 대시 끝난 직후 (음수 = 지난 프레임 수)
      if (f.dashT < 0) f.dashT = f.dashT <= -DASH_GRAB_GRACE ? 0 : f.dashT - 1;
      if (guardCounter(s, i)) return;
      if (tryAttack(s, i, ["X", "T", "S", "H", "L"])) return;
      if (doubleTap(f, IN.R) || doubleTap(f, IN.L)) {
        f.face = doubleTap(f, IN.R) ? 1 : -1;
        f.st = "dash";
        f.t = 0;
        f.dashT = DASH_T;
        f.vx = f.face * spd(f, c.dash);
        s.ev.push({ k: "dash", p: i, x: f.x, h: f.h, v: 0 });
        return;
      }
      if (pressed(f, JUMP_BITS, 3)) {
        jump(s, i, JUMP_V);
        return;
      }
      if (holding(f, IN.D)) {
        steerFace(f);
        f.st = "block";
        f.t = 0;
        f.stun = 0;
        f.vx = 0;
        f.guardT = 0;
        return;
      }
      if (holding(f, IN.R)) f.face = 1;
      else if (holding(f, IN.L)) f.face = -1;
      const moving = holding(f, IN.L) !== holding(f, IN.R);
      const st: FState = moving ? "walk" : "idle";
      if (st !== f.st) {
        f.st = st;
        f.t = 0;
      }
      f.vx = moving ? spd(f, c.walk) * f.face : 0;
      return;
    }
    case "dash":
      f.dashT--;
      if (tryAttack(s, i, ["X", "T", "S", "H", "L"])) return;
      if (holding(f, f.face > 0 ? IN.L : IN.R) && !holding(f, f.face > 0 ? IN.R : IN.L)) {
        // 반대쪽을 누르면 바로 돌아서 멈춤 (방향키 우선)
        f.face = f.face > 0 ? -1 : 1;
        f.vx = 0;
        f.dashT = 0;
        f.st = "idle";
        f.t = 0;
        return;
      }
      if (pressed(f, JUMP_BITS, 3)) {
        const keep = f.vx;
        jump(s, i, JUMP_V);
        f.vx = Math.trunc((keep * 8) / 10);
        return;
      }
      if (f.dashT <= 0) {
        f.st = "idle";
        f.t = 0;
        f.dashT = -1;
      }
      return;
    case "jump":
      if (f.dashT > 0) f.dashT--;
      // 뜬 직후 5프레임은 2단 점프가 안 나가지만, 그 사이에 누른 건 기억해 뒀다가 바로 (뜨게 만든 그 입력은 빼고)
      if (f.jumps < 2 && f.t > 4 && pressed(f, JUMP_BITS, Math.min(f.t, 6))) {
        jump(s, i, JUMP2_V);
        return;
      }
      if (!f.airDash && (doubleTap(f, IN.R) || doubleTap(f, IN.L))) {
        f.face = doubleTap(f, IN.R) ? 1 : -1;
        f.airDash = 1;
        f.dashT = DASH_T - 2;
        f.vx = Math.trunc((f.face * c.dash * 85) / 100);
        f.vh = Math.max(f.vh, 120);
        s.ev.push({ k: "dash", p: i, x: f.x, h: f.h, v: 1 });
        return;
      }
      if (airAttack(s, i)) return;
      // 공중에서도 누르는 쪽을 봄
      if (holding(f, IN.R) && !holding(f, IN.L)) f.face = 1;
      else if (holding(f, IN.L) && !holding(f, IN.R)) f.face = -1;
      if (f.dashT <= 0) airSteer(f);
      return;
    case "atk": {
      const m = moveOf(f)!;
      const air = airborneS(s, f);
      // 급강하: 어느 높이에서 써도 바닥에 닿을 때까지 내리꽂음 (높은 데서 쓰면 기술이 공중에서 끝나 충격파가 안 나가던 것 10.10)
      if (f.dive && air && m.rush && m.rush.airVh < 0 && f.t >= m.startup + m.active - 1) f.t = m.startup + m.active - 1;
      // 곰 포옹으로 안고 떨어지는 중: 착지할 때까지 그 자세 그대로
      if (f.hug) {
        f.t = m.startup + m.active;
        return;
      }
      // 차지 기술: 시작 자세(at)에서 버튼을 누르고 있는 동안 멈춰서 기를 모음 — 떼거나 다 모으면 바로 이어 나감
      if (m.charge && !air && f.t === m.charge.at + 1 && f.chg < m.charge.max && holding(f, IN.C)) {
        f.t = m.charge.at;
        f.chg++;
        if (f.chg === m.charge.max) s.ev.push({ k: "charged", p: i, x: f.x, h: f.h + 40 * SUB, v: 0 });
        return;
      }
      // 잡기 입력 너그럽게: 약(또는 발차기)을 먼저 눌러 시작 중이어도 몇 프레임 안에 나머지를 누르면 잡기
      if (!air && (f.mv === "L" || f.mv === "H") && f.chain === 1 && f.t <= 3 &&
          (cur(f) & (IN.A | IN.B)) === (IN.A | IN.B) && pressed(f, f.mv === "L" ? IN.B : IN.A, 2)) {
        startMove(s, i, "T");
        return;
      }
      // 대시에서 낸 약·발차기: 4프레임 안에 나머지 버튼이 오면 돌진 잡기 (동시에 안 눌러도 됨)
      if (!air && f.lg === 2 && f.chain === 1 && f.t <= 4 && !f.hit && f.meter >= DASH_GRAB_COST &&
          pressed(f, f.mv === "L" ? IN.B : IN.A, 2)) {
        startMove(s, i, "T");
        return;
      }
      // 점프 우선: 약·발차기 중에도 점프를 누르면 바로 뜀 (땅 → 점프, 공중 → 2단 점프)
      // (아이덴티티·필살기·잡기·가드 반격은 끊지 않고, 끝나자마자 뜀 — 아래 끝 처리)
      if (pressed(f, JUMP_BITS, 2)) {
        if (!air && (f.mv === "L" || f.mv === "H")) {
          f.mv = "";
          jump(s, i, JUMP_V);
          return;
        }
        if (air && (f.mv === "J" || f.mv === "K") && f.jumps < 2) {
          f.mv = "";
          jump(s, i, JUMP2_V);
          return;
        }
      }
      // 방향키 우선: 기술 중에도 누르는 쪽으로 돎 (돌진기는 돌진 시작 전까지만, 필살기는 쓴 순간 본 쪽 그대로)
      if (f.mv !== "T" && f.mv !== "G" && f.mv !== "X" && (!(m.rush || m.lunge) || f.t < m.startup)) steerFace(f);
      if (air) {
        if ((!m.lunge && !m.rush) || f.t > m.startup + m.active) airSteer(f);
      } else if ((f.mv === "L" || f.mv === "H") && f.vx * f.face < c.walk) {
        // 걸으면서 때림: 보는 쪽을 누르고 있으면 걷는 속도의 70%로 계속 나감
        const fwd = f.face > 0 ? IN.R : IN.L;
        if (holding(f, fwd)) f.vx = Math.trunc((c.walk * 7) / 10) * f.face;
      }
      // 일섬이 지나간 선 (그림용): 시작 자리 기억 → 끝날 때 선
      if (m.zap && f.t === m.startup) f.zx = f.x;
      if (m.zap && f.t === m.startup + m.active) {
        f.vx = 0;
        s.ev.push({ k: "zapLine", p: i, x: f.zx, h: f.h + 40 * SUB, v: f.x });
      }
      if (m.rush && f.t === m.startup) {
        // 돌진: 땅에선 앞으로, 공중에선 앞쪽 아래로 내리꽂음
        f.vx = f.face * m.rush.vx;
        if (air) {
          f.vh = m.rush.airVh;
          if (m.rush.airVx !== undefined) f.vx = f.face * m.rush.airVx;
          f.dive = 1;
        }
        s.ev.push({ k: "dash", p: i, x: f.x, h: f.h, v: 2 });
      }
      if (m.summon && f.t === m.startup) {
        // 상대 발밑(또는 그 아래 발판)에 불기둥 — front면 내 앞 넓은 범위
        const o = s.p[1 - i];
        const sx = m.summon.front ? f.x + f.face * m.summon.front * SUB : o.x;
        const under = platBelow(map, sx, m.summon.front ? f.h : o.h);
        const sh = under ? under.y * SUB : m.summon.front ? f.h : o.h;
        s.proj.push({ k: 1, mv: 1, n: 0, t: 0, o: i, x: sx, h: sh, vx: 0, vh: 0, life: m.summon.delay + m.summon.life });
      }
      // 돌진 잡기: 잡을 때까지 앞으로 파고듦
      if (f.mv === "T" && f.lg && f.t < m.startup + m.active) f.vx = f.face * DASH_GRAB_V;
      // 연타 돌진기 · 일섬 · 공중 뇌격돌은 판정 동안 계속 나아감 (공중 뇌격돌은 맞히면 멈춤 — applyHit)
      if ((m.multi || m.zap) && m.rush && f.t >= m.startup && f.t < m.startup + m.active) f.vx = f.face * m.rush.vx;
      // 공중 뇌격돌: 돌진이 끝나면 확 느려짐 (끝없이 날아가지 않게)
      if (m.rush && m.rush.airVh === 0 && !m.zap && !m.multi && air && f.t === m.startup + m.active) f.vx = Math.trunc(f.vx / 5);
      // 공중 뇌격돌을 맞혔으면: 상대 바로 앞(ZAP_AIR_GAP)까지 마저 파고든 뒤 멈춤 — 판정 끝(약 90px)에서 맞으면 너무 멀어 후속타가 안 닿던 것 (10.12)
      if (airRushHit(f, m) && air) {
        const gap = Math.abs(s.p[1 - i].x - f.x) - ZAP_AIR_GAP * SUB;
        f.vx = gap > 0 ? f.face * Math.min(m.rush!.vx, gap) : 0;
      }
      // 연타기: 일정 프레임마다 다시 맞을 수 있게
      if (m.multi && f.t > m.startup && (f.t - m.startup) % m.multi === 0) f.hit = 0;
      if (m.proj && f.t === m.startup) {
        const d = m.proj;
        // 공중에서 쏘면 앞쪽 아래로 비스듬히 내리꽂음 (flat 탄은 수평)
        const dive = air && !d.flat;
        s.proj.push({
          k: 0,
          mv: f.mv === "X" ? 1 : 0,
          n: d.hits ?? 1,
          t: 0,
          o: i,
          // 여러 번 맞는 파도(릴리 장마 파도)는 몸에서부터 — 딱 붙은 상대도 맞게 (10.12)
          x: f.x + f.face * (d.hits && d.hits > 1 ? 4 : 24) * SUB,
          h: f.h + d.y * SUB,
          vx: f.face * (dive ? Math.trunc((d.speed * 3) / 4) : d.speed),
          vh: dive ? -Math.trunc((d.speed * 3) / 5) : 0,
          life: d.life,
          ...(d.boomer ? { d: f.face, hb: 0 } : {}),
        });
        s.ev.push({ k: "proj", p: i, x: f.x, h: f.h, v: 0 });
      }
      // 띄운 뒤 점프 캔슬: 잡기·약 4단 마무리를 맞힌 뒤엔 바로 뛰어올라 공중 콤보
      if (
        f.hit &&
        !air &&
        (f.mv === "T" || f.mv === "G" || (f.mv === "L" && isFinisher(f) && m.launcher) || (f.mv === "S" && m.launch)) &&
        f.t >= m.startup + 2 &&
        pressed(f, JUMP_BITS, 10)
      ) {
        f.mv = "";
        jump(s, i, JUMP_V);
        return;
      }
      // 공중 끌어올리기가 맞으면: 판정 끝난 뒤 바로 점프·공중 약·발차기로 이어감 (공중 콤보)
      // (제나 공중 뇌격돌도: 맞히면 남은 돌진·빈틈 없이 바로)
      if (f.hit && f.aerial && ((m.pullUp && f.t >= m.startup + m.active - 2) || airRushHit(f, m))) {
        if (f.jumps < 2 && pressed(f, JUMP_BITS, 10)) {
          f.mv = "";
          jump(s, i, JUMP2_V);
          return;
        }
        const nb = pressed(f, IN.B, 10) ? "K" : pressed(f, IN.A, 10) ? "J" : null;
        if (nb) {
          if (holding(f, IN.R)) f.face = 1;
          else if (holding(f, IN.L)) f.face = -1;
          startMove(s, i, nb);
          return;
        }
      }
      // 공중 연속 공격: 공중 약·발차기를 맞히면 짧은 창 안에 다음 공중 약·발차기로 이어 침 (약 4 + 발차기 2까지)
      if (air && f.hit && (f.mv === "J" || f.mv === "K") && f.t > m.startup && f.t <= m.startup + m.active + AIR_CHAIN_WIN) {
        if (airAttack(s, i)) return;
      }
      // 약·발차기 연속 동작: 판정이 나온 뒤부터 끝날 때까지 같은 버튼으로 다음 동작 (헛쳐도 됨)
      const cm = CHAIN_MAX[f.mv as MoveId];
      if (cm && f.chain < cm && f.t >= m.startup + (f.hit ? 1 : m.active) && onGround(s, f)) {
        if (tryAttack(s, i, [f.mv as MoveId])) return;
      }
      // 맞히거나 막힌 뒤 짧은 동안 다음 기술로 캔슬 (마지막 동작 뒤엔 같은 기술 연타 불가)
      if (f.hit && m.cancel && f.t >= m.startup && f.t < m.startup + m.active + 12 && onGround(s, f)) {
        const allow = isFinisher(f) ? m.cancel.filter((c) => c !== f.mv) : m.cancel;
        if (tryAttack(s, i, allow)) return;
      }
      if (f.t >= totalOf(m) + finishRec(f)) {
        f.mv = "";
        f.t = 0;
        f.st = onGround(s, f) ? "idle" : "jump";
        // 기술 중에 미리 누른 점프는 끝나자마자
        if (pressed(f, JUMP_BITS, 16)) {
          if (f.st === "idle") jump(s, i, JUMP_V);
          else if (f.jumps < 2) jump(s, i, JUMP2_V);
        }
      }
      return;
    }
    case "hit":
      if (f.trapT > 0) {
        // 갇힘: 버튼(공격·점프)을 새로 누를 때마다 더 빨리 빠져나옴
        f.trapT--;
        if (pressed(f, IN.A | IN.B | IN.C | JUMP_BITS, 1)) f.trapT = Math.max(0, f.trapT - 4);
        if (f.trapT === 0) {
          f.stun = 6;
          s.ev.push({ k: "pop", p: 1 - i, x: f.x, h: f.h + 30 * SUB, v: 0 });
        }
        return;
      }
      if (f.grabbed > 0) {
        f.grabbed--;
        // 잡기 풀기: 잡힌 직후 약+발차기 (히트스톱 동안 누른 것, 눌렀다 뗀 것도 인정) — 풀면 피해 없음
        const AB = IN.A | IN.B;
        const techIn = ((cur(f) & AB) === AB && pressed(f, AB, 4)) || (pressed(f, IN.A, 4) && pressed(f, IN.B, 4));
        if (f.grabbed === 0) {
          // 못 풀었으면 피해가 들어가고 위로 띄워짐 (다운 아님 → 뛰어올라 공중 콤보)
          const o = s.p[1 - i];
          f.hp = Math.max(0, f.hp - f.grabDmg);
          f.grabDmg = 0;
          gainMeter(o, charOf(o).moves.T.meter);
          f.vh = LAUNCH_VH;
          f.kd = 0;
          f.float = 1;
          f.vx = o.face * 220;
          f.stun = LAUNCH_STUN;
          s.ev.push({ k: "launch", p: 1 - i, x: f.x, h: f.h, v: 0 });
        } else if (f.grabbed >= THROW_TECH_T - THROW_TECH_WIN && techIn) {
          const o = s.p[1 - i];
          f.grabbed = 0;
          f.grabDmg = 0;
          f.st = "idle";
          f.t = 0;
          f.stun = 0;
          f.combo = 0;
          f.kd = 0;
          f.vx = -f.face * 400;
          // 푸는 데 쓴 약·발차기 입력은 여기서 소진 (안 그러면 풀자마자 그 입력으로 발차기가 나감)
          for (let k = HIST - 4; k < HIST; k++) f.hist[k] |= AB;
          // 잡은 쪽을 밀쳐 냄: 멀리 밀려나며 잠깐 휘청 (공격 · 잡기 못 함 — 바로 다시 붙어 잡지 못하게)
          if (o.st === "atk" && o.mv === "T") {
            o.st = "block";
            o.mv = "";
            o.t = 0;
            o.stun = TECH_SHOVE_T;
            o.vx = f.x < o.x ? TECH_SHOVE_VX : -TECH_SHOVE_VX;
          }
          s.ev.push({ k: "tech", p: i, x: (f.x + o.x) >> 1, h: f.h + 30 * SUB, v: 0 });
          return;
        }
      }
      if (f.stun > 0) f.stun--;
      if (f.stun <= 0) {
        f.pulled = 0;
        // (콤보 수는 프레임 끝에 0 — 풀리는 바로 그 프레임에 또 맞으면 같은 콤보로 이어 셈, 10.10)
        if (onGround(s, f)) {
          f.st = "idle";
          f.t = 0;
          f.recov = 1;
        } else if (!f.kd) {
          // 공중에서 경직이 풀리면 다시 조작 (점프 하나는 남겨 둠)
          f.st = "jump";
          f.t = 0;
          f.recov = 1;
          f.float = 0;
          f.airUsed = 0;
          f.airK = 0;
          f.airS = 0;
          f.jumps = Math.min(f.jumps, 1);
        }
      }
      return;
    case "block":
      if (f.guardT < 255) f.guardT++;
      if (guardCounter(s, i)) return;
      // 막은 채로 좌우를 누르면 그쪽을 봄
      steerFace(f);
      if (f.stun > 0) {
        f.stun--;
        return;
      }
      // 막는 경직이 아니면 다른 버튼은 바로 실행 (공격·점프·대시)
      if (tryAttack(s, i, ["X", "T", "S", "H", "L"])) return;
      if (pressed(f, JUMP_BITS, 3)) {
        jump(s, i, JUMP_V);
        return;
      }
      if (!holding(f, IN.D)) {
        f.st = "idle";
        f.t = 0;
      }
      return;
    case "down":
      if (f.t >= DOWN_T) {
        f.st = "rise";
        f.t = 0;
      }
      return;
    case "rise":
      if (f.t >= RISE_T) {
        f.st = "idle";
        f.t = 0;
        f.recov = 1;
      }
      return;
    default:
      return;
  }
}

function landed(s: State, i: number, f: Fighter) {
  f.jumps = 0;
  f.float = 0;
  f.juggle = 0;
  if (f.spiked === 2 && f.st === "hit") {
    // 마무리 내려찍기로 처박힘: 충격파 + 크게 한 번 튄 뒤 (kd) 다음 착지에 다운
    f.spiked = 0;
    f.vh = SLAM_BOUNCE;
    f.h += SUB;
    f.vx = Math.trunc(f.vx / 2);
    s.ev.push({ k: "slam", p: i, x: f.x, h: f.h, v: 1 });
    return;
  }
  if (f.spiked && f.st === "hit") {
    // 내리꽂혀 땅에 닿음: 살짝 튀어 오름
    f.spiked = 0;
    f.vh = 900;
    f.h += SUB;
    s.ev.push({ k: "clash", p: i, x: f.x, h: f.h, v: 1 });
    return;
  }
  f.spiked = 0;
  f.hold = 0;
  f.airUsed = 0;
  f.airK = 0;
  f.airS = 0;
  f.airDash = 0;
  f.dashT = 0;
  const lm = moveOf(f);
  // 포르테 되감기 낙하: 땅에 닿으면 (판정이 나온 뒤) 시작한 공중 자리로 되돌아감
  if (f.st === "atk" && f.aerial && f.mv === "S" && lm?.rwDive && f.t >= lm.startup) {
    rewindDive(s, i);
    return;
  }
  // 땅에 닿기 직전에 낸 공중 아이덴티티: 판정이 나오기 전에 착지하면 아무것도 안 나가고 재사용 대기만 돌던 것 (10.16 제나)
  // → 땅 버전으로 이어서 냄 (지난 시작 프레임은 그대로 셈, 재사용 대기는 땅 버전 값)
  if (f.st === "atk" && f.aerial && f.mv === "S" && lm && f.t < lm.startup && !f.hit) {
    const gm = charOf(f).moves.S;
    f.aerial = 0;
    f.dive = 0;
    f.vx = 0;
    f.t = Math.min(f.t, gm.startup - 1);
    f.cd = gm.cd ?? charOf(f).cd;
    s.ev.push({ k: "land", p: i, x: f.x, h: f.h, v: 0 });
    return;
  }
  if (f.st === "atk" && f.aerial && f.mv === "S" && lm?.hug) {
    if (f.hug) {
      // 안고 떨어져 착지: 바닥에 내리꽂음 → 기절 (그 자리에서 비틀거림, 이어 치기)
      const o = s.p[1 - i];
      f.hug = 0;
      o.x = f.x + f.face * 22 * SUB;
      o.h = f.h;
      o.vx = 0;
      o.vh = 0;
      const dmg = scaleDmg(lm.hug.dmg, o.combo);
      o.hp = Math.max(0, o.hp - dmg);
      o.combo++;
      o.st = "hit";
      o.t = 0;
      // 상태 이상 면역이면 기절 대신 짧은 경직
      const imm = o.cc > 0 || o.imm > 0;
      o.stun = imm ? DIZZY_IMM_STUN : lm.hug.stun;
      if (!imm) o.cc = 1;
      o.kd = 0;
      o.float = 0;
      gainMeter(f, lm.meter);
      s.stop = Math.max(s.stop, lm.hitstop);
      s.ev.push({ k: "hit", p: i, x: o.x, h: o.h + 20 * SUB, v: dmg, m: "S" });
      s.ev.push({ k: "slam", p: 1 - i, x: o.x, h: o.h, v: 1 });
      s.ev.push({ k: imm ? "immune" : "stun", p: i, x: o.x, h: o.h + 70 * SUB, v: 0 });
    } else s.ev.push({ k: "land", p: i, x: f.x, h: f.h, v: 0 });
    // 착지 경직 (내리꽂는 자세 / 헛치면 그대로 무방비)
    f.t = Math.max(f.t, lm.startup + lm.active);
    f.vx = 0;
    f.dive = 0;
    return;
  }
  // 내리꽂기 착지: 주변에 충격파 (가까이 땅에 있는 상대를 띄움 → 후속 2타, 바로 점프해 공중 콤보)
  if (f.dive && f.st === "atk" && lm?.rush?.landBurst) {
    const o = s.p[1 - i];
    const hr = hurtRect(o);
    const r = lm.rush.landBurst * SUB;
    s.ev.push({ k: "clash", p: i, x: f.x, h: f.h, v: 1 });
    // 양옆 r px, 위로도 낮게 뛴 상대까지 (56→66px 10.10)
    if (hr && Math.abs(o.x - f.x) < r && o.h - f.h < 66 * SUB && f.h - o.h < 24 * SUB) {
      f.hit = 0;
      applyHit(s, i, { ...lm, kd: false, multi: undefined, push: 0, dmg: lm.rush.landDmg ?? lm.dmg, launch: true }, f.x, "S");
    }
  }
  f.dive = 0;
  // 연타 돌진 필살기(카이 천풍난무)는 공중에서 써도 착지 뒤 땅에서 마저 돌진 (끊기지 않게)
  // 제나 뇌섬일창도 떨어지다 쓰면 착지에 끊겨서(10.12) 땅에서 마저 꿰뚫고 마무리까지
  const keepRush =
    f.st === "atk" && f.mv === "X" && !!lm?.rush && ((!!lm.multi && f.t < lm.startup + lm.active) || !!lm.zap);
  const landRush = f.st === "atk" && f.mv === "X" && !!lm?.rush?.landRush && f.t < lm.startup + lm.active;
  if (keepRush) {
    f.vh = 0;
    f.aerial = 0;
  } else if (landRush && lm) {
    // 이반 붉은 폭풍: 내리꽂다 착지 → 땅에서 돌진을 처음부터 (다음 프레임에 시작 = 돌진 속도)
    f.vh = 0;
    f.aerial = 0;
    f.dive = 0;
    if (f.t >= lm.startup) ((f.t = lm.startup - 1), (f.vx = 0));
  } else if (f.st === "jump" || (f.st === "atk" && (f.mv === "J" || f.mv === "K" || lm?.lunge || lm?.rush || (f.aerial && f.mv && charOf(f).moves[f.mv].air)))) {
    f.st = "idle";
    f.mv = "";
    f.t = 0;
    f.vx = 0;
    s.ev.push({ k: "land", p: i, x: f.x, h: f.h, v: 0 });
  } else if (f.st === "hit" && f.kd) {
    f.st = "down";
    f.t = 0;
    f.kd = 0;
    f.stun = 0;
    f.vx = Math.trunc(f.vx / 3);
  } else if (f.st === "ko") {
    f.vx = 0;
  }
}

function moveX(f: Fighter, dx: number) {
  let nx = f.x + dx;
  if (nx < WALL_L) nx = WALL_L;
  if (nx > WALL_R) nx = WALL_R;
  f.x = nx;
}

/** 벽 발판(건물): 윗면보다 낮은 높이에선 옆으로 못 파고듦 → 벽면에 막힘 */
function hitWall(map: MapDef, f: Fighter, px: number) {
  for (const p of map.plats) {
    if (!p.wall || f.h >= p.y * SUB || !inX(p, f.x) || inX(p, px)) continue;
    f.x = px < p.x0 * SUB ? p.x0 * SUB - 1 : p.x1 * SUB + 1;
    f.vx = 0;
  }
}

/** 벽 발판(건물) 속에 들어가 있으면 지붕 위로 올림 */
function unstick(map: MapDef, f: Fighter) {
  for (const p of map.plats) if (p.wall && inX(p, f.x) && f.h < p.y * SUB) f.h = p.y * SUB;
}

function respawn(s: State, i: number) {
  const f = s.p[i];
  // 떨어진 그 자리(지금 x) 바로 위 화면 꼭대기에서 다시 내려옴 — 아래가 낭떠러지면 공중 조작·2단 점프·대시로 건너감
  const bx = Math.max(WALL_L + 24 * SUB, Math.min(WALL_R - 24 * SUB, f.x));
  s.ev.push({ k: "fall", p: i, x: f.x, h: 0, v: 0 });
  releaseHug(s, i);
  f.x = bx;
  f.h = RESPAWN_H;
  f.vx = 0;
  f.vh = 0;
  // 땅에서 FALL_GRACE만큼 버티기 전에 또 떨어졌으면: 무적 없음 + 체력 깎임 (이걸로 쓰러지진 않음)
  const again = f.fell > 0;
  if (again && f.st !== "ko" && s.phase === "fight" && f.hp > 1)
    f.hp = Math.max(1, f.hp - Math.trunc((charOf(f).hp * FALL_DMG) / 100));
  f.fell = FALL_GRACE;
  f.grabbed = 0;
  f.grabDmg = 0;
  f.hold = 0;
  f.st = f.st === "ko" ? "ko" : "jump";
  f.mv = "";
  f.t = 0;
  f.stun = 0;
  f.kd = 0;
  f.combo = 0;
  f.jumps = 1;
  f.airUsed = 0;
  f.airK = 0;
  f.airS = 0;
  f.airDash = 0;
  f.dashT = 0;
  f.gcT = 0;
  f.float = 0;
  f.mark = 0;
  f.trapT = 0;
  f.inv = again ? 0 : RESPAWN_INV;
}

function physics(s: State, i: number) {
  const f = s.p[i];
  const map = mapOf(s);
  const m = moveOf(f);
  if (f.inv > 0) f.inv--;
  // 안 떠 있으면 띄워진 시간은 0 — 땅에 서 있을 땐 아래까지 안 내려가서, 긴 공중 콤보 뒤 남은 값 때문에
  // 다음에 띄울 때(잡기 등) 처음부터 무거운 중력으로 낮게 뜨던 것
  if (!f.float) f.floatT = 0;
  const hb = s.p[1 - i];
  if (f.tsT > 0 && f.st === "hit") {
    // 시간 정지: 그 자리에 멈춤 (중력 · 밀려남 없음)
    f.tsT--;
    f.vx = 0;
    f.vh = 0;
    return;
  }
  if (hb.hug && f.st === "hit") {
    // 곰 포옹에 안김: 안은 쪽 바로 앞에 붙어서 같이 떨어짐
    f.x = hb.x + hb.face * 22 * SUB;
    f.h = hb.h;
    f.vx = 0;
    f.vh = 0;
    return;
  }
  if (f.trapT > 0) {
    // 방울 안: 천천히 떠오르다 멈춤 (중력 없음)
    f.vx = 0;
    f.vh = f.trapT > 40 ? 160 : 0;
    f.h += f.vh;
    return;
  }
  if (f.pullT > 0) {
    const px0 = f.x;
    moveX(f, Math.trunc((f.pullX - f.x) / f.pullT));
    // 끌려오다 건물 벽에 걸리면 거기서 멈춤 (건물 속으로 안 끌려 들어가게)
    hitWall(map, f, px0);
    f.pullT--;
    f.vx = 0;
  }
  const on = standingOn(map, f);
  if (on) {
    if (f.fell > 0) f.fell--;
    // (차지 기술은 모으는 동안엔 제자리, 다 모은 뒤 내디딤)
    if (f.st === "atk" && m?.step && f.t < m.startup && !(m.charge && f.t <= m.charge.at)) moveX(f, m.step * f.face);
    // 연속 동작 2단째부터는 앞으로 조금씩 따라 들어감 (밀려난 상대를 계속 맞힘)
    if (f.st === "atk" && m && f.chain > 1 && CHAIN_MAX[f.mv as MoveId] && f.t < m.startup) moveX(f, CHAIN_STEP * f.face);
    moveX(f, f.vx);
    if (!inX(on, f.x)) {
      // 다른 같은 높이 발판으로 이어지지 않으면 떨어짐
      if (!standingOn(map, f)) {
        f.vh = 0;
      }
    }
    if (f.st !== "walk" && f.st !== "dash") {
      const fr = 60;
      if (f.vx > 0) f.vx = Math.max(0, f.vx - fr);
      else if (f.vx < 0) f.vx = Math.min(0, f.vx + fr);
    }
    if (standingOn(map, f)) return;
  }
  // 땅 상태인데 발밑이 없음 (발판 끝을 넘었거나, 가드·대기 중에 밀려났거나, 공중에서 잡기를 풀었거나): 공중 상태로
  // — 안 그러면 공중에서 대기·가드 자세로 떨어지며 땅 기술이 나감
  if (f.st === "idle" || f.st === "walk" || f.st === "dash" || f.st === "block") {
    f.st = "jump";
    f.t = 0;
    f.stun = 0;
    f.jumps = 1;
    f.airUsed = 0;
    f.airK = 0;
    f.airS = 0;
  }
  // 공중 (띄워진 상대는 천천히 떨어짐)
  // (띄워진 상대: 중력 45%, 떨어지는 최고 속도도 낮게 → 공중 콤보 넣을 시간)
  // 띄운 상대를 공중에서 맞힌 쪽: 상대가 아직 떠 있는 동안 같은 느린 중력으로 같이 내려옴
  const o = s.p[1 - i];
  if ((f.float === 1 || f.float === 2) && f.st === "hit") f.floatT = Math.min(f.floatT + 1, 1000);
  else if (!f.float) f.floatT = 0;
  if (f.juggle > 0) f.juggle--;
  // (💫 혼란으로 떠 있는 상대(float 3)도 — 건모 공중 Alt+Tab 뒤 이어 치기)
  // 💫 혼란 상대(건모 Alt+Tab) 쪽으로 솟는 중엔 보통 중력 — 느린 중력이면 계산한 높이보다 3배 솟아 지나침. 꼭대기부터 천천히
  const hang =
    f.juggle > 0 &&
    (f.st === "jump" || f.st === "atk") &&
    o.st === "hit" &&
    (o.float === 1 || (o.float === 3 && f.vh <= 0));
  if (!hang) f.juggle = 0;
  if (f.hug && m?.hug) f.vh = -m.hug.fall; // 곰 포옹: 안고 곧장 떨어짐
  else if (f.hold > 0 && f.vh <= 0 && (f.st === "jump" || f.st === "atk")) {
    // 건모 Alt+Tab 뒤: 잠깐 안 떨어짐 (점프하면 끝)
    f.hold--;
    f.vh = 0;
  } else if (f.float === 3 && f.st === "hit" && f.stun > 0) f.vh = 0; // 💫 혼란: 그 자리에 둥실 멈춤
  else if ((f.float === 1 && f.st === "hit") || hang) {
    // 공중에서 6대 넘게 맞으면 한 대마다 중력·낙하 속도가 커져 4대 뒤엔 보통 낙하 (너무 오래 안 떠 있게)
    const ft = f.st === "hit" ? f.floatT : o.floatT;
    f.vh = Math.max(-floatCap(ft, FLOAT_FALL), f.vh - floatG(ft, FLOAT_G));
  }
  else if (f.float === 2 && f.st === "hit") f.vh = Math.max(-floatCap(f.floatT, 1400), f.vh - floatG(f.floatT, GRAVITY));
  else {
    f.vh = Math.max(-MAX_FALL, f.vh - GRAVITY);
    // 공중 돌진 필살기(카이 천풍난무): 판정 동안 천천히 떨어짐
    const am = f.st === "atk" && f.aerial ? moveOf(f) : null;
    const af = am?.rush?.airFall;
    if (af !== undefined && am && f.t >= am.startup && f.t < am.startup + am.active) f.vh = Math.max(f.vh, -af);
  }
  // 우산 활강: 점프를 누르고 있으면 천천히 떨어짐
  const gl = charOf(f).glide;
  if (gl && f.vh < -gl && (f.st === "jump" || f.st === "atk") && holding(f, JUMP_BITS)) f.vh = -gl;
  const px = f.x;
  moveX(f, f.vx);
  hitWall(map, f, px);
  const prev = f.h;
  const next = f.h + f.vh;
  if (f.vh <= 0) {
    let land: Plat | null = null;
    for (const p of map.plats) {
      const top = p.y * SUB;
      if (!inX(p, f.x) || top > prev || top < next) continue;
      if (!land || p.y > land.y) land = p;
    }
    if (land) {
      f.h = land.y * SUB;
      f.vh = 0;
      landed(s, i, f);
      return;
    }
  }
  f.h = next;
  if (f.h < FALL_H) respawn(s, i);
}

/**
 * 돌진 잡기로 잡은 뒤: 때린 쪽은 대시 힘으로 계속 미끄러져 나가는데 잡힌 쪽은 그 자리에서 떠올라,
 * 때린 쪽이 상대를 지나쳐 버림(약 40px 뒤에 떠 있어 공중 콤보를 잇기 어려웠음) → 때린 쪽이 더 간 만큼 잡힌 쪽도 같이 옮김
 */
function carryDashGrab(s: State, x0: number[]) {
  const map = mapOf(s);
  for (let i = 0; i < 2; i++) {
    const a = s.p[i],
      d = s.p[1 - i];
    if (a.st !== "atk" || a.mv !== "T" || a.lg !== 1 || !a.hit) continue;
    if (d.st !== "hit" || !(d.grabbed > 0 || d.float === 1)) continue;
    const dx = a.x - x0[i];
    if (!dx) continue;
    const px = d.x;
    moveX(d, dx);
    hitWall(map, d, px);
  }
}

/** 두 캐릭터가 겹치지 않게 밀어냄 (높이가 비슷할 때만) */
function separate(s: State) {
  const [a, b] = s.p;
  if (Math.abs(a.h - b.h) > 40 * SUB) return;
  // 일섬으로 꿰뚫고 지나가는 중엔 몸끼리 안 막힘
  for (const f of s.p) {
    const m = f.st === "atk" ? moveOf(f) : null;
    if (m?.zap && f.t >= m.startup && f.t < m.startup + m.active + 2) return;
  }
  const need = Math.trunc(((charOf(a).width + charOf(b).width) * SUB) / 2);
  const dx = b.x - a.x;
  if (Math.abs(dx) >= need) return;
  const dir = dx > 0 ? 1 : dx < 0 ? -1 : a.face;
  const over = need - Math.abs(dx);
  const pa = Math.trunc(over / 2);
  moveX(a, -dir * pa);
  moveX(b, dir * (over - pa));
}

/** 곰 포옹 풀기 (i가 안고 있었거나 안겨 있었으면) — 안겨 있던 쪽은 짧은 경직으로 */
function releaseHug(s: State, i: number) {
  for (const k of [i, 1 - i]) {
    const a = s.p[k];
    if (!a.hug) continue;
    a.hug = 0;
    const o = s.p[1 - k];
    if (o.st === "hit" && o.stun > 100) o.stun = 12;
  }
}

/** 제나 공중 뇌격돌(수평 돌진 아이덴티티)을 맞힌 상태 */
function airRushHit(f: Fighter, m: MoveDef) {
  return f.mv === "S" && f.hit > 0 && !!f.aerial && !!m.rush && m.rush.airVh === 0 && !m.zap && !m.multi && !m.rush.landBurst;
}

/** 공중 잡기(곰 포옹)가 상대를 붙잡음 — 막을 수 없음, 같이 떨어져 착지하면 내리꽂음 */
function hugStart(s: State, i: number) {
  const a = s.p[i],
    o = s.p[1 - i];
  if (o.combo === 0) o.hugd = 0;
  a.hit = 1;
  a.hug = 1;
  a.vx = 0;
  a.vh = Math.min(a.vh, 0);
  o.hugd = 1;
  o.st = "hit";
  o.mv = "";
  o.t = 0;
  o.stun = 999;
  o.kd = 0;
  o.float = 0;
  o.floatT = 0;
  o.juggle = 0;
  o.grabbed = 0;
  o.trapT = 0;
  o.pullT = 0;
  o.spiked = 0;
  o.hold = 0;
  o.vx = 0;
  o.vh = 0;
  o.face = a.face > 0 ? -1 : 1;
  s.stop = Math.max(s.stop, 6);
  s.ev.push({ k: "throw", p: i, x: o.x, h: o.h + 30 * SUB, v: 0, m: "S" });
}

/** 공중 잡기로 잡을 수 있나: 누운·잡기 무적(차지 아머)·이번 콤보에 이미 잡힌 상대는 안 됨 */
function hugOk(o: Fighter) {
  if (o.st === "down" || o.st === "ko" || o.st === "rise" || chargeArmored(o)) return false;
  return !(o.hugd && o.combo > 0);
}

/** 차지 아머 (이반 철곰권): 기를 모으기 시작한 뒤 판정이 끝날 때까지 — 맞아도 버티고 잡히지 않음 (필살기엔 뚫림) */
function chargeArmored(d: Fighter) {
  if (d.st !== "atk" || d.mv !== "S" || d.aerial || d.chg <= 0) return false;
  const m = CHARS[d.ch].moves.S;
  return !!m.charge?.armor && d.t >= m.charge.at && d.t < m.startup + m.active;
}

/** 몸 공격이 이 거리(px) 안 — 바로 위 · 겹침 — 에서 오면 방향 없음 (어느 쪽을 봐도 막음) */
const GUARD_DEAD = 6;
function canBlock(s: State, d: Fighter, from: number) {
  if (airborneS(s, d)) return false;
  // 방향이 있는 공격(몸 · 날아오는 탄)은 그쪽을 보고 있어야 막음 — 뒤에서 오면 못 막음 (10.26).
  // 방향이 없는 것(발밑 불기둥 같은 소환 · 바로 위에서 내리찍기)은 어느 쪽을 봐도 막음. 막는 중에 좌우로 돌아볼 수 있음
  if (from !== 0 && from !== d.face) return false;
  return d.st === "block" || ((d.st === "idle" || d.st === "walk") && holding(d, IN.D));
}

/** 라운드·경기 끝난 뒤: 조작 없이 하던 동작을 마무리, win 이면 서 있을 때 승리 포즈 */
function settle(s: State, i: number, win: boolean) {
  const f = s.p[i];
  f.t++;
  if (f.st === "walk" || f.st === "dash") ((f.st = "idle"), (f.vx = 0), (f.t = 0));
  if (f.st === "hit" && f.stun > 0) f.stun--;
  if (f.st === "hit" && f.stun <= 0 && onGround(s, f)) ((f.st = "idle"), (f.t = 0));
  if (f.st === "atk" && f.t >= totalOf(moveOf(f)!) + finishRec(f)) ((f.st = onGround(s, f) ? "idle" : "jump"), (f.mv = ""), (f.t = 0));
  if (f.st === "block" && --f.stun <= 0) ((f.st = "idle"), (f.t = 0));
  if (f.st === "down" && f.t >= DOWN_T) ((f.st = "rise"), (f.t = 0));
  if (f.st === "rise" && f.t >= RISE_T) ((f.st = "idle"), (f.t = 0));
  if (win && f.st === "idle") ((f.st = "win"), (f.t = 0));
}

/** 띄워진 지 오래되면 중력·최고 낙하 속도가 점점 커짐 (2초 뒤 1초 동안 보통 중력까지, 이후 2초 동안 2배까지) */
function floatG(t: number, g0: number) {
  const over = t - FLOAT_SOFT_T;
  if (over <= 0) return g0;
  const g1 = g0 + Math.trunc(((GRAVITY - g0) * Math.min(over, FLOAT_RAMP)) / FLOAT_RAMP);
  return over <= FLOAT_RAMP ? g1 : g1 + Math.trunc((GRAVITY * Math.min(over - FLOAT_RAMP, FLOAT_RAMP2)) / FLOAT_RAMP2);
}
function floatCap(t: number, c0: number) {
  const over = t - FLOAT_SOFT_T;
  if (over <= 0) return c0;
  return c0 + Math.trunc(((MAX_FALL * 2 - c0) * Math.min(over, FLOAT_RAMP + FLOAT_RAMP2)) / (FLOAT_RAMP + FLOAT_RAMP2));
}

/** 콤보 피해 보정: 맞을수록 12%씩 줄고(최저 30%), 6대를 넘기면 한 대마다 5%씩 더 줄어 최저 10% (긴 공중 콤보 억제) */
function scaleDmg(dmg: number, combo: number) {
  const floor = combo < 6 ? 30 : Math.max(10, 30 - 5 * (combo - 5));
  return Math.max(1, Math.trunc((dmg * Math.max(floor, 100 - 12 * combo)) / 100));
}

/** 화상 1겹 더함 (최대 BURN_MAX) — 지속은 BURN_T 로 다시 */
function addBurn(s: State, ai: number, d: Fighter) {
  if (d.st === "ko") return;
  if (d.burn === 0) ((d.burnN = 0), (d.burnAcc = 0));
  const up = d.burnN < BURN_MAX;
  d.burnN = Math.min(BURN_MAX, d.burnN + 1);
  d.burn = BURN_T;
  if (up) s.ev.push({ k: "burn", p: ai, x: d.x, h: d.h + 60 * SUB, v: d.burnN });
}

/** 일섬 낙인이 터짐: 큰 피해 + 감전 (가드 · 무적 무시, 누워 있어도 다 들어감) */
function zapBurst(s: State, ai: number) {
  const a = s.p[ai];
  const d = s.p[1 - ai];
  const z = CHARS[a.ch].moves.X.zap;
  if (!z || d.st === "ko" || s.phase !== "fight") return;
  const dmg = z.dmg;
  d.hp = Math.max(0, d.hp - dmg);
  gainMeter(a, 6);
  s.stop = Math.max(s.stop, 10);
  s.ev.push({ k: "zapBurst", p: ai, x: d.x, h: d.h + 40 * SUB, v: dmg });
  s.ev.push({ k: "hit", p: ai, x: d.x, h: d.h + 28 * SUB, v: dmg, m: "X" });
  if (d.st === "down" || d.st === "rise") return;
  // 하던 걸 끊고 경직 — 감전은 상태 이상 면역 규칙 그대로
  if (d.hug) releaseHug(s, 1 - ai);
  d.grabbed = 0;
  d.st = "hit";
  d.t = 0;
  d.mv = "";
  d.combo++;
  d.stun = 24;
  d.vx = 0;
  if (airborneS(s, d)) ((d.vh = 600), (d.float = 2));
  // 낙인의 감전은 1차 감전의 마무리라 면역 무시
  if (d.shock === 0) s.ev.push({ k: "shock", p: ai, x: d.x, h: d.h + 70 * SUB, v: 0 });
  d.shock = Math.max(d.shock, z.shock);
  d.stun += SHOCK_STUN;
  d.cc = 1;
  d.imm = 0;
  if (d.hp <= 0) d.hp = 0;
}

/** 동시에 맞을 때: 때린 쪽이 (먼저 맞아서 상태가 바뀌기 전) 원래 어떤 상태였나 */
interface PreHit {
  fin: boolean;
  st: FState;
  t: number;
}

/** a가 d를 m으로 때림 (src = 판정 위치 x, 탄이면 탄 위치). pre = 서로 동시에 맞을 때 때린 쪽의 원래 상태 */
function applyHit(s: State, ai: number, m: MoveDef, srcX: number, mid: MoveId, pre?: PreHit, fromSide?: number) {
  const a = s.p[ai];
  const d = s.p[1 - ai];
  // 공격이 오는 쪽 (d 기준 1 오른쪽 · -1 왼쪽 · 0 방향 없음) — 안 주면 판정 출처가 거의 겹치면(바로 위) 방향 없음
  const from = fromSide ?? (Math.abs(srcX - d.x) < GUARD_DEAD * SUB ? 0 : srcX > d.x ? 1 : -1);
  // d가 밀려날 방향: 판정 반대쪽 — 판정이 바로 발밑(소환 기둥)이면 때린 쪽 반대로
  const dir = d.x > srcX ? 1 : d.x < srcX ? -1 : d.x >= a.x ? 1 : -1;
  if (!m.proj && !m.summon) a.hit = 1;
  // 새 콤보의 첫 타: 누운 상대 잡기 횟수 초기화
  if (d.combo === 0) d.otg = 0;
  if (d.combo === 0 && !d.hug) d.hugd = 0;
  if (d.hug) releaseHug(s, 1 - ai);
  const wasDown = d.st === "down";
  const wasHitSt = d.st === "hit";
  const eh = d.h + 28 * SUB;
  d.juggle = 0;
  d.hold = 0;
  if (d.st === "down" && mid !== "T") {
    // 누워 있는 상대: 못 막음, 피해 절반, 계속 누워 있음 (일어나는 시간은 그대로 → 무한 콤보 없음)
    // (잡기는 아래 보통 처리 → 붙잡아서 다시 띄움)
    const dmg = Math.max(1, scaleDmg(m.dmg, d.combo) >> 1);
    d.hp -= dmg;
    d.combo++;
    gainMeter(a, (m.meter >> 1));
    s.stop = Math.max(s.stop, m.hitstop - 2);
    s.ev.push({ k: "hit", p: ai, x: d.x - dir * 8 * SUB, h: d.h + 14 * SUB, v: dmg, m: mid });
    if (d.hp <= 0) d.hp = 0;
    return;
  }
  // 경직 면역 (카이 질풍권 돌진 중): 피해만 받고 하던 동작 계속 (잡기는 못 버팀)
  const am = d.st === "atk" ? moveOf(d) : null;
  if (
    (mid !== "T" && am?.armor && d.t >= am.startup - 2 && d.t < am.startup + am.active) ||
    (mid !== "T" && mid !== "X" && chargeArmored(d))
  ) {
    const dmg = Math.max(1, scaleDmg(m.dmg, d.combo));
    d.hp -= dmg;
    gainMeter(a, (m.meter >> 1));
    s.stop = Math.max(s.stop, m.hitstop - 3);
    s.ev.push({ k: "hit", p: ai, x: d.x - dir * 8 * SUB, h: eh, v: dmg, m: mid });
    s.ev.push({ k: "clash", p: 1 - ai, x: d.x, h: d.h + 30 * SUB, v: 0 });
    if (d.hp <= 0) d.hp = 0;
    return;
  }
  // 가드 부수기 (끝까지 모은 철곰권): 막고 있어도 그냥 맞음
  if (m.crush && canBlock(s, d, from)) s.ev.push({ k: "crush", p: ai, x: d.x, h: d.h + 40 * SUB, v: 0 });
  if (mid !== "T" && !m.crush && !m.bsod && canBlock(s, d, from)) {
    // 저스트 가드: 가드를 올린 지 JUST_T 프레임 안에 막으면 경직 반, 깎임 없음, 게이지 보너스
    const wasBlocking = d.st === "block";
    // (↓를 새로 눌러야 함 — 다운·경직 중부터 누르고만 있던 가드는 보통 가드)
    const just = pressed(d, IN.D, JUST_T + 1) && (!wasBlocking || d.guardT <= JUST_T);
    d.hp -= just ? 0 : m.chip;
    d.st = "block";
    d.t = 0;
    d.mv = "";
    d.stun = just ? Math.max(2, m.blockstun >> 1) : m.blockstun;
    // 막는 쪽은 때린 사람을 봄 (탄은 날아온 쪽). 이미 막는 중이면 그대로 — 연타·소환 필살기는 판정이
    // 상대 앞뒤 여기저기서 나와서, 맞을 때마다 그쪽으로 돌아 뒤를 보던 것 (10.10)
    const faceX = m.proj && !m.summon ? srcX : a.x;
    if (!wasBlocking && faceX !== d.x) d.face = faceX > d.x ? 1 : -1;
    d.gcT = d.stun + GC_GRACE;
    if (!wasBlocking) d.guardT = 0;
    d.guardT = Math.max(d.guardT, JUST_T + 1);
    // 막은 쪽은 조금, 때린 쪽도 밀려남 (가드 밀림 — 계속 붙어서 때리기 어렵게)
    d.vx = Math.trunc((dir * m.push * (just ? 3 : 6)) / 10);
    if (!m.proj && !m.summon && !m.multi) a.vx = -Math.trunc((dir * m.push * 3) / 10);
    gainMeter(a, (m.meter >> 1));
    gainMeter(d, (just ? 10 : 3));
    s.stop = Math.max(s.stop, m.hitstop - 3);
    s.ev.push({ k: just ? "just" : "block", p: ai, x: d.x - dir * 10 * SUB, h: eh, v: m.chip, m: mid });
    // 막아도 화상은 쌓이는 기술 (이그나 업화주)
    if (m.burn && m.burnGuard) addBurn(s, ai, d);
  } else {
    // 연타·소환 필살기는 콤보 보정 없이 매 타 같은 피해
    const fin = pre ? pre.fin : (mid === "L" || mid === "H") && isFinisher(a);
    // 카운터 히트: 상대가 기술 발동 중(판정 나오기 전)에 맞음 → 1.25배, 경직 +6
    const dm = moveOf(d);
    // (대시로 들어오다 맞아도 카운터 — 거리 두는 캐릭터의 보상)
    const counter = ((d.st === "atk" && !!dm && d.t < dm.startup) || d.st === "dash") && d.combo === 0;
    let base = fin ? Math.trunc((m.dmg * 13) / 10) : m.dmg;
    if (counter) base = Math.trunc((base * 5) / 4);
    // 감전된 상대: 감전시킬 수 있는 캐릭터(제나)의 모든 공격이 10% 더 아픔
    const shocker = CHARS[a.ch].moves.S.shock !== undefined;
    if (d.shock > 0 && shocker) base = Math.trunc((base * 110) / 100);
    // 화상 중인 상대: 태울 수 있는 캐릭터(이그나)의 모든 공격이 더 아픔
    const burner = CHARS[a.ch].moves.S.burn !== undefined || CHARS[a.ch].moves.X.burn !== undefined;
    if (d.burn > 0 && burner) base = Math.trunc((base * (100 + BURN_BONUS * d.burnN)) / 100);
    const wasAir = airborneS(s, d);
    const slam = mid === "K" && a.dk === 1 && wasAir;
    if (slam) base = Math.trunc((base * SLAM_DMG) / 100);
    // 섞기 보상: 공중 콤보에서 기술을 바꿔 맞히면 더 아프고, 같은 기술만 반복하면 점점 덜 아픔
    if (d.combo === 0) ((d.mixM = 0), (d.mixN = 0));
    let mixPct = 100;
    if (wasAir && !m.multi && !m.summon) {
      const code = mid.charCodeAt(0);
      if (d.mixM === code) {
        d.mixN++;
        mixPct = Math.max(MIX_MIN, 100 - MIX_REPEAT * d.mixN);
      } else {
        if (d.mixM !== 0) mixPct = MIX_BONUS;
        d.mixN = 0;
      }
      d.mixM = code;
    }
    const dmg =
      m.multi || m.summon ? m.dmg : Math.max(1, Math.trunc((scaleDmg(base, d.combo) * mixPct) / 100));
    let popBonus = 0;
    if (d.trapT > 0) {
      // 갇힌 상대를 때리면 방울이 터짐 — 터뜨린 타격에 추가 피해
      d.trapT = 0;
      popBonus = BUBBLE_POP_DMG;
      s.ev.push({ k: "pop", p: ai, x: d.x, h: d.h + 30 * SUB, v: 0 });
    }
    // 잡기 피해는 던져지는 순간에 (그 전에 풀면 안 들어감)
    if (mid === "T") d.grabDmg = dmg + popBonus;
    else d.hp -= dmg + popBonus;
    d.combo++;
    d.st = "hit";
    d.t = 0;
    d.mv = "";
    // 경직 감소: 콤보가 길어질수록 맞는 경직이 줄어 무한 콤보 방지 (필살기 연타는 예외)
    const decay = m.multi || m.summon ? 0 : Math.min(40, Math.max(0, d.combo - 3) * 6);
    // (발차기 2단 마무리가 맞으면 경직 더 — finStun, 이반: 맞혀도 -20이라 바로 반격당하던 것 10.14)
    d.stun = Math.max(6, Math.trunc(((m.hitstun + (fin ? (m.finStun ?? 0) : 0)) * (100 - decay)) / 100)) + (counter ? 6 : 0);
    if (counter) s.ev.push({ k: "counter", p: ai, x: d.x, h: d.h + 70 * SUB, v: 0 });
    d.vx = fin ? Math.trunc((dir * m.push * 16) / 10) : dir * m.push;
    // 끌어당기는 기술: 때린 쪽 바로 앞(약 34px)에 멈추게 — 땅 마찰(60/프레임)로 멈추는 거리에 맞춘 속도
    // 상태 이상 면역: 이미 걸려 있거나(같은 콤보) 풀린 지 2초 안 — 피해·경직만 들어가고 상태 이상은 안 걸림
    // (연타기의 2타째부터는 같은 상태 이상의 연장 — 면역 아님)
    const cont = !!m.multi && !m.proj && !m.summon && a.st === "atk" && a.t > m.startup && wasHitSt;
    const immune = (d.cc > 0 && !cont) || d.imm > 0;
    // (이미 감전 중이면 새 상태 이상이 아니라 감전 연장 — 제나 L 뒤 천뢰강림 3연타가 매번 IMMUNE 뜨던 것)
    const shockOn = !!m.shock && d.shock > 0;
    const hasStatus = !!(m.timeStop || m.pull || m.pullUp || m.pause || m.swap || (m.trap && !popBonus) || (m.shock && !shockOn) || m.dizzy);
    let gotStatus = false;
    if (hasStatus && immune) s.ev.push({ k: "immune", p: ai, x: d.x, h: d.h + 74 * SUB, v: 0 });
    // 긴 경직이 곧 상태 이상인 기술(카이 기절·건모 일시정지·혼란 등): 면역이면 보통 경직으로
    if (hasStatus && immune && m.hitstun > 30) d.stun = Math.min(d.stun, DIZZY_IMM_STUN);
    if (m.dizzy && !immune) gotStatus = true;
    if (m.pull && !immune) {
      gotStatus = true;
      // 8프레임 동안 때린 쪽 바로 앞(30px)까지 끌려옴 → 바로 약·잡기로 이어 칠 수 있음
      d.vx = 0;
      d.pullX = a.x + a.face * 30 * SUB;
      d.pullT = 8;
      d.pulled = 1;
    }
    const aSt = pre ? pre.st : a.st,
      aT = pre ? pre.t : a.t;
    // 공중에서 맞는 횟수엔 한도 없음 (때리는 쪽 공중 공격 수만 제한)
    // (연타기는 마지막 타만 다운 — 탄은 쏜 사람 동작과 상관없이 탄 쪽에서 정해 줌)
    const kd = (m.kd && !(m.multi && !m.proj && mid !== "S" && aSt === "atk" && aT < m.startup + m.active - m.multi));
    // 띄우는 연타기(카이 질풍권)의 다음 타: 이미 띄워 놓은 상대를 다시 낮게 끌어내리지 않게
    const prevVh = d.vh,
      prevFloat = d.float;
    if (wasAir || kd) {
      d.vh = kd ? 1500 : 700;
      d.kd = kd ? 1 : 0;
      d.vx = Math.trunc((dir * (kd && m.multi ? 1700 : m.push) * 13) / 10);
      if (wasAir && !kd && d.float) {
        // 띄워진 상대 공중 콤보(저글): 멀리 안 날아가고 다시 살짝 떠올라 다음 타를 넣을 수 있음
        // 때린 쪽이 아직 떠오르는 중이면 그 속도에 맞춰 같이 떠오름 (위로 지나쳐 버리지 않게)
        // 이후엔 때린 쪽과 같은 중력(float=2)으로 같이 움직여서 다음 타가 닿음
        if (airborneS(s, a) && !m.proj && !m.summon) {
          // 공중에서 맞힘: 둘 다 살짝 떠올랐다가 같은 느린 중력으로 같이 내려옴 → 다음 타가 계속 닿음
          d.vh = JUGGLE_POP;
          d.float = 1;
          a.vh = JUGGLE_POP;
          // 가로로도 같이 밀려감 (간격 유지 → 다음 공중 공격이 닿음)
          a.vx = mid === "K" ? Math.trunc((d.vx * AIR_K_FOLLOW) / 100) : d.vx;
          a.juggle = JUGGLE_HANG;
        } else {
          d.vh = JUGGLE_VH;
          d.float = 2;
        }
        d.vx = Math.trunc((dir * m.push * JUGGLE_PUSH) / 100);
        d.stun = Math.max(d.stun, JUGGLE_STUN);
      }
    }
    // 제자리 연타 필살기(소영 보충수업 등)를 공중에서 맞음: 매 타 위로 튕겨 판정 밖으로 빠져 나머지 타가 헛치던 것 → 그 자리에 붙잡아 둠
    if (wasAir && !kd && m.multi && !m.rush && !m.proj && !m.summon && mid === "X" && !airborneS(s, a)) {
      d.vh = 160;
      d.vx = Math.trunc((dir * m.push) / 10);
      d.float = 2;
    }
    if (m.launch && wasAir && !kd && prevFloat === 1) {
      d.vh = Math.max(d.vh, prevVh);
      d.float = 1;
    }
    if (m.pullUp && !kd && !immune) {
      gotStatus = true;
      // 끌어올리기 = 띄우기: 때린 쪽 높이까지 솟구치게 띄우고(천천히 떨어지는 상태), 가로로는 때린 쪽 앞으로 끌려옴
      const dh = Math.max(0, a.h - 20 * SUB - d.h);
      // 낮은 데서 맞혀도 최소 80px은 뜨게 (예전엔 700 → 26px쯤 떠서 이어 칠 수가 없었음)
      d.vh = Math.min(LAUNCH_VH, Math.max(isqrt(2 * FLOAT_G * 80 * SUB), isqrt(2 * FLOAT_G * dh)));
      d.vx = 0;
      d.kd = 0;
      d.float = 1;
      d.stun = Math.max(d.stun, LAUNCH_STUN - 10);
      s.ev.push({ k: "launch", p: ai, x: d.x, h: d.h, v: 3 });
    }
    if (m.spike && wasAir && !kd) {
      // 내리꽂기: 공중의 상대를 땅으로 처박음 → 바닥에서 한 번 튀고 경직 유지 (착지해 이어 치기)
      d.vh = -2200;
      d.vx = Math.trunc((dir * m.push) / 2);
      d.spiked = 1;
      d.float = 0;
      d.stun = Math.max(d.stun, m.hitstun + 6);
    }
    if (slam) {
      // 마무리 내려찍기: 바닥에 처박고 → 한 번 튀어 오른 뒤 다운 (콤보 끝)
      d.vh = -SLAM_VH;
      d.vx = Math.trunc((dir * m.push) / 3);
      d.spiked = 2;
      d.float = 0;
      d.kd = 1;
      d.stun = Math.max(d.stun, 40);
      a.juggle = 0;
      s.stop = Math.max(s.stop, SLAM_STOP);
      s.ev.push({ k: "slam", p: ai, x: d.x, h: d.h + 30 * SUB, v: 0 });
    }
    if (mid === "G" && !wasAir) {
      // 가드 반격: 막은 직후 발차기로 상대를 위로 띄움 → 점프 캔슬해서 공중 콤보
      d.vh = LAUNCH_VH;
      d.kd = 0;
      d.float = 1;
      d.vx = dir * 300;
      d.stun = Math.max(d.stun, LAUNCH_STUN - 10);
      s.ev.push({ k: "launch", p: ai, x: d.x, h: d.h, v: 2 });
    }
    if (fin && mid === "L" && m.launcher && !kd && !wasAir) {
      // 약 4단 마무리: 위로 띄움 → 점프 캔슬해서 공중 콤보
      d.vh = CHAIN_LAUNCH_VH;
      d.kd = 0;
      d.float = 1;
      d.vx = Math.trunc((dir * m.push * 5) / 10);
      d.stun = Math.max(d.stun, 36);
      s.ev.push({ k: "launch", p: ai, x: d.x, h: d.h, v: 1 });
    }
    if (!m.pull && mid !== "T") d.pulled = 0;
    if (mid === "T") {
      d.pulled = 0;
      // 잡기: 잠깐 붙잡혀 있다가(그 사이 약+발차기로 풀 수 있음) 던져짐 — 던지는 건 hit 상태에서 처리
      d.grabbed = THROW_TECH_T;
      if (wasDown) d.otg = 1;
      d.stun = m.hitstun;
      d.vx = 0;
      d.vh = 0;
      d.kd = 0;
    }
    d.mark = 0; // 다른 기술에 맞으면 ⏸/💫 표시는 사라짐 (아래에서 다시 붙음)
    if (m.timeStop && !kd && !immune) {
      // 시간 정지: 그 자리에 멈춤 (경직 = 멈춘 시간 이상, 콤보 보정으로 줄지 않게)
      gotStatus = true;
      d.tsT = m.timeStop;
      d.stun = Math.max(d.stun, m.timeStop);
      d.vx = 0;
      d.vh = 0;
      d.float = 0;
      s.ev.push({ k: "timeStop", p: ai, x: d.x, h: d.h + 70 * SUB, v: m.timeStop });
    }
    if (m.pause && !kd && !immune) {
      gotStatus = true;
      // ⏸ 일시정지: 긴 경직 그대로 (콤보 보정으로 줄지 않게)
      d.stun = Math.max(d.stun, m.hitstun);
      d.mark = 1;
      s.ev.push({ k: "pause", p: ai, x: d.x, h: d.h + 70 * SUB, v: 0 });
    }
    if (m.bsod && !d.bsodd) {
      // Alt+F4: 강제 종료 — 면역 무시, 그 자리에 멈춤 (공중이면 둥실 멈춤)
      gotStatus = true;
      d.frz = m.bsod;
      d.bsodd = 1;
      d.stun = Math.max(d.stun, m.bsod);
      d.mark = 1;
      d.vx = 0;
      d.kd = 0;
      // 콤보 초기화: 피해 보정 · 경직 감소 · 공중 낙하 가속 · 섞기 · 콤보마다 한 번 기술(곰 포옹 등)이 처음부터 → 멈춘 동안 한 콤보 더
      d.combo = 0;
      d.floatT = 0;
      d.mixM = 0;
      d.mixN = 0;
      d.otg = 0;
      d.hugd = 0;
      // 공중이면 그대로 땅에 떨어져 선 채로 멈춤 (멈춘 동안 다시 땅 콤보부터)
      if (airborneS(s, d)) ((d.vh = Math.min(d.vh, 0)), (d.float = 0));
      s.ev.push({ k: "bsod", p: ai, x: d.x, h: d.h + 70 * SUB, v: 0 });
    } else if (m.bsod) {
      // 같은 콤보에 두 번째 강제 종료: 이미 꺼진 창 — 멈춤 · 초기화 없이 경직도 짧게 (무한 반복 막기)
      d.stun = Math.min(d.stun, 10);
    } else if (d.frz > 0 && !kd && d.vh > 0 && !wasAir) {
      // 멈춘 상대를 띄우는 타(약 4단 · 가드 반격): 멈춤이 풀리고 그대로 공중 콤보로
      d.frz = 0;
    } else if (d.frz > 0 && !kd) {
      // 멈춘 동안 맞은 타: 멈춤은 그대로(남은 만큼 경직), 멀리 안 밀려남
      d.stun = Math.max(d.stun, d.frz);
      d.mark = 1;
      d.vx = Math.trunc(d.vx / 3);
      if (airborneS(s, d)) ((d.vh = Math.min(d.vh, 0)), (d.float = 0));
    }
    if (m.swap && !immune) {
      gotStatus = true;
      // Alt+Tab: 자리를 바꾸고 💫 혼란 — 그 자리에 떠 있다가 넘어짐 (아래에 발판이 없으면 안 넘어뜨림)
      const ax = a.x,
        ah = a.h;
      a.x = d.x;
      a.h = d.h;
      d.x = ax;
      d.h = ah;
      a.face = d.x >= a.x ? 1 : -1;
      d.face = -a.face as 1 | -1;
      a.vx = 0;
      // 멀리서 맞혀도 바꾼 뒤 상대를 바로 앞(약이 닿는 거리)까지 끌어옴 → 바로 이어 침
      if (Math.abs(d.x - a.x) > SWAP_NEAR * SUB)
        d.x = Math.max(WALL_L, Math.min(WALL_R, a.x + a.face * SWAP_NEAR * SUB));
      // 때린 쪽은 바뀐 상대와 같은 높이로 와서 0.3초 동안 안 떨어짐 → 바로 공중 J · K (점프 하나 남김)
      a.h = d.h;
      a.vh = 0;
      // 바꾼 자리가 건물 속이면 지붕 위로 (달밤 마천루: 지붕 끝 상대를 낮은 데서 맞히면 건물 안에 들어가 밑으로 빠졌음)
      unstick(mapOf(s), a);
      unstick(mapOf(s), d);
      if (!airborneS(s, a)) landed(s, ai, a);
      if (airborneS(s, a)) {
        a.hold = SWAP_HOLD;
        a.st = "jump";
        a.mv = "";
        a.t = 0;
        a.airUsed = 0;
        a.airK = 0;
        a.airS = 0;
        a.jumps = Math.min(a.jumps, 1);
        a.hit = 0;
      }
      d.vx = 0;
      d.vh = 0;
      d.float = 3;
      d.stun = m.hitstun;
      d.kd = platBelow(mapOf(s), d.x, d.h) ? 1 : 0;
      // (지붕 위로 올려져 땅에 선 채면 떠 있는 상태가 아님 — 그 자리에서 혼란 경직만)
      if (!airborneS(s, d)) ((d.float = 0), (d.kd = 0));
      d.mark = 2;
      d.pulled = 0;
      // 때린 쪽도 상대가 혼란에 떠 있는 동안 천천히 떨어짐 (공중 콤보 넣을 시간)
      a.juggle = d.stun;
      // (x·h = 때린 쪽이 원래 있던 자리 — 화면에서 "떠난 자리"에 창을 남기는 데 씀)
      s.ev.push({ k: "swap", p: ai, x: ax, h: ah, v: 0 });
    }
    if (m.trap && !kd && !popBonus && !immune) {
      gotStatus = true;
      // 비눗방울에 갇힘: 그 자리에서 둥실 떠오름
      d.trapT = m.trap;
      d.stun = m.trap + 4;
      d.vx = 0;
      d.vh = 0;
      d.kd = 0;
      d.float = 0;
      s.ev.push({ k: "trap", p: ai, x: d.x, h: d.h + 30 * SUB, v: 0 });
    }
    if (m.shock && (!immune || shockOn)) {
      if (!shockOn) gotStatus = true;
      // 처음 감전되면 짧게 기절 (몸이 굳음), 이미 감전 중이면 살짝만
      const fresh = d.shock === 0;
      if (fresh) s.ev.push({ k: "shock", p: ai, x: d.x, h: d.h + 70 * SUB, v: 0 });
      d.shock = Math.max(d.shock, m.shock);
      if (!d.kd) d.stun += fresh ? SHOCK_STUN : 3;
    }
    if (gotStatus) d.cc = 1;
    if (m.burn) addBurn(s, ai, d);
    // 공중 뇌격돌(제나): 맞히면 돌진을 멈춰 상대 앞에 붙음 → 공중 콤보
    if (mid === "S" && m.rush && !m.rush.landBurst && m.rush.airVh === 0 && !m.zap && airborneS(s, a)) {
      a.vx = Math.trunc(a.vx / 6);
      // 공중에 뜬 상대는 띄운 상태(저글)로 — 둘 다 같은 느린 중력으로 내려와서 공중 약·발차기가 이어짐 (10.12)
      if (airborneS(s, d) && !kd) ((d.float = 1), (d.vh = 0), (a.juggle = JUGGLE_HANG));
    }
    // 일섬 낙인: 막지 못하고 맞으면 delay 뒤 터짐
    if (m.zap && !kd) d.stun = Math.max(d.stun, m.zap.stun);
    if (m.zap && d.zap === 0) {
      d.zap = m.zap.delay;
      s.ev.push({ k: "zapMark", p: ai, x: d.x, h: d.h + 70 * SUB, v: 0 });
    }
    if (m.launch && !kd && !wasAir) {
      // 띄우는 후속타 (카이 질풍권 · 공중 질풍권 착지 충격파)
      // 낮게 띄우는 기술(launchVh)은 경직도 짧게 — 공중 콤보 한두 대 정도
      d.vh = m.launchVh ?? LAUNCH_VH;
      d.kd = 0;
      d.float = 1;
      d.vx = dir * 250;
      d.stun = Math.max(d.stun, m.launchVh ? 36 : LAUNCH_STUN - 10);
      s.ev.push({ k: "launch", p: ai, x: d.x, h: d.h, v: 4 });
    }
    // (잡기 게이지는 던질 때 — 풀리면 없음)
    if (mid !== "T") gainMeter(a, m.meter);
    gainMeter(d, (dmg >> 4));
    s.stop = Math.max(s.stop, m.hitstop);
    s.ev.push({ k: mid === "T" ? "throw" : "hit", p: ai, x: d.x - dir * 8 * SUB, h: eh, v: dmg + popBonus, m: mid });
  }
  if (d.hp <= 0) d.hp = 0;
}

function projectiles(s: State) {
  const map = mapOf(s);
  for (const p of s.proj) {
    p.t++;
    if (p.k === 1 || p.k === 2) {
      p.life--;
      // 불기둥이 꺼지면 그 자리에 불 장판 (이그나 업화주)
      const fl = p.k === 1 && p.life === 0 ? CHARS[s.p[p.o].ch].moves.X.summon?.floor : undefined;
      if (fl) s.proj.push({ k: 2, mv: 1, n: 0, t: 0, o: p.o, x: p.x, h: p.h, vx: 0, vh: 0, life: fl.life });
      continue;
    }
    const prev = p.h;
    const bm = p.k === 0 ? projDef(p, s).boomer : undefined;
    if (bm && p.t > bm.turn) {
      // 태엽 팽이: 쏜 사람 쪽으로 방향을 틀어 되돌아옴 (가로 최고 속도 = 처음 속도), 높이는 쏜 사람 쪽으로 서서히
      const o = s.p[p.o];
      const pd = projDef(p, s);
      const tx = o.x - p.x;
      p.vx += Math.sign(tx || -(p.d ?? 1)) * bm.accel;
      if (Math.abs(p.vx) > pd.speed) p.vx = Math.sign(p.vx) * pd.speed;
      p.vh = Math.trunc((o.h + pd.y * SUB - p.h) / 10);
      // 돌아오는 중 쏜 사람에게 닿으면 받아서 사라짐 — 재사용 대기가 줄어듦
      if (Math.sign(p.vx) !== (p.d ?? 1) && Math.abs(tx) < 22 * SUB && Math.abs(o.h + pd.y * SUB - p.h) < 50 * SUB) {
        p.life = 0;
        o.cd = Math.max(0, o.cd - bm.catchCd);
        s.ev.push({ k: "catch", p: p.o, x: p.x, h: p.h, v: 0 });
        continue;
      }
    }
    p.x += p.vx;
    p.h += p.vh;
    p.life--;
    if (p.vh < 0 && !bm) {
      // 내리꽂는 탄은 발판·바닥에 닿으면 터짐
      for (const q of map.plats) {
        const top = q.y * SUB;
        if (inX(q, p.x) && prev >= top && p.h <= top) {
          p.life = 0;
          s.ev.push({ k: "clash", p: p.o, x: p.x, h: top, v: 0 });
          break;
        }
      }
      if (p.h < FALL_H) p.life = 0;
    }
  }
  // 탄끼리 부딪치면 둘 다 사라짐
  for (let i = 0; i < s.proj.length; i++)
    for (let j = i + 1; j < s.proj.length; j++) {
      const a = s.proj[i],
        b = s.proj[j];
      if (a.k === 0 && b.k === 0 && a.mv === 0 && b.mv === 0 && a.o !== b.o && a.life > 0 && b.life > 0 && overlap(projRect(a, s), projRect(b, s))) {
        a.life = b.life = 0;
        s.ev.push({ k: "clash", p: -1, x: (a.x + b.x) >> 1, h: a.h, v: 0 });
      }
    }
  for (const p of s.proj) {
    if (p.life <= 0) continue;
    const d = s.p[1 - p.o];
    const h = hurtRect(d);
    if (p.k === 2) {
      // 불 장판: 밟고 서 있으면(발이 장판 높이) every 프레임마다 피해 + 화상. 경직은 없음, 화상처럼 쓰러지진 않음
      const fl = CHARS[s.p[p.o].ch].moves.X.summon!.floor!;
      const r = projRect(p, s);
      const on = d.x >= r.l && d.x <= r.r && d.h >= r.lo && d.h <= r.hi && d.st !== "ko" && d.inv === 0;
      // (장판이 여러 개 겹쳐 있어도 한 번만 — 피해는 그 프레임에 한 번, 화상 겹은 1초에 한 번)
      if (on && p.t % fl.every === 0 && d.flT !== s.f) {
        d.flT = s.f;
        if (s.f - d.flB >= 60) {
          d.flB = s.f;
          addBurn(s, p.o, d);
        } else if (d.burn > 0) d.burn = BURN_T;
        if (d.hp > 1) d.hp = Math.max(1, d.hp - fl.dmg);
      }
      continue;
    }
    if (p.k === 1) {
      // 불기둥: 솟은 뒤 every 프레임마다 타격, 마지막 타에 날림
      const X = CHARS[s.p[p.o].ch].moves.X;
      const sm = X.summon!;
      const at = p.t - sm.delay;
      if (sm.track && (sm.track === "burn" ? d.burn > 0 : d.shock > 0) && at >= 0 && at % sm.every === 0) {
        // 추적: 감전(화상)된 상대라면 타마다 상대 발밑으로 따라감 (지금 선 발판 높이)
        p.x = d.x;
        const under = platBelow(map, d.x, d.h);
        p.h = under ? under.y * SUB : d.h;
      }
      if (at >= 0 && at % sm.every === 0 && h && overlap(projRect(p, s), h)) {
        const last = at + sm.every >= sm.life;
        applyHit(s, p.o, last ? X : { ...X, kd: false }, p.x, "X", undefined, 0);
      }
      continue;
    }
    const pm = CHARS[s.p[p.o].ch].moves[p.mv ? "X" : "S"];
    const pd = pm.proj!;
    if (pd.hits && pd.hits > 1) {
      // 여러 번 맞는 탄: every 프레임마다, 마지막 타에만 다운
      // (나오자마자 첫 타 — 예전엔 every 프레임 뒤라 붙어 있던 상대를 지나쳐 버림)
      if (p.t % (pd.every ?? 8) === 1 && h && overlap(projRect(p, s), h)) {
        p.n--;
        // 밀어내는 쪽은 파도가 나아가는 쪽 (파도 가운데가 상대를 지나치면 거꾸로 당겨져 남은 타가 빗나가던 것)
        applyHit(s, p.o, { ...pm, multi: pd.every ?? 8, kd: !!pm.kd && p.n <= 0 }, d.x - Math.sign(p.vx) * SUB, p.mv ? "X" : "S", undefined, -Math.sign(p.vx));
        if (p.n <= 0) p.life = 0;
      }
    } else if (pd.boomer) {
      // 태엽 팽이: 가는 길 한 번 · 오는 길 한 번 (오는 길은 쏜 사람 쪽으로 밀어 옴)
      const leg = Math.sign(p.vx) === (p.d ?? 1) ? 1 : 2;
      if (!((p.hb ?? 0) & leg) && h && overlap(projRect(p, s), h)) {
        p.hb = (p.hb ?? 0) | leg;
        applyHit(s, p.o, pm, p.x - p.vx * 4, "S", undefined, -Math.sign(p.vx));
      }
      if (p.x < -60 * SUB || p.x > (VIEW_W + 60) * SUB) p.life = 0;
    } else if (h && overlap(projRect(p, s), h)) {
      applyHit(s, p.o, pm, p.x - p.vx * 4, p.mv ? "X" : "S", undefined, -Math.sign(p.vx));
      p.life = 0;
    }
    if (!pd.boomer && (p.x < -20 * SUB || p.x > (VIEW_W + 20) * SUB)) p.life = 0;
  }
  s.proj = s.proj.filter((p) => p.life > 0);
}

function attacks(s: State) {
  const hits: number[] = [];
  for (let i = 0; i < 2; i++) {
    const r = hitRect(s.p[i]);
    const h = hurtRect(s.p[1 - i]);
    if (!r || !h || !overlap(r, h)) continue;
    // 공중 잡기(곰 포옹): 맞으면 바로 붙잡음 (가드·아머 무시), 못 잡는 상대면 헛침
    const hm = s.p[i].st === "atk" && s.p[i].mv === "S" && s.p[i].aerial ? moveOf(s.p[i]) : null;
    if (hm?.hug) {
      // 동시에 상대 공격도 닿으면 상대 공격이 이김 (잡기처럼)
      const or = hitRect(s.p[1 - i]),
        mh = hurtRect(s.p[i]);
      if (hugOk(s.p[1 - i]) && !(or && mh && overlap(or, mh))) hugStart(s, i);
      continue;
    }
    // 잡기는 땅에 서 있는(경직 아닌) 상대만 — 단, 끌어당겨 온 상대·감전된 상대(땅)·방울에 갇힌 상대는 잡을 수 있음
    if (s.p[i].mv === "T") {
      const o = s.p[1 - i];
      // (건모 ⏸ 일시정지 중인 상대도 잡힘)
      if (o.trapT === 0 && (airborneS(s, o) || (o.st === "hit" && !o.pulled && o.shock === 0 && o.mark !== 1))) continue;
      // 누운 상대 다시 잡기는 콤보마다 한 번 (잡기 → 내려찍기 → 다시 잡기 무한 반복 방지)
      if (o.st === "down" && o.otg) continue;
      // 막는 경직 중엔 안 잡힘
      if (o.st === "block" && o.stun > 0) continue;
      // 이반 철곰권 기 모으는 중엔 안 잡힘 (아머)
      if (chargeArmored(o)) continue;
    }
    hits.push(i);
  }
  // 둘 다 잡기면 서로 밀쳐 냄
  if (hits.length === 2 && s.p[0].mv === "T" && s.p[1].mv === "T") {
    for (let i = 0; i < 2; i++) {
      const f = s.p[i];
      f.st = "idle";
      f.mv = "";
      f.t = 0;
      f.vx = -f.face * (TECH_SHOVE_VX >> 1);
    }
    s.ev.push({ k: "tech", p: -1, x: (s.p[0].x + s.p[1].x) >> 1, h: s.p[0].h + 30 * SUB, v: 0 });
    return;
  }
  // 동시에 맞으면 서로 맞음 (상쇄)
  // (먼저 계산해 둠: 1P 타격을 적용하면 2P 상태가 바뀌어, 2P의 마무리 보너스·띄우기가 빠졌었음)
  const ms = hits.map((i) => {
    const f = s.p[i];
    const pre: PreHit = { fin: (f.mv === "L" || f.mv === "H") && isFinisher(f), st: f.st, t: f.t };
    return [moveOf(f)!, f.mv as MoveId, f.x, pre] as const;
  });
  hits.forEach((i, k) => applyHit(s, i, ms[k][0], ms[k][2], ms[k][1], ms[k][3]));
}

function endRound(s: State, winner: number) {
  s.phase = "roundEnd";
  s.pt = 0;
  s.roundWinner = winner;
  if (winner === 0 || winner === 1) s.wins[winner]++;
  s.proj = [];
}

function checkKO(s: State) {
  const [a, b] = s.p;
  const ka = a.hp <= 0,
    kb = b.hp <= 0;
  if (!ka && !kb) return;
  for (const [f, i] of [
    [a, 0],
    [b, 1],
  ] as const) {
    if (f.hp > 0) continue;
    f.st = "ko";
    f.t = 0;
    f.mv = "";
    f.vh = 800;
    f.vx = f.x < s.p[1 - i].x ? -500 : 500;
    s.ev.push({ k: "ko", p: i, x: f.x, h: f.h, v: 0 });
  }
  s.stop = 48;
  endRound(s, ka && kb ? 2 : ka ? 1 : 0);
}

/**
 * 포르테 공중 「되감기 낙하」: 내리찍기가 막히거나 헛쳐서 땅에 닿으면 시작한 공중 자리로 되돌아감 (빈틈 없음).
 * 맞혔으면 되감지 않고 맞힌 자리에 그대로 — 상대는 시간 정지, 공중 약 2번 다시 채워 바로 이어 침
 */
/** 되감기 낙하로 땅의 상대를 맞혔을 때 포르테 발 높이 (상대 발 위 px) */
const DIVE_LOW = 25;
/** 되감기 낙하를 맞혔을 때 상대가 포르테 앞으로 최소 이만큼 (px) */
const DIVE_GAP = 20;
function rewindDive(s: State, i: number) {
  const f = s.p[i];
  const o = s.p[1 - i];
  const hit = f.hit && o.st === "hit" && !o.kd && o.hp > 0;
  const fx = f.x,
    fh = f.h;
  // 맞혔으면 그 자리(맞힌 위치)에 그대로 서서 이어 침 — 안 맞았을 때(헛침 · 막힘 · 땅에 닿음)만 뛰어내린 자리로 되감김 (10.16)
  if (!hit) {
    f.x = f.rwX;
    f.h = f.rwH;
  }
  f.vx = 0;
  f.vh = 0;
  f.dive = 0;
  f.st = "jump";
  f.mv = "";
  f.t = 0;
  f.aerial = 0;
  // 공중 약 2번만큼 다시 채움 (공중 콤보에 끼워 이어 칠 수 있게, 끝없이는 안 되게)
  f.airUsed = Math.max(0, f.airUsed - 2);
  // (맞힌 상대는 시간 정지로 그 자리에 멈춰 있음 — applyHit timeStop)
  // 맞혔으면 포르테도 시간 정지 동안 그 자리에 둥실 — 바로 떨어지면 멈춘 상대에게 못 이어 침 (10.16)
  if (hit) {
    // 땅에 선 상대를 맞혔으면 상대 키 언저리까지 내려 섬 — 너무 높이 떠 있으면 이어 칠 첫 공중 약이 머리 위로 헛침 (10.16)
    if (standingOn(mapOf(s), o)) f.h = Math.min(f.h, o.h + DIVE_LOW * SUB);
    // 앞으로 미끄러지며 내리찍어 상대 머리 위 · 뒤로 넘어가 맞히면 이어 칠 공중 약이 앞으로만 나가 헛침 → 상대 바로 앞으로 (10.22)
    if (((o.x - f.x) * f.face) / SUB < DIVE_GAP) {
      let nx = o.x - f.face * DIVE_GAP * SUB;
      if (nx < WALL_L || nx > WALL_R) ((f.face = -f.face as 1 | -1), (nx = o.x - f.face * DIVE_GAP * SUB));
      f.x = Math.max(WALL_L, Math.min(WALL_R, nx));
    }
    f.hold = charOf(f).moves.S.air?.timeStop ?? 30;
    return;
  }
  // 되감긴 자리에서 0.5초 둥실 머묾 (바로 떨어지면 대비할 틈이 없음, 10.16) — 점프하면 끝 (건모 Alt+Tab 과 같은 hold)
  f.hold = 30;
  s.ev.push({ k: "rewind", p: i, x: fx, h: fh, v: -1 });
  s.ev.push({ k: "rewind", p: i, x: f.x, h: f.h, v: 0 });
}

/** 포르테 「앙코르」: 맞힌 타격 기록 · 필살기가 맞으면 기록한 타격을 같은 박자로 다시 넣음 */
function encoreStep(s: State) {
  for (let i = 0; i < 2; i++) {
    const f = s.p[i];
    const X = charOf(f).moves.X;
    const en = X.encore;
    if (!en) continue;
    const o = s.p[1 - i];
    // 기록: 이번 프레임 내가 맞힌 타 (앙코르 자체 · 필살기 빼고)
    if (f.encT === 0)
      for (const e of s.ev)
        if (e.k === "hit" && e.p === i && e.m !== "X" && e.v > 0) f.enc.push(s.f, e.v);
    while (f.enc.length && s.f - f.enc[0] > en.win) f.enc.splice(0, 2);
    while (f.enc.length > en.max * 2) f.enc.splice(0, 2);
    // 시작: 필살기가 막히지 않고 맞음
    if (f.encT === 0 && f.st === "atk" && f.mv === "X" && s.ev.some((e) => e.k === "hit" && e.p === i && e.m === "X")) {
      const t0 = f.enc.length ? f.enc[0] : s.f;
      f.encQ = [];
      for (let k = 0; k < f.enc.length; k += 2) f.encQ.push(f.enc[k] - t0 + 14, f.enc[k + 1]);
      f.enc = [];
      f.encT = 1;
      f.encX = o.x;
      f.encH = o.h;
      s.ev.push({ k: "encore", p: i, x: o.x, h: o.h, v: f.encQ.length >> 1 });
      continue;
    }
    if (f.encT === 0) continue;
    if (o.hp <= 0 || s.phase !== "fight") {
      f.encT = 0;
      f.encQ = [];
      continue;
    }
    f.encT++;
    // 붙잡아 둠: 포르테는 필살기 자세 그대로, 상대는 그 자리에서 맞는 중
    f.st = "atk";
    f.mv = "X";
    f.t = X.startup + X.active - 1;
    f.vx = 0;
    f.vh = 0;
    o.st = "hit";
    o.stun = Math.max(o.stun, 12);
    o.kd = 0;
    o.x = f.encX;
    o.h = f.encH;
    o.vx = 0;
    o.vh = 0;
    for (let k = 0; k < f.encQ.length; k += 2)
      if (f.encQ[k] === f.encT) {
        const dmg = Math.max(1, Math.trunc((f.encQ[k + 1] * en.pct) / 100));
        o.hp = Math.max(0, o.hp - dmg);
        o.combo++;
        s.stop = Math.max(s.stop, 2);
        s.ev.push({ k: "hit", p: i, x: o.x, h: o.h + 28 * SUB, v: dmg, m: "X" });
      }
    const last = f.encQ.length ? f.encQ[f.encQ.length - 2] : 0;
    if (f.encT >= last + 18) {
      // 마무리: 날려 버림
      f.encT = 0;
      f.encQ = [];
      f.t = X.startup + X.active;
      const dmg = Math.max(1, scaleDmg(en.fin, o.combo));
      o.hp = Math.max(0, o.hp - dmg);
      o.combo++;
      o.kd = 1;
      o.stun = 30;
      o.vh = 1400;
      o.h += SUB;
      o.vx = (o.x >= f.x ? 1 : -1) * 900;
      s.stop = Math.max(s.stop, 10);
      s.ev.push({ k: "hit", p: i, x: o.x, h: o.h + 28 * SUB, v: dmg, m: "X" });
    }
  }
}

/** 한 프레임 진행 (s를 직접 바꿈 — 보관이 필요하면 clone 먼저) */
export function step(s: State, input: [number, number]): State {
  s.ev = [];
  s.f++;
  // 멈춘 프레임(히트스톱·필살 연출)엔 입력 기록을 밀지 않고 마지막 칸에 겹쳐 둠
  // → 멈춘 동안 누른 버튼이 풀리는 순간 "방금 누름"으로 남아 캔슬·연타가 씹히지 않음
  // (인트로·라운드 끝에도 그대로 기록 — 0으로 채우면 누르고 있던 버튼이 시작하자마자 "새로 누름"이 됨)
  const frozen = s.phase !== "over" && (s.freeze > 0 || s.stop > 0);
  for (let i = 0; i < 2; i++) {
    const h = s.p[i].hist;
    const v = input[i] & IN_MASK;
    if (frozen) h[HIST - 1] |= v;
    else {
      h.shift();
      h.push(v);
    }
  }
  if (s.phase === "over") {
    // 경기 끝: 하던 동작은 마저 끝내고, 이긴 쪽은 계속 승리 포즈
    s.pt++;
    for (let i = 0; i < 2; i++) {
      settle(s, i, s.winner === i);
      physics(s, i);
    }
    return s;
  }
  if (s.freeze > 0) {
    s.freeze--;
    return s;
  }
  if (s.stop > 0) {
    s.stop--;
    return s;
  }

  if (s.phase === "intro") {
    s.pt++;
    for (const f of s.p) f.t++;
    if (s.pt >= INTRO) {
      s.phase = "fight";
      s.pt = 0;
      s.ev.push({ k: "fight", p: -1, x: 0, h: 0, v: 0 });
    }
    return s;
  }

  if (s.phase === "fight") {
    s.pt++;
    if (s.timer > 0) s.timer--;
    for (const f of s.p) {
      if (f.cd > 0) f.cd--;
      if (f.shock > 0) f.shock--;
      if (f.burn > 0) {
        f.burn--;
        if (f.burn % BURN_EVERY === 0 && f.hp > 1) {
          // 겹마다 초당 최대 체력 0.2% (15프레임마다 0.05%) — 나머지는 모아 둠
          f.burnAcc += CHARS[f.ch].hp * f.burnN * 5;
          const dmg = Math.trunc(f.burnAcc / 10000);
          f.burnAcc -= dmg * 10000;
          if (dmg) f.hp = Math.max(1, f.hp - dmg);
        }
        if (f.burn === 0) ((f.burnN = 0), (f.burnAcc = 0));
      }
    }
    // 일섬 낙인이 터짐 (때린 쪽 = 상대)
    for (let i = 0; i < 2; i++) {
      const f = s.p[i];
      if (f.zap > 0 && --f.zap === 0) zapBurst(s, 1 - i);
    }
    control(s, 0);
    control(s, 1);
  } else {
    // roundEnd: 조작 없이 물리만, 이긴 쪽은 승리 포즈
    s.pt++;
    for (let i = 0; i < 2; i++) settle(s, i, s.pt > 50 && s.roundWinner === i);
  }

  const x0 = [s.p[0].x, s.p[1].x];
  physics(s, 0);
  physics(s, 1);
  carryDashGrab(s, x0);
  separate(s);

  if (s.phase === "fight") {
    projectiles(s);
    attacks(s);
    for (let i = 0; i < 2; i++) {
      const f = s.p[i];
      // (낭떠러지로 내리찍어 떨어지는 중이면 260px 아래에서 되감음)
      if (f.st === "atk" && f.mv === "S" && f.aerial && moveOf(f)?.rwDive && (f.hit || (f.dive && f.rwH - f.h > 260 * SUB))) rewindDive(s, i);
    }
    encoreStep(s);
    // 경직에서 풀린 프레임에 안 맞았으면 콤보 끝
    for (const f of s.p) {
      if (f.recov && f.st !== "hit" && f.st !== "down") f.combo = 0;
      f.recov = 0;
    }
    checkKO(s);
    if (s.phase === "fight" && s.timer <= 0) {
      // 시간 끝: 남은 체력 비율로
      const r0 = Math.trunc((s.p[0].hp * 1000) / CHARS[s.p[0].ch].hp);
      const r1 = Math.trunc((s.p[1].hp * 1000) / CHARS[s.p[1].ch].hp);
      endRound(s, r0 > r1 ? 0 : r1 > r0 ? 1 : 2);
    }
  } else if (s.phase === "roundEnd" && s.pt >= ROUND_END) {
    const [w0, w1] = s.wins;
    if (w0 >= WINS_NEEDED || w1 >= WINS_NEEDED || s.round >= MAX_ROUNDS) {
      s.phase = "over";
      s.pt = 0;
      s.winner = w0 > w1 ? 0 : w1 > w0 ? 1 : 2;
    } else nextRound(s);
  }
  return s;
}

/** 화면 표시용: 체력·게이지 비율 등 */
export const hpRatio = (f: Fighter) => f.hp / CHARS[f.ch].hp;
/** 공중인지 (AI·그림용) */
export const isAir = (s: State, f: Fighter) => airborneS(s, f);
export { charOf, moveOf, totalOf, mapOf, finishRec };

/** 지금 하는 기술의 정의 (연습 모드 프레임 데이터용 — 연속 동작 마무리 빈틈 · 공중 · 돌진 잡기 · 모으기 반영) */
export const moveData = (f: Fighter) => {
  const m = moveOf(f);
  return m ? { ...m, recovery: m.recovery + finishRec(f) } : null;
};
