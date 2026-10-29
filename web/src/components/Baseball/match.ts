/**
 * 경기 진행 (화면 · 입력 · 연출). 규칙은 lib/baseball/game.ts, 공 하나 처리는 resolve.ts.
 *
 * 한 타석 흐름
 *   준비(돌발미션) → [사용자 투수] 구종 · 코스 → 게이지 → (마구면 컷인) → 와인드업 → 공 → 스윙/판정
 *                    [사용자 타자] (필살 · 번트 준비) → 와인드업 → 공 → 스윙 타이밍 → 판정
 *   → 인플레이면 필드 화면(수비 · 주루 재생) → 결과 문구 → 다음 타자 · 공수 교대 · 경기 끝
 * 홈런더비: 같은 타석 화면, 아웃 10개까지 비거리 합 (골든 보드)
 */
import { cpuGauge, cpuPlan, cpuSwing, cpuUseSpecial, SPEED_SCALE, type Diff } from "@/lib/baseball/ai";
import { CZ_MOVE, CZ_RANGE, contactZone, timingLabel, timingWindow } from "@/lib/baseball/contact";
import { BP_PITCHER, TEAM_DEFS, artUrl, charById, cutinUrl, faceUrl, hasSwingArt, swingArtUrl, makeTeam, seasonOf, swingOf, type Batter, type CharId, type Pitcher, type Team } from "@/lib/baseball/data";
import { advanceToMyPA, botHook, mySide, newCareerGame, quickPA, slotName, type CareerSetup, type MyPA, type RecapLine } from "@/lib/baseball/careerGame";
import {
  BAT_BUNT, BAT_IDLE, BAT_LOAD, BAT_SWING, BATS, BATTER_RIG, HAIR, HELMETS, PIT_IDLE, PIT_RIG_RELEASE_T, PIT_THROW, PITCH_RELEASE_T, PITCHER_RIG,
  SKIN_TONES, SWING_HIT_T, baseSkin,
} from "@/lib/baseball/figures";
import {
  batSide, batter as curBatter, changePitcher, cpuManage, fieldSide, maybeMission, mvp, newGame, nextHalf, pitcher as curPitcher,
  stamina01, staminaMax, userBatting, type GameState, type Mission, type PAKind, type PAResult,
} from "@/lib/baseball/game";
import { logPlay, logUi } from "@/lib/baseball/telemetry";
import { BALL_R, PITCHES, ZONE, inZone, makePitch, mistakeChance, pitchAt, plateCross, type Pitch, type PitchKind } from "@/lib/baseball/pitch";
import { predictBall, type FieldEvent, type FieldOut, type Frame } from "@/lib/baseball/play";
import { veloKmh } from "@/lib/baseball/club";
import { batterShift, commit, effectiveHit, evaluate, hitByPitch, type Outcome, type SwingDecision } from "@/lib/baseball/resolve";
import { lookColors, lookSkin, uniColors } from "@/lib/baseball/look";
import { batterFrame, batterSheets, drawable, drawBatter, sheetImage, KICK_HOLD_T, KICK_STEP_T, preloadBatter, strideProg, strideStartFor, syncIdleTo, walkinFrame, WALKIN_IDLE_CELL, WALKIN_LEN, type SpriteLook } from "@/lib/baseball/batterSprite";
/** 빈 스윙 한 번 길이 (이 시간 지나면 다시 휘두를 수 있고, 하던 자세로 돌아감) */
const FREE_SWING_T = 0.5;
import { BATCOL } from "@/lib/baseball/look";
import { boneTip, drawRig, pose, type Anim, type RigColors, type Skin } from "@/lib/baseball/rig";
import { clamp, lerp, makeRng, smooth, type Rng } from "@/lib/baseball/rng";
/** 필살타법 사이드 컷인 길이 (초) */
const SIDE_CUT_DUR = 1.35;
import pitcherThrowData from "@/data/baseball/pitcher-throw.json";
import { sfx } from "./sfx";
import { DH, DW, PITCHER_FEET, PROJ3D, ballProj, battingBg, drawFieldFrame, fieldBg, fproj, proj, shadowProj, unprojPlate } from "./view";
import type { World3D } from "./three/world3d";
import { drawCatcher, drawPvBatter, drawPvPitcher, drawPvZone, drawUmpire, pvBackground, pvCam, pvProj, pvUnproj, type PvBatPose } from "./pitchView";

/** 투수 그림 (pitcher-set.webp): 발 기준점 · 크기 (키 ≈ 115px, 목업 크기) */
// scale: 낮은 정면 시점 구장(bat-low)의 투수판 크기에 맞춤 (예전 0.229 → 0.16) → 0.1956: 키 1.22배로 공 놓는 손을 20px 위로
//   (손이 존 위 끝과 거의 같은 높이라 높은 볼이 홈 앞에서 솟아 보였음 — 발은 투수판 그대로, view.ts BC 도 손 229 에 맞춤)
/** 실투: 「! 실투」 보여 주고 와인드업 시작까지 쉬는 시간 (초) */
const MISTAKE_TELL = 0.5;
/** 날아오는 공 꼬리 길이 (초) · 나눌 점 수 */
const TRAIL_SEC = 0.13;
const TRAIL_N = 18;
/** 타석 화면 수비수 그림 (GPT — 투수 그림체 · 정면) · 실제 원근 대비 키 배율 (투수 그림과 비슷하게) */
const FIELDER = { inf: "/baseball/sprites/fielder-if-ready.webp", of: "/baseball/sprites/fielder-of-ready.webp" } as const;
/** 타석 화면에 그리는 수비 자리 (m, HOME_POS 순서) — 실제 수비 위치처럼 조금씩 어긋나게: 1루수 베이스 쪽 · 유격수 깊게 · 3루수 얕게 · 외야 살짝 우중간 */
const FIELDER_SPOT: [number, number][] = [[0, 18.4], [0, -1.6], [18.5, 28.5], [10.5, 40.5], [-16, 24.5], [-8, 42], [-29, 76], [2.5, 95], [33.5, 82]];
/** 루상 주자 (공격 팀 · 타자와 같은 주황 유니폼) — 서 있는 그림 키 753px = 1.75m */
const RUNNER = { lead: "/baseball/sprites/runner-lead.webp", hands: "/baseball/sprites/runner-hands.webp", ref: 753 } as const;
/** 주자 리드 자리 (m): 1루 → 2루 쪽 3.5m · 2루 → 3루 쪽 4m · 3루는 파울 쪽 선 따라 홈 쪽 */
const RUNNER_SPOT: [number, number][] = [[16.9, 21.9], [-2.9, 35.9], [-18.6, 17]];
const FIELDER_H = [1, 1, 1.03, 0.97, 1, 0.98, 1.02, 1, 0.99];
const FIELDER_BOOST = 1.8;
/** 특수능력 발동 연출 길이 · 시간이 흐르는 화면 */
const BOOST_DUR = 2.8;
/**
 * 경기 템포 (초) — 컴프야 v24 · 마구마구 영상 프레임으로 잰 것에 맞춤 (2026-10-28):
 *   공 도착 → 다음 공 도착: 컴프야 약 4.8초 · 마구마구 약 4초 · 우리(예전) 3.65초 → 4.3초쯤
 *   타석 끝 → 다음 타자 첫 공: 컴프야 약 8초(타자 등장 컷 포함) · 마구마구 약 4초 · 우리(예전) 2.6초 → 4초쯤
 * call: 볼 · 스트라이크 판정 보여 주는 시간 · ready: 다음 공 전 숨 고르기 · first: 타석 첫 공 전 ·
 * result: 타석 결과 배너 · change: 공수 교대
 */
const TEMPO = { call: 1.1, ready: 1.4, first: 1.9, result: 2.0, change: 2.4 };
/** 타석에 걸어 들어오기 재생 속도 · 다 들어온 뒤 첫 공까지 숨 고르기 */
const WALK_SPEED = WALKIN_LEN / 3.3;
const WALK_SETTLE = 0.7;
const BOOST_PHASES: Phase[] = ["ready", "windup", "flight", "contact", "call"];
/** HUD · 이펙트 그림 (GPT 이미지 → public/baseball/ui) */
const UI = {
  profile: "/baseball/ui/profile.webp",
  burst: "/baseball/ui/burst.webp",
  ring: "/baseball/ui/ring.webp",
  homerun: "/baseball/ui/homerun.webp",
} as const;
const PITCHER_STILL = { src: "/baseball/sprites/pitcher-set.webp", ax: 85, ay: 503, scale: 0.1956 };
/**
 * 투구 줄 (그록 영상 → scripts/baseball-pitcher-video.py): 세트 → 다리 들기 → 내딛기 → 공 놓기(PITCH_RELEASE_T) → 팔로스루.
 * 영상 캔버스 = 세트 그림 × 520/506 × 1.1 이라 캔버스 1px = PITCHER_STILL.scale / 1.1304 게임 px, 줄 칸은 캔버스 × cell.
 * hand = 공 놓는 자리 (캔버스 px, 축발 기준)
 */
const PITCHER_THROW_SRC = "/baseball/sprites/pitcher-throw.webp";
const PITCHER_THROW = { src: PITCHER_THROW_SRC, ...pitcherThrowData };
const PIT_CANVAS_PX = PITCHER_STILL.scale / ((520 / 506) * 1.1);
const PIT_THROW_SEQ = pitcherThrowData.seq as [number, number][];

export type Mode = "game" | "derby" | "career";

export interface MatchCfg {
  mode: Mode;
  diff: Diff;
  innings: number;
  userHome: boolean;
  /** 육성 경기: 팀 · 내 타순 (내 타석만 직접, 나머지는 빠르게) */
  career?: CareerSetup;
  /** 하이라이트: 내 타석도 찬스 · 돌발미션 · 7회부터 접전일 때만 직접 (나머지는 봇이 침) */
  highlight?: boolean;
  /** 배속 — 자동 진행(수비 · 주루 · 공수 교대)만 빨라짐. 투구 · 스윙 · 투구 결과 문구는 제 속도 */
  speed?: number;
  /**
   * 인연 대결 (mode "derby" 로 돌림): 그 캐릭터가 공 N개를 던지고 내 육성 선수가 침.
   * 안타 1점 · 홈런 2점, need 점이면 승리. magic = 마구를 던지는 공 순서 (0부터). 볼(안 친 것)은 다시 던짐.
   */
  bond?: { char: CharId; pitches: number; need: number; magic: readonly number[]; batter: Batter; title: string };
  /** 정해진 두 팀으로 (구단 · 온라인 대결) — 없으면 기본 팀 vs 아무 팀. mine = 사용자 팀 */
  teams?: { mine: Team; cpu: Team };
  seed?: number;
  /** 연습 경기: 한쪽만 직접 — "bat" 공격만(수비 이닝은 자동) · "pit" 수비만(공격 이닝은 자동). 없으면 둘 다 */
  only?: "bat" | "pit";
  /** 관리자 테스트: 상대(봇) 투수 전원 구속 · 변화를 이 능력치(0~1000)로 (없으면 원래 값) */
  testPit?: { velo?: number; brk?: number };
}

export type Phase =
  | "intro" | "mission" | "ready" | "aim" | "gauge" | "cutin" | "windup" | "flight" | "contact"
  | "call" | "field" | "result" | "change" | "over" | "recap";

export interface UiState {
  phase: Phase;
  mode: Mode;
  userBat: boolean;
  /** 사용자 타자 · 투수 차례에 누를 수 있는 것 */
  canSwing: boolean;
  /** 투구 전 (준비 · 와인드업) — 타자 · 컨택존 옮기기 */
  canMove: boolean;
  bunt: boolean;
  spArmed: boolean;
  /** 필살 · 마구를 쓸 수 있는 선수인가 + 남은 수 */
  spHero: boolean;
  spLeft: number;
  spName: string;
  /** 필살타법 — 지금 K 로 바로 칠 수 있나 (공이 날아오는 중 · 아직 안 휘두름) · 캐릭터 · 타자 왼손 */
  spNow: boolean;
  spChar: CharId | null;
  lefty: boolean;
  /** 육성: 아직 내 첫 타석 첫 공 전이라 경기 시작을 없던 걸로 할 수 있음 */
  canCancel: boolean;
  /** 타자 · 투수 카드가 아래에 떠 있음 (타석 준비) — 그동안 아래쪽 버튼은 숨김 */
  cards: boolean;
  kinds: { id: PitchKind; name: string }[];
  kind: number;
  aiming: boolean;
  gauging: boolean;
  bullpen: { idx: number; name: string; role: string; hero: boolean; used: boolean; cur: boolean }[];
  fieldPlaying: boolean;
  fast: boolean;
  over: null | { win: boolean | null; score: [number, number]; mvp: string; pt: number; derby?: { dist: number; hr: number; best: number }; bond?: { pts: number; need: number } };
  paused: boolean;
  /** 배속 (경기 안에서도 바꿈) */
  speed: number;
  /** 육성 경기: 지금 방식 · 다음 타석부터 바뀔 방식 */
  career: null | { mode: "direct" | "highlight"; next: "direct" | "highlight" | "auto" | null };
}

interface Banner {
  text: string;
  sub?: string;
  color: string;
  t: number;
  dur: number;
  big?: boolean;
  /** 글자 대신 그림 로고 (홈런 등) */
  logo?: string;
}

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  t: number;
}

const SAVE = "pxb:v1";
export interface Save {
  pt: number;
  derbyBest: number;
  games: number;
  wins: number;
}
export function loadSave(): Save {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE) ?? "null");
    if (s && typeof s.pt === "number") return { pt: s.pt, derbyBest: s.derbyBest ?? 0, games: s.games ?? 0, wins: s.wins ?? 0 };
  } catch {}
  return { pt: 0, derbyBest: 0, games: 0, wins: 0 };
}
function writeSave(s: Save) {
  try {
    localStorage.setItem(SAVE, JSON.stringify(s));
  } catch {}
}

const imgCache = new Map<string, HTMLImageElement>();
function img(url: string) {
  let im = imgCache.get(url);
  if (!im && typeof Image !== "undefined") {
    // 큰 시트(투수 투구 48칸)는 ImageBitmap 으로 미리 풀어 둠 — drawable() 로 그림
    im = url === PITCHER_THROW_SRC ? sheetImage(url) : new Image();
    if (url !== PITCHER_THROW_SRC) im.src = url;
    imgCache.set(url, im);
  }
  return im!;
}

/** 팀 색으로 리그 색 만들기 */
function colorsFor(team: { color: string; dark: string }, seed: number, num: number, name: string, accent?: string): RigColors {
  return {
    team: team.color,
    dark: team.dark,
    skin: SKIN_TONES[seed % SKIN_TONES.length],
    hair: HAIR[seed % HAIR.length],
    pants: "#eef0f4",
    accent: accent ?? "#f2f2f2",
    num: String(num),
    name,
  };
}

/** 돌발 미션 주는 팀 사람들 초상 */
const NPC_FACE: Record<string, string> = {
  감독: "/baseball/ui/npc-manager.webp",
  주장: "/baseball/ui/npc-captain.webp",
  선배: "/baseball/ui/npc-senior.webp",
  안경: "/baseball/ui/npc-glasses.webp",
  후배: "/baseball/ui/npc-junior.webp",
};
const NPC_COLOR: Record<string, string> = { 감독: "#ffcf4a", 주장: "#7ad7ff", 선배: "#ff7a7a", 안경: "#b6ffb0", 후배: "#ffb0e6" };

export class Match {
  cfg: MatchCfg;
  rng: Rng;
  s: GameState;
  ui: UiState;
  private onUi: (u: UiState) => void;
  save: Save;

  phase: Phase = "intro";
  pt = 0; // phase time
  time = 0;
  night: boolean;

  // 타석
  pitch: Pitch | null = null;
  tf = 0;
  outcome: Outcome | null = null;
  decision: SwingDecision | null = null;
  swingStart = -1;
  /** 사용자 입력 */
  buntArmed = false;
  spArmed = false;
  /** 이번 공에 필살타법을 맞혀서 썼는지 */
  spSpent = false;
  /** 타자 내딛기 시작 (레그킥 시계 · 공 놓을 때 정함) */
  strideAt = Infinity;
  /** 3D 경기 화면 (불러온 뒤 BaseballApp 이 넣어 줌 — 없으면 2D 그림) · 이번 프레임에 3D 로 그렸는지 */
  w3d: World3D | null = null;
  private on3d = false;
  private fieldOut: FieldOut | null = null;
  kindIdx = 0;
  target = { x: 0, y: ZONE.mid };
  gaugeT = 0;
  gaugeVal = 0;
  quality = 0.7;
  useBallSp = false;
  cpuUseSp = false;
  contactShown = false;
  batTilt = 0;
  timingText = "";
  timingPerfect = false;
  /** 판정 글자가 뜬 뒤 시간 (튀어나오는 연출) */
  timingT = 0;
  /** 그림 이펙트 (맞는 순간 섬광 · 충격파 링) */
  fxs: { src: string; x: number; y: number; t: number; dur: number; size: number; grow: number; rot: number }[] = [];
  /** 타석에 들어설 때 (또 2스트라이크 · 득점권 · 7회 이후처럼 상황이 맞을 때) 경기 능력치 특수능력 발동 연출 */
  boostFx: { t: number; items: { name: string; text: string }[]; bonus: { hit: number; power: number; run: number }; head: string } | null = null;
  private lastStrikes = 0;
  /** 타자 · 투수 카드 보임 정도 (0 ~ 1) · 이번 타석에서 이미 빠졌는지 */
  cardK = 0;
  private cardsGone = false;
  /** 이번 타석 첫 공 전 (타자가 타석에 들어서는 숨 고르기 조금 더) */
  private paFirst = false;
  /** 타석에 걸어 들어오는 시간 (WALKIN_LEN 넘으면 끝 · Infinity = 안 함) */
  walkT = Infinity;
  private walkPending = false;
  private get walking() {
    return this.walkPending || this.walkT < WALKIN_LEN;
  }
  /** 다 걸어 들어온 시각 (this.time · 없으면 -1) */
  private walkDoneAt = -1;
  pitchInfo = "";
  lastCall = "";

  // 필드
  frames: Frame[] = [];
  events: FieldEvent[] = [];
  evIdx = 0;
  ft = 0;
  fast = false;
  trail: { x: number; y: number; h: number }[] = [];
  hitPath: { x: number; y: number; h: number }[] = [];
  hr = false;
  hrDist = 0;

  pending: PAResult | null = null;
  banner: Banner | null = null;
  popups: Popup[] = [];
  cutin: null | { id: CharId; title: string; sub: string; t: number; side: "bat" | "pit" } = null;
  shake = 0;
  flash = 0;
  /** 히트스톱 (남은 초) — 공 · 배트만 멈춤 */
  hitStop = 0;
  /** 홈런 연출: 슬로모션 · 줌 (남은 초) */
  slowmo = 0;
  zoomT = 0;
  /** 타이밍 오차 ms (+ 늦음) */
  /** 타이밍 오차 / 맞힘 창 (0 = 딱 맞음, ±1 = 창 끝) */
  timingR = 0;
  /** 타구 정보 (타구속도 · 비거리) */
  batInfo: { text: string; t: number } | null = null;
  /** 움직임 줄이기 (흔들림 · 줌 끔) */
  reduceMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  particles: { x: number; y: number; vx: number; vy: number; life: number; c: string }[] = [];
  /** 임팩트 순간 터지는 링 · 빛살 (t 는 0 → 0.22초) */
  impact: { x: number; y: number; t: number; q: number; perfect: boolean } | null = null;
  paused = false;

  // 리그
  batSkin: Skin;
  pitSkin: Skin;
  batAnim: Anim = BAT_IDLE;
  batAnimT = 0;
  batFrom: { a: Anim; t: number; k: number } | undefined;
  pitAnim: Anim = PIT_IDLE;
  pitAnimT = 0;

  // 홈런더비
  /** 육성: 다음 타석부터 바꿀 진행 방식 (지금 타석은 그대로 — 결과 보고 도망 못 가게) */
  afterMode: "direct" | "highlight" | "auto" | null = null;
  /** 육성: 내 타석 수 · 돌발미션 성공 수 */
  paCount = 0;
  missionsOk = 0;
  myPAs: MyPA[] = [];
  private rbiBefore = 0;

  derby = { outs: 0, dist: 0, hr: 0, boss: null as CharId | null, bossLeft: 0, longest: 0 };
  /** 인연 대결: 던진 공 · 점수 · 볼 수 · 공마다 결과 */
  bondSt = { idx: 0, pts: 0, balls: 0, marks: [] as ("hit" | "hr" | "out" | null)[] };

  constructor(cfg: MatchCfg, onUi: (u: UiState) => void) {
    this.cfg = cfg;
    this.onUi = onUi;
    this.rng = makeRng(cfg.seed);
    this.night = this.rng() < 0.5;
    this.save = typeof window === "undefined" ? { pt: 0, derbyBest: 0, games: 0, wins: 0 } : loadSave();
    const mine = TEAM_DEFS[0];
    const others = TEAM_DEFS.slice(1);
    const cpuDef = this.rng.pick(others);
    // 마선수 없음 — 캐릭터는 인연(대결)에서만 던지고 침
    let myTeam = cfg.teams?.mine ?? makeTeam(mine, this.rng);
    let cpuTeam = cfg.teams?.cpu ?? makeTeam(cpuDef, this.rng);
    const tp = cfg.testPit;
    if (tp) cpuTeam = { ...cpuTeam, pitchers: cpuTeam.pitchers.map((pp) => ({ ...pp, velo: tp.velo ? veloKmh(tp.velo) : pp.velo, brk: tp.brk ?? pp.brk })) };
    if (cfg.bond) {
      const b = cfg.bond.batter;
      myTeam = { ...myTeam, batters: myTeam.batters.map(() => ({ ...b })) };
      this.derby.boss = cfg.bond.char;
      this.derby.bossLeft = 999;
      this.bondSt.marks = Array.from({ length: cfg.bond.pitches }, () => null);
    } else if (cfg.mode === "derby") {
      // 4번 타자가 계속 침
      const slugger = myTeam.batters[3];
      myTeam = { ...myTeam, batters: myTeam.batters.map(() => ({ ...slugger })) };
    }
    this.s = cfg.career ? newCareerGame(cfg.career) : newGame({
      innings: cfg.innings,
      diff: cfg.diff,
      userHome: cfg.mode === "derby" ? true : cfg.userHome,
      away: cfg.mode === "derby" ? cpuTeam : cfg.userHome ? cpuTeam : myTeam,
      home: cfg.mode === "derby" ? myTeam : cfg.userHome ? myTeam : cpuTeam,
    });
    if (cfg.mode === "derby") {
      this.s.top = false;
      this.s.line[1][0] = 0;
      // 인연 대결: 필살타법은 한 번
      if (cfg.bond) this.s.sides[1].swingLeft = cfg.bond.batter.learned ? 1 : 0;
    }
    this.batSkin = baseSkin();
    this.pitSkin = baseSkin();
    // 육성: 첫 내 타석까지 미리 진행해 둠 — 인트로 동안 1번 타자가 서 있다가 내 선수로 휙 바뀌던 문제
    if (cfg.career) {
      this.recapBase = this.snapRecap();
      this.careerAdvance(false, this.pendingLines);
      this.preAdvanced = true;
      this.updateSkins();
    }
    void preloadBatter();
    this.ui = this.makeUi();
    this.setBanner(
      cfg.bond ? cfg.bond.title : cfg.mode === "derby" ? "HOME RUN DERBY" : "PLAY BALL!",
      cfg.bond ? `${charById(cfg.bond.char).name}의 공 ${cfg.bond.pitches}개 · ${cfg.bond.need}점이면 승리 · 안타 1점 · 홈런 2점` : cfg.mode === "derby" ? "아웃 10개까지 · 비거리 합" : cfg.career ? `${slotName(cfg.career.myIdx)} 타자로 출전 · 내 타석만 직접 쳐요` : `${this.s.opts.away.name} vs ${this.s.opts.home.name}`,
      "#ffcf4a",
      1.6,
      true
    );
    sfx.cheer(0.6);
  }

  // ───────────── 상태 ─────────────
  get userBat() {
    return userBatting(this.s);
  }
  get batterNow() {
    return curBatter(this.s);
  }
  get pitcherNow(): Pitcher {
    if (this.cfg.mode === "derby") {
      if (this.derby.boss) {
        const c = charById(this.derby.boss);
        return { name: c.name, num: 0, role: "CL", throws: c.throws, ...c.pit, special: c.id };
      }
      return BP_PITCHER;
    }
    return curPitcher(this.s);
  }
  get speedScale() {
    return SPEED_SCALE[this.cfg.diff];
  }
  private userSide() {
    return this.s.sides[this.s.opts.userHome ? 1 : 0];
  }

  private makeUi(): UiState {
    const ub = this.userBat;
    const b = this.batterNow;
    const p = this.pitcherNow;
    const us = this.userSide();
    const bSw = swingOf(b);
    const hero = ub ? !!bSw : !!p.special;
    const sp = hero ? (ub ? charById(bSw!) : charById(p.special!)) : null;
    const fsd = this.s.sides[fieldSide(this.s)];
    return {
      phase: this.phase,
      mode: this.cfg.mode,
      userBat: ub,
      canSwing: ub && this.swingStart < 0 && !this.walking && (this.phase === "ready" || this.phase === "windup" || this.phase === "flight" || this.phase === "call" || this.phase === "result"),
      canMove: ub && this.czMovable,
      bunt: this.buntArmed,
      spArmed: ub ? this.spArmed : this.useBallSp,
      spHero: hero && (this.cfg.mode !== "derby" || ub),
      spLeft: this.cfg.bond ? (ub ? us.swingLeft : 0) : this.cfg.mode === "derby" ? (ub ? 99 : 0) : ub ? us.swingLeft : us.ballLeft,
      spName: sp ? (ub ? sp.swing.name : sp.ball.name) : "",
      spNow: ub && !!bSw && this.phase === "flight" && this.swingStart < 0 && !this.hbpHit && !this.buntArmed && (this.cfg.mode === "derby" && !this.cfg.bond ? true : us.swingLeft > 0),
      spChar: sp ? sp.id : null,
      lefty: b.bats === "L",
      cards: !this.cardsGone && (this.phase === "ready" || this.phase === "aim"),
      canCancel: !!this.cfg.career && !this.s.over && this.paCount <= 1 && !this.myPAs.some((x) => !x.auto) && this.s.balls === 0 && this.s.strikes === 0 && ["intro", "recap", "mission", "ready"].includes(this.phase),
      kinds: p.rep.map((k) => ({ id: k, name: PITCHES[k].name })),
      kind: this.kindIdx,
      aiming: !ub && this.phase === "aim",
      gauging: !ub && this.phase === "gauge",
      bullpen: ub || this.cfg.mode === "derby"
        ? []
        : fsd.team.pitchers.map((pp, i) => ({ idx: i, name: pp.name, role: pp.role === "SP" ? "선발" : pp.role === "CL" ? "마무리" : "불펜", hero: !!pp.special, used: fsd.used.includes(i) && i !== fsd.pitcher, cur: i === fsd.pitcher })),
      fieldPlaying: this.phase === "field",
      fast: this.fast,
      over: this.ui?.over ?? null,
      paused: this.paused,
      speed: this.cfg.speed ?? 1,
      career: this.cfg.career ? { mode: this.cfg.highlight ? "highlight" : "direct", next: this.afterMode } : null,
    };
  }
  private pushUi() {
    const u = this.makeUi();
    const a = JSON.stringify(u);
    if (a !== JSON.stringify(this.ui)) {
      this.ui = u;
      this.onUi(u);
    }
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.pt = 0;
  }
  private setBanner(text: string, sub: string | undefined, color: string, dur = 1.2, big = false) {
    this.banner = { text, sub, color, t: 0, dur, big };
  }
  private popup(x: number, y: number, text: string, color = "#fff") {
    this.popups.push({ x, y, text, color, t: 0 });
  }
  /** 스윙 버튼 때 스트라이드(디딤발 내딛기) 진행도 — 1 이면 배트만 돌림 */
  private swingSp = 1;
  private playBat(a: Anim) {
    if (a === BAT_SWING) this.swingSp = this.batAnim === BAT_LOAD ? strideProg(this.batAnimT, this.strideAt) : 0;
    this.batFrom = { a: this.batAnim, t: this.batAnimT, k: 0 };
    this.batAnim = a;
    this.batAnimT = 0;
  }

  // ───────────── 타석 준비 ─────────────
  /** 육성: 다음 내 타석까지 빠르게 진행 → 그 사이 내 자동 타석들 */
  private preAdvanced = false;
  /** 건너뛴 타석들 (다음 beginPA 에서 「경기 요약」으로 보여 줌) */
  private pendingLines: RecapLine[] = [];
  /** 경기 요약 (문자중계): 건너뛴 타석을 한 줄씩 — 탭 · Space 로 건너뛰기 */
  recap: { lines: RecapLine[]; shown: number; t: number; step: number; hold: number } | null = null;
  private recapJustShown = false;
  /** 요약 시작 때 상태 (첫 줄 전 점수표 · 주자) */
  private recapBase: RecapBase | null = null;
  /** 오늘 타석 기록 (팀 → 타순 → 「안타」 「삼진」 …) — 중계 화면 타순표 */
  hist: string[][][] = [Array.from({ length: 9 }, () => []), Array.from({ length: 9 }, () => [])];

  private careerAdvance(allAuto: boolean, log?: RecapLine[]): MyPA[] {
    const s = this.s;
    const c = this.cfg.career!;
    const autos = advanceToMyPA(s, c.myIdx, this.rng, this.cfg.highlight || allAuto ? botHook(this.cfg.diff, allAuto) : undefined, this.myPAs.filter((p) => !p.auto).length, allAuto, log);
    this.myPAs.push(...autos);
    if (!s.over) {
      cpuManage(s, fieldSide(s));
      this.rbiBefore = s.sides[batSide(s)].bat[c.myIdx].rbi;
    }
    return autos;
  }

  private beginPA(): void {
    const s = this.s;
    if (s.over) return this.finish();
    if (this.cfg.career) {
      // 다음 타석부터 바꾸기로 한 방식 적용
      let allAuto = false;
      if (this.afterMode) {
        if (this.afterMode === "auto") allAuto = true;
        else this.cfg.highlight = this.afterMode === "highlight";
        this.afterMode = null;
      }
      // 내 타석까지 빠르게 진행 (남은 경기 자동이면 끝까지) — 첫 타석은 생성자에서 이미 진행해 둠
      const sc = [...s.score];
      const inn = s.inning;
      if (!this.preAdvanced) this.recapBase = this.snapRecap();
      const autos = this.preAdvanced ? [] : this.careerAdvance(allAuto, this.pendingLines);
      this.preAdvanced = false;
      // 건너뛴 타석이 있으면 먼저 「경기 요약」(문자중계 화면)으로 보여 주고 다시 여기로 (그땐 진행 없이)
      // 첫 타석은 건너뛴 타석이 없어도 양 팀 타순 · 점수표를 잠깐
      if (this.pendingLines.length || (this.paCount === 0 && !this.recapJustShown && !s.over)) {
        this.startRecap(this.pendingLines);
        this.pendingLines = [];
        this.preAdvanced = true;
        return;
      }
      if (s.over) return this.finish();
      const recapped = this.recapJustShown;
      this.recapJustShown = false;
      if (recapped) {
        // 요약을 봤으면 배너는 짧게 (그 사이 점수 · 내 자동 타석은 요약에 다 나옴)
        if (this.paCount++ > 0 || this.cfg.highlight) {
          const runners = s.bases.filter((x) => x !== null).length;
          this.setBanner(`${s.inning}회${s.top ? "초" : "말"} · ${this.cfg.highlight ? "찬스!" : "내 타석"}`, `${s.outs}아웃${runners ? ` · 주자 ${runners}명` : ""}`, "#ffcf4a", 1.2, true);
        }
      } else if (this.paCount++ > 0) {
        const me = mySide(s);
        const got = s.score[me] - sc[me];
        const lost = s.score[1 - me] - sc[1 - me];
        const runners = s.bases.filter((x) => x !== null).length;
        const autoTxt = autos.length ? `내 자동 타석: ${autos.map((a) => a.text).join(" · ")} · ` : "";
        this.setBanner(
          `${s.inning}회${s.top ? "초" : "말"} · ${this.cfg.highlight ? "찬스!" : "내 타석"}`,
          `${autoTxt}${inn !== s.inning || got || lost ? `그 사이 우리 +${got} · 상대 +${lost} · ` : ""}${s.outs}아웃${runners ? ` · 주자 ${runners}명` : ""}`,
          "#ffcf4a",
          1.4,
          true
        );
      }
    } else if (this.cfg.mode === "game" && this.cfg.only && (this.cfg.only === "bat") !== this.userBat) {
      // 연습 경기 한쪽만: 내가 안 하는 이닝은 빠르게 확률로 진행하고 결과만 띄움
      const me = s.opts.userHome ? 1 : 0;
      const sc = [...s.score];
      const half = `${s.inning}회${s.top ? "초" : "말"}`;
      const atk = batSide(s) === me;
      s.mission = null;
      while (!s.over && (this.cfg.only === "bat") !== this.userBat) {
        cpuManage(s, fieldSide(s));
        const pa = quickPA(s, this.rng);
        if (pa.halfOver && !s.over) nextHalf(s);
      }
      const d = atk ? s.score[me] - sc[me] : s.score[1 - me] - sc[1 - me];
      this.setBanner(`${half} ${atk ? "우리 공격" : "상대 공격"} (자동)`, d ? `${d}점 ${atk ? "냈어요" : "줬어요"}` : atk ? "무득점" : "무실점", atk ? "#7dff9a" : "#7ad7ff", 1.4, true);
      if (s.over) return this.finish();
      return this.beginPA();
    } else if (this.cfg.mode === "game" && !this.userBat) {
      // (사용자 투수) 지치면 자동 교체 안내만 · 0 이면 강제
      const sd = s.sides[fieldSide(s)];
      if (sd.stamina <= 0) {
        const free = sd.team.pitchers.findIndex((_, i) => !sd.used.includes(i));
        if (free >= 0) {
          changePitcher(s, fieldSide(s), free);
          this.setBanner("투수 교체", `${sd.team.pitchers[free].name} 등판 — 체력 소진`, "#7ad7ff", 1.3);
        }
      }
    } else if (this.cfg.mode === "game") {
      if (cpuManage(s, fieldSide(s))) {
        const p = curPitcher(s);
        // 방금 띄운 「N회 상대 공격 (자동)」 배너가 있으면 덮지 말고 밑줄에 붙임
        if (this.banner && this.banner.t === 0) this.banner.sub = `${this.banner.sub ? `${this.banner.sub} · ` : ""}투수 교체: ${p.name}${p.special ? " (마투수!)" : ""}`;
        else this.setBanner("투수 교체", `${p.name}${p.special ? " — 마투수 등판!" : ""}`, p.special ? charById(p.special).color : "#7ad7ff", 1.4);
        if (p.special) sfx.cutin();
      }
    }
    this.pitch = null;
    this.outcome = null;
    this.decision = null;
    this.swingStart = -1;
    this.buntArmed = false;
    this.spArmed = false;
    this.useBallSp = false;
    this.cpuUseSp = false;
    this.contactShown = false;
    this.timingText = "";
    this.pitchInfo = "";
    this.batAnim = BAT_IDLE;
    this.batAnimT = 0;
    this.batFrom = undefined;
    this.freeSwing = false;
    this.pitAnim = PIT_IDLE;
    this.cz = { x: 0, y: ZONE.mid };
    this.cpuCz = undefined;
    this.hbpHit = false;
    this.updateSkins();
    this.lastStrikes = 0;
    this.paFirst = true;
    // 새 타자: 타석에 걸어 들어오기 (타석 시점 · 사용자 타자만 — 투수 시점은 리그 그림이라 없음, 홈런더비는 같은 타자라 없음)
    // (돌발미션 카드가 먼저 뜨면 그 뒤 타석 준비 화면에서 시작 — update)
    this.walkT = Infinity;
    this.walkPending = this.userBat && this.cfg.mode !== "derby" && !this.reduceMotion;
    this.walkDoneAt = -1;
    this.cardsGone = false;
    this.boostFx = null;
    if (this.userBat) this.showBoosts("all");
    const m = this.cfg.mode !== "derby" ? s.mission ?? maybeMission(s, this.rng) : null;
    if (m) {
      // 앞 타석 미션 결과판이 아직 떠 있으면 새 카드 밑에 깔려 겹쳐 보였음 → 치움
      this.missionFx = null;
      s.mission = m;
      sfx.mission();
      this.setPhase("mission");
    } else this.toPitch();
  }

  /**
   * 지금 그리는 타자 (타석 시작 때 고정) — 결과 반영(commit) 순간 경기 상태는 다음 타자로 넘어가는데,
   * 결과 문구 · 공수 교대 동안은 방금 친 타자가 그 자세 그대로 보여야 함 (좌 → 우 바뀌며 스윙 자세로 나오던 문제)
   */
  paBatter: Batter | null = null;
  paSide = 0;
  paOrder = 0;
  private get shownBatter(): Batter {
    return this.paBatter ?? this.batterNow;
  }

  private updateSkins() {
    const b = this.batterNow;
    this.paBatter = b;
    this.paSide = batSide(this.s);
    this.paOrder = this.s.sides[this.paSide].order;
    const bs = this.s.sides[batSide(this.s)];
    const fsd = this.s.sides[fieldSide(this.s)];
    const p = this.pitcherNow;
    const bc = b.special ? charById(b.special) : null;
    // 육성 선수: 필살을 배웠으면 그 캐릭터 색 배트
    const lc = !bc && b.learned ? charById(b.learned) : null;
    const metal = this.rng() < 0.3;
    this.batSkin = { ...baseSkin(), helmet: bc ? HELMETS.hero : HELMETS.basic, bat: bc || lc ? BATS.hero : metal ? BATS.metal : BATS.wood };
    this.pitSkin = baseSkin();
    this.batColors = colorsFor(bs.team, bs.order * 7 + 3, b.num, b.special ? bc!.name : b.name, (bc ?? lc)?.color);
    // 육성: 내 선수 외형 · 우리 팀 유니폼
    const myLook = this.cfg.career?.my.batters.find((x) => x.look)?.look ?? this.cfg.bond?.batter.look;
    const meIdx = this.s.opts.userHome ? 1 : 0;
    if (b.look) {
      this.batSkin = lookSkin(this.batSkin, b.look, { heroBat: !!lc });
      this.batColors = lookColors(this.batColors, b.look);
    } else if (myLook && this.cfg.career && batSide(this.s) === meIdx) this.batColors = uniColors(this.batColors, myLook);
    // 픽셀 스프라이트 외형
    const c = this.batColors;
    this.batLook = {
      team: c.team,
      helm: bc ? c.accent : c.team,
      skin: c.skin,
      pants: c.pants,
      dark: c.dark,
      bat: bc || lc ? "#fff3d6" : b.look ? BATCOL[b.look.bat]?.wood ?? BATCOL[0].wood : metal ? "#c8ced8" : "#d9a35b",
      num: c.num,
      glow: bc || lc ? c.accent : undefined,
    };
    const pc = p.special ? charById(p.special) : null;
    this.pitColors = colorsFor(this.cfg.mode === "derby" ? TEAM_DEFS[1] : fsd.team, fsd.pitcher * 5 + 1, p.num, p.name, pc?.color);
    if (myLook && this.cfg.career && fieldSide(this.s) === meIdx) this.pitColors = uniColors(this.pitColors, myLook);
    if (pc) this.pitColors.team = pc.color;
    // 투수 바지는 원정 회색 (흰 공이 흰 바지 위에서 안 보이던 문제)
    this.pitColors.pants = "#8e95a8";
  }
  batColors: RigColors = colorsFor(TEAM_DEFS[0], 0, 0, "");
  batLook: SpriteLook = { team: "#FF8A3D", helm: "#FF8A3D", skin: "#eec29e", pants: "#eef0f4", dark: "#1d2a52", bat: "#d9a35b" };
  pitColors: RigColors = colorsFor(TEAM_DEFS[1], 0, 0, "");

  private toPitch() {
    if (this.userBat) this.setPhase("ready");
    else {
      this.target = { x: 0, y: ZONE.mid };
      this.setPhase("aim");
    }
  }

  /** 투구 시작 (CPU 투수면 여기서 정함) */
  /** 타자 준비 → 와인드업까지 기다리는 시간 (특수능력 카드가 떠 있으면 그게 사라질 즈음까지) */
  private readyWait() {
    let base = this.cfg.mode === "derby" ? 0.8 : this.paFirst ? TEMPO.first : TEMPO.ready;
    // 걸어 들어오는 중이면 다 들어오고 WALK_SETTLE 뒤에 던짐
    if (this.paFirst && this.walkT < WALKIN_LEN) base = Math.max(base, this.pt + (WALKIN_LEN - this.walkT) / WALK_SPEED + WALK_SETTLE);
    else if (this.paFirst && this.walkDoneAt >= 0) base = Math.max(base, this.pt + (this.walkDoneAt + WALK_SETTLE - this.time));
    return this.boostFx ? Math.max(base, this.pt + (BOOST_DUR - 0.35 - this.boostFx.t)) : base;
  }

  private startWindup() {
    this.paFirst = false;
    const p = this.pitcherNow;
    if (this.userBat) {
      const plan = cpuPlan(p, this.s.balls, this.s.strikes, this.batterNow.bats, this.rng);
      this.kindIdx = Math.max(0, p.rep.indexOf(plan.kind));
      this.target = plan.target;
      this.quality = cpuGauge(this.cfg.diff, this.rng);
      const fsd = this.s.sides[fieldSide(this.s)];
      const risp = this.s.bases[1] !== null || this.s.bases[2] !== null;
      if (this.cfg.bond) {
        this.cpuUseSp = this.cfg.bond.magic.includes(this.bondSt.idx);
        // 예고한 구종 그대로 (인텐트): 직구 / 변화구
        const intent = this.bondIntent();
        if (intent !== "magic") {
          const fb = p.rep.indexOf("FB");
          const brk = p.rep.map((k, i) => (k === "FB" ? -1 : i)).filter((i) => i >= 0);
          this.kindIdx = intent === "fast" ? Math.max(0, fb) : brk.length ? brk[(this.bondSt.idx + this.bondSt.balls) % brk.length] : 0;
        }
      }
      else if (this.cfg.mode === "derby") this.cpuUseSp = !!this.derby.boss;
      else this.cpuUseSp = !!p.special && cpuUseSpecial(fsd.ballLeft, this.s.inning, this.s.strikes, risp, this.rng);
      if (this.cpuUseSp && this.cfg.mode !== "derby") fsd.ballLeft--;
      if (this.cfg.mode === "derby" && !this.derby.boss) {
        // 배팅볼: 존 안 · 느긋하게
        this.target = { x: this.rng.gauss() * 0.1, y: ZONE.mid + this.rng.gauss() * 0.09 };
        this.quality = 0.5;
      }
      if (this.cpuUseSp) {
        const c = charById(p.special!);
        this.target = { x: this.rng.gauss() * 0.1, y: 0.75 + this.rng.gauss() * 0.12 };
        this.showCutin(c.id, c.ball.name, c.ball.hint, "pit");
        return;
      }
    } else if (this.useBallSp) {
      const c = charById(p.special!);
      this.showCutin(c.id, c.ball.name, c.ball.hint, "pit");
      return;
    }
    this.goWindup();
  }

  /** 필살타법 사이드 컷인 — 타자 반대쪽 옆에서 살짝 (게임은 안 멈춤) */
  sideCut: { id: CharId; t: number; right: boolean } | null = null;
  private spHintAt = -9;
  private startSideCut(id: CharId) {
    // 오른손 타자는 왼쪽에 서니까 오른쪽에서 · 왼손은 왼쪽에서
    this.sideCut = { id, t: 0, right: this.batterNow.bats !== "L" };
    sfx.cutin();
  }
  private showCutin(id: CharId, title: string, sub: string, side: "bat" | "pit") {
    this.cutin = { id, title, sub, t: 0, side };
    sfx.cutin();
    this.setPhase("cutin");
  }

  /** 이번 공 실투 (와인드업 전에 정함 — 「! 실투」를 먼저 보여 주고 0.5초 뒤에 던짐) */
  private mistakeNext = false;
  /** 미트에 꽂힌 자리 (볼 · 스트라이크 · 헛스윙) — 다음 공 던질 때까지 존 위에 남김 */
  private pitchMark: { x: number; y: number; strike: boolean; at: number } | null = null;
  private goWindup() {
    this.pitchMark = null;
    this.setPhase("windup");
    this.pitAnim = PIT_THROW;
    this.pitAnimT = 0;
    // 실투: 예전엔 공 놓는 순간 「! 실투」가 손 앞에 떠서 공을 가렸음 → 와인드업 전에 위쪽에 띄우고 0.5초 쉬었다 던짐
    const sp = this.userBat ? this.cpuUseSp : this.useBallSp;
    const st = this.cfg.mode === "derby" ? 1 : stamina01(this.s);
    this.mistakeNext = !sp && (this.quality < 0.22 || this.rng() < mistakeChance(this.pitcherNow.control, st));
    if (this.mistakeNext) {
      this.popup(DW / 2, 150, "! 실투", "#ff5a5a");
      this.pt = -MISTAKE_TELL;
      this.pitAnimT = -MISTAKE_TELL;
    }
    // 타자는 내가 치든 CPU 가 치든 와인드업에 맞춰 레그킥
    if (this.swingStart < 0 && !this.buntArmed && !this.freeSwing) {
      this.playBat(BAT_LOAD);
      this.strideAt = Infinity;
      // 실투로 0.5초 쉬면 레그킥 시계도 같이 늦춤 (안 그러면 타자만 먼저 다리 들고 내딛어 버림)
      if (this.mistakeNext) this.batAnimT = -MISTAKE_TELL;
    }
  }

  private release() {
    const p = this.pitcherNow;
    const kind = p.rep[this.kindIdx] ?? "FB";
    const special = this.userBat ? (this.cpuUseSp ? p.special : undefined) : this.useBallSp ? p.special : undefined;
    const st = this.cfg.mode === "derby" ? 1 : stamina01(this.s);
    // 실투 (마구마구식 「!」): 가운데 느린 직구 — 치는 쪽엔 기회, 던지는 쪽엔 경고 (goWindup 에서 미리 정하고 띄움)
    this.pitch = makePitch(p, { kind, target: this.target, quality: this.quality, special, mistake: this.mistakeNext }, this.speedScale, this.rng, st);
    // 타자 내딛기: 공 도착 직전에 착지 (레그킥 시계 기준)
    if (this.batAnim === BAT_LOAD) this.strideAt = strideStartFor(this.batAnimT, this.pitch.dur);
    if (special) this.specialSound(special, "start");
    this.tf = 0;
    this.setPhase("flight");
    const pc = this.pitch;
    this.pitchInfo = `${pc.kmh}km/h ${special ? charById(special).ball.name : PITCHES[pc.kind].name}`;
    if (!this.userBat) {
      // CPU 타자 판단
      const b = this.batterNow;
      const fbDur = 17 / (p.velo / 3.6) / this.speedScale;
      const cs = cpuSwing(b, pc, plateCross(pc), this.s.strikes, this.s.balls, this.cfg.diff, this.rng, fbDur);
      const useSwingSp = !!swingOf(b) && cs.swing && this.rng() < 0.3 && this.s.sides[batSide(this.s)].swingLeft > 0;
      // CPU 컨택존: 공이 올 자리를 반쯤 읽고 노림 (히트 · 난이도가 높을수록 잘 읽음)
      const at = plateCross(pc);
      // (실제 공 자리를 다 알면 반칙이라 절반 남짓만 · 흔들림도 넉넉히)
      const read = clamp(0.2 + (b.hit / 1000) * 0.3 + this.cfg.diff * 0.08, 0, 0.66);
      this.cpuCz = {
        x: clamp(at.x * read + this.rng.gauss() * 0.08, -CZ_RANGE.x, CZ_RANGE.x),
        y: clamp(ZONE.mid + (at.y - ZONE.mid) * read + this.rng.gauss() * 0.07, CZ_RANGE.y0, CZ_RANGE.y1),
      };
      this.decision = { swing: cs.swing, e: cs.e, bunt: false, special: useSwingSp ? swingOf(b) : undefined, cz: this.cpuCz };
      if (useSwingSp) this.s.sides[batSide(this.s)].swingLeft--;
      if (cs.swing) {
        this.outcome = evaluate(this.s, pc, this.decision, this.rng);
        this.swingStart = pc.dur + cs.e - SWING_HIT_T;
        this.computeTilt();
      }
    }
  }

  // ───────────── 입력 ─────────────
  pressSwing(special = false) {
    if (this.paused) return;
    if (this.phase === "mission") return this.skipMission();
    if (this.phase === "recap") return this.skipRecap();
    // 타석으로 걸어 들어오는 동안엔 못 휘두름
    if (this.walking) return;
    // 공이 나온 뒤 한 번 휘둘렀으면 그 공은 끝
    if (!this.userBat || this.swingStart >= 0) return;
    const b = this.batterNow;
    if (this.phase !== "flight") {
      // 공 던지기 전 · 공 지나가 판정 난 뒤 = 빈 스윙 (판정 없음, 몇 번이든)
      const free = this.phase === "ready" || this.phase === "windup" || this.phase === "call" || this.phase === "result";
      if (!free || this.buntArmed || (this.batAnim === BAT_SWING && this.batAnimT < FREE_SWING_T)) return;
      this.freeSwing = true;
      this.playBat(BAT_SWING);
      sfx.swing(0.8 + (b.power / 1000) * 0.4);
      return;
    }
    const p = this.pitch!;
    if (this.hbpHit) return;
    const e = this.tf + SWING_HIT_T - p.dur;
    this.decision = { swing: true, e, bunt: this.buntArmed, special: special ? swingOf(b) : undefined, cz: { ...this.cz } };
    this.swingStart = this.tf;
    this.freeSwing = false;
    this.outcome = evaluate(this.s, p, this.decision, this.rng);
    // 필살타법은 공을 앞으로 보냈을 때만 1회 소모 (헛스윙 · 파울이면 다음 공까지 유지)
    this.spSpent = !!this.decision.special && this.outcome.sw?.kind === "bip";
    if (this.spSpent && (this.cfg.mode !== "derby" || !!this.cfg.bond)) this.userSide().swingLeft--;
    this.computeTilt();
    if (!this.buntArmed) {
      this.playBat(BAT_SWING);
      sfx.swing(0.8 + (b.power / 1000) * 0.4);
    }
    const W = timingWindow(b.hit, this.buntArmed, !!this.decision.special);
    this.timingText = timingLabel(e, W);
    // 글자는 PERFECT 만 (그것도 헛스윙이 아닐 때 — 컨택존이 빗나가면 타이밍이 좋아도 헛스윙이라 헷갈림)
    this.timingPerfect = this.timingText === "PERFECT" && this.outcome.sw?.kind !== "whiff";
    this.timingT = 0;
    this.timingR = e / W;
    this.pushUi();
  }
  /** 지금 스윙이 빈 스윙(판정 없음)인지 — 끝나면 하던 자세(대기 · 레그킥)로 돌아감 */
  freeSwing = false;

  /**
   * 컨택존 가운데 (m, 플레이트 위) — 사용자 타자는 투구 전(준비 · 와인드업)에 상하좌우로 옮김.
   * 타자 그림도 딱 그만큼 같이 움직임. CPU 타자는 공을 놓는 순간 노리는 자리를 정함 (투수 쪽엔 안 보임)
   */
  cz = { x: 0, y: ZONE.mid };
  /** 입력 방향 (-1 ~ 1) — 키를 누르고 있거나 패드를 미는 동안 */
  czVel = { x: 0, y: 0 };
  /** CPU 타자가 노리는 자리 (이번 공) */
  cpuCz: { x: number; y: number } | undefined;
  /** 몸에 맞는 공 — 공이 타자 몸에 닿은 뒤 (공 그리기 멈춤) */
  hbpHit = false;
  /** 몸에 맞고 튕겨 나가는 공 (화면 좌표) */
  hbpBall: { x: number; y: number; vx: number; vy: number; t: number; r: number } | null = null;

  /** 타자 · 컨택존 옮기기 입력 (BaseballApp: 방향키 · WASD · 화면 패드) */
  setBatMove(x: number, y: number) {
    const l = Math.hypot(x, y);
    this.czVel = l > 1 ? { x: x / l, y: y / l } : { x, y };
  }
  /** 컨택존을 옮길 수 있나: 투구 전 · 공이 날아오는 동안 휘두르기 전까지 */
  private get czMovable() {
    return this.phase === "ready" || this.phase === "windup" || (this.phase === "flight" && !this.decision);
  }
  private czNow() {
    return this.userBat ? this.cz : this.cpuCz;
  }

  /** 내가 던지는 차례 = 투수 뷰 (연습 · 온라인 경기 수비). 육성(타자)은 내 타석만 보여서 해당 없음 */
  get pitcherView() {
    return !this.userBat && this.cfg.mode === "game" && !this.cfg.career;
  }
  private pvCamNow() {
    return pvCam(this.shownBatter.bats === "L");
  }
  /** 지금 화면 시점으로 월드 → 화면 (타석 = 포수 뒤 · 투수 뷰 = 외야 카메라) */
  private scr(x: number, y: number, z: number) {
    return this.pitcherView ? pvProj(this.pvCamNow(), x, y, z) : ballProj(x, y, z);
  }
  /** 투수 뷰: 공 놓는 순간의 손 자리 (와인드업 동안 매 프레임 기록) */
  private pvRelHand: { x: number; y: number } | null = null;

  toggleBunt() {
    if (!this.userBat || this.swingStart >= 0 || this.cfg.mode === "derby") return;
    if (this.phase !== "ready" && this.phase !== "windup") return;
    this.buntArmed = !this.buntArmed;
    this.playBat(this.buntArmed ? BAT_BUNT : BAT_IDLE);
    sfx.ui();
    this.pushUi();
  }

  toggleSpecial() {
    if (this.paused) return;
    const us = this.userSide();
    if (this.userBat) {
      // 필살타법 = K 누르는 그 순간 바로 특별한 스윙 (예전: 준비 때 눌러 두고 화면 가득 컷인 → 다음 스윙)
      const b = this.batterNow;
      const sw = swingOf(b);
      if (!sw) return;
      const counted = this.cfg.mode !== "derby" || !!this.cfg.bond;
      if (counted && us.swingLeft <= 0) {
        if (this.phase === "flight" || this.phase === "ready") this.popup(DW / 2, 200, "필살타법을 다 썼어요!", "#ff9ad5");
        return;
      }
      if (this.phase !== "flight") {
        if ((this.phase === "ready" || this.phase === "windup") && this.time - this.spHintAt > 1.2) {
          this.spHintAt = this.time;
          this.popup(DW / 2, 200, "공이 날아올 때 K!", "#ff9ad5");
        }
        return;
      }
      if (this.swingStart >= 0 || this.hbpHit || this.buntArmed) return;
      this.pressSwing(true);
      if (this.decision?.special) this.startSideCut(sw);
    } else {
      const p = this.pitcherNow;
      if (!p.special || (this.phase !== "aim" && this.phase !== "gauge")) return;
      if (!this.useBallSp && us.ballLeft <= 0) return;
      this.useBallSp = !this.useBallSp;
      sfx.ui();
    }
    this.pushUi();
  }
  afterCutin: Phase | null = null;

  selectKind(i: number) {
    if (this.userBat || this.phase !== "aim") return;
    const p = this.pitcherNow;
    if (i < 0 || i >= p.rep.length) return;
    this.kindIdx = i;
    sfx.ui();
    this.pushUi();
  }

  /** 코스 정하기 (디자인 좌표) */
  aimAt(sx: number, sy: number) {
    if (this.userBat || this.phase !== "aim") return false;
    let x: number;
    let y: number;
    if (this.pitcherView) ({ x, y } = pvUnproj(this.pvCamNow(), sx, sy));
    else {
      ({ x, y } = unprojPlate(sx, sy));
    }
    if (Math.abs(x) > 0.55 || y < 0.15 || y > 1.5) return false;
    this.target = { x: clamp(x, -0.5, 0.5), y: clamp(y, 0.2, 1.45) };
    return true;
  }
  moveAim(dx: number, dy: number) {
    if (this.userBat || this.phase !== "aim") return;
    // 투수 뷰는 좌우가 뒤집혀 보임 (화면 오른쪽 = 3루 쪽 = −x)
    if (this.pitcherView) dx = -dx;
    this.target = { x: clamp(this.target.x + dx * 0.05, -0.5, 0.5), y: clamp(this.target.y + dy * 0.05, 0.2, 1.45) };
  }

  /** 던지기 (게이지 시작 · 멈춤) */
  pressThrow() {
    if (this.paused || this.userBat) return;
    if (this.phase === "mission") return this.skipMission();
    if (this.phase === "aim") {
      this.gaugeT = 0;
      this.setPhase("gauge");
      sfx.ui();
    } else if (this.phase === "gauge") {
      this.quality = this.gaugeVal;
      if (this.quality >= 0.9) {
        sfx.gaugeMax();
        this.popup(DW / 2 + 150, 300, "MAX!", "#ffd23f");
      }
      if (this.useBallSp) this.userSide().ballLeft--;
      this.startWindup();
    }
    this.pushUi();
  }

  /** 화면 아무 데나 누름 · swing = 화면 누름으로 스윙할지 (터치 기기는 스윙 버튼으로만 — 화면 아무 데나 닿아도 휘둘러지던 문제) */
  tap(sx: number, sy: number, swing = true) {
    if (this.paused) return;
    if (this.phase === "mission") return this.skipMission();
    if (this.phase === "recap") return this.skipRecap();
    if (this.phase === "field") {
      this.fast = true;
      this.pushUi();
      return;
    }
    if (this.userBat) return swing ? this.pressSwing() : undefined;
    if (this.phase === "aim") {
      if (this.aimAt(sx, sy)) this.pressThrow();
    } else if (this.phase === "gauge") this.pressThrow();
  }

  skipField() {
    if (this.phase === "field") this.ft = 1e9;
  }
  toggleFast() {
    this.fast = !this.fast;
    this.pushUi();
  }
  setPaused(p: boolean) {
    this.paused = p;
    this.pushUi();
  }

  /** 배속 바꾸기 (저장은 화면 쪽) */
  setSpeed(v: number) {
    this.cfg.speed = v;
    this.pushUi();
  }
  /** 육성: 다음 타석부터 진행 방식 (같은 걸 다시 누르면 취소) */
  /** 육성: 경기 도중 나가기 — 지금까지 친 건 그대로 두고 남은 경기만 자동으로 끝냄 (예전엔 경기를 처음부터 다시 돌려 친 기록이 사라졌음) */
  autoRest() {
    if (!this.cfg.career || this.s.over) return;
    this.recap = null;
    this.pendingLines = [];
    this.careerAdvance(true);
  }

  setAfterMode(m: "direct" | "highlight" | "auto") {
    if (!this.cfg.career) return;
    const cur = this.cfg.highlight ? "highlight" : "direct";
    this.afterMode = this.afterMode === m || m === cur ? null : m;
    this.pushUi();
  }

  changePitcherTo(idx: number) {
    if (this.userBat || this.cfg.mode !== "game" || this.phase !== "aim") return;
    const sd = this.s.sides[fieldSide(this.s)];
    if (sd.used.includes(idx) && idx !== sd.pitcher) return;
    changePitcher(this.s, fieldSide(this.s), idx);
    this.kindIdx = 0;
    this.useBallSp = false;
    this.updateSkins();
    const p = curPitcher(this.s);
    this.setBanner("투수 교체", `${p.name}${p.special ? " — 마투수!" : ""}`, p.special ? charById(p.special).color : "#7ad7ff", 1.1);
    sfx.ui();
    this.pushUi();
  }

  private skipMission() {
    if (this.phase === "mission" && this.pt > 0.6) this.toPitch();
  }

  // ───────────── 판정 · 결과 ─────────────
  private computeTilt() {
    // 방망이가 공 높이를 지나가게 기울임
    if (!this.pitch && !this.outcome) return;
    const at = this.outcome?.at ?? (this.pitch ? plateCross(this.pitch) : { x: 0, y: ZONE.mid });
    const bp = ballProj(at.x, at.y, 0);
    const lefty = this.shownBatter.bats === "L";
    const { x: bx, y: by, sc } = this.batterPos();
    const ps = pose(BATTER_RIG, BAT_SWING, SWING_HIT_T);
    const [hx, hy] = boneTip(BATTER_RIG, ps, "hands", 0);
    const hsx = bx + (lefty ? -hx : hx) * sc;
    const hsy = by + hy * sc;
    let ang = (Math.atan2(bp.y - hsy, (bp.x - hsx) * (lefty ? -1 : 1)) * 180) / Math.PI;
    ang = clamp(ang, -10, 55);
    this.batTilt = ang - 4;
  }

  private batterPos() {
    const lefty = this.shownBatter.bats === "L";
    // 구장 그림의 왼쪽 · 오른쪽 타석 가운데에 발이 오게 + 사용자 타자는 컨택존을 옮긴 만큼 같이 움직임 (화면 px 그대로)
    // 위로 옮길 땐 타자가 화면 위(= 투수 쪽 앞)로 떠 보여서 20%만 — 좌우 · 아래는 그대로
    const S0 = proj(0, 0, 0).s;
    const dy = this.cz.y - ZONE.mid;
    // 플레이트 쪽으로는 35%만 (다 따라가면 스윙 때 디딤발이 홈플레이트를 밟음) — 바깥쪽은 그대로
    const inward = lefty ? this.cz.x < 0 : this.cz.x > 0;
    const ox = this.userBat ? this.cz.x * S0 * (inward ? 0.35 : 1) : 0;
    const oy = this.userBat ? -dy * S0 * (dy > 0 ? 0.2 : 1) : 0;
    // 플레이트에서 0.14m(42px) 더 떨어뜨림 — 몸쪽 공이 그림상 허벅지에 닿는 자리가 몸 맞는 공 판정 끝(0.52m)과 맞게
    return { x: (lefty ? 744 : 280) + ox, y: 394 + oy, sc: 2.25, lefty };
  }

  /** 타석 화면 타구가 홈 뒤(카메라 쪽)로 오는지 — 파울팁 · 뒤로 뜬 파울 */
  hitBack = false;
  /**
   * 파울 궤적 (60Hz 점, 월드 좌표: x 옆 · y 홈에서 투수 쪽 + · h 높이). 빠르면 당겨서(우타 = 3루 쪽 = 화면 왼쪽),
   * 늦으면 밀어서. 파울팁은 포수 · 카메라 쪽으로 곧장 날아옴.
   */
  private foulPath(e: number, tip: boolean, at: { x: number; y: number }) {
    const righty = this.shownBatter.bats !== "L";
    const side = (e < 0 ? -1 : 1) * (righty ? 1 : -1);
    const r = () => this.rng();
    let vx = tip ? side * (0.8 + r() * 1.5) : side * (2.5 + r() * 4);
    let vy = tip ? -(15 + r() * 4) : -(2 + r() * 5);
    let vh = tip ? 1.5 + r() * 2 : 6 + r() * 7;
    let x = at.x;
    let y = 0.1;
    let h = at.y;
    const pts: { x: number; y: number; h: number }[] = [];
    for (let i = 0; i < 40; i++) {
      pts.push({ x, y, h });
      const dt = 1 / 60;
      x += vx * dt;
      y += vy * dt;
      h += vh * dt;
      vh -= 9.8 * dt;
      vx *= 0.995;
      vy *= 0.995;
      if (y < -6.4) break;
    }
    this.hitPath = pts;
    this.hitBack = true;
  }

  private resolveFlight() {
    const p = this.pitch!;
    // 안 휘두름
    if (!this.outcome) this.outcome = evaluate(this.s, p, null, this.rng, this.czNow());
  }

  private specialSound(id: CharId, when: "start") {
    void when;
    switch (id) {
      case "igna":
        sfx.fire();
        break;
      case "zena":
        sfx.zap();
        break;
      case "gunmo":
        sfx.glitch();
        break;
      case "ivan":
        sfx.charge();
        break;
      case "kai":
        sfx.wind();
        break;
      case "violet":
        sfx.wind();
        break;
      case "mei":
        sfx.wind();
        break;
      default:
        sfx.ui();
    }
  }

  /** 공이 지나간 뒤: 볼 · 스트라이크 · 파울 · 인플레이 */
  private afterPitch() {
    const o = this.outcome!;
    // 인플레이 · 수비가 쫓아간 파울 · 라인 바로 밖 큰 파울은 필드 화면으로 (파울은 끝나면 「파울」)
    if ((o.call === "bip" || (o.call === "foul" && this.cfg.mode !== "derby")) && o.field && o.field.frames.length) {
      const f = o.field;
      this.fieldOut = f;
      this.frames = f.frames;
      this.events = f.events;
      this.evIdx = 0;
      this.ft = 0.15;
      this.fast = false;
      this.trail = [];
      this.hr = f.hr;
      this.hrDist = f.dist;
      this.setPhase("field");
      if (f.hr) {
        sfx.homerun();
        this.shake = 0.4;
      } else if (o.call === "bip") sfx.cheer(0.5);
      return;
    }
    this.finishPitch();
  }

  /** 인연 대결: 다음 공 예고 (직구 · 변화구 · 마구) */
  bondIntent(): "fast" | "break" | "magic" {
    const B = this.cfg.bond!;
    const i = this.bondSt.idx;
    if (B.magic.includes(i)) return "magic";
    return (i * 37 + this.bondSt.balls * 13 + B.char.length * 11) % 5 < 3 ? "fast" : "break";
  }

  /** 인연 대결 한 구 */
  private bondResolve(o: Outcome) {
    const B = this.cfg.bond!;
    const st = this.bondSt;
    const name = charById(B.char).name;
    let text = "";
    let color = "#fff";
    if (o.call === "ball" && st.balls < 3) {
      st.balls++;
      text = "볼 — 다시 던진다";
      color = "#7ad7ff";
    } else {
      let mark: "hit" | "hr" | "out" = "out";
      if (o.call === "bip" && o.field?.hr) {
        mark = "hr";
        st.pts += 2;
        text = "홈런! +2";
        color = "#ffd23f";
      } else if (o.call === "bip" && !o.bad) {
        mark = "hit";
        st.pts += 1;
        text = "안타! +1";
        color = "#7dff9a";
      } else text = o.call === "bip" ? "잡혔다" : o.call === "foul" ? "파울" : o.call === "swingMiss" ? "헛스윙" : o.call === "ball" ? "볼" : "스트라이크";
      st.marks[st.idx] = mark;
      st.idx++;
    }
    const left = B.pitches - st.idx;
    const won = st.pts >= B.need;
    const lost = !won && st.pts + left * 2 < B.need;
    this.setBanner(text, won ? `${name}에게 이겼다!` : lost ? "…졌다" : `${st.pts}/${B.need}점 · 남은 공 ${left}`, color, 1.3, true);
    if (o.call === "bip" && o.field?.hr) sfx.cheer(0.8);
    this.setPhase("result");
    this.pending = won || lost || left <= 0 ? { kind: "OUT", text, runs: 0, halfOver: true, gameOver: true } : null;
  }

  private derbyResolve(o: Outcome) {
    // 더비 · 인연 대결엔 사구 없음 — 볼
    if (o.call === "hbp") o = { ...o, call: "ball" };
    if (this.cfg.bond) return this.bondResolve(o);
    const d = this.derby;
    let out = false;
    let text = "";
    let color = "#fff";
    if (o.call === "ball") {
      text = "볼";
    } else if (o.call === "strike") {
      out = true;
      text = "스트라이크 — 아웃";
    } else if (o.call === "bip" && o.field?.hr) {
      const dist = Math.round(this.hrDist);
      let add = dist;
      const sp = this.outcome?.sw?.kind === "bip" ? this.outcome.sw.ball.spray : 99;
      let golden = false;
      if (Math.abs(sp) < 7 && dist >= 122) {
        add += 300;
        golden = true;
      }
      d.dist += add;
      d.hr++;
      d.longest = Math.max(d.longest, dist);
      text = golden ? `골든 보드! ${dist}m +300` : `홈런 ${dist}m`;
      color = golden ? "#ffd23f" : "#7dff9a";
    } else {
      out = true;
      const foulOut = o.call === "foul" || o.field?.label.includes("파울");
      text = foulOut ? "파울 — 아웃" : o.call === "bip" ? "홈런 아님 — 아웃" : "헛스윙 — 아웃";
    }
    if (out) d.outs++;
    if (d.boss) {
      d.bossLeft--;
      if (d.bossLeft <= 0) d.boss = null;
    }
    this.setBanner(text, `아웃 ${d.outs}/10 · 합계 ${d.dist}m`, color, 1.3, true);
    this.setPhase("result");
    if (d.outs >= 10) this.pending = { kind: "OUT", text, runs: 0, halfOver: true, gameOver: true };
    else this.pending = null;
  }

  /** 볼카운트 · 인플레이 결과를 경기에 반영하고 문구 */
  private finishPitch() {
    const o = this.outcome!;
    if (this.cfg.mode === "derby") return this.derbyResolve(o);
    const before = { ...this.s };
    void before;
    const res = commit(this.s, o);
    this.pending = res;
    const big = !!res && (res.kind === "HR" || res.kind === "K");
    if (res) {
      const col = res.kind === "HR" ? "#ffd23f" : res.kind === "HIT" ? "#7dff9a" : res.kind === "BB" ? "#7ad7ff" : res.kind === "K" ? (this.userBat ? "#ff7a7a" : "#ffd23f") : "#ffffff";
      const sub = res.runs ? `+${res.runs}점` : undefined;
      this.setBanner(res.text, sub, col, res.kind === "HR" ? 2 : 1.5, big || res.runs > 0);
      if (res.kind === "HR" && this.banner) this.banner.logo = UI.homerun;
      if (res.kind === "K") (this.userBat ? sfx.groan : () => sfx.cheer(0.7))();
      if (this.cfg.career && this.userBat) {
        const ln = this.s.sides[batSide(this.s)].bat[this.cfg.career.myIdx];
        this.myPAs.push({ inning: this.s.inning, text: res.text, kind: res.kind, rbi: ln.rbi - this.rbiBefore, mission: res.mission ? { ok: res.mission.ok, pt: 0, partial: res.mission.partial, char: res.mission.char } : undefined });
        this.hist[this.paSide][this.paOrder]?.push(paShort(res.text, res.kind));
      }
      if (res.mission) {
        if (res.mission.ok) this.missionsOk++;
        const r = res.mission.ok ? "ok" : res.mission.partial ? "partial" : "fail";
        // 아쉬움 판 제목: 안타 / 볼넷 / 몸에 맞는 공 (결과 문구에서 코인 부분만 뺌)
        const label = r === "partial" ? res.mission.text.replace(/\s*\+\d+ 코인$/, "") : undefined;
        if (this.lastMission) this.missionFx = { m: this.lastMission, r, t: 0, label };
        else this.popup(DW / 2, 150, res.mission.text, res.mission.ok ? "#ffd23f" : res.mission.partial ? "#ffcf9a" : "#ff9a7a");
        (res.mission.ok || res.mission.partial ? sfx.missionOk : sfx.missionNg)();
        // 성공: 금색 꽃가루
        if (res.mission.ok && !this.reduceMotion)
          for (let i = 0; i < 26; i++) {
            const a = -Math.PI / 2 + (this.rng() - 0.5) * 2.6;
            const v = 180 + this.rng() * 260;
            this.particles.push({ x: 512, y: 300, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6 + this.rng() * 0.5, c: this.rng() < 0.5 ? "#ffd23f" : this.lastMission?.char ? charById(this.lastMission.char).color : "#ffffff" });
          }
      }
      this.setPhase("result");
    } else {
      const txt = o.call === "ball" ? "볼" : o.call === "foul" ? "파울" : o.call === "swingMiss" ? "헛스윙" : "스트라이크";
      this.lastCall = txt;
      if (o.call === "ball") sfx.ball();
      else if (o.call !== "foul") sfx.strike();
      this.setBanner(txt, undefined, o.call === "ball" ? "#7ad7ff" : o.call === "foul" ? "#fff" : "#ff9a7a", 0.75);
      this.setPhase("call");
    }
    this.pushUi();
  }

  private finish() {
    if (this.phase === "over") return;
    this.setPhase("over");
    const s = this.s;
    if (this.cfg.bond) {
      const st = this.bondSt;
      this.ui = { ...this.makeUi(), over: { win: st.pts >= this.cfg.bond.need, score: [0, 0], mvp: "", pt: 0, bond: { pts: st.pts, need: this.cfg.bond.need } } };
      logPlay("bond_battle", { char: this.cfg.bond.char, pts: st.pts, need: this.cfg.bond.need, pitches: this.cfg.bond.pitches, diff: this.cfg.diff });
      this.onUi(this.ui);
      return;
    }
    if (this.cfg.mode === "derby") {
      const d = this.derby;
      const pt = Math.round(d.dist / 20);
      this.save.pt += pt;
      const best = Math.max(this.save.derbyBest, d.dist);
      this.save.derbyBest = best;
      writeSave(this.save);
      this.ui = { ...this.makeUi(), over: { win: null, score: [0, 0], mvp: "", pt, derby: { dist: d.dist, hr: d.hr, best } } };
      logPlay("derby", { dist: d.dist, hr: d.hr, outs: d.outs, diff: this.cfg.diff });
      this.onUi(this.ui);
      return;
    }
    const meIdx = s.opts.userHome ? 1 : 0;
    const win = s.winner === -1 ? null : s.winner === meIdx;
    if (this.cfg.career) {
      // 육성 경기: 기록은 육성 쪽에서 (연습 경기 저장값은 안 건드림)
      const ln = s.sides[meIdx].bat[this.cfg.career.myIdx];
      const line = `${ln.ab}타수 ${ln.h}안타${ln.hr ? ` ${ln.hr}홈런` : ""}${ln.rbi ? ` ${ln.rbi}타점` : ""}`;
      this.ui = { ...this.makeUi(), over: { win, score: [s.score[0], s.score[1]], mvp: line, pt: s.pt } };
      this.onUi(this.ui);
      if (win) sfx.homerun();
      return;
    }
    {
      // 연습 경기 기록 (관리자 분석용): 우리 팀 타격 합 · 상대 타격 합 · 점수
      const sum = (side: number) => s.sides[side].bat.reduce((a, l) => ({ pa: a.pa + l.pa, ab: a.ab + l.ab, h: a.h + l.h, hr: a.hr + l.hr, bb: a.bb + l.bb, k: a.k + l.k, rbi: a.rbi + l.rbi }), { pa: 0, ab: 0, h: 0, hr: 0, bb: 0, k: 0, rbi: 0 });
      logPlay("match", { mode: this.cfg.mode, diff: this.cfg.diff, innings: s.opts.innings, only: this.cfg.only ?? null, score: [s.score[meIdx], s.score[1 - meIdx]], win, bat: sum(meIdx), opp: sum(1 - meIdx), missions: this.missionsOk });
    }
    const pt = s.pt + (win ? 100 : win === null ? 50 : 30) + s.score[meIdx] * 5;
    this.save.pt += pt;
    this.save.games++;
    if (win) this.save.wins++;
    writeSave(this.save);
    const m = mvp(s);
    this.ui = { ...this.makeUi(), over: { win, score: [s.score[0], s.score[1]], mvp: m.name ? `${m.name} · ${m.line}` : "", pt } };
    this.onUi(this.ui);
    if (win) sfx.homerun();
  }

  // ───────────── 시간 ─────────────
  update(dtRaw: number) {
    if (this.paused) return;
    // 사이드 컷인은 히트스톱 · 슬로모션과 상관없이 제 속도로
    if (this.sideCut) {
      this.sideCut.t += Math.min(dtRaw, 1 / 20);
      if (this.sideCut.t > SIDE_CUT_DUR) this.sideCut = null;
    }
    // 배속: 자동으로 굴러가는 구간(수비 · 주루 필드 화면, 공수 교대)만 — 투구 · 스윙은 물론
    // 볼 · 스트라이크 · 헛스윙 · 삼진 · 볼넷 같은 투구 결과 문구도 제 속도로 보여야 함
    const auto = this.phase === "field" || this.phase === "change";
    let dt = Math.min(dtRaw, 1 / 20) * (auto ? this.cfg.speed ?? 1 : 1);
    // 히트스톱: 공 · 배트 · 진행만 멈추고 흔들림 · 플래시 · 파티클은 계속
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      this.shake = Math.max(0, this.shake - dt);
      this.flash = Math.max(0, this.flash - dt * 3);
      for (const p of this.particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
      }
      return;
    }
    if (this.slowmo > 0) {
      this.slowmo -= dt;
      dt *= 0.5;
    }
    this.zoomT = Math.max(0, this.zoomT - dt);
    if (this.batInfo) {
      this.batInfo.t += dt;
      if (this.batInfo.t > 1.8) this.batInfo = null;
    }
    this.time += dt;
    this.pt += dt;
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > this.banner.dur) this.banner = null;
    }
    for (const p of this.popups) p.t += dt;
    this.popups = this.popups.filter((p) => p.t < 1.4);
    this.shake = Math.max(0, this.shake - dt);
    this.flash = Math.max(0, this.flash - dt * 3);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 120 * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.impact && (this.impact.t += dt) > 0.22) this.impact = null;
    this.timingT += dt;
    for (const f of this.fxs) f.t += dt;
    if (this.hbpBall && (this.hbpBall.t += dt) > 0.7) this.hbpBall = null;
    if (this.s.mission) this.lastMission = this.s.mission;
    if (this.missionFx && (this.missionFx.t += dt) > 2.5) this.missionFx = null;
    this.fxs = this.fxs.filter((f) => f.t < f.dur);
    // 특수능력 발동: 타석 화면에서만 시간이 흐름 (미션 안내 · 인트로 동안은 기다림)
    if (this.boostFx && BOOST_PHASES.includes(this.phase)) {
      if (this.boostFx.t < 0 && this.boostFx.t + dt >= 0) sfx.boost();
      if ((this.boostFx.t += dt) > BOOST_DUR) this.boostFx = null;
    }
    if (this.userBat && this.s.strikes >= 2 && this.lastStrikes < 2) this.showBoosts("twoK");
    // 카드: 타석 준비 화면에서만 · 첫 와인드업 0.5초 전(던지는 쪽이면 게이지 시작)부터 빠지고 그 타석 동안은 안 나옴
    if (this.phase === "ready" && this.paFirst && this.pt > this.readyWait() - 0.5) this.cardsGone = true;
    if (this.phase === "gauge" || this.phase === "windup" || this.phase === "cutin" || this.phase === "flight") this.cardsGone = true;
    const cardOn = !this.cardsGone && (this.phase === "ready" || this.phase === "aim");
    this.cardK = clamp(this.cardK + (cardOn ? dt / 0.3 : -dt / 0.25), 0, 1);
    // 카드가 떠 있는 동안 아래쪽 버튼(필살 칩 · 터치 스윙)은 비켜 줌 → 바뀔 때 화면에 알림
    if (cardOn !== this.ui.cards) this.pushUi();
    this.lastStrikes = this.s.strikes;
    // 컨택존 · 타자 옮기기 (투구 전만, 초당 0.65m — 끝에서 끝까지 1초 남짓)
    // 공이 날아오는 동안에도 (휘두르기 전까지) 옮길 수 있음 — 마구마구식: 파란 원을 보고 따라가서 맞힘
    if (this.userBat && this.czMovable && (this.czVel.x || this.czVel.y)) {
      const v = this.phase === "flight" ? CZ_MOVE.flight : CZ_MOVE.ready;
      this.cz = {
        x: clamp(this.cz.x + this.czVel.x * v * dt, -CZ_RANGE.x, CZ_RANGE.x),
        y: clamp(this.cz.y + this.czVel.y * v * dt, CZ_RANGE.y0, CZ_RANGE.y1),
      };
    }
    // 리그 애니
    this.batAnimT += dt;
    // 걸어 들어오기: 3.3초 · 스윙 · 레그킥이 시작되면 바로 끝
    if (this.walkPending && this.phase === "ready") {
      this.walkPending = false;
      this.walkT = 0;
    }
    if (this.walkT < WALKIN_LEN) {
      this.walkT = this.batAnim === BAT_IDLE ? this.walkT + dt * WALK_SPEED : Infinity;
      if (this.walkT >= WALKIN_LEN) {
        this.walkDoneAt = this.time;
        syncIdleTo(WALKIN_IDLE_CELL);
      }
    }
    // 빈 스윙이 끝나면 하던 자세로: 와인드업 중이면 레그킥 시계에 맞춰, 공이 날아오는 중이면 최고점, 그 밖엔 대기
    if (this.freeSwing && this.batAnim === BAT_SWING && this.batAnimT > FREE_SWING_T) {
      this.freeSwing = false;
      const kick = this.userBat && !this.buntArmed && (this.phase === "windup" || this.phase === "flight");
      this.playBat(kick ? BAT_LOAD : BAT_IDLE);
      if (kick) this.batAnimT = this.phase === "windup" ? this.pt : KICK_HOLD_T;
    }
    // 안 치고 보내면 판정(볼 · 스트라이크)이 난 뒤에야 레그킥을 내림 — 공이 날아오는 동안은 최고점으로 버팀
    if (this.batAnim === BAT_LOAD && this.batAnimT < KICK_STEP_T && this.phase !== "windup" && this.phase !== "flight") this.batAnimT = KICK_STEP_T;
    if (this.batFrom) {
      this.batFrom.t += dt;
      this.batFrom.k = Math.min(1, this.batFrom.k + dt / 0.08);
      if (this.batFrom.k >= 1) this.batFrom = undefined;
    }
    this.pitAnimT += dt;

    switch (this.phase) {
      case "intro":
        // 육성은 인트로 없이 바로 경기 요약(중계 화면) → 그다음 내 타자가 걸어 들어옴
        if (this.pt > (this.cfg.career && !this.cfg.bond ? 0 : 1.6)) this.beginPA();
        break;
      case "recap": {
        const r = this.recap;
        if (!r) break;
        // 실제 흐른 시간 × 배속 — 프레임 상한(1/20초) · 앞 타구의 슬로모션이 남아 있으면 느려지던 것
        r.t += Math.min(dtRaw, 0.25) * (this.cfg.speed ?? 1);
        while (r.shown < r.lines.length && r.t >= r.step) {
          r.t -= r.step;
          this.revealRecap();
        }
        if (r.shown >= r.lines.length && r.t >= r.hold) {
          this.recap = null;
          this.recapJustShown = true;
          this.beginPA();
        }
        break;
      }
      case "mission":
        // 미션 카드: 읽을 시간 — 누르면 시작 (안 누르면 7초 뒤 자동). 예전 2.6초 자동은 보상 · 패널티를 다 못 읽었음
        if (this.pt > 7) this.toPitch();
        break;
      case "ready":
        // 사용자 타자: 잠깐 숨 고르고 투구
        // 특수능력 발동 카드(왼쪽 위)가 떠 있으면 다 사라질 즈음까지 기다렸다 던짐 (투구 중에 떠 있으면 거슬림)
        if (this.pt > this.readyWait() && !(this.boostFx && this.boostFx.t < BOOST_DUR - 0.35)) this.startWindup();
        break;
      case "aim":
      case "gauge":
        if (this.phase === "gauge") {
          const st = this.cfg.mode === "derby" ? 1 : stamina01(this.s);
          const period = 1.15 * (0.62 + 0.38 * st);
          this.gaugeT += dt;
          const k = (this.gaugeT / period) % 2;
          this.gaugeVal = k < 1 ? k : 2 - k;
        }
        break;
      case "cutin":
        if (this.cutin) this.cutin.t += dt;
        if (this.pt > 1.15) {
          this.cutin = null;
          if (this.afterCutin) {
            this.phase = this.afterCutin;
            this.afterCutin = null;
          } else this.goWindup();
        }
        break;
      case "windup":
        if (this.pt >= PITCH_RELEASE_T) this.release();
        break;
      case "flight": {
        const p = this.pitch!;
        this.tf += dt;
        // CPU 스윙 시작
        if (!this.userBat && this.decision?.swing && this.swingStart >= 0 && this.tf >= this.swingStart && this.batAnim !== BAT_SWING) {
          if (this.decision.special) this.startSideCut(this.decision.special);
          this.playBat(BAT_SWING);
          sfx.swing(0.8 + (this.batterNow.power / 1000) * 0.4);
        }
        if (p.special === "lily" && Math.abs(this.tf - (p.tl?.segs[0].t1 ?? 0)) < dt) sfx.pop();
        if (p.special === "zena" && Math.floor(this.tf * 9) !== Math.floor((this.tf - dt) * 9) && this.tf < p.dur * 0.85) sfx.zap();
        // 바이올렛: 후프 통과 순간 「퐁」
        if (p.special === "violet" && p.tl && Math.abs(this.tf - p.tl.segs[0].t1) < dt) sfx.pop();
        // 맞는 순간
        const hitT = this.swingStart + SWING_HIT_T;
        // 헛스윙: 바람 빠지는 소리 + 살짝 흔들림 (몸이 돌아가는 힘)
        if (this.outcome?.call === "swingMiss" && !this.contactShown && this.swingStart > -10 && this.tf >= hitT) {
          this.contactShown = true;
          sfx.whiff();
          if (!this.reduceMotion) this.shake = Math.max(this.shake, 0.07);
        }
        if (this.outcome && !this.contactShown && this.swingStart > -10 && this.tf >= hitT && this.outcome.call !== "swingMiss") {
          this.contactShown = true;
          const o = this.outcome;
          if (o.call === "bip" || o.call === "foul") {
            const foul = o.call === "foul";
            const q = o.sw?.kind === "bip" ? o.sw.ball.c : o.sw?.kind === "foul" ? o.sw.c : 0.3;
            const perfect = !foul && o.sw?.kind === "bip" && o.sw.ball.perfect;
            sfx.crack(foul ? 0.2 + q * 0.5 : q, perfect);
            if (foul) sfx.foul();
            // 등급별 손맛: PERFECT 히트스톱 110ms + 플래시 · 정타 60ms · 빗맞음 25ms (멈춘 화면 = 임팩트 자세)
            // 파울도 「맞았다」는 손맛 — 짧은 히트스톱 · 작은 링 · 살짝 흔들림
            this.hitStop = perfect ? 0.11 : foul ? 0.035 : q > 0.6 ? 0.06 : 0.025;
            this.impact = { x: 0, y: 0, t: 0, q: foul ? Math.min(0.5, q) : q, perfect };
            this.flash = perfect ? 0.55 : foul ? 0.08 + q * 0.12 : 0.12 + q * 0.3;
            this.shake = this.reduceMotion ? 0 : perfect ? 0.32 : foul ? 0.05 + q * 0.06 : 0.08 + q * 0.16;
            this.setPhase("contact");
            this.hitBack = false;
            this.hitPath = [];
            if (o.sw?.kind === "bip") {
              const pr = predictBall(o.sw.ball);
              this.hitPath = pr.pts.slice(0, 40).map((pp) => ({ x: pp.x, y: pp.y, h: pp.h }));
              if (!foul) {
                const kmh = Math.round(o.sw.ball.ev * 3.6);
                this.batInfo = { text: `타구 ${kmh}km/h${pr.land > 30 ? ` · 비거리 ${Math.round(pr.land)}m` : ""}`, t: 0 };
                // 홈런은 슬로모션 + 줌 · 필살타법은 맞기만 하면 조금 더 끌어서 보여 줌
                if (pr.hr && !this.reduceMotion) {
                  this.slowmo = perfect ? 0.45 : 0.25;
                  this.zoomT = 0.6;
                }
                if (o.sw.ball.special && !this.reduceMotion) {
                  this.hitStop = Math.max(this.hitStop, 0.16);
                  this.slowmo = Math.max(this.slowmo, 0.55);
                  this.zoomT = Math.max(this.zoomT, 0.5);
                  this.flash = Math.max(this.flash, 0.45);
                }
              }
            } else if (o.sw?.kind === "foul") this.foulPath(o.sw.e, o.sw.tip || o.sw.c < 0.18, o.at);
            const at = this.scr(o.at.x, o.at.y, 0);
            this.impact.x = at.x;
            this.impact.y = at.y;
            // 그림 이펙트: 섬광(세기 = 맞은 질) · 정타 이상이면 충격파 링
            this.fxs.push({ src: UI.burst, x: at.x, y: at.y, t: 0, dur: perfect ? 0.32 : 0.22, size: (foul ? 70 : 90) + q * 70 + (perfect ? 40 : 0), grow: 0.25, rot: this.rng() * Math.PI });
            if (perfect || (!foul && q > 0.6)) this.fxs.push({ src: UI.ring, x: at.x, y: at.y, t: 0, dur: perfect ? 0.45 : 0.32, size: perfect ? 120 : 80, grow: perfect ? 2.6 : 1.8, rot: 0 });
            for (let i = 0; i < (foul ? 8 : 18); i++) {
              const a = this.rng() * Math.PI * 2;
              const v = 120 + this.rng() * 260;
              this.particles.push({ x: at.x, y: at.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: 0.35 + this.rng() * 0.3, c: q > 0.85 && !foul ? "#ffd23f" : "#ffffff" });
            }
            break;
          }
        }
        // 몸에 맞는 공: 안 휘두른 공이 타자 몸 자리에 닿는 순간 (플레이트 직전) — 퍽 + 흔들림, 공은 거기서 멈춤
        if (!this.hbpHit && this.cfg.mode !== "derby" && !this.decision?.swing && !p.special && this.tf >= p.dur * 0.97) {
          const bats = this.shownBatter.bats;
          if (hitByPitch(plateCross(p), bats, batterShift(bats, this.czNow()))) {
            this.hbpHit = true;
            {
              const v = pitchAt(p, this.tf);
              const q = ballProj(v.x, v.y, v.z);
              const out = bats === "L" ? 1 : -1;
              this.hbpBall = { x: q.x, y: q.y, vx: -out * (160 + this.rng() * 80), vy: -260, t: 0, r: Math.max(5, BALL_R * q.s) };
            }
            sfx.mitt(true);
            sfx.groan();
            if (!this.reduceMotion) this.shake = Math.max(this.shake, 0.18);
            const bp = this.pitcherView ? pvProj(this.pvCamNow(), bats === "L" ? 0.78 : -0.78, 1.0, 0) : this.batterPos();
            this.popup(bp.x, bp.y - 60, "아얏!", "#ff9a7a");
          }
        }
        if (this.tf >= p.dur + 0.1) {
          this.resolveFlight();
          const call = this.outcome?.call;
          if (call !== "foul" && call !== "hbp" && call !== "bip") {
            sfx.mitt(call === "swingMiss" || call === "strike");
            if (!this.hbpHit) {
              const pc = plateCross(p);
              this.pitchMark = { x: pc.x, y: pc.y, strike: inZone(pc.x, pc.y), at: this.time };
            }
            // 미트 「퍽」: 먼지 조금 + 빠른 공은 살짝 흔들림 (속도감)
            const at = this.scr(p.target.x, p.target.y, -0.6);
            for (let i = 0; i < 7; i++) {
              const a = -Math.PI / 2 + (this.rng() - 0.5) * 2.4;
              const sp = 60 + this.rng() * 120;
              this.particles.push({ x: at.x, y: at.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.22 + this.rng() * 0.18, c: "rgba(235,225,205,0.9)" });
            }
            if (!this.reduceMotion && p.kmh >= 145) this.shake = Math.max(this.shake, 0.035 + (p.kmh - 145) * 0.002);
          }
          this.afterPitch();
        }
        break;
      }
      case "contact":
        if (this.pt > 0.42) this.afterPitch();
        break;
      case "field":
        this.updateField(dt);
        break;
      case "call":
        if (this.pt > (this.cfg.mode === "derby" ? 0.8 : TEMPO.call)) this.toPitchNext();
        break;
      case "result":
        if (this.pt > (this.cfg.mode === "derby" ? 1.3 : TEMPO.result)) this.afterResult();
        break;
      case "change":
        if (this.pt > TEMPO.change) {
          nextHalf(this.s);
          this.beginPA();
        }
        break;
      case "over":
        break;
    }
    this.pushUi();
  }

  private toPitchNext() {
    // 같은 타석 다음 공
    const swung = !!this.decision?.swing;
    this.pitch = null;
    this.outcome = null;
    this.decision = null;
    this.swingStart = -1;
    this.contactShown = false;
    this.timingText = "";
    this.buntArmed = false;
    // 필살타법은 맞혀서 앞으로 보냈을 때만 풀림 (그냥 보낸 공 · 헛스윙 · 파울이면 다음 공에 그대로)
    if (this.cfg.mode !== "derby" && swung && this.spSpent) this.spArmed = false;
    this.spSpent = false;
    this.useBallSp = false;
    this.batAnim = BAT_IDLE;
    this.batAnimT = 0;
    this.freeSwing = false;
    this.pitAnim = PIT_IDLE;
    this.cpuCz = undefined;
    this.hbpHit = false;
    this.toPitch();
  }

  private afterResult() {
    const r = this.pending;
    this.pending = null;
    if (this.cfg.mode === "derby") {
      if (r?.gameOver) return this.finish();
      this.updateSkins();
      return this.toPitchNext();
    }
    if (!r) return this.toPitchNext();
    if (r.gameOver || this.s.over) return this.finish();
    if (this.cfg.career) {
      if (r.halfOver) nextHalf(this.s);
      return this.beginPA();
    }
    if (r.halfOver) {
      const s = this.s;
      const nextTop = !s.top;
      const inn = nextTop ? s.inning + 1 : s.inning;
      this.setBanner("공수 교대", `${inn}회${nextTop ? "초" : "말"} · ${s.score[0]} : ${s.score[1]}`, "#ffffff", 1.5);
      this.setPhase("change");
      return;
    }
    this.beginPA();
  }

  private updateField(dt: number) {
    const sp = this.fast ? 2.6 : 1;
    this.ft += dt * sp;
    const last = this.frames[this.frames.length - 1];
    const end = last ? last.t : 0;
    // 이벤트
    while (this.evIdx < this.events.length && this.events[this.evIdx].t <= this.ft) {
      const e = this.events[this.evIdx++];
      const p = fproj(e.x, e.y, 1.5);
      switch (e.kind) {
        case "out":
          this.popup(p.x, p.y - 20, "OUT", "#ff7a7a");
          sfx.out();
          break;
        case "catch":
          sfx.catchBall();
          break;
        case "dive":
          this.popup(p.x, p.y - 26, e.text, "#ffd23f");
          sfx.cheer(0.8);
          break;
        case "stun":
          this.popup(p.x, p.y - 26, e.text, "#ff7a3d");
          sfx.stun();
          break;
        case "run":
          this.popup(fproj(0, 0).x, fproj(0, 0).y - 30, "득점!", "#7dff9a");
          sfx.safe();
          break;
        case "throw":
          sfx.throwBall();
          break;
        case "hr":
          break;
      }
    }
    if (this.hr && this.ft > 2.6) this.ft = end + 1;
    if (this.cfg.mode === "derby" && !this.hr) {
      // 홈런더비: 떨어지면 바로 (수비 · 주루는 안 봄)
      const fr = this.frameAt(this.ft);
      if (this.ft > 0.6 && fr && fr.bh <= 0.05) this.ft = Math.max(this.ft, end + 0.35 - 0.5);
      if (this.ft > 4.5) this.ft = end + 1;
    }
    if (this.ft >= end + 0.35) {
      this.finishPitch();
    }
  }

  // ───────────── 그리기 ─────────────
  /** 큰 그림 시트 미리 데우기 (한 프레임에 하나, 투구 전 화면에서만) — 첫 투구 때 스트라이드 시트(1.6만 px)를
   *  처음 그리며 디코드 · GPU 업로드로 0.3초 멈칫하던 것 */
  private warmed = new Set<CanvasImageSource>();
  private warmUp(ctx: CanvasRenderingContext2D) {
    if (this.phase !== "intro" && this.phase !== "mission" && this.phase !== "ready" && this.phase !== "aim" && this.phase !== "change") return;
    const list: CanvasImageSource[] = [
      ...batterSheets(),
      drawable(img(PITCHER_THROW.src)),
      img(FIELDER.inf),
      img(FIELDER.of),
      img(RUNNER.lead),
      img(RUNNER.hands),
      img(UI.burst),
      img(UI.ring),
      img(UI.homerun),
      img(UI.profile),
    ];
    for (const im of list) {
      // 아직 ImageBitmap 이 안 풀렸으면(그림 그대로면) 기다림 — 그림을 1px 로 그리면 작은 크기로만 디코드돼서 소용없음
      if (this.warmed.has(im) || im instanceof HTMLImageElement) continue;
      this.warmed.add(im);
      // GPU 로 올려 두기 (첫 그림 때 올리느라 멈칫하지 않게)
      ctx.drawImage(im, 0, 0, 1, 1);
      return;
    }
  }

  /**
   * 3D 장면을 지금 상태에 맞춤 (update 뒤 · draw 전에 매 프레임). 타석 · 수비 화면이면 3D 로 그리고 true,
   * 투수 시점(내가 던질 때)은 아직 2D 라 false. 존 · 공 · 팝업 투영도 3D 카메라로 바꿔 끼움
   */
  sync3d(dt: number): boolean {
    const w = this.w3d;
    const fieldView = this.phase === "field" || (this.phase === "result" && this.frames.length > 0 && this.lastWasField());
    this.on3d = !!w && !this.pitcherView && (!fieldView || !!this.fieldOut);
    PROJ3D.bat = PROJ3D.field = PROJ3D.unbat = null;
    if (!w || !this.on3d) return false;
    const fsd = this.s.sides[fieldSide(this.s)], bsd = this.s.sides[batSide(this.s)];
    const colors = { field: fsd.team.color, bat: bsd.team.color };
    if (fieldView) {
      w.field({ out: this.fieldOut!, t: this.ft, colors, ballOnly: this.cfg.mode === "derby", night: this.night }, dt);
      PROJ3D.field = w.projectField;
      return true;
    }
    const lefty = this.shownBatter.bats === "L";
    const a = this.batAnim;
    const dy = this.cz.y - ZONE.mid;
    const inward = lefty ? this.cz.x < 0 : this.cz.x > 0;
    w.batting(
      {
        lefty,
        pitLefty: this.pitcherNow.throws === "L",
        bat: { anim: a === BAT_SWING ? "swing" : a === BAT_LOAD ? "load" : a === BAT_BUNT ? "bunt" : "idle", t: this.batAnimT, sp: this.swingSp, strideAt: this.strideAt },
        walk: this.walkPending ? 0 : this.walkT < WALKIN_LEN ? this.walkT / WALKIN_LEN : null,
        pit: { throwing: this.pitAnim === PIT_THROW, t: this.pitAnimT },
        runners: [this.s.bases[0] !== null, this.s.bases[1] !== null, this.s.bases[2] !== null],
        shift: this.userBat ? { x: this.cz.x * (inward ? 0.35 : 1), z: dy * (dy > 0 ? 0.25 : 1) } : { x: 0, z: 0 },
        colors,
        night: this.night,
      },
      dt,
    );
    PROJ3D.bat = w.project;
    PROJ3D.unbat = w.unprojectPlate;
    return true;
  }

  draw(ctx: CanvasRenderingContext2D, q: number) {
    // 배경보다 먼저 1px 로 그려 가려짐
    this.warmUp(ctx);
    // 3D 화면 위에 겹쳐 그림: 2D 판은 투명하게 비우고 시작
    if (this.on3d) ctx.clearRect(0, 0, DW, DH);
    ctx.save();
    if (this.shake > 0) ctx.translate((this.rng() - 0.5) * this.shake * 30, (this.rng() - 0.5) * this.shake * 30);
    if (this.zoomT > 0) {
      // 홈런: 타석 쪽으로 살짝 당겼다 풀기
      const z = 1 + 0.12 * Math.sin((this.zoomT / 0.6) * Math.PI);
      ctx.translate(512, 300);
      ctx.scale(z, z);
      ctx.translate(-512, -300);
    }
    const fieldView = this.phase === "field" || (this.phase === "result" && this.frames.length > 0 && this.lastWasField());
    if (fieldView) this.drawField(ctx, q);
    else if (this.pitcherView) this.drawPitching(ctx, q);
    else this.drawBatting(ctx, q);
    ctx.restore();
    // 경기 요약 중엔 HUD(점수판 · 미션 띠) 숨김 — 요약보다 앞선 최종 점수가 먼저 보여 김샘
    if (this.phase !== "recap") this.drawHud(ctx);
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.6})`;
      ctx.fillRect(0, 0, DW, DH);
    }
    if (this.cutin) this.drawCutin(ctx);
    if (this.sideCut) this.drawSideCut(ctx);
    this.drawBanner(ctx);
    for (const p of this.popups) {
      const a = 1 - smooth(0.9, 1.4, p.t);
      ctx.globalAlpha = a;
      ctx.font = '22px "Black Han Sans", sans-serif';
      ctx.textAlign = "center";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.strokeText(p.text, p.x, p.y - p.t * 30);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y - p.t * 30);
      ctx.globalAlpha = 1;
    }
    if (this.phase === "mission" && this.s.mission) this.drawMission(ctx);
    this.drawMissionFx(ctx);
    if (this.phase === "recap") this.drawRecap(ctx);
  }

  private lastWasField() {
    return this.outcome?.call === "bip" && !!this.outcome.field && !this.outcome.field.foul;
  }

  private drawBatting(ctx: CanvasRenderingContext2D, q: number) {
    const d3 = this.on3d && !!this.w3d;
    // 3D: 타석 들어서기 연출 동안은 겹쳐 그릴 것 없음
    if (d3 && (this.walkPending || this.walkT < WALKIN_LEN)) return;
    if (!d3) ctx.drawImage(battingBg(q, this.night), 0, 0, DW, DH);
    const p = this.pitch;
    // 투수
    // 수비수 (내야 4 · 외야 3): 구장 그림 땅 위 실제 수비 위치 — 먼 쪽부터 그리고 투수는 그 앞
    if (!d3) this.drawFielders(ctx);
    // 투수판(높이 0.25m) 위 · 크기는 구장 그림 목업 기준 (키 ≈ 135px)
    const mp = PITCHER_FEET;
    const pitcherScale = 0.77;
    const pps = pose(PITCHER_RIG, this.pitAnim, this.pitAnim === PIT_THROW ? (this.pitAnimT * PIT_RIG_RELEASE_T) / PITCH_RELEASE_T : this.pitAnimT);
    const pFlip = this.pitcherNow.throws === "L";
    // 투수 그림 (지피티 세트 자세 1장, 발 = 투수판) — 없으면 코드 리그
    const pim = img(PITCHER_STILL.src);
    const tim = img(PITCHER_THROW.src);
    const throwSprite = tim.complete && tim.naturalWidth > 0;
    if (d3) {
      // 3D 투수
    } else if (this.pitAnim === PIT_THROW && throwSprite) {
      const T = PITCHER_THROW;
      const c = (PIT_THROW_SEQ.find(([, e]) => this.pitAnimT < e) ?? PIT_THROW_SEQ[PIT_THROW_SEQ.length - 1])[0];
      const k = PIT_CANVAS_PX / T.cell;
      ctx.save();
      ctx.imageSmoothingQuality = "medium";
      ctx.translate(mp.x, mp.y);
      ctx.scale(pFlip ? -k : k, k);
      ctx.drawImage(drawable(tim), c * T.CW, 0, T.CW, T.CH, -T.ax, -T.ay, T.CW, T.CH);
      ctx.restore();
    } else if (pim.complete && pim.naturalWidth) {
      ctx.save();
      ctx.imageSmoothingQuality = "medium";
      ctx.translate(mp.x, mp.y);
      ctx.scale(pFlip ? -PITCHER_STILL.scale : PITCHER_STILL.scale, PITCHER_STILL.scale);
      ctx.drawImage(pim, -PITCHER_STILL.ax, -PITCHER_STILL.ay);
      ctx.restore();
    } else drawRig(ctx, PITCHER_RIG, pps, this.pitSkin, this.pitColors, mp.x, mp.y - 56 * pitcherScale, pitcherScale, pFlip);
    // 손 위치 (공 놓는 점)
    const relPs = pose(PITCHER_RIG, PIT_THROW, PIT_RIG_RELEASE_T);
    const [hx, hy] = boneTip(PITCHER_RIG, relPs, "handT", 1);
    const hand = d3
      ? this.w3d!.pitcherHand()
      : throwSprite && PITCHER_THROW.hand
        ? { x: mp.x + (pFlip ? -1 : 1) * PITCHER_THROW.hand[0] * PIT_CANVAS_PX, y: mp.y + PITCHER_THROW.hand[1] * PIT_CANVAS_PX }
        : { x: mp.x + (pFlip ? -hx : hx) * pitcherScale, y: mp.y - 56 * pitcherScale + hy * pitcherScale };
    // 이반 기모으기 · 손에 든 공
    if (this.phase === "windup" || (p && this.tf < 0.02)) {
      // 아무것도
    }

    // 스트라이크 존
    const z0 = ballProj(-ZONE.x, ZONE.y1, 0);
    const z1 = ballProj(ZONE.x, ZONE.y0, 0);
    const showZone = !this.userBat || this.cfg.diff < 2 || this.phase === "aim";
    if (showZone) {
      ctx.strokeStyle = this.userBat ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.6)";
      ctx.lineWidth = 2;
      ctx.strokeRect(z0.x, z0.y, z1.x - z0.x, z1.y - z0.y);
      if (!this.userBat) {
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = 1;
        for (let i = 1; i < 3; i++) {
          const x = z0.x + ((z1.x - z0.x) * i) / 3;
          const y = z0.y + ((z1.y - z0.y) * i) / 3;
          ctx.beginPath();
          ctx.moveTo(x, z0.y);
          ctx.lineTo(x, z1.y);
          ctx.moveTo(z0.x, y);
          ctx.lineTo(z1.x, y);
          ctx.stroke();
        }
      }
    }

    // 컨택존 (사용자 타자): 히트가 높을수록 넓음 · 투구 전 상하좌우로 옮김 — 존에 맞을수록 잘 맞음
    if (this.userBat && ["ready", "windup", "flight", "contact", "call"].includes(this.phase)) {
      const b = this.shownBatter;
      const { hw, hh } = contactZone(effectiveHit(this.s, b));
      const a = ballProj(this.cz.x - hw, this.cz.y + hh, 0);
      const c = ballProj(this.cz.x + hw, this.cz.y - hh, 0);
      const fade = this.phase === "contact" || this.phase === "call" ? 0.45 : 1;
      const moving = !!(this.czVel.x || this.czVel.y) && this.czMovable;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.fillStyle = moving ? "rgba(255,190,90,0.2)" : "rgba(255,170,60,0.13)";
      ctx.strokeStyle = "rgba(255,196,110,0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(a.x, a.y, c.x - a.x, c.y - a.y, Math.min(14, (c.x - a.x) * 0.2));
      ctx.fill();
      ctx.stroke();
      // 가운데 (제일 잘 맞는 자리)
      const m = ballProj(this.cz.x, this.cz.y, 0);
      ctx.strokeStyle = "rgba(255,220,150,0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(m.x - 7, m.y);
      ctx.lineTo(m.x + 7, m.y);
      ctx.moveTo(m.x, m.y - 7);
      ctx.lineTo(m.x, m.y + 7);
      ctx.stroke();
      ctx.restore();
    }

    // 사용자 투수: 코스 표시
    if (!this.userBat && (this.phase === "aim" || this.phase === "gauge" || this.phase === "cutin" || this.phase === "windup")) {
      const t = ballProj(this.target.x, this.target.y, 0);
      const inz = inZone(this.target.x, this.target.y);
      ctx.strokeStyle = inz ? "#ffd23f" : "#7ad7ff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 13, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(t.x - 20, t.y);
      ctx.lineTo(t.x - 7, t.y);
      ctx.moveTo(t.x + 7, t.y);
      ctx.lineTo(t.x + 20, t.y);
      ctx.moveTo(t.x, t.y - 20);
      ctx.lineTo(t.x, t.y - 7);
      ctx.moveTo(t.x, t.y + 7);
      ctx.lineTo(t.x, t.y + 20);
      ctx.stroke();
      ctx.font = '700 12px "Nanum Gothic", sans-serif';
      ctx.fillStyle = inz ? "#ffd23f" : "#7ad7ff";
      ctx.textAlign = "center";
      ctx.fillText(inz ? "스트라이크 존" : "유인구", t.x, t.y + 34);
    }

    // 파란 원 (마구마구식): 공의 지금 위치(좌우 · 높이)를 존 면에 그대로 옮긴 원 — 공이 날아오는 동안 궤적을 따라 존 위를 움직임.
    // 크기는 고정 (공 크기 정도). 난이도와 상관없이 다 보임 · 마구는 안 보임 (안 읽혀야 마구)
    if (p && this.userBat && this.phase === "flight" && !p.special) {
      const v = pitchAt(p, this.tf);
      const u = this.tf / p.dur;
      const show = v.inHand ? 0 : smooth(0, 0.06, u) * (1 - smooth(0.97, 1, u));
      if (show > 0.01) {
        const c = ballProj(v.x, v.y, 0);
        const R = Math.max(5, BALLR_PX(c.s) * BLUE_R);
        ctx.save();
        ctx.globalAlpha = show;
        ctx.fillStyle = "rgba(70,150,255,0.22)";
        ctx.beginPath();
        ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
        ctx.fill();
        // 남색 펜스 · 파란 유니폼 위에서도 보이게 흰 테 + 파란 선
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.strokeStyle = "#3d8bff";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    }

    this.drawPitchMark(ctx, ballProj);

    // 공
    // 홈 근처(마지막 8%)부터는 타자 앞에 그림 — 타자 옆을 지나는 몸쪽 공이 그림상 몸 뒤로 숨어 「맞았는데 볼」처럼 보였음
    const ballNear = !!p && this.phase === "flight" && this.tf >= p.dur * 0.92;
    if (p && this.phase === "flight" && !ballNear) this.drawPitchBall(ctx, p, hand);
    if (!d3 && this.phase === "windup" && this.pitAnimT > 0.2 && !img(PITCHER_THROW.src).naturalWidth) {
      // 손에 든 공 (코드 리그일 때만 — 투구 줄 그림엔 공이 그려져 있음)
      const ps = pose(PITCHER_RIG, this.pitAnim, (this.pitAnimT * PIT_RIG_RELEASE_T) / PITCH_RELEASE_T);
      const [ax, ay] = boneTip(PITCHER_RIG, ps, "handT", 1);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(mp.x + (pFlip ? -ax : ax) * pitcherScale, mp.y - 56 * pitcherScale + ay * pitcherScale, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // 타구 (맞은 직후 · 타석 화면에서 날아감)
    if (this.phase === "contact" && this.hitPath.length) {
      const k = Math.min(this.hitPath.length - 1, Math.floor(this.pt * 60));
      for (let i = Math.max(0, k - 8); i <= k; i++) {
        const hp = this.hitPath[i];
        const pp = proj(hp.x, hp.h, Math.max(this.hitBack ? -6.4 : 0.2, hp.y));
        ctx.globalAlpha = (i - (k - 8)) / 8;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, clamp(0.037 * pp.s, 2, 34), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 타자
    const { x: bx, y: by, sc, lefty } = this.batterPos();
    let anim = this.batAnim;
    if (anim === BAT_SWING && this.batTilt) {
      const add = (keys: NonNullable<Anim["tracks"][string]>) =>
        keys.map((k) => (k.t >= 0.035 && k.t <= 0.14 ? { ...k, r: (k.r ?? 0) + this.batTilt * (k.t === 0.07 ? 1 : 0.6) } : k));
      anim = { ...anim, tracks: { ...anim.tracks, bat: add(anim.tracks.bat) } };
    }
    const bps = pose(BATTER_RIG, anim, this.batAnimT, this.batFrom);
    // 그림자: 발바닥 바로 밑에 작고 옅게 (떠 보이지 않게)
    if (!d3) {
      const fy = by + 58 * sc;
      const g = ctx.createRadialGradient(bx, fy, 0, bx, fy, 70);
      g.addColorStop(0, "rgba(0,0,0,0.28)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(bx, fy);
      ctx.scale(1, 0.18);
      ctx.translate(-bx, -fy);
      ctx.beginPath();
      ctx.arc(bx, fy, 70, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // 픽셀 타자 (그림 불러오기 전엔 코드 리그)
    // 걸어 들어오기 (미션 카드 동안은 출발 자리에서 기다림)
    const bFrame = this.walkPending ? walkinFrame(0) : this.walkT < WALKIN_LEN ? walkinFrame(this.walkT) : batterFrame(this.batAnim, this.batAnimT, this.swingSp, this.strideAt);
    if (!d3 && !drawBatter(ctx, bFrame, this.batLook, bx, by, sc, lefty, this.batAnim === BAT_SWING && !this.reduceMotion ? 1 : 0)) drawRig(ctx, BATTER_RIG, bps, this.batSkin, this.batColors, bx, by, sc, lefty);
    if (ballNear && p) this.drawPitchBall(ctx, p, hand);
    // 몸에 맞은 공: 맞은 자리에서 튕겨 나가 떨어짐
    if (this.hbpBall) {
      const b = this.hbpBall;
      const t = b.t;
      const x = b.x + b.vx * t;
      const y = b.y + b.vy * t + 900 * t * t;
      ctx.globalAlpha = 1 - smooth(0.45, 0.7, t);
      this.drawBall(ctx, x, y, b.r);
      ctx.globalAlpha = 1;
    }

    // 임팩트: 링 + 빛살 (히트스톱 동안은 멈춘 채 크게)
    if (this.impact) {
      const im = this.impact;
      const u = im.t / 0.22;
      const R = (im.perfect ? 26 : 16 + im.q * 10) * (0.5 + u * 1.6);
      ctx.save();
      ctx.globalAlpha = 1 - u;
      ctx.strokeStyle = im.perfect ? "#ffd23f" : "#ffffff";
      ctx.lineWidth = (im.perfect ? 6 : 4) * (1 - u) + 1;
      ctx.beginPath();
      ctx.arc(im.x, im.y, R, 0, Math.PI * 2);
      ctx.stroke();
      const n = im.perfect ? 10 : 7;
      ctx.lineWidth = im.perfect ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.3;
        ctx.beginPath();
        ctx.moveTo(im.x + Math.cos(a) * R * 0.9, im.y + Math.sin(a) * R * 0.9);
        ctx.lineTo(im.x + Math.cos(a) * R * (1.5 + (i % 2) * 0.5), im.y + Math.sin(a) * R * (1.5 + (i % 2) * 0.5));
        ctx.stroke();
      }
      ctx.fillStyle = "#fff";
      ctx.globalAlpha = Math.max(0, 1 - u * 2.5);
      ctx.beginPath();
      ctx.arc(im.x, im.y, R * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // 그림 이펙트 (섬광 · 충격파 링): 빨리 커지며 사라짐
    for (const f of this.fxs) {
      const im = img(f.src);
      if (!im.complete || !im.naturalWidth) continue;
      const u = f.t / f.dur;
      const sz = f.size * (0.6 + u * f.grow + (1 - (1 - u) ** 3) * 0.4);
      ctx.save();
      ctx.globalAlpha = u < 0.15 ? u / 0.15 : 1 - smooth(0.35, 1, u);
      ctx.globalCompositeOperation = "lighter";
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.drawImage(im, -sz / 2, -sz / 2 * (im.naturalHeight / im.naturalWidth), sz, sz * (im.naturalHeight / im.naturalWidth));
      ctx.restore();
    }
    // 파티클
    for (const pt of this.particles) {
      ctx.globalAlpha = Math.min(1, pt.life * 3);
      ctx.fillStyle = pt.c;
      ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    // 투구 정보 · 타이밍
    if (this.pitchInfo && (this.phase === "call" || this.phase === "contact" || this.phase === "result")) {
      ctx.font = '700 15px "JetBrains Mono", monospace';
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      const w = ctx.measureText(this.pitchInfo).width + 16;
      // 타자 반대쪽 (좌타면 존 왼쪽)
      const ix = this.shownBatter.bats === "L" ? z0.x - 22 - w : z1.x + 22;
      ctx.fillRect(ix, z0.y - 2, w, 24);
      ctx.fillStyle = "#fff";
      ctx.fillText(this.pitchInfo, ix + 8, z0.y + 15);
    }
    // 스윙 타이밍 게이지 (홈플레이트 아래): 가운데 = 딱 맞음, 왼쪽 빠름 · 오른쪽 늦음 — 판정선으로만 보여 줌
    if (this.timingText && this.userBat && (this.phase === "flight" || this.phase === "contact" || this.phase === "call" || this.phase === "result")) this.drawTimingBar(ctx);
    if (this.batInfo && this.userBat) {
      const a = 1 - smooth(1.3, 1.8, this.batInfo.t);
      ctx.globalAlpha = a;
      ctx.font = '700 15px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      const w = ctx.measureText(this.batInfo.text).width + 20;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(512 - w / 2, 330, w, 26);
      ctx.fillStyle = "#ffd23f";
      ctx.fillText(this.batInfo.text, 512, 348);
      ctx.globalAlpha = 1;
    }
    if (this.phase === "gauge" || (this.phase === "aim" && !this.userBat)) this.drawGauge(ctx);
  }

  /**
   * 투수 뷰 (내가 던질 때): 외야 카메라 — 뒤쪽부터 심판 → 포수(미트 = 조준 자리) → 타자 → 공 → 내 투수(뒷모습) → 존 · 조준 · 게이지.
   * 타자가 컨택존을 어디로 옮겼는지는 안 보임 (타자도 안 움직임)
   */
  private drawPitching(ctx: CanvasRenderingContext2D, q: number) {
    const lefty = this.shownBatter.bats === "L";
    const c = pvCam(lefty);
    ctx.drawImage(pvBackground(c, q, this.night), 0, 0, DW, DH);
    const p = this.pitch;
    const P = (x: number, y: number, z: number) => pvProj(c, x, y, z);
    drawUmpire(ctx, c, lefty ? -1 : 1);
    // 포수 미트: 조준하는 동안은 목표 자리, 공이 오면 실제로 들어오는 자리로 따라감
    let mitt = { x: this.target.x, h: this.target.y };
    if (p && (this.phase === "flight" || this.phase === "call" || this.phase === "contact" || this.phase === "result")) {
      const at = plateCross(p);
      const k = this.phase === "flight" ? smooth(0.55, 0.95, this.tf / p.dur) : 1;
      mitt = { x: lerp(this.target.x, at.x, k), h: lerp(this.target.y, at.y, k) };
    }
    drawCatcher(ctx, c, this.pitColors, mitt);
    const pose: PvBatPose =
      this.batAnim === BAT_SWING ? { kind: "swing", t: this.batAnimT } : this.batAnim === BAT_LOAD ? { kind: "load", t: this.batAnimT } : this.batAnim === BAT_BUNT ? { kind: "bunt", t: 0 } : { kind: "idle", t: 0 };
    drawPvBatter(ctx, c, this.batColors, this.batLook.bat, lefty, pose, SWING_HIT_T);
    // 공 (투수보다 멀리 있으니 투수 앞에 먼저)
    if (p && this.phase === "flight") {
      const r0 = pitchAt(p, 0);
      const hand = this.pvRelHand ?? P(r0.x, r0.y, r0.z);
      this.drawPitchBall(ctx, p, hand, P);
    }
    // 타구 (맞은 직후)
    if (this.phase === "contact" && this.hitPath.length) {
      const k = Math.min(this.hitPath.length - 1, Math.floor(this.pt * 60));
      for (let i = Math.max(0, k - 8); i <= k; i++) {
        const hp = this.hitPath[i];
        const pp = P(hp.x, hp.h, hp.y);
        ctx.globalAlpha = (i - (k - 8)) / 8;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, clamp(0.037 * pp.s, 2.5, 30), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // 내 투수 (뒷모습)
    const throwing = this.pitAnim === PIT_THROW;
    const hand = drawPvPitcher(ctx, c, this.pitColors, this.pitcherNow.throws === "L", this.pitAnimT, throwing, PITCH_RELEASE_T);
    if (this.phase === "windup") this.pvRelHand = hand;
    else if (this.phase !== "flight") this.pvRelHand = null;
    // 공을 놓기 직전 손에 든 공
    if (this.phase === "windup" && this.pitAnimT > 0.75) {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(hand.x, hand.y, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 존 9칸 · 조준
    const aiming = this.phase === "aim" || this.phase === "gauge" || this.phase === "cutin" || this.phase === "windup";
    const z = drawPvZone(ctx, c, aiming ? 1 : 0.55);
    this.drawPitchMark(ctx, P);
    if (aiming) {
      const t = P(this.target.x, this.target.y, 0);
      const inz = inZone(this.target.x, this.target.y);
      ctx.strokeStyle = inz ? "#ffd23f" : "#7ad7ff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(t.x - 18, t.y);
      ctx.lineTo(t.x - 6, t.y);
      ctx.moveTo(t.x + 6, t.y);
      ctx.lineTo(t.x + 18, t.y);
      ctx.moveTo(t.x, t.y - 18);
      ctx.lineTo(t.x, t.y - 6);
      ctx.moveTo(t.x, t.y + 6);
      ctx.lineTo(t.x, t.y + 18);
      ctx.stroke();
      ctx.font = '700 12px "Nanum Gothic", sans-serif';
      ctx.fillStyle = inz ? "#ffd23f" : "#7ad7ff";
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.strokeText(inz ? "스트라이크 존" : "유인구", t.x, t.y + 32);
      ctx.fillText(inz ? "스트라이크 존" : "유인구", t.x, t.y + 32);
    }

    // 임팩트 · 파티클
    if (this.impact) {
      const im = this.impact;
      const u = im.t / 0.22;
      const R = (im.perfect ? 22 : 13 + im.q * 8) * (0.5 + u * 1.6);
      ctx.save();
      ctx.globalAlpha = 1 - u;
      ctx.strokeStyle = im.perfect ? "#ffd23f" : "#ffffff";
      ctx.lineWidth = 4 * (1 - u) + 1;
      ctx.beginPath();
      ctx.arc(im.x, im.y, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (const pt of this.particles) {
      ctx.globalAlpha = Math.min(1, pt.life * 3);
      ctx.fillStyle = pt.c;
      ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    // 투구 정보 (구속 · 구종)
    if (this.pitchInfo && (this.phase === "call" || this.phase === "contact" || this.phase === "result")) {
      ctx.font = '700 15px "JetBrains Mono", monospace';
      ctx.textAlign = "left";
      const w = ctx.measureText(this.pitchInfo).width + 16;
      const ix = lefty ? z.x0 - w - 14 : z.x1 + 14;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(ix, z.y0 - 2, w, 24);
      ctx.fillStyle = "#fff";
      ctx.fillText(this.pitchInfo, ix + 8, z.y0 + 15);
    }
    // 게이지: 존 옆 (타자 반대쪽)
    if (this.phase === "gauge" || this.phase === "aim") this.drawGauge(ctx, lefty ? z.x1 + 26 : z.x0 - 62);
  }

  /** 미트에 꽂힌 자리 표시: 공 크기 테두리 원 (스트라이크 노랑 · 볼 하늘색) · 꽂힐 때 살짝 커졌다 줄어듦 · 1초 보이고 사라짐 */
  private drawPitchMark(ctx: CanvasRenderingContext2D, pj: (x: number, y: number, z: number) => { x: number; y: number; s: number }) {
    const m = this.pitchMark;
    if (!m || !(this.phase === "call" || this.phase === "result" || this.phase === "ready" || this.phase === "aim" || this.phase === "gauge")) return;
    const c = pj(m.x, m.y, 0);
    const R = Math.max(5, BALLR_PX(c.s));
    const age = this.time - m.at;
    const a = 1 - smooth(1.0, 1.3, age);
    if (a <= 0) return;
    const pop = 1 + 0.6 * (1 - smooth(0, 0.18, age));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = m.strike ? "#ffd23f" : "#7ad7ff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(c.x, c.y, R * pop, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawPitchBall(ctx: CanvasRenderingContext2D, p: Pitch, hand: { x: number; y: number }, pj: (x: number, y: number, z: number) => { x: number; y: number; s: number } = ballProj) {
    const t = this.tf;
    const v = pitchAt(p, t);
    // 놓는 점은 투구 그림 손 자리와 같게 맞춰 둠 (pitch.ts release) — 그래도 남는 차이(코드 리그 · 좌우 반전)는
    // 처음 15% 동안 「옮겨 붙였다가 서서히 0」으로만 메꿈 (손 → 궤적 사이를 오가며 공이 갈팡질팡하던 문제)
    const r0 = pitchAt(p, 0);
    const p0 = pj(r0.x, r0.y, r0.z);
    const off = { x: hand.x - p0.x, y: hand.y - p0.y };
    // 홈플레이트 지난 뒤(포수 쪽): 홈 통과 순간의 화면 속도 그대로 곧게 (예전엔 원근 계산을 홈에서 멈추고 거리도 잘라서
    // 좌우는 멈추고 위아래만 움직여 몸 앞에서 20 ~ 45° 「휘리릭」 꺾여 보였음)
    const pe = pitchAt(p, p.dur);
    const pq = pitchAt(p, p.dur * 0.995);
    const E = pj(pe.x, pe.y, pe.z);
    const Q = pj(pq.x, pq.y, pq.z);
    const du = Math.max(1e-4, 1 - pq.u);
    const toScreen = (x: number, y: number, z: number, u: number) => {
      if (u > 1) {
        const d = (u - 1) / du;
        return { x: E.x + (E.x - Q.x) * d, y: E.y + (E.y - Q.y) * d, s: E.s + (E.s - Q.s) * d };
      }
      const s = pj(x, y, z);
      // 투수 그림 손 ↔ 공 놓는 점 차이는 비행 70% 동안 천천히 줄임 (빨리 줄이면 공이 손에서 툭 떨어졌다 다시 떠 보임)
      const k = 1 - smooth(0, 0.7, u);
      return { x: s.x + off.x * k, y: s.y + off.y * k, s: s.s };
    };
    // 지나간 공 (헛스윙 · 볼) 은 미트까지만 · 몸에 맞은 공은 거기서 끝
    if (v.u > 1.15 || this.hbpHit) return;
    const sp = p.special;
    // 그림자
    // 타석 화면은 공과 같은 원근의 그림자 (shadowProj — 공이 떠 보이던 원인), 투수 뷰는 그 카메라 그대로
    const g = pj === ballProj ? shadowProj(v.x, Math.max(v.z, 0.2)) : pj(v.x, 0, Math.max(v.z, 0.2));
    // 그림자는 홈까지 (지나간 뒤엔 공만 곧게 날아감)
    ctx.fillStyle = `rgba(0,0,0,${(0.42 * (1 - smooth(1, 1.06, v.u))).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, Math.max(3.5, 0.06 * g.s), Math.max(1.5, 0.022 * g.s), 0, 0, Math.PI * 2);
    ctx.fill();
    // 꼬리 (속도감 + 휘는 길): 최근 TRAIL_SEC 자취를 가늘어지는 띠로 — 길게 남겨야 변화구가 휘는 곡선이 눈에 남음
    // (예전 0.05초는 거의 점이라 궤적이 안 읽혔음). 마구는 마지막 25% 꼬리를 꺼서 늦은 변화를 숨김
    if (!(sp && v.u > 0.75) && !v.inHand) {
      const pts: { x: number; y: number; r: number }[] = [];
      for (let i = TRAIL_N; i >= 0; i--) {
        const vt = pitchAt(p, Math.max(0, t - (i * TRAIL_SEC) / TRAIL_N));
        if (vt.inHand) continue;
        const a = toScreen(vt.x, vt.y, vt.z, vt.u);
        pts.push({ x: a.x, y: a.y, r: Math.max(2.6, BALLR_PX(a.s)) });
      }
      for (let i = 1; i < pts.length; i++) {
        const k = i / (pts.length - 1);
        ctx.globalAlpha = 0.3 * Math.pow(k, 1.6) * v.vis;
        ctx.strokeStyle = sp ? charById(sp).color : "#ffffff";
        ctx.lineCap = "round";
        ctx.lineWidth = pts[i].r * 1.7 * (0.15 + 0.85 * k);
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (v.ghosts) {
      for (const gh of v.ghosts) {
        const a = toScreen(gh.x, gh.y, gh.z, v.u);
        ctx.globalAlpha = gh.a;
        if (sp === "mei") this.drawBun(ctx, a.x, a.y, Math.max(6, 0.075 * a.s));
        else this.drawFireBall(ctx, a.x, a.y, Math.max(6, 0.08 * a.s), false);
      }
      ctx.globalAlpha = 1;
    }
    // 바이올렛 후프: 빙글 도는 고리 (공이 지나갈 자리)
    if (v.hoop && v.hoop.a > 0.01) {
      const h = toScreen(v.hoop.x, v.hoop.y, v.hoop.z, 0.74);
      const R = Math.max(16, 0.45 * h.s);
      ctx.save();
      ctx.globalAlpha = v.hoop.a;
      ctx.translate(h.x, h.y);
      ctx.rotate(Math.sin(v.hoop.spin * 0.5) * 0.4);
      const sq = 0.35 + 0.65 * Math.abs(Math.cos(v.hoop.spin));
      ctx.lineWidth = Math.max(3, R * 0.12);
      ctx.strokeStyle = "#1c1726";
      ctx.beginPath();
      ctx.ellipse(0, 0, R * sq, R, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = Math.max(2, R * 0.08);
      ctx.strokeStyle = "#B58CFF";
      ctx.setLineDash([R * 0.35, R * 0.18]);
      ctx.lineDashOffset = -v.hoop.spin * R * 0.4;
      ctx.beginPath();
      ctx.ellipse(0, 0, R * sq, R, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
    const b = toScreen(v.x, v.y, v.z, v.u);
    const r = Math.max(4.6, BALLR_PX(b.s));
    if (v.inHand) {
      // 이반: 손에서 기모으기
      const k = (v.tagK ?? 0);
      ctx.fillStyle = `rgba(255,60,60,${0.3 + k * 0.5})`;
      ctx.beginPath();
      ctx.arc(hand.x, hand.y, 8 + k * 18 + Math.sin(this.time * 40) * 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.globalAlpha = v.vis;
    switch (sp) {
      case "igna":
        this.drawFireBall(ctx, b.x, b.y, r * 1.6, true);
        break;
      case "mei":
        if (v.tag === "split") this.drawBun(ctx, b.x, b.y, Math.max(6, 0.075 * b.s));
        else this.drawBall(ctx, b.x, b.y, r);
        if (v.tag === "merge") {
          // 합쳐지며 김 퐁 (치는 신호)
          const k = v.tagK ?? 0;
          ctx.fillStyle = `rgba(255,255,255,${0.75 * (1 - k)})`;
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + this.time * 3;
            ctx.beginPath();
            ctx.arc(b.x + Math.cos(a) * r * (1.5 + k * 3), b.y + Math.sin(a) * r * (1.2 + k * 2) - k * 10, r * (0.8 + k), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      case "lily": {
        const bub = v.tag === "bubble";
        this.drawBall(ctx, b.x, b.y, r);
        if (bub) {
          ctx.strokeStyle = "rgba(160,230,255,0.9)";
          ctx.fillStyle = "rgba(120,210,255,0.25)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(b.x, b.y, r * 2.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          ctx.beginPath();
          ctx.arc(b.x - r, b.y - r, r * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "zena":
        ctx.shadowColor = "#FFD43B";
        ctx.shadowBlur = 20;
        this.drawBall(ctx, b.x, b.y, r * 1.2);
        ctx.shadowBlur = 0;
        if (v.tag === "rise") {
          ctx.strokeStyle = "#FFD43B";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y + 4);
          ctx.lineTo(b.x - 6, b.y + 16);
          ctx.lineTo(b.x + 3, b.y + 22);
          ctx.lineTo(b.x - 3, b.y + 34);
          ctx.stroke();
        }
        break;
      case "kai":
        ctx.strokeStyle = "rgba(200,230,255,0.8)";
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(b.x, b.y, r * (2 + i), this.time * 12 + i, this.time * 12 + i + 2);
          ctx.stroke();
        }
        this.drawBall(ctx, b.x, b.y, r);
        break;
      case "gunmo":
        if (v.vis > 0.05) {
          this.drawBall(ctx, b.x, b.y, r);
          ctx.fillStyle = "rgba(59,156,255,0.7)";
          for (let i = 0; i < 4; i++) ctx.fillRect(b.x + (this.rng() - 0.5) * 20, b.y + (this.rng() - 0.5) * 12, 6, 2);
        }
        break;
      case "ivan":
        ctx.shadowColor = "#ff3b3b";
        ctx.shadowBlur = 18;
        this.drawBall(ctx, b.x, b.y, r * 1.1);
        ctx.shadowBlur = 0;
        break;
      case "violet":
        ctx.shadowColor = "#B58CFF";
        ctx.shadowBlur = 12;
        this.drawBall(ctx, b.x, b.y, r);
        ctx.shadowBlur = 0;
        break;
      case "soyoung":
        ctx.shadowColor = "#FF5FB4";
        ctx.shadowBlur = 14;
        this.drawBall(ctx, b.x, b.y, r);
        ctx.shadowBlur = 0;
        break;
      default:
        this.drawBall(ctx, b.x, b.y, r, p.kind);
    }
    ctx.globalAlpha = 1;
    // 디버그 볼: 버퍼링 바
    if (sp === "gunmo" && v.tag === "buffer") {
      const k = v.tagK ?? 0;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(362, 236, 300, 28);
      ctx.fillStyle = "#3B9CFF";
      ctx.fillRect(366, 240, 292 * k, 20);
      ctx.fillStyle = "#fff";
      ctx.font = '700 13px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      ctx.fillText(`BUFFERING… ${Math.floor(k * 100)}%`, 512, 255);
    }
  }

  /**
   * 날아가는 공 — 실제 공은 초당 30~40바퀴 돌아서 실밥이 선으로 안 보이고 붉은 기운으로 번짐.
   * 직구 · 투심(백스핀) = 가로로 번진 분홍 띠, 슬라이더 · 커터 = 「빨간 점」(회전축이 보이는 슬라이더 특유의 점),
   * 커브(톱스핀) = 세로로 번진 띠, 체인지업 · 포크 · 싱커 = 옅게 퍼진 분홍. 너클볼만 실밥이 보이는데 우리 구종엔 없음.
   */
  private drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, kind?: PitchKind) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.6, "#f1f2f5");
    g.addColorStop(1, "#c4c8d2");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (r > 4) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.clip();
      // 슬라이더 · 커터는 예전에 빨간 점(회전축)을 찍었는데 공에 점 박힌 것 같아서 뺌 — 옅은 실밥 띠만
      if (kind === "CB" || kind === "SL" || kind === "CT") {
        ctx.fillStyle = "rgba(225,85,90,0.2)";
        ctx.fillRect(x - r * 0.22, y - r, r * 0.44, r * 2);
      } else if (kind === "CH" || kind === "FK" || kind === "SK") {
        ctx.fillStyle = "rgba(230,110,120,0.13)";
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      } else {
        ctx.fillStyle = "rgba(225,85,90,0.2)";
        ctx.fillRect(x - r, y - r * 0.2, r * 2, r * 0.4);
      }
      ctx.restore();
    }
    // 얇은 어두운 테두리 (밝은 하늘 · 흰 유니폼 앞에서도 보이게)
    ctx.strokeStyle = "rgba(20,22,34,0.8)";
    ctx.lineWidth = Math.max(1.1, r * 0.13);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** 메이: 만두 (분신) */
  private drawBun(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    ctx.fillStyle = "#fff8ea";
    ctx.strokeStyle = "rgba(60,40,20,0.85)";
    ctx.lineWidth = Math.max(1.5, r * 0.16);
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.15, r * 1.25, r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 주름
    ctx.strokeStyle = "rgba(150,110,70,0.9)";
    ctx.lineWidth = Math.max(1, r * 0.1);
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(x + i * r * 0.18, y - r * 0.55);
      ctx.quadraticCurveTo(x + i * r * 0.35, y - r * 0.1, x + i * r * 0.5, y + r * 0.2);
      ctx.stroke();
    }
    // 김
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.3, y - r * 1.1);
    ctx.quadraticCurveTo(x - r * 0.6, y - r * 1.6, x - r * 0.2, y - r * 2.1);
    ctx.moveTo(x + r * 0.3, y - r * 1.1);
    ctx.quadraticCurveTo(x, y - r * 1.6, x + r * 0.4, y - r * 2.1);
    ctx.stroke();
  }

  private drawFireBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, real: boolean) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
    g.addColorStop(0, "#fff6c2");
    g.addColorStop(0.35, "#ffae3d");
    g.addColorStop(1, "rgba(255,60,20,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
    ctx.fill();
    if (real) {
      // 진짜는 연기 꼬리
      ctx.fillStyle = "rgba(90,90,100,0.45)";
      for (let i = 1; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(x - i * 4, y - i * 6, r * (0.6 + i * 0.25), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawGauge(ctx: CanvasRenderingContext2D, gx?: number) {
    // 타자 반대쪽 (좌타자면 존 왼쪽)
    const x = gx ?? (this.shownBatter.bats === "L" ? 352 : 640);
    const y = 300;
    const h = 170;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x - 4, y - 24, 40, h + 52);
    const grd = ctx.createLinearGradient(0, y + h, 0, y);
    grd.addColorStop(0, "#3b4a6b");
    grd.addColorStop(0.6, "#7ad7ff");
    grd.addColorStop(0.88, "#ffd23f");
    grd.addColorStop(1, "#ff4d6d");
    ctx.fillStyle = grd;
    ctx.fillRect(x + 6, y, 20, h);
    // MAX 구간
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 4, y - 2, 24, h * 0.1 + 2);
    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.fillStyle = "#ffd23f";
    ctx.textAlign = "center";
    ctx.fillText("MAX", x + 16, y - 8);
    if (this.phase === "gauge") {
      const vy = y + h * (1 - this.gaugeVal);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(x - 2, vy);
      ctx.lineTo(x - 14, vy - 7);
      ctx.lineTo(x - 14, vy + 7);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x + 2, vy - 1.5, 28, 3);
    }
    ctx.fillStyle = "#fff";
    ctx.font = '700 11px "Nanum Gothic", sans-serif';
    ctx.fillText(this.phase === "gauge" ? "멈춰!" : "게이지", x + 16, y + h + 20);
  }

  /**
   * 타구가 날아갈 길: 지금(t) 이후 프레임에서 잡히거나(hold) 땅에 처음 닿을 때까지의 공 자리 · 그 끝 = 떨어질 자리.
   * 뜬공 · 라이너만 (낮게 굴러가는 공은 없음)
   */
  private arcCache: { frames: Frame[]; idx: number[]; landI: number } | null = null;
  private flightArc(t: number) {
    const F = this.frames;
    if (!F.length) return undefined;
    if (!this.arcCache || this.arcCache.frames !== F) {
      let landI = -1;
      let peak = 0;
      for (let i = 1; i < F.length; i++) {
        peak = Math.max(peak, F[i].bh);
        if (F[i].hold >= 0 || (peak > 1 && F[i].bh <= 0.15)) {
          landI = i;
          break;
        }
      }
      // 홈런처럼 잡히지도 떨어지지도 않고 끝나면 마지막 자리까지
      if (landI < 0) {
        landI = F.length - 1;
        for (const fr of F) peak = Math.max(peak, fr.bh);
      }
      const idx: number[] = [];
      if (landI > 0 && peak > 2) for (let i = 0; i <= landI; i += Math.max(1, Math.floor(landI / 40))) idx.push(i);
      if (idx.length && idx[idx.length - 1] !== landI) idx.push(landI);
      this.arcCache = { frames: F, idx, landI: peak > 2 ? landI : -1 };
    }
    const c = this.arcCache;
    // 떨어지거나 잡힌 뒤(송구 중)엔 낙하 표시 없음
    if (c.landI < 0 || t > F[c.landI].t) return undefined;
    const pts = c.idx.filter((i) => F[i].t > t).map((i) => ({ x: F[i].bx, y: F[i].by, h: F[i].bh }));
    return { pts, land: { x: F[c.landI].bx, y: F[c.landI].by } };
  }

  private drawField(ctx: CanvasRenderingContext2D, q: number) {
    const d3 = this.on3d && !!this.w3d;
    if (!d3) ctx.drawImage(fieldBg(q, this.night), 0, 0, DW, DH);
    const fr = this.frameAt(this.ft);
    if (!fr) return;
    const fsd = this.s.sides[fieldSide(this.s)];
    const bsd = this.s.sides[batSide(this.s)];
    this.trail.push({ x: fr.bx, y: fr.by, h: fr.bh });
    if (this.trail.length > 18) this.trail.shift();
    const sp = this.outcome?.sw?.kind === "bip" ? this.outcome.sw.ball.special : undefined;
    const deriv = this.cfg.mode === "derby";
    if (deriv) {
      // 홈런더비: 수비 없이 공만
      const b = fproj(fr.bx, fr.by, fr.bh);
      if (!d3) {
      const sh = fproj(fr.bx, fr.by);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(sh.x, sh.y, 3, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.trail.forEach((t, i) => {
        const p = fproj(t.x, t.y, t.h);
        if (i) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
      ctx.fill();
      }
      // 골든 보드
      const gb = fproj(0, 128, 6);
      ctx.fillStyle = "#ffd23f";
      ctx.fillRect(gb.x - 22, gb.y - 10, 44, 16);
      ctx.fillStyle = "#3a2a00";
      ctx.font = '800 10px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      ctx.fillText("GOLD", gb.x, gb.y + 2);
    } else if (!d3) {
      drawFieldFrame(ctx, fr, { body: fsd.team.color, cap: fsd.team.dark }, { body: bsd.team.color, cap: bsd.team.dark }, this.trail, sp, this.flightArc(this.ft));
    }
    if (this.hr) {
      const d = Math.round(this.hrDist);
      ctx.font = '30px "Black Han Sans", sans-serif';
      ctx.textAlign = "center";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      const tt = `${d}m`;
      ctx.strokeText(tt, 512, 230);
      ctx.fillStyle = "#ffd23f";
      ctx.fillText(tt, 512, 230);
      // 폭죽
      if (this.rng() < 0.3) {
        const cx = 200 + this.rng() * 620;
        const cy = 60 + this.rng() * 140;
        const col = ["#ffd23f", "#ff5fb4", "#7ad7ff", "#7dff9a"][Math.floor(this.rng() * 4)];
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          this.particles.push({ x: cx, y: cy, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, life: 0.8, c: col });
        }
      }
      for (const pt of this.particles) {
        ctx.globalAlpha = Math.min(1, pt.life * 2);
        ctx.fillStyle = pt.c;
        ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
      }
      ctx.globalAlpha = 1;
    }
  }

  private frameAt(t: number) {
    const fs = this.frames;
    if (!fs.length) return null;
    const i = clamp(Math.floor(t * 60), 0, fs.length - 1);
    return fs[i];
  }

  private drawBanner(ctx: CanvasRenderingContext2D) {
    const b = this.banner;
    if (!b) return;
    const inK = smooth(0, 0.12, b.t);
    const outK = 1 - smooth(b.dur - 0.2, b.dur, b.t);
    const a = Math.min(inK, outK);
    ctx.globalAlpha = a;
    const y = b.big ? 230 : 210;
    const hgt = b.big ? 92 : 64;
    const grd = ctx.createLinearGradient(0, 0, DW, 0);
    grd.addColorStop(0, "rgba(0,0,0,0)");
    grd.addColorStop(0.2, "rgba(0,0,0,0.72)");
    grd.addColorStop(0.8, "rgba(0,0,0,0.72)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, y - hgt / 2, DW, hgt);
    const lim = b.logo ? img(b.logo) : null;
    if (lim && lim.complete && lim.naturalWidth) {
      // 홈런: 로고가 크게 튀어나와 흔들림
      const pop = b.t < 0.14 ? 2 - (b.t / 0.14) * 1.1 : b.t < 0.26 ? 0.9 + ((b.t - 0.14) / 0.12) * 0.1 : 1 + Math.sin(b.t * 9) * 0.02;
      const w = 360 * pop;
      const h = w * (lim.naturalHeight / lim.naturalWidth);
      ctx.drawImage(lim, 512 - w / 2, y - 20 - h / 2, w, h);
      if (b.sub) {
        ctx.font = '22px "Black Han Sans", sans-serif';
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.lineWidth = 5;
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.strokeText(b.sub, 512, y + h / 2 + 4);
        ctx.fillText(b.sub, 512, y + h / 2 + 4);
      }
      ctx.globalAlpha = 1;
      return;
    }
    const sc = 1 + (1 - inK) * 0.4;
    ctx.save();
    ctx.translate(512, y + (b.sub ? -6 : 8));
    ctx.scale(sc, sc);
    ctx.font = `${b.big ? 46 : 34}px "Black Han Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText(b.text, 0, 0);
    ctx.fillStyle = b.color;
    ctx.fillText(b.text, 0, 0);
    ctx.restore();
    if (b.sub) {
      ctx.font = '700 16px "Nanum Gothic", sans-serif';
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText(b.sub, 512, y + 30);
    }
    ctx.globalAlpha = 1;
  }

  private drawCutin(ctx: CanvasRenderingContext2D) {
    const c = this.cutin!;
    const ch = charById(c.id);
    const t = c.t;
    const inK = smooth(0, 0.18, t);
    const outK = 1 - smooth(0.95, 1.15, t);
    const a = Math.min(inK, outK);
    ctx.fillStyle = `rgba(0,0,0,${0.55 * a})`;
    ctx.fillRect(0, 0, DW, DH);
    // 띠 (그림 전체가 보이게: 1200×500 → 가로 840)
    const bw = 840;
    const bh = 350;
    const dir = c.side === "bat" ? -1 : 1;
    const x = 512 - bw / 2 + dir * (1 - inK) * 600 - dir * (1 - outK) * 600;
    const y = 120;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.moveTo(x + 40, y);
    ctx.lineTo(x + bw, y);
    ctx.lineTo(x + bw - 40, y + bh);
    ctx.lineTo(x, y + bh);
    ctx.closePath();
    ctx.fillStyle = ch.color;
    ctx.fill();
    ctx.clip();
    const im = img(cutinUrl(c.id));
    if (im.complete && im.naturalWidth) ctx.drawImage(im, x, y, bw, bh);
    // 속도선
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      const ly = y + ((i * 37 + t * 900) % bh);
      ctx.beginPath();
      ctx.moveTo(x, ly);
      ctx.lineTo(x + bw * 0.25, ly);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = a;
    ctx.font = '52px "Black Han Sans", sans-serif';
    ctx.textAlign = "center";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.strokeText(c.title, 512, y + bh + 54);
    ctx.fillStyle = ch.color;
    ctx.fillText(c.title, 512, y + bh + 54);
    ctx.font = '700 16px "Nanum Gothic", sans-serif';
    ctx.fillStyle = "#fff";
    ctx.fillText(`${ch.name} · ${c.side === "bat" ? "필살타법" : "마구"} — ${c.sub}`, 512, y + bh + 84);
    ctx.globalAlpha = 1;
  }

  /**
   * 필살타법 사이드 컷인: 타자 반대쪽 화면 옆에서 비스듬한 판이 툭 튀어나와 1.3초 —
   * 캐릭터 스윙 그림(없으면 서 있는 그림 위쪽) + 퍼스널 컬러 + 기술 이름. 화면을 덮지 않고 경기는 그대로 굴러감
   */
  private drawSideCut(ctx: CanvasRenderingContext2D) {
    const c = this.sideCut!;
    const ch = charById(c.id);
    const t = c.t;
    // 들어올 때 살짝 넘쳤다 돌아옴 · 나갈 땐 빠르게
    const u = clamp(t / 0.16, 0, 1);
    const inK = 1 + 2.2 * Math.pow(u - 1, 3) + 1.2 * Math.pow(u - 1, 2);
    const outK = 1 - smooth(SIDE_CUT_DUR - 0.22, SIDE_CUT_DUR, t);
    const k = Math.min(inK, outK);
    const W = 300, H = 330, Y = 128, SL = 56;
    const R = c.right;
    // 판 바깥 끝은 화면 밖까지 (옆에서 나온 느낌)
    const edge = R ? DW + 30 : -30;
    const inner = R ? DW - W * k : W * k;
    const pts = R
      ? [[inner + SL, Y], [edge, Y], [edge, Y + H], [inner, Y + H]]
      : [[edge, Y], [inner, Y], [inner - SL, Y + H], [edge, Y + H]];
    ctx.save();
    const path = () => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    };
    // 그림자
    ctx.save();
    ctx.translate(R ? -8 : 8, 8);
    path();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fill();
    ctx.restore();
    path();
    const gx0 = R ? inner : edge;
    const g = ctx.createLinearGradient(gx0, Y, gx0 + (R ? W : -W), Y + H);
    g.addColorStop(0, ch.color);
    g.addColorStop(1, "#120b1e");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // 속도선 (안쪽으로 흐름)
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const ly = Y + ((i * 41 + 17) % H);
      const off = ((t * 1400 + i * 97) % (W + 200)) - 100;
      const x0 = R ? DW - off : off;
      ctx.beginPath();
      ctx.moveTo(x0, ly);
      ctx.lineTo(x0 + (R ? -90 : 90), ly);
      ctx.stroke();
    }
    // 캐릭터 (스윙 그림 · 없으면 서 있는 그림 위 60%)
    const sw = hasSwingArt(c.id) ? img(swingArtUrl(c.id)) : null;
    const st = img(artUrl(c.id));
    const cx = R ? DW - (W * k) / 2 + 6 : (W * k) / 2 - 6;
    if (sw && sw.complete && sw.naturalWidth) {
      const h = H + 20;
      const w = (sw.naturalWidth / sw.naturalHeight) * h;
      ctx.save();
      if (!R) {
        // 그림은 오른쪽을 보고 있음 → 왼쪽 판에선 안쪽(오른쪽)을 보게 그대로, 오른쪽 판에선 뒤집어 안쪽(왼쪽)을 보게
      } else {
        ctx.translate(cx * 2, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(sw, cx - w / 2, Y - 10, w, h);
      ctx.restore();
    } else if (st.complete && st.naturalWidth) {
      const sh = st.naturalHeight * 0.58;
      const h = H - 20;
      const w = (st.naturalWidth / sh) * h;
      ctx.drawImage(st, 0, 0, st.naturalWidth, sh, cx - w / 2, Y + 6, w, h);
    }
    // 아래 이름 띠
    const bandY = Y + H - 74;
    const bg = ctx.createLinearGradient(0, bandY, 0, Y + H);
    bg.addColorStop(0, "rgba(0,0,0,0)");
    bg.addColorStop(0.35, "rgba(8,4,16,0.82)");
    ctx.fillStyle = bg;
    ctx.fillRect(R ? inner - SL : edge, bandY, W + SL + 40, 80);
    ctx.restore();
    // 테두리 빛
    path();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.stroke();
    // 글자
    const tx = R ? inner + SL * 0.25 + (W - SL * 0.25) / 2 - 6 : inner - SL * 0.25 - (W - SL * 0.25) / 2 + 6;
    ctx.globalAlpha = clamp(k * 1.4 - 0.2, 0, 1);
    ctx.textAlign = "center";
    ctx.font = '800 12px "Nanum Gothic", sans-serif';
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillText(`${ch.name} · 필살타법`, tx, Y + H - 44);
    ctx.font = '30px "Black Han Sans", sans-serif';
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.strokeText(ch.swing.name, tx, Y + H - 14);
    ctx.fillStyle = ch.color;
    ctx.fillText(ch.swing.name, tx, Y + H - 14);
    ctx.restore();
  }

  /** 미션 주는 사람 얼굴 (인연 캐릭터 얼굴 · 팀 사람들 초상) */
  private missionFace(m: Mission) {
    return m.char ? faceUrl(m.char) : NPC_FACE[m.who] ?? null;
  }
  private missionColor(m: Mission) {
    return m.char ? charById(m.char).color : NPC_COLOR[m.who] ?? "#ffcf4a";
  }
  /** 미션 결과로 실제로 바뀌는 것 (육성 · 연습 경기마다 다름) */
  private missionRewards(m: Mission, r: "ok" | "partial" | "fail"): { t: string; good: boolean }[] {
    const out: { t: string; good: boolean }[] = [];
    const bond = m.char ? charById(m.char).name : null;
    const career = !!this.cfg.career;
    if (r === "ok") {
      out.push(career ? { t: `자금 +${Math.round(m.pt / 3)}만`, good: true } : { t: `+${m.pt} 코인`, good: true });
      if (!this.userBat) out.push({ t: "마구 +1", good: true });
      if (career) out.push({ t: "감독 신뢰 ↑", good: true }, { t: "인기도 +2", good: true }, { t: "경기 평가 ↑", good: true });
      if (bond && career) out.push({ t: `${bond} 호감 +6`, good: true });
    } else if (r === "partial") {
      const pp = Math.round(m.pt / 4);
      out.push(career ? { t: `자금 +${Math.round(pp / 3)}만`, good: true } : { t: `+${pp} 코인`, good: true });
      if (bond && career) out.push({ t: `${bond} 호감 +2`, good: true });
      if (career) out.push({ t: "패널티 없음", good: true });
    } else {
      if (career) out.push({ t: "감독 신뢰 ↓", good: false });
      if (bond && career) out.push({ t: `${bond} 호감 −3`, good: false });
      if (!out.length) out.push({ t: "보상 없음", good: false });
    }
    return out;
  }
  /** 보상 칩 한 줄 (x 부터 오른쪽으로) — 그린 폭. maxW 보다 길면 통째로 줄여서 판 밖으로 안 나가게 */
  private rewardChips(ctx: CanvasRenderingContext2D, x: number, y: number, list: { t: string; good: boolean }[], k = 1, small = false, maxW = Infinity) {
    ctx.font = `800 ${small ? 11 : 12.5}px "Nanum Gothic", sans-serif`;
    const ws = list.map((c) => ctx.measureText(c.t).width + 14);
    const total = ws.reduce((a, w) => a + w, 0) + 6 * Math.max(0, list.length - 1);
    const sc = total > maxW ? maxW / total : 1;
    const h = small ? 18 : 22;
    ctx.save();
    ctx.translate(x, y + (h * (1 - sc)) / 2);
    ctx.scale(sc, sc);
    let cx = 0;
    list.forEach((c, i) => {
      const a = clamp(k * list.length - i, 0, 1);
      const w = ws[i];
      if (a <= 0) return;
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.translate(0, (1 - a) * 8);
      ctx.fillStyle = c.good ? "rgba(255,210,63,0.16)" : "rgba(255,90,90,0.16)";
      ctx.strokeStyle = c.good ? "rgba(255,210,63,0.7)" : "rgba(255,110,110,0.7)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(cx, 0, w, h, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = c.good ? "#ffe9a8" : "#ffb0b0";
      ctx.textAlign = "left";
      ctx.fillText(c.t, cx + 7, h / 2 + 4.5);
      ctx.restore();
      cx += w + 6;
    });
    ctx.restore();
    return Math.min(total, maxW);
  }
  /** 한 줄 글씨를 maxW 안에 들어가게 글자 크기를 줄임 (size → min) */
  private fitFont(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, min: number, face: string) {
    let sz = size;
    ctx.font = `${sz}px ${face}`;
    while (sz > min && ctx.measureText(text).width > maxW) {
      sz -= 1;
      ctx.font = `${sz}px ${face}`;
    }
    return sz;
  }
  /** 얼굴 (둥근 네모 · 테두리) */
  private missionPortrait(ctx: CanvasRenderingContext2D, m: Mission, x: number, y: number, s: number, gray = false) {
    const col = this.missionColor(m);
    const src = this.missionFace(m);
    const im = src ? img(src) : null;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, s, s, 14);
    ctx.fillStyle = "#141a33";
    ctx.fill();
    ctx.clip();
    if (im && im.complete && im.naturalWidth) {
      if (gray) ctx.filter = "grayscale(1) brightness(0.8)";
      const h = s * (im.naturalHeight / im.naturalWidth);
      ctx.drawImage(im, x, y, s, h);
      ctx.filter = "none";
    } else {
      ctx.fillStyle = col;
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = "#1a1a24";
      ctx.font = '30px "Black Han Sans", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText(m.who, x + s / 2, y + s / 2 + 11);
      ctx.textAlign = "left";
    }
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = gray ? "#666" : col;
    ctx.beginPath();
    ctx.roundRect(x, y, s, s, 14);
    ctx.stroke();
  }

  /**
   * 미션 등장 카드 (타석 시작) — 돌발 미션 · 인연 미션 같은 틀, 인연은 그 사람 색으로 빛나게.
   * 「MISSION!」 리본이 들어오고 카드가 튀어 오름 · 성공하면 / 실패하면 바뀌는 것 칩으로
   */
  private drawMission(ctx: CanvasRenderingContext2D) {
    const m = this.s.mission!;
    const t = this.pt;
    const col = this.missionColor(m);
    const bond = !!m.char;
    const W = 680, H = 168;
    const x = 512 - W / 2, y = 318;
    const pop = t < 0.18 ? 0.7 + (t / 0.18) * 0.38 : t < 0.3 ? 1.08 - ((t - 0.18) / 0.12) * 0.08 : 1;
    ctx.save();
    ctx.globalAlpha = Math.min(1, t / 0.12);
    // 화면 살짝 어둡게
    ctx.fillStyle = "rgba(4,6,16,0.35)";
    ctx.fillRect(0, 0, DW, DH);
    ctx.translate(512, y + H / 2);
    ctx.scale(pop, pop);
    ctx.translate(-512, -(y + H / 2));
    // 판: 인연은 그 사람 색 빛 · 돌발은 남색
    if (bond) {
      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = 26 + Math.sin(t * 6) * 8;
      ctx.fillStyle = "rgba(0,0,0,0.01)";
      ctx.beginPath();
      ctx.roundRect(x, y, W, H, 18);
      ctx.fill();
      ctx.restore();
    }
    const g = ctx.createLinearGradient(x, y, x + W, y + H);
    g.addColorStop(0, bond ? `${col}55` : "rgba(40,52,96,0.96)");
    g.addColorStop(0.45, "rgba(14,18,38,0.96)");
    g.addColorStop(1, "rgba(8,10,24,0.96)");
    ctx.fillStyle = g;
    ctx.strokeStyle = col;
    ctx.lineWidth = bond ? 4 : 3;
    ctx.beginPath();
    ctx.roundRect(x, y, W, H, 18);
    ctx.fill();
    ctx.stroke();
    // 리본 (왼쪽 위에서 미끄러져 들어옴)
    {
      const rk = 1 - Math.pow(1 - Math.min(1, t / 0.28), 3);
      const label = bond ? `♥ ${m.who}의 부탁` : `${m.who}의 돌발 미션`;
      // 앞에서 그린 배너(가운데 정렬)가 남아 있으면 글씨가 리본 왼쪽 밖으로 삐져나왔음
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = '20px "Black Han Sans", sans-serif';
      const lw = ctx.measureText(label).width + 30;
      const rx = x + 14 - (1 - rk) * 220;
      const ry = y - 16;
      ctx.globalAlpha *= rk;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + lw + 12, ry);
      ctx.lineTo(rx + lw, ry + 30);
      ctx.lineTo(rx - 12, ry + 30);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#14102a";
      ctx.fillText(label, rx + 12, ry + 23);
      ctx.globalAlpha = Math.min(1, t / 0.12);
    }
    // 「MISSION!」 큰 글씨 (오른쪽 위)
    ctx.save();
    ctx.translate(x + W - 20, y - 2);
    ctx.rotate(-0.08);
    ctx.font = '30px "Black Han Sans", sans-serif';
    ctx.textAlign = "right";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText("MISSION!", 0, 0);
    const mg = ctx.createLinearGradient(0, -26, 0, 0);
    mg.addColorStop(0, "#fff6c2");
    mg.addColorStop(1, bond ? col : "#ffb625");
    ctx.fillStyle = mg;
    ctx.fillText("MISSION!", 0, 0);
    ctx.restore();
    // 얼굴
    this.missionPortrait(ctx, m, x + 18, y + 26, 118);
    // 미션 내용
    const tx = x + 152;
    ctx.fillStyle = "#fff";
    const maxW = x + W - 20 - tx;
    ctx.textAlign = "left";
    this.fitFont(ctx, `"${m.text}"`, maxW, 25, 16, '"Jua", "Nanum Gothic", sans-serif');
    ctx.fillText(`"${m.text}"`, tx, y + 58);
    // 보상
    ctx.font = '800 12px "Nanum Gothic", sans-serif';
    ctx.fillStyle = "#ffd23f";
    ctx.fillText("성공하면", tx, y + 92);
    this.rewardChips(ctx, tx + 58, y + 77, this.missionRewards(m, "ok"), Math.min(1, Math.max(0, (t - 0.25) / 0.5)), false, maxW - 58);
    const fail = this.missionRewards(m, "fail");
    ctx.font = '800 11px "Nanum Gothic", sans-serif';
    ctx.fillStyle = "#ff9a9a";
    ctx.fillText(m.kind === "hr" || m.kind === "xbh" ? "실패하면" : "실패하면", tx, y + 125);
    ctx.font = '800 11px "Nanum Gothic", sans-serif';
    const fx = tx + ctx.measureText(m.kind === "hr" || m.kind === "xbh" ? "실패하면" : "실패하면").width + 10;
    this.rewardChips(ctx, fx, y + 112, fail, Math.min(1, Math.max(0, (t - 0.5) / 0.4)), true, tx + maxW - fx);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "12px \"Nanum Gothic\", sans-serif";
    ctx.textAlign = "right";
    ctx.globalAlpha *= 0.6 + 0.4 * Math.sin(this.time * 5);
    ctx.fillText("탭 · Space 로 시작", x + W - 18, y + H - 12);
    ctx.textAlign = "left";
    ctx.restore();
  }

  private snapRecap(): RecapBase {
    const s = this.s;
    return {
      inning: s.inning, top: s.top, outs: s.outs, bases: [s.bases[0] !== null, s.bases[1] !== null, s.bases[2] !== null],
      score: [s.score[0], s.score[1]], line: [[...s.line[0]], [...s.line[1]]], hits: [s.sides[0].hits, s.sides[1].hits],
    };
  }
  private startRecap(lines: RecapLine[]) {
    // 한 줄 0.4초 (×1 기준 — 배속으로 줄임). 줄 수에 따라 속도를 바꾸면 판마다 빠르기가 달라 배속이 안 먹는 것처럼 보였음
    // 건너뛴 타석이 없으면 (첫 타석이 1회 첫 타자) 양 팀 타순만 잠깐
    const step = lines.length ? 0.4 : 0;
    this.recap = { lines: [...lines], shown: 0, t: step * 0.6, step, hold: !lines.length ? 2 : this.cfg.highlight ? 1.4 : 1 };
    this.setPhase("recap");
  }
  /** 요약 한 줄 드러내기 (타순표의 오늘 기록에도 붙음) */
  private revealRecap() {
    const r = this.recap!;
    const l = r.lines[r.shown++];
    this.hist[l.side][l.ord]?.push(paShort(l.text, l.kind));
    if (l.kind === "HR") sfx.ui();
  }
  skipRecap() {
    const r = this.recap;
    if (!r) return;
    logUi("recapSkip");
    if (r.shown < r.lines.length) {
      while (r.shown < r.lines.length) this.revealRecap();
      r.t = r.hold - 0.4;
    } else r.t = r.hold;
  }

  /**
   * 경기 요약 (문자중계 · 화면 꽉 채움) — 건너뛴 타석을 한 줄씩.
   * 위: 이닝별 점수표(R · H) / 양옆: 원정 · 홈 타순(포지션 · 이름 · 오늘 기록) / 가운데: 다이아몬드(주자 · 아웃) · 타자 vs 투수 · 중계 글
   */
  private drawRecap(ctx: CanvasRenderingContext2D) {
    const r = this.recap;
    if (!r) return;
    const s = this.s;
    const base = this.recapBase ?? this.snapRecap();
    const last = r.shown ? r.lines[r.shown - 1] : null;
    const st = last
      ? { inning: last.inning, top: last.top, outs: last.outs, bases: last.bases, score: last.score, line: last.line, hits: last.hits }
      : base;
    const me = mySide(s);
    const myIdx = this.cfg.career?.myIdx ?? -1;
    const team = (i: number) => s.sides[i].team;
    const enter = r.step ? Math.min(1, r.t / Math.min(0.12, r.step)) : 1;
    ctx.save();
    // 배경
    const g = ctx.createLinearGradient(0, 0, 0, DH);
    g.addColorStop(0, "#101a3c");
    g.addColorStop(1, "#05070f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, DW, DH);
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    for (let x = 0; x < DW; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, DH);
      ctx.stroke();
    }
    ctx.textBaseline = "middle";

    // ── 점수표 ──
    const nInn = Math.max(9, st.line[0].length, st.line[1].length, st.inning);
    const sx = 16, sy = 10, sw = DW - 32, sh = 84;
    this.panel(ctx, sx, sy, sw, sh);
    const nameW = 170, colW = Math.min(46, (sw - nameW - 2 * 56 - 16) / nInn);
    const colX = (i: number) => sx + nameW + colW * (i + 0.5);
    const rhX = (k: number) => sx + nameW + colW * nInn + 28 + k * 56;
    const rowY = (i: number) => sy + 34 + i * 26;
    ctx.font = '700 12px "Nanum Gothic", sans-serif';
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.textAlign = "center";
    for (let i = 0; i < nInn; i++) ctx.fillText(String(i + 1), colX(i), sy + 14);
    ctx.fillText("R", rhX(0), sy + 14);
    ctx.fillText("H", rhX(1), sy + 14);
    for (let t = 0; t < 2; t++) {
      const y = rowY(t);
      // 지금 공격 칸
      const curCol = st.inning - 1;
      if ((t === 0) === st.top) {
        ctx.fillStyle = "rgba(255,207,74,0.16)";
        ctx.fillRect(colX(curCol) - colW / 2 + 2, y - 11, colW - 4, 22);
      }
      ctx.textAlign = "left";
      ctx.fillStyle = team(t).color;
      ctx.beginPath();
      ctx.roundRect(sx + 14, y - 9, 18, 18, 4);
      ctx.fill();
      ctx.font = '900 15px "Nanum Gothic", sans-serif';
      ctx.fillStyle = t === me ? "#ffcf4a" : "#fff";
      ctx.fillText(team(t).name, sx + 40, y + 1);
      ctx.textAlign = "center";
      ctx.font = '800 15px "Nanum Gothic", sans-serif';
      for (let i = 0; i < nInn; i++) {
        const v = st.line[t][i];
        const played = i < st.inning - 1 || (i === st.inning - 1 && (t === 0 || !st.top));
        ctx.fillStyle = v ? "#ffcf4a" : "rgba(255,255,255,0.7)";
        ctx.fillText(v !== undefined && played ? String(v) : "", colX(i), y + 1);
      }
      ctx.font = '20px "Black Han Sans", sans-serif';
      ctx.fillStyle = "#fff";
      ctx.fillText(String(st.score[t]), rhX(0), y + 2);
      ctx.font = '800 15px "Nanum Gothic", sans-serif';
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillText(String(st.hits[t]), rhX(1), y + 1);
    }

    // ── 양 팀 타순 ──
    const lineup = (t: number, x: number) => {
      // 아래 40px 은 배속 · 메뉴 버튼 자리 (겹치지 않게)
      const w = 290, y0 = 102, rowH = 42;
      const atk = (t === 0) === st.top;
      this.panel(ctx, x, y0, w, 9 * rowH + 34, atk ? "rgba(255,207,74,0.6)" : undefined);
      ctx.textAlign = "left";
      ctx.font = '900 14px "Nanum Gothic", sans-serif';
      ctx.fillStyle = t === me ? "#ffcf4a" : "#fff";
      ctx.fillText(`${team(t).short} ${t === 0 ? "원정" : "홈"}`, x + 14, y0 + 17);
      ctx.textAlign = "right";
      ctx.font = '800 12px "Nanum Gothic", sans-serif';
      ctx.fillStyle = atk ? "#ffcf4a" : "rgba(255,255,255,0.4)";
      ctx.fillText(atk ? "공격" : "수비", x + w - 14, y0 + 17);
      team(t).batters.slice(0, 9).forEach((b, i) => {
        const y = y0 + 34 + i * rowH;
        const isMe = t === me && i === myIdx;
        const now = !!last && last.side === t && last.ord === i;
        if (now || isMe) {
          ctx.fillStyle = now ? `rgba(255,255,255,${0.16 * enter})` : "rgba(255,207,74,0.1)";
          ctx.beginPath();
          ctx.roundRect(x + 6, y + 2, w - 12, rowH - 4, 6);
          ctx.fill();
        }
        ctx.textAlign = "center";
        ctx.font = '800 13px "Nanum Gothic", sans-serif';
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.fillText(String(i + 1), x + 20, y + rowH / 2);
        this.chip(ctx, x + 32, y + rowH / 2 - 9, b.pos, "rgba(255,255,255,0.12)", "rgba(255,255,255,0.8)");
        ctx.textAlign = "left";
        ctx.font = `${isMe ? "900" : "800"} 15px "Nanum Gothic", sans-serif`;
        ctx.fillStyle = isMe ? "#ffcf4a" : "#fff";
        ctx.fillText(isMe ? `${b.name} ★` : b.name, x + 70, y + rowH / 2);
        // 오늘 기록 (최근 3개)
        const h = (this.hist[t][i] ?? []).slice(-3);
        let cx = x + w - 10;
        ctx.font = '800 11px "Nanum Gothic", sans-serif';
        for (let k = h.length - 1; k >= 0; k--) {
          const txt = h[k];
          const tw = ctx.measureText(txt).width + 10;
          cx -= tw;
          const col = PA_SHORT_COL[txt] ?? "rgba(255,255,255,0.55)";
          ctx.fillStyle = `${col}`;
          ctx.globalAlpha = k === h.length - 1 && now ? 0.35 + 0.65 * enter : 1;
          ctx.beginPath();
          ctx.roundRect(cx, y + rowH / 2 - 9, tw - 3, 18, 4);
          ctx.fill();
          ctx.fillStyle = "#0b0f1e";
          ctx.textAlign = "center";
          ctx.fillText(txt, cx + (tw - 3) / 2, y + rowH / 2 + 1);
          ctx.globalAlpha = 1;
        }
      });
    };
    lineup(0, 16);
    lineup(1, DW - 16 - 290);

    // ── 가운데: 이닝 · 다이아몬드 · 타자 vs 투수 · 중계 ──
    const cx0 = DW / 2;
    ctx.textAlign = "center";
    ctx.font = '26px "Black Han Sans", sans-serif';
    ctx.fillStyle = "#ffcf4a";
    ctx.fillText(`${st.inning}회${st.top ? "초" : "말"}`, cx0, 124);
    ctx.font = '800 13px "Nanum Gothic", sans-serif';
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillText(`${team(st.top ? 0 : 1).short} 공격`, cx0, 148);
    // 다이아몬드
    const dy = 222, dd = 50;
    ctx.save();
    ctx.translate(cx0, dy);
    ctx.fillStyle = "rgba(60,140,70,0.35)";
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, dd);
    ctx.lineTo(dd, 0);
    ctx.lineTo(0, -dd);
    ctx.lineTo(-dd, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const bag = (x: number, y: number, on: boolean) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = on ? "#ffcf4a" : "rgba(255,255,255,0.85)";
      if (on) {
        ctx.shadowColor = "#ffcf4a";
        ctx.shadowBlur = 12;
      }
      ctx.fillRect(-8, -8, 16, 16);
      ctx.restore();
    };
    bag(dd, 0, st.bases[0]);
    bag(0, -dd, st.bases[1]);
    bag(-dd, 0, st.bases[2]);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(-7, dd - 4);
    ctx.lineTo(7, dd - 4);
    ctx.lineTo(7, dd + 2);
    ctx.lineTo(0, dd + 8);
    ctx.lineTo(-7, dd + 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // 아웃
    ctx.font = '800 13px "Nanum Gothic", sans-serif';
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.textAlign = "right";
    ctx.fillText("OUT", cx0 + 92, dy + 2);
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.arc(cx0 + 106 + i * 18, dy + 1, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = i < st.outs || st.outs >= 3 ? "#ff5a4a" : "rgba(255,255,255,0.15)";
      ctx.fill();
    }
    // 타자 vs 투수 (방금 타석)
    if (last) {
      ctx.textAlign = "center";
      ctx.font = '900 15px "Nanum Gothic", sans-serif';
      ctx.fillStyle = last.me ? "#ffcf4a" : "#fff";
      ctx.fillText(`${last.name}${last.me ? " ★" : ""}`, cx0 - 70, 300);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = '800 12px "Nanum Gothic", sans-serif';
      ctx.fillText("VS", cx0, 300);
      ctx.font = '900 15px "Nanum Gothic", sans-serif';
      ctx.fillStyle = "#cfe0ff";
      ctx.fillText(last.pit, cx0 + 70, 300);
    }
    // 중계 (최근 5줄 · 새 줄은 밝게 미끄러져 들어옴)
    const fy = 320, fh = 210, fx = cx0 - 200, fw = 400;
    this.panel(ctx, fx, fy, fw, fh);
    const N = 5;
    const from = Math.max(0, r.shown - N);
    for (let i = from; i < r.shown; i++) {
      const l = r.lines[i];
      const row = i - from;
      const isNew = i === r.shown - 1;
      const y = fy + 26 + row * 40;
      const slide = isNew ? (1 - enter) * 18 : 0;
      ctx.globalAlpha = isNew ? 0.3 + 0.7 * enter : 0.55 + 0.45 * (row / N);
      const good = l.kind === "HR" ? "#ffd23f" : l.kind === "HIT" ? "#7dff9a" : l.kind === "BB" ? "#7ad7ff" : "rgba(255,255,255,0.6)";
      const col = l.ours ? good : l.kind === "HR" || l.kind === "HIT" ? "#ff8a7a" : l.kind === "BB" ? "#ffb07a" : "rgba(255,255,255,0.6)";
      ctx.textAlign = "left";
      ctx.font = '700 11px "Nanum Gothic", sans-serif';
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText(`${l.inning}회${l.top ? "초" : "말"}`, fx + 14 + slide, y);
      ctx.fillStyle = l.ours ? "#ffcf4a" : "#7ad7ff";
      ctx.beginPath();
      ctx.arc(fx + 60 + slide, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `${l.me ? "900" : "800"} 14px "Nanum Gothic", sans-serif`;
      ctx.fillStyle = l.me ? "#ffcf4a" : "#fff";
      ctx.fillText(l.me ? `${l.name} ★` : l.name, fx + 72 + slide, y);
      ctx.font = '900 14px "Nanum Gothic", sans-serif';
      ctx.fillStyle = col;
      const tx = fx + 190 + slide;
      ctx.fillText(l.text, tx, y);
      if (l.runs > 0) {
        const tw = ctx.measureText(l.text).width;
        ctx.fillStyle = l.ours ? "#ffcf4a" : "#ff6a5a";
        ctx.fillText(`  ${l.runs}점`, tx + tw, y);
      }
      ctx.globalAlpha = 1;
    }
    if (!r.lines.length) {
      ctx.textAlign = "center";
      ctx.font = '900 18px "Nanum Gothic", sans-serif';
      ctx.fillStyle = "#fff";
      ctx.fillText("PLAY BALL!", cx0, fy + fh / 2 - 12);
      ctx.font = '700 13px "Nanum Gothic", sans-serif';
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText(`${team(0).name} vs ${team(1).name}`, cx0, fy + fh / 2 + 14);
    }
    // 아래 안내
    ctx.textAlign = "left";
    ctx.font = '700 12px "Nanum Gothic", sans-serif';
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText(r.lines.length ? `${r.shown} / ${r.lines.length} 타석 · 탭 · Space 로 건너뛰기` : "탭 · Space 로 시작", 22, DH - 20);
    ctx.restore();
  }

  /** 미션 결과 연출 — 도장(MISSION CLEAR! / 아쉽지만 안타! / MISSION FAILED) + 얼굴 + 실제로 바뀐 것 칩 */
  missionFx: { m: Mission; r: "ok" | "partial" | "fail"; t: number; label?: string } | null = null;
  private lastMission: Mission | null = null;
  private drawMissionFx(ctx: CanvasRenderingContext2D) {
    const f = this.missionFx;
    if (!f) return;
    const t = f.t;
    const a = Math.min(1, t / 0.1) * (1 - smooth(2.1, 2.5, t));
    const ok = f.r !== "fail";
    const col = f.r === "ok" ? "#ffd23f" : f.r === "partial" ? "#d8e2f0" : "#ff6b6b";
    const label = f.r === "ok" ? "MISSION CLEAR!" : f.r === "partial" ? (f.label ?? "아쉽지만 안타!") : "MISSION FAILED";
    const cy = 340;
    ctx.save();
    ctx.globalAlpha = a;
    // 판
    const W = 600, H = 150;
    const x = 512 - W / 2, y = cy - H / 2;
    ctx.fillStyle = "rgba(8,10,24,0.88)";
    ctx.strokeStyle = ok ? this.missionColor(f.m) : "#5a5f73";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, W, H, 16);
    ctx.fill();
    ctx.stroke();
    // 실패는 쿵 하고 흔들림
    const shake = f.r === "fail" && t > 0.16 && t < 0.4 ? Math.sin(t * 90) * 5 * (1 - (t - 0.16) / 0.24) : 0;
    this.missionPortrait(ctx, f.m, x + 16 + shake, y + 16, 96, f.r === "fail");
    // 도장: 크게 → 쾅 (기울어짐)
    const sk = t < 0.16 ? 2.4 - (t / 0.16) * 1.5 : t < 0.26 ? 0.9 + ((t - 0.16) / 0.1) * 0.1 : 1;
    ctx.save();
    ctx.translate(x + 128 + (W - 128) / 2 + shake, y + 44);
    ctx.rotate(-0.07);
    ctx.scale(sk, sk);
    ctx.font = `${f.r === "partial" ? 30 : 34}px "Black Han Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = 7;
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.strokeText(label, 0, 12);
    const g = ctx.createLinearGradient(0, -18, 0, 14);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, col);
    ctx.fillStyle = g;
    ctx.fillText(label, 0, 12);
    ctx.restore();
    // 미션 내용 (작게)
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.textAlign = "left";
    const maxW = W - 128 - 18;
    this.fitFont(ctx, `${f.m.who}: "${f.m.text}"`, maxW, 13, 10, '"Jua", "Nanum Gothic", sans-serif');
    ctx.fillText(`${f.m.who}: "${f.m.text}"`, x + 128, y + 82);
    // 바뀐 것 칩 (하나씩 튀어나옴)
    this.rewardChips(ctx, x + 128, y + 96, this.missionRewards(f.m, f.r), Math.min(1, Math.max(0, (t - 0.3) / 0.6)), false, maxW);
    ctx.restore();
  }

  // ───────────── HUD ─────────────
  private drawHud(ctx: CanvasRenderingContext2D) {
    const s = this.s;
    ctx.textAlign = "left";
    if (this.cfg.bond) {
      const B = this.cfg.bond;
      const ch = charById(B.char);
      const st = this.bondSt;
      this.panel(ctx, 12, 12, 270, 70);
      ctx.fillStyle = ch.color;
      ctx.font = '18px "Black Han Sans", sans-serif';
      ctx.fillText(B.title, 24, 38);
      ctx.fillStyle = "#fff";
      ctx.font = '700 15px "JetBrains Mono", monospace';
      ctx.fillText(`${st.pts} / ${B.need}점`, 24, 64);
      // 공 N칸 (마구는 테두리)
      const w = 30;
      this.panel(ctx, DW - 20 - B.pitches * w - 16, 12, B.pitches * w + 16, 46);
      for (let i = 0; i < B.pitches; i++) {
        const x = DW - 20 - B.pitches * w + i * w + 7;
        const m = st.marks[i];
        ctx.fillStyle = m === "hr" ? "#ffd23f" : m === "hit" ? "#7dff9a" : m === "out" ? "#ff4d6d" : "rgba(255,255,255,0.18)";
        ctx.beginPath();
        ctx.arc(x, 35, 9, 0, Math.PI * 2);
        ctx.fill();
        if (B.magic.includes(i)) {
          ctx.strokeStyle = ch.color;
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
        if (i === st.idx && !m) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, 35, 12.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (st.idx < B.pitches) {
        // 다음 공 예고 (슬더스 인텐트처럼)
        const it = this.bondIntent();
        this.panel(ctx, DW - 262, 64, 250, 44);
        const chips: ["fast" | "break" | "magic", string][] = [["fast", "직구"], ["break", "변화구"], ["magic", "마구"]];
        chips.forEach(([k, label], j) => {
          const x = DW - 252 + j * 78;
          const on = k === it;
          ctx.fillStyle = on ? (k === "magic" ? ch.color : "#ffd23f") : "rgba(255,255,255,0.1)";
          ctx.beginPath();
          ctx.roundRect(x, 72, 70, 28, 8);
          ctx.fill();
          ctx.fillStyle = on ? "#111" : "rgba(255,255,255,0.5)";
          ctx.font = '700 13px "Nanum Gothic", sans-serif';
          ctx.textAlign = "center";
          ctx.fillText(label, x + 35, 91);
        });
        ctx.textAlign = "left";
        if (it === "magic") {
          this.panel(ctx, DW - 262, 112, 250, 34);
          ctx.fillStyle = ch.color;
          ctx.font = '14px "Black Han Sans", sans-serif';
          ctx.fillText(`「${ch.ball.name}」`, DW - 250, 134);
        }
      }
      this.batterCard(ctx);
      return;
    }
    if (this.cfg.mode === "derby") {
      const d = this.derby;
      this.panel(ctx, 12, 12, 250, 70);
      ctx.fillStyle = "#ffcf4a";
      ctx.font = '18px "Black Han Sans", sans-serif';
      ctx.fillText("HOME RUN DERBY", 24, 38);
      ctx.fillStyle = "#fff";
      ctx.font = '700 15px "JetBrains Mono", monospace';
      ctx.fillText(`${d.dist}m · HR ${d.hr}`, 24, 64);
      // 아웃 10칸
      this.panel(ctx, DW - 262, 12, 250, 46);
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = i < d.outs ? "#ff4d6d" : "rgba(255,255,255,0.18)";
        ctx.beginPath();
        ctx.arc(DW - 244 + i * 23.5, 35, 8, 0, Math.PI * 2);
        ctx.fill();
      }
      this.batterCard(ctx);
      return;
    }
    this.scoreBoard(ctx);
    this.countBoard(ctx);
    // 타자 · 투수 카드는 타석 · 투구 화면에서만 (치고 난 뒤 수비 화면에선 가림)
    const fieldView = this.phase === "field" || (this.phase === "result" && this.frames.length > 0 && this.lastWasField());
    if (!fieldView && this.cardK > 0.001) {
      // 타자 · 투수 카드: 타석 시작에 옆에서 들어오고, 첫 와인드업 0.5초 전부터 옆으로 빠짐
      const k = 1 - Math.pow(1 - this.cardK, 3);
      const lefty = this.userBat && this.shownBatter.bats === "L";
      const slide = (left: boolean, draw: () => void) => {
        ctx.save();
        ctx.globalAlpha = k;
        ctx.translate((left ? -1 : 1) * (1 - k) * 330, 0);
        draw();
        ctx.restore();
      };
      slide(!lefty, () => this.batterCard(ctx));
      slide(lefty, () => this.pitcherCard(ctx));
    }
    if (this.userBat && BOOST_PHASES.includes(this.phase)) this.drawBoosts(ctx);
    // 미션 진행 중
    if (s.mission && this.phase !== "mission") {
      ctx.font = '700 13px "Nanum Gothic", sans-serif';
      const t = `미션 · ${s.mission.who}: ${s.mission.text}`;
      const w = ctx.measureText(t).width + 24;
      this.panel(ctx, 512 - w / 2, 56, w, 28);
      ctx.fillStyle = s.mission.char ? charById(s.mission.char).color : NPC_COLOR[s.mission.who] ?? "#ffcf4a";
      ctx.textAlign = "center";
      ctx.fillText(t, 512, 75);
      ctx.textAlign = "left";
    }
  }

  /**
   * 타석 화면 수비수 7명 (1루 · 2루 · 3루 · 유격 · 좌익 · 중견 · 우익). 투수 그림처럼 실제 원근보다 크게(FIELDER_BOOST) 해야 보임.
   * 와인드업 · 투구 중엔 준비 자세(무릎 굽힘), 그 밖엔 서 있음. 왼쪽 수비수는 좌우 뒤집어 다양하게
   */
  private drawFielders(ctx: CanvasRenderingContext2D) {
    // 늘 준비 자세로 가만히 (서 있다 공 던질 때 확 숙이던 것) · 자리는 실제처럼 조금씩 어긋나게 (좌우 대칭 줄맞춤 위화감)
    // 루상 주자(공격 팀)도 같이 — 리드 잡고 투수 쪽을 봄. 먼 쪽부터 그림
    type Fig = { x: number; z: number; src: string; ref: number; flip: boolean; h: number };
    const figs: Fig[] = [6, 7, 8, 3, 5, 2, 4].map((i) => ({ x: FIELDER_SPOT[i][0], z: FIELDER_SPOT[i][1], src: i >= 6 ? FIELDER.of : FIELDER.inf, ref: 528, flip: FIELDER_SPOT[i][0] < 0, h: FIELDER_H[i] }));
    this.s.bases.forEach((r, b) => {
      if (r === null) return;
      const [x, z] = RUNNER_SPOT[b];
      figs.push({ x, z, src: b === 0 ? RUNNER.lead : RUNNER.hands, ref: RUNNER.ref, flip: b === 0, h: 1 });
    });
    figs.sort((a, b) => b.z - a.z);
    for (const f of figs) {
      const g = proj(f.x, 0, f.z);
      const im = img(f.src);
      if (!im.complete || !im.naturalWidth) continue;
      // 서 있는 키(그림 px) = 1.75m 로 맞춤 · 사람마다 키 조금씩
      const k = (g.s * 1.75 * FIELDER_BOOST * f.h) / f.ref;
      const w = im.naturalWidth * k;
      const h = im.naturalHeight * k;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath();
      ctx.ellipse(g.x, g.y, w * 0.4, Math.max(1.5, w * 0.08), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(g.x, g.y);
      if (f.flip) ctx.scale(-1, 1);
      ctx.drawImage(im, -w / 2, -h, w, h);
      ctx.restore();
    }
  }

  private drawTimingBar(ctx: CanvasRenderingContext2D) {
    const t = this.timingT;
    const a = Math.min(1, t / 0.08) * (1 - smooth(1.5, 1.9, t));
    if (a <= 0) return;
    const cx = 512, y = 540, w = 240, h = 8;
    const R = 1.5;
    const xOf = (r: number) => cx + (clamp(r, -R, R) / R) * (w / 2);
    ctx.save();
    ctx.globalAlpha = a;
    // 판
    ctx.fillStyle = "rgba(6,10,24,0.72)";
    ctx.beginPath();
    ctx.roundRect(cx - w / 2 - 34, y - 9, w + 68, h + 18, 9);
    ctx.fill();
    // 구간: 바깥(헛스윙) · 빠름/늦음 · 좋음 · 딱
    const band = (r0: number, r1: number, col: string) => {
      ctx.fillStyle = col;
      ctx.fillRect(xOf(r0), y, xOf(r1) - xOf(r0), h);
    };
    band(-R, R, "rgba(255,90,90,0.55)");
    band(-1, 1, "rgba(255,160,80,0.75)");
    band(-0.45, 0.45, "rgba(110,230,140,0.85)");
    band(-0.15, 0.15, "#ffd23f");
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(xOf(-R), y, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = '800 10px "Nanum Gothic", sans-serif';
    ctx.textAlign = "right";
    ctx.fillText("빠름", cx - w / 2 - 5, y + 8);
    ctx.textAlign = "left";
    ctx.fillText("늦음", cx + w / 2 + 5, y + 8);
    // 판정선: 가운데서 미끄러져 그 자리에 박힘
    const k = 1 - Math.pow(1 - Math.min(1, t / 0.18), 3);
    const mx = cx + (xOf(this.timingR) - cx) * k;
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 4;
    ctx.fillRect(mx - 1.5, y - 6, 3, h + 12);
    ctx.beginPath();
    ctx.moveTo(mx - 6, y - 12);
    ctx.lineTo(mx + 6, y - 12);
    ctx.lineTo(mx, y - 5);
    ctx.closePath();
    ctx.fill();
    if (this.timingPerfect) {
      // PERFECT: 바 위에 노란 글자 — 톡 커졌다가 자리 잡음
      const pop = 1 + 0.35 * (1 - Math.min(1, t / 0.12));
      ctx.translate(cx, y - 26);
      ctx.scale(pop, pop);
      ctx.font = '900 26px "Nanum Gothic", sans-serif';
      ctx.textAlign = "center";
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      ctx.shadowBlur = 6;
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(40,20,0,0.9)";
      ctx.strokeText("PERFECT!", 0, 0);
      ctx.fillStyle = "#ffd23f";
      ctx.fillText("PERFECT!", 0, 0);
    }
    ctx.restore();
    ctx.textAlign = "left";
  }

  /** HUD 판 (목업: 짙은 남색 그라데이션 + 파란 테두리 · 윗변 밝은 줄) */
  private panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, edge = "rgba(90,150,255,0.55)") {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, "rgba(20,30,62,0.9)");
    g.addColorStop(1, "rgba(8,12,28,0.9)");
    ctx.fillStyle = g;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 2.5, y + 2.5, w - 5, h - 5, 8);
    ctx.stroke();
  }

  /** 작은 딱지 (포지션 · 우타 · P …) */
  private chip(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg = "#fff", h = 18) {
    ctx.font = '800 11px "Nanum Gothic", sans-serif';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 5);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    // 기준선을 늘 같게 (중계 화면처럼 middle 로 그리던 중이면 글씨가 아래로 처졌음)
    const tb = ctx.textBaseline;
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
    ctx.textBaseline = tb;
    ctx.textAlign = "left";
    return w;
  }

  /** 팀 로고 타일 (팀 색 · 첫 글자) */
  private teamTile(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: Team) {
    const g = ctx.createLinearGradient(x, y, x, y + s);
    g.addColorStop(0, t.color);
    g.addColorStop(1, t.dark ?? "#111");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x, y, s, s, 5);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `italic 900 ${Math.round(s * 0.62)}px "Black Han Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.strokeText(t.short[0], x + s / 2, y + s * 0.74);
    ctx.fillText(t.short[0], x + s / 2, y + s * 0.74);
    ctx.textAlign = "left";
  }

  /** 점수판 (왼쪽 위): 팀 타일 · 약칭 · 점수 | 회 · 초말 */
  private scoreBoard(ctx: CanvasRenderingContext2D) {
    const s = this.s;
    const x = 12, y = 12, w = 268, h = 82;
    this.panel(ctx, x, y, w, h);
    const teams: [Team, number][] = [
      [s.opts.away, s.score[0]],
      [s.opts.home, s.score[1]],
    ];
    teams.forEach(([t, sc], i) => {
      const ry = y + 10 + i * 34;
      const atBat = (i === 0) === s.top;
      if (atBat) {
        ctx.fillStyle = "rgba(255,207,74,0.1)";
        ctx.fillRect(x + 6, ry - 2, 186, 32);
      }
      this.teamTile(ctx, x + 10, ry, 28, t);
      ctx.fillStyle = "#fff";
      ctx.font = '800 18px "JetBrains Mono", monospace';
      ctx.fillText(t.short, x + 46, ry + 21);
      if ((i === 1) === s.opts.userHome) {
        ctx.fillStyle = "#ffcf4a";
        ctx.font = '800 10px "Nanum Gothic", sans-serif';
        ctx.fillText("나", x + 98, ry + 20);
      }
      ctx.fillStyle = "#fff";
      ctx.font = '28px "Black Han Sans", sans-serif';
      ctx.textAlign = "right";
      ctx.fillText(String(sc), x + 180, ry + 25);
      ctx.textAlign = "left";
    });
    // 세로 구분선 · 회차
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.moveTo(x + 196, y + 10);
    ctx.lineTo(x + 196, y + h - 10);
    ctx.stroke();
    // 회차: 한 줄 (1회초) — 위에 초 ▲ / 말 ▼
    const cx = x + 232;
    ctx.fillStyle = "#ffcf4a";
    ctx.beginPath();
    if (s.top) {
      ctx.moveTo(cx - 7, y + 28);
      ctx.lineTo(cx, y + 18);
      ctx.lineTo(cx + 7, y + 28);
    } else {
      ctx.moveTo(cx - 7, y + 18);
      ctx.lineTo(cx, y + 28);
      ctx.lineTo(cx + 7, y + 18);
    }
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    const inn = `${s.inning}회${s.top ? "초" : "말"}`;
    ctx.font = `${inn.length > 3 ? 19 : 22}px "Black Han Sans", sans-serif`;
    ctx.fillText(inn, cx, y + 58);
    ctx.textAlign = "left";
  }

  /** 볼카운트 · 주자 (오른쪽 위) */
  private countBoard(ctx: CanvasRenderingContext2D) {
    const s = this.s;
    const w = 226, h = 90;
    const x = DW - 12 - w, y = 12;
    this.panel(ctx, x, y, w, h);
    const rows: [string, number, number, string][] = [
      ["B", s.balls, 3, "#56e07a"],
      ["S", s.strikes, 2, "#ffcf3a"],
      ["O", s.outs, 2, "#ff4d5e"],
    ];
    rows.forEach(([l, n, max, col], i) => {
      const ry = y + 22 + i * 24;
      ctx.fillStyle = "#fff";
      ctx.font = '800 16px "JetBrains Mono", monospace';
      ctx.fillText(l, x + 14, ry + 6);
      for (let k = 0; k < max; k++) {
        const on = k < n;
        const dx = x + 46 + k * 24;
        if (on) {
          ctx.shadowColor = col;
          ctx.shadowBlur = 8;
        }
        ctx.fillStyle = on ? col : "rgba(255,255,255,0.14)";
        ctx.beginPath();
        ctx.arc(dx, ry, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.moveTo(x + 124, y + 10);
    ctx.lineTo(x + 124, y + h - 10);
    ctx.stroke();
    // 다이아몬드 (2루 위 · 3루 왼쪽 · 1루 오른쪽 · 홈 아래)
    const cx = x + 175, cy = y + 42, d = 21;
    const base = (bx: number, by: number, on: boolean, home = false) => {
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(Math.PI / 4);
      if (on) {
        ctx.shadowColor = "#ffcf3a";
        ctx.shadowBlur = 10;
      }
      ctx.fillStyle = home ? "rgba(255,255,255,0.35)" : on ? "#ffcf3a" : "rgba(255,255,255,0.16)";
      const r = home ? 6 : 9;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    };
    base(cx + d, cy, s.bases[0] !== null);
    base(cx, cy - d, s.bases[1] !== null);
    base(cx - d, cy, s.bases[2] !== null);
    base(cx, cy + d + 4, false, true);
  }

  /** 능력치 막대 (목업: 이름 · 그라데이션 막대 · 숫자) */
  private statBar(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, v: number, col: string, w = 96, shown?: string, bonus = 0, glow = 0) {
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = '800 11px "Nanum Gothic", sans-serif';
    ctx.fillText(label, x, y + 9);
    const bx = x + 30;
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath();
    ctx.roundRect(bx, y + 1, w, 9, 4);
    ctx.fill();
    const k = clamp(v / 1000, 0, 1);
    if (k > 0) {
      const g = ctx.createLinearGradient(bx, 0, bx + w, 0);
      g.addColorStop(0, col);
      g.addColorStop(1, "#ffffff");
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.roundRect(bx, y + 1, Math.max(6, w * k), 9, 4);
      ctx.fill();
    }
    // 특수능력으로 오른 몫: 막대 끝을 금색으로 (발동 연출 동안 반짝)
    if (bonus > 0 && glow > 0) {
      const kb = clamp(bonus / 1000, 0, k);
      ctx.save();
      ctx.globalAlpha = glow;
      ctx.fillStyle = "#ffd65a";
      ctx.shadowColor = "#ffcf3a";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.roundRect(bx + w * (k - kb), y + 1, Math.max(4, w * kb), 9, 3);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = bonus > 0 && glow > 0.5 ? "#ffe07a" : "#fff";
    ctx.font = '800 12px "JetBrains Mono", monospace';
    ctx.textAlign = "right";
    ctx.fillText(shown ?? String(v), bx + w + 34, y + 10);
    ctx.textAlign = "left";
    // 오른 만큼 (+95) — 막대 빈 칸에
    if (bonus && glow > 0 && k < 0.78) {
      ctx.save();
      ctx.globalAlpha = glow;
      ctx.font = '800 10px "JetBrains Mono", monospace';
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      const bt = `${bonus > 0 ? "+" : ""}${bonus}`;
      ctx.strokeText(bt, bx + w * k + 5, y + 9.5);
      ctx.fillStyle = bonus > 0 ? "#ffd65a" : "#ff7a7a";
      ctx.fillText(bt, bx + w * k + 5, y + 9.5);
      ctx.restore();
    }
  }

  /** 얼굴 칸: 캐릭터면 얼굴 그림 · 아니면 빈 프로필 */
  private portrait(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, face: string | null, edge: string) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.clip();
    ctx.fillStyle = "#1a2236";
    ctx.fillRect(x, y, w, h);
    const im = img(face ?? UI.profile);
    if (im.complete && im.naturalWidth) {
      const sc = Math.max(w / im.naturalWidth, h / im.naturalHeight);
      const iw = im.naturalWidth * sc, ih = im.naturalHeight * sc;
      ctx.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
    }
    ctx.restore();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.stroke();
  }

  /** 지금 상황에 켜진 경기 능력치 특수능력 — all: 타석 들어설 때 (늘 붙는 것 + 지금 맞는 상황), twoK: 2스트라이크 된 순간 */
  private showBoosts(when: "all" | "twoK") {
    const b = this.shownBatter;
    if (!b.boosts?.length || this.cfg.mode === "derby") return;
    const s = this.s;
    const risp = s.bases[1] !== null || s.bases[2] !== null;
    const late = s.inning >= 7;
    const items: { name: string; text: string }[] = [];
    const bonus = { hit: 0, power: 0, run: 0 };
    const parts: string[] = [];
    const add = (k: keyof typeof bonus, v: number | undefined, label: string) => {
      if (!v) return;
      bonus[k] += v;
      parts.push(`${label} ${v > 0 ? "+" : ""}${v}`);
    };
    for (const x of b.boosts) {
      parts.length = 0;
      if (when === "all") {
        add("hit", x.add?.hit, "타격");
        add("power", x.add?.power, "파워");
        add("run", x.add?.run, "주루");
        if (risp) {
          add("hit", x.sit?.rispHit, "득점권 타격");
          add("power", x.sit?.rispPow, "득점권 파워");
        }
        if (late && x.sit?.late) {
          bonus.hit += x.sit.late;
          bonus.power += x.sit.late;
          parts.push(`7회~ 타격 · 파워 +${x.sit.late}`);
        }
      }
      add("hit", x.sit?.twoK, "2스트라이크 타격");
      if (when === "all" && s.strikes < 2 && x.sit?.twoK) {
        // 아직 2스트라이크 아님 — 그때 따로 발동
        bonus.hit -= x.sit.twoK;
        parts.pop();
      }
      if (parts.length) items.push({ name: x.name, text: parts.join(" · ") });
    }
    if (!items.length) return;
    // 2스트라이크 발동은 이미 떠 있는 것에 이어 붙임
    if (when === "twoK" && this.boostFx) {
      this.boostFx.items.push(...items);
      this.boostFx.bonus.hit += bonus.hit;
      this.boostFx.t = Math.min(this.boostFx.t, 0.6);
      sfx.boost();
      return;
    }
    this.boostFx = { t: when === "all" ? -0.35 : 0, items, bonus, head: when === "all" ? "특수능력 발동!" : "끈질긴 승부 — 발동!" };
    if (when === "twoK") sfx.boost();
  }

  /** 특수능력 발동 연출 — 점수판 아래로 카드가 하나씩 미끄러져 들어옴 */
  private drawBoosts(ctx: CanvasRenderingContext2D) {
    const f = this.boostFx;
    if (!f || f.t < 0) return;
    const t = f.t;
    const out = smooth(BOOST_DUR - 0.45, BOOST_DUR, t);
    const shown = f.items.slice(0, 4);
    const x0 = 12, y0 = 104;
    ctx.save();
    ctx.globalAlpha = 1 - out;
    // 머리글: 번쩍
    const hp = Math.min(1, t / 0.16);
    const hs = 1 + (1 - hp) * 0.5;
    ctx.save();
    ctx.translate(x0 + 4, y0 + 12);
    ctx.scale(hs, hs);
    ctx.font = '17px "Black Han Sans", sans-serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(40,20,0,0.85)";
    ctx.strokeText(`▲ ${f.head}`, 0, 0);
    const hg = ctx.createLinearGradient(0, -14, 0, 2);
    hg.addColorStop(0, "#fff6c2");
    hg.addColorStop(1, "#ffb625");
    ctx.fillStyle = hg;
    ctx.fillText(`▲ ${f.head}`, 0, 0);
    ctx.restore();
    shown.forEach((it, i) => {
      const lt = t - 0.12 - i * 0.11;
      if (lt < 0) return;
      // 왼쪽 밖에서 쑥 (살짝 넘쳤다 돌아옴)
      const e = Math.min(1, lt / 0.26);
      const back = 1 + 2.2 * Math.pow(e - 1, 3) + 1.2 * Math.pow(e - 1, 2);
      const w = 252, h = 38;
      const x = x0 - (1 - back) * (w + 20);
      const y = y0 + 22 + i * (h + 6);
      const g = ctx.createLinearGradient(x, y, x + w, y);
      g.addColorStop(0, "rgba(120,62,0,0.94)");
      g.addColorStop(0.55, "rgba(46,30,10,0.9)");
      g.addColorStop(1, "rgba(20,24,46,0.82)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 8);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255,206,84,0.95)";
      ctx.stroke();
      // 빛 지나감
      const sw = lt - 0.18;
      if (sw > 0 && sw < 0.45) {
        const sx = x - 60 + (sw / 0.45) * (w + 120);
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 8);
        ctx.clip();
        const lg = ctx.createLinearGradient(sx - 40, 0, sx + 40, 0);
        lg.addColorStop(0, "rgba(255,255,255,0)");
        lg.addColorStop(0.5, "rgba(255,248,210,0.55)");
        lg.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = lg;
        ctx.fillRect(sx - 40, y, 80, h);
        ctx.restore();
      }
      // 위 화살표 동그라미
      ctx.fillStyle = "#ffcf3a";
      ctx.beginPath();
      ctx.arc(x + 19, y + h / 2, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#5a2d00";
      ctx.beginPath();
      ctx.moveTo(x + 19, y + h / 2 - 7);
      ctx.lineTo(x + 26, y + h / 2 + 2);
      ctx.lineTo(x + 22, y + h / 2 + 2);
      ctx.lineTo(x + 22, y + h / 2 + 7);
      ctx.lineTo(x + 16, y + h / 2 + 7);
      ctx.lineTo(x + 16, y + h / 2 + 2);
      ctx.lineTo(x + 12, y + h / 2 + 2);
      ctx.closePath();
      ctx.fill();
      ctx.textAlign = "left";
      ctx.fillStyle = "#fff3cf";
      ctx.font = '15px "Black Han Sans", sans-serif';
      ctx.fillText(it.name, x + 38, y + 17);
      ctx.fillStyle = "#8ff0a4";
      ctx.font = '800 11px "Nanum Gothic", sans-serif';
      ctx.fillText(it.text, x + 38, y + 31);
    });
    if (f.items.length > shown.length) {
      const lt = t - 0.12 - shown.length * 0.11;
      if (lt > 0) {
        ctx.fillStyle = "rgba(255,226,140,0.9)";
        ctx.font = '800 11px "Nanum Gothic", sans-serif';
        ctx.fillText(`외 ${f.items.length - shown.length}개`, x0 + 6, y0 + 22 + shown.length * 44 + 12);
      }
    }
    ctx.restore();
  }

  private batterCard(ctx: CanvasRenderingContext2D) {
    const b = this.shownBatter;
    const bs = this.s.sides[this.paBatter ? this.paSide : batSide(this.s)];
    const order = this.paBatter ? this.paOrder : bs.order;
    const ln = bs.bat[order];
    const w = 292, h = 132;
    // 타석 시점: 타자가 서 있는 쪽 (좌타는 오른쪽) · 투수 시점(내가 던질 때)은 왼쪽 아래가 투수 다리(레그킥) 자리라 점수판 밑으로
    const x = this.userBat && b.bats === "L" ? DW - 12 - w : 12;
    const y = this.userBat ? DH - 12 - h : 102;
    const hero = b.special ? charById(b.special) : null;
    const accent = hero ? hero.color : "#ff8a3d";
    this.panel(ctx, x, y, w, h, hero ? hero.color : "rgba(255,138,61,0.7)");
    // 타순 번호 딱지 · 얼굴
    this.portrait(ctx, x + 10, y + 12, 70, 82, hero ? faceUrl(hero.id) : null, accent);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(x + 6, y + 8, 24, 24, 6);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = '18px "Black Han Sans", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(String(order + 1), x + 18, y + 27);
    ctx.textAlign = "left";
    // 이름 · 포지션 · 타석
    const tx = x + 90;
    ctx.fillStyle = hero ? hero.color : "#fff";
    ctx.font = '19px "Black Han Sans", sans-serif';
    const nm = `${hero ? "마타자 " : ""}${b.name}`;
    ctx.fillText(nm, tx, y + 30);
    let cx = tx + ctx.measureText(nm).width + 8;
    cx += this.chip(ctx, cx, y + 15, b.pos, "#ff8a3d") + 4;
    this.chip(ctx, cx, y + 15, b.bats === "L" ? "좌타" : "우타", "rgba(255,255,255,0.14)");
    // 오늘 · 시즌
    ctx.font = '700 11.5px "Nanum Gothic", sans-serif';
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    if (this.cfg.mode !== "derby") ctx.fillText(`오늘 ${ln.ab}타수 ${ln.h}안타${ln.hr ? ` ${ln.hr}홈런` : ""}`, tx, y + 50);
    // 시즌 기록 + 이번 경기 (타율은 타수 · 안타를 합쳐 다시)
    const se0 = seasonOf(b);
    const today = this.cfg.mode !== "derby";
    const ab = (se0.ab ?? 0) + (today ? ln.ab : 0);
    const se = {
      avg: se0.ab !== undefined ? (ab ? ((se0.h ?? 0) + (today ? ln.h : 0)) / ab : 0) : se0.avg,
      hr: se0.hr + (today ? ln.hr : 0),
      rbi: se0.rbi + (today ? ln.rbi : 0),
    };
    ctx.fillStyle = "#ffd98a";
    ctx.font = '800 11.5px "JetBrains Mono", monospace';
    ctx.fillText(`시즌 ${se.avg.toFixed(3).replace(/^0/, "")} · ${se.hr}HR · ${se.rbi}타점`, tx, y + 67);
    // 능력치
    const bf = this.boostFx && this.boostFx.t >= 0 && b === this.shownBatter ? this.boostFx : null;
    const bon = bf?.bonus;
    const glow = bf ? 1 - smooth(BOOST_DUR - 0.45, BOOST_DUR, bf.t) : 0;
    // 육성 선수는 순수 능력치로 보여 줌 (보정은 판정에만 — 허브 능력치와 달라 보이던 것)
    const shown = b.base ?? b;
    this.statBar(ctx, tx, y + 76, "타격", shown.hit, "#5fe07f", 120, undefined, bon?.hit, glow);
    this.statBar(ctx, tx, y + 93, "파워", shown.power, "#ff5a5a", 120, undefined, bon?.power, glow);
    this.statBar(ctx, tx, y + 110, "주루", shown.run, "#4fb3ff", 120, undefined, bon?.run, glow);
    if (bf && glow > 0) {
      // 카드 테두리 금빛 맥박
      ctx.save();
      ctx.globalAlpha = glow * (0.55 + 0.45 * Math.sin(bf.t * 9));
      ctx.shadowColor = "#ffcf3a";
      ctx.shadowBlur = 18;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#ffd65a";
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 10);
      ctx.stroke();
      ctx.restore();
    }
    const learned = !hero && b.learned ? charById(b.learned) : null;
    if ((hero || learned) && this.cfg.mode !== "derby") {
      const left = this.s.sides[batSide(this.s)].swingLeft;
      ctx.fillStyle = (hero ?? learned)!.color;
      ctx.font = '700 11px "Nanum Gothic", sans-serif';
      ctx.fillText(`필살 ${"★".repeat(left)}${"☆".repeat(Math.max(0, 3 - left))}`, x + 12, y + 116);
    }
  }

  private pitcherCard(ctx: CanvasRenderingContext2D) {
    const p = this.pitcherNow;
    const fsd = this.s.sides[fieldSide(this.s)];
    const w = 292, h = 132;
    // 좌타자 타석이면 타자 카드가 오른쪽이라 투수 카드는 왼쪽
    const x = this.userBat && this.shownBatter.bats === "L" ? 12 : DW - 12 - w;
    const y = DH - 12 - h;
    const hero = p.special ? charById(p.special) : null;
    const accent = hero ? hero.color : "#3d8bff";
    this.panel(ctx, x, y, w, h, hero ? hero.color : "rgba(61,139,255,0.75)");
    this.portrait(ctx, x + 10, y + 12, 70, 82, hero ? faceUrl(hero.id) : null, accent);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(x + 6, y + 8, 24, 24, 6);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = '18px "Black Han Sans", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("P", x + 18, y + 27);
    ctx.textAlign = "left";
    const tx = x + 90;
    ctx.fillStyle = hero ? hero.color : "#fff";
    ctx.font = '19px "Black Han Sans", sans-serif';
    const nm = `${hero ? "마투수 " : ""}${p.name}`;
    ctx.fillText(nm, tx, y + 30);
    this.chip(ctx, tx + ctx.measureText(nm).width + 8, y + 15, p.throws === "L" ? "좌투" : "우투", "#3d8bff");
    const ln = fsd.pit[fsd.pitcher];
    ctx.font = '700 11.5px "Nanum Gothic", sans-serif';
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(`투구 수 ${ln.pitches} · ${ln.k}K`, tx, y + 50);
    if (hero) {
      ctx.fillStyle = hero.color;
      ctx.font = '700 11px "Nanum Gothic", sans-serif';
      ctx.fillText(`마구 ${"★".repeat(fsd.ballLeft)}${"☆".repeat(Math.max(0, 3 - fsd.ballLeft))}`, tx, y + 67);
    }
    this.statBar(ctx, tx, y + 76, "제구", p.control, "#5fe07f", 120);
    this.statBar(ctx, tx, y + 93, "변화", p.brk, "#b98cff", 120);
    const st = stamina01(this.s);
    this.statBar(ctx, tx, y + 110, "체력", Math.round(st * 1000), st > 0.5 ? "#5fe07f" : st > 0.25 ? "#ffcf3a" : "#ff4d5e", 120, `${Math.round(st * 100)}%`);
    void staminaMax;
  }
}

const BALLR_PX = (s: number) => 0.055 * s;
/** 파란 원 반지름 = 플레이트에서 공 크기 × 이만큼 */
const BLUE_R = 1;
export { DW, DH };

/** 요약 화면 처음 상태 */
interface RecapBase {
  inning: number;
  top: boolean;
  outs: number;
  bases: [boolean, boolean, boolean];
  score: [number, number];
  line: [number[], number[]];
  hits: [number, number];
}
/** 타석 결과 → 타순표 칩 글자 */
function paShort(text: string, kind: PAKind): string {
  if (kind === "HR") return "홈런";
  if (/3루타/.test(text)) return "3루타";
  if (/2루타/.test(text)) return "2루타";
  if (kind === "HIT") return "안타";
  if (kind === "BB") return /사구|몸에/.test(text) ? "사구" : "볼넷";
  if (kind === "K") return "삼진";
  if (kind === "DP") return "병살";
  if (kind === "SAC" || /희생/.test(text)) return "희생";
  if (kind === "FC") return "야선";
  if (/땅볼/.test(text)) return "땅볼";
  if (/직선|라이너/.test(text)) return "직선";
  if (/뜬공|플라이/.test(text)) return "뜬공";
  return "아웃";
}
const PA_SHORT_COL: Record<string, string> = {
  홈런: "#ffd23f", "3루타": "#7dff9a", "2루타": "#7dff9a", 안타: "#7dff9a", 볼넷: "#7ad7ff", 사구: "#7ad7ff", 삼진: "#ff8a7a", 병살: "#ff8a7a",
};

