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
import { CZ_RANGE, contactZone, timingLabel, timingWindow } from "@/lib/baseball/contact";
import { BP_PITCHER, TEAM_DEFS, charById, cutinUrl, faceUrl, makeTeam, seasonOf, swingOf, type Batter, type CharId, type Pitcher, type Team } from "@/lib/baseball/data";
import { advanceToMyPA, botHook, mySide, newCareerGame, quickPA, slotName, type CareerSetup, type MyPA } from "@/lib/baseball/careerGame";
import {
  BAT_BUNT, BAT_IDLE, BAT_LOAD, BAT_SWING, BATS, BATTER_RIG, HAIR, HELMETS, PIT_IDLE, PIT_RIG_RELEASE_T, PIT_THROW, PITCH_RELEASE_T, PITCHER_RIG,
  SKIN_TONES, SWING_HIT_T, baseSkin,
} from "@/lib/baseball/figures";
import {
  batSide, batter as curBatter, changePitcher, cpuManage, fieldSide, maybeMission, mvp, newGame, nextHalf, pitcher as curPitcher,
  stamina01, staminaMax, userBatting, type GameState, type PAResult,
} from "@/lib/baseball/game";
import { PITCHES, ZONE, inZone, makePitch, mistakeChance, pitchAt, plateCross, type Pitch, type PitchKind } from "@/lib/baseball/pitch";
import { predictBall, type FieldEvent, type Frame } from "@/lib/baseball/play";
import { veloKmh } from "@/lib/baseball/club";
import { batterShift, commit, effectiveHit, evaluate, hitByPitch, type Outcome, type SwingDecision } from "@/lib/baseball/resolve";
import { lookColors, lookSkin, uniColors } from "@/lib/baseball/look";
import { batterFrame, batterSheets, drawBatter, KICK_HOLD_T, KICK_STEP_T, preloadBatter, strideProg, type SpriteLook } from "@/lib/baseball/batterSprite";
/** 빈 스윙 한 번 길이 (이 시간 지나면 다시 휘두를 수 있고, 하던 자세로 돌아감) */
const FREE_SWING_T = 0.5;
import { BATCOL } from "@/lib/baseball/look";
import { boneTip, drawRig, pose, type Anim, type RigColors, type Skin } from "@/lib/baseball/rig";
import { clamp, lerp, makeRng, smooth, type Rng } from "@/lib/baseball/rng";
import pitcherThrowData from "@/data/baseball/pitcher-throw.json";
import { sfx } from "./sfx";
import { DH, DW, PITCHER_FEET, ballProj, battingBg, drawFieldFrame, fieldBg, fproj, proj, shadowProj, unprojPlate } from "./view";
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
const FIELDER_H = [1, 1, 1.03, 0.97, 1, 0.98, 1.02, 1, 0.99];
const FIELDER_BOOST = 1.8;
/** 특수능력 발동 연출 길이 · 시간이 흐르는 화면 */
const BOOST_DUR = 2.8;
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
const PITCHER_THROW = { src: "/baseball/sprites/pitcher-throw.webp", ...pitcherThrowData };
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
  | "call" | "field" | "result" | "change" | "over";

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
    im = new Image();
    im.src = url;
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
  /** 판정 글자가 뜬 뒤 시간 (튀어나오는 연출) */
  timingT = 0;
  /** 그림 이펙트 (맞는 순간 섬광 · 충격파 링) */
  fxs: { src: string; x: number; y: number; t: number; dur: number; size: number; grow: number; rot: number }[] = [];
  /** 타석에 들어설 때 (또 2스트라이크 · 득점권 · 7회 이후처럼 상황이 맞을 때) 경기 능력치 특수능력 발동 연출 */
  boostFx: { t: number; items: { name: string; text: string }[]; bonus: { hit: number; power: number; run: number }; head: string } | null = null;
  private lastStrikes = 0;
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
    void preloadBatter();
    this.ui = this.makeUi();
    this.setBanner(
      cfg.bond ? cfg.bond.title : cfg.mode === "derby" ? "HOME RUN DERBY" : "PLAY BALL!",
      cfg.bond ? `${charById(cfg.bond.char).name}의 공 ${cfg.bond.pitches}개 · ${cfg.bond.need}점이면 승리 (안타 1 · 홈런 2)` : cfg.mode === "derby" ? "아웃 10개까지 · 비거리 합" : cfg.career ? `${slotName(cfg.career.myIdx)} 타자로 출전 · 내 타석만 직접 쳐요` : `${this.s.opts.away.name} vs ${this.s.opts.home.name}`,
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
      canSwing: ub && this.swingStart < 0 && (this.phase === "ready" || this.phase === "windup" || this.phase === "flight" || this.phase === "call" || this.phase === "result"),
      canMove: ub && (this.phase === "ready" || this.phase === "windup"),
      bunt: this.buntArmed,
      spArmed: ub ? this.spArmed : this.useBallSp,
      spHero: hero && (this.cfg.mode !== "derby" || ub),
      spLeft: this.cfg.bond ? (ub ? us.swingLeft : 0) : this.cfg.mode === "derby" ? (ub ? 99 : 0) : ub ? us.swingLeft : us.ballLeft,
      spName: sp ? (ub ? sp.swing.name : sp.ball.name) : "",
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
    if (a === BAT_SWING) this.swingSp = this.batAnim === BAT_LOAD ? strideProg(this.batAnimT) : 0;
    this.batFrom = { a: this.batAnim, t: this.batAnimT, k: 0 };
    this.batAnim = a;
    this.batAnimT = 0;
  }

  // ───────────── 타석 준비 ─────────────
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
      // 내 타석까지 빠르게 진행 (남은 경기 자동이면 끝까지)
      const sc = [...s.score];
      const inn = s.inning;
      const autos = advanceToMyPA(s, this.cfg.career.myIdx, this.rng, this.cfg.highlight || allAuto ? botHook(this.cfg.diff) : undefined, this.myPAs.filter((p) => !p.auto).length, allAuto);
      this.myPAs.push(...autos);
      if (s.over) return this.finish();
      cpuManage(s, fieldSide(s));
      this.rbiBefore = s.sides[batSide(s)].bat[this.cfg.career.myIdx].rbi;
      if (this.paCount++ > 0) {
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
          this.setBanner("투수 교체", `${sd.team.pitchers[free].name} 등판 (체력 소진)`, "#7ad7ff", 1.3);
        }
      }
    } else if (this.cfg.mode === "game") {
      if (cpuManage(s, fieldSide(s))) {
        const p = curPitcher(s);
        this.setBanner("투수 교체", `${p.name}${p.special ? " — 마투수 등판!" : ""}`, p.special ? charById(p.special).color : "#7ad7ff", 1.4);
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
    this.boostFx = null;
    if (this.userBat) this.showBoosts("all");
    const m = this.cfg.mode !== "derby" ? s.mission ?? maybeMission(s, this.rng) : null;
    if (m) {
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
  private startWindup() {
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

  private showCutin(id: CharId, title: string, sub: string, side: "bat" | "pit") {
    this.cutin = { id, title, sub, t: 0, side };
    sfx.cutin();
    this.setPhase("cutin");
  }

  /** 이번 공 실투 (와인드업 전에 정함 — 「! 실투」를 먼저 보여 주고 0.5초 뒤에 던짐) */
  private mistakeNext = false;
  private goWindup() {
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
  pressSwing() {
    if (this.paused) return;
    if (this.phase === "mission") return this.skipMission();
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
    this.decision = { swing: true, e, bunt: this.buntArmed, special: this.spArmed ? swingOf(b) : undefined, cz: { ...this.cz } };
    this.swingStart = this.tf;
    this.freeSwing = false;
    this.outcome = evaluate(this.s, p, this.decision, this.rng);
    this.computeTilt();
    if (!this.buntArmed) {
      this.playBat(BAT_SWING);
      sfx.swing(0.8 + (b.power / 1000) * 0.4);
    }
    const W = timingWindow(b.hit, this.buntArmed, !!this.decision.special);
    this.timingText = timingLabel(e, W);
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

  /** 타자 · 컨택존 옮기기 입력 (BaseballApp: 방향키 · WASD · 화면 패드) */
  setBatMove(x: number, y: number) {
    const l = Math.hypot(x, y);
    this.czVel = l > 1 ? { x: x / l, y: y / l } : { x, y };
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
      const b = this.batterNow;
      const sw = swingOf(b);
      if (!sw || this.phase !== "ready") return;
      if (this.spArmed) return;
      const counted = this.cfg.mode !== "derby" || !!this.cfg.bond;
      if (counted && us.swingLeft <= 0) return;
      this.spArmed = true;
      if (counted) us.swingLeft--;
      const c = charById(sw);
      this.showCutin(c.id, c.swing.name, c.swing.desc, "bat");
      this.afterCutin = "ready";
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

  /** 화면 아무 데나 누름 */
  tap(sx: number, sy: number) {
    if (this.paused) return;
    if (this.phase === "mission") return this.skipMission();
    if (this.phase === "field") {
      this.fast = true;
      this.pushUi();
      return;
    }
    if (this.userBat) return this.pressSwing();
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
    if (this.phase === "mission" && this.pt > 0.35) this.toPitch();
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
    return { x: (lefty ? 702 : 322) + ox, y: 394 + oy, sc: 2.25, lefty };
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
    if (o.call === "bip" && o.field) {
      const f = o.field;
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
      } else sfx.cheer(0.5);
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
      text = o.call === "bip" ? "홈런 아님 — 아웃" : o.call === "foul" ? "파울 — 아웃" : "헛스윙 — 아웃";
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
      }
      if (res.mission) {
        if (res.mission.ok) this.missionsOk++;
        this.popup(DW / 2, 150, res.mission.text, res.mission.ok ? "#ffd23f" : res.mission.partial ? "#ffcf9a" : "#ff9a7a");
        (res.mission.ok || res.mission.partial ? sfx.missionOk : sfx.missionNg)();
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
    this.fxs = this.fxs.filter((f) => f.t < f.dur);
    // 특수능력 발동: 타석 화면에서만 시간이 흐름 (미션 안내 · 인트로 동안은 기다림)
    if (this.boostFx && BOOST_PHASES.includes(this.phase)) {
      if (this.boostFx.t < 0 && this.boostFx.t + dt >= 0) sfx.boost();
      if ((this.boostFx.t += dt) > BOOST_DUR) this.boostFx = null;
    }
    if (this.userBat && this.s.strikes >= 2 && this.lastStrikes < 2) this.showBoosts("twoK");
    this.lastStrikes = this.s.strikes;
    // 컨택존 · 타자 옮기기 (투구 전만, 초당 0.65m — 끝에서 끝까지 1초 남짓)
    if (this.userBat && (this.phase === "ready" || this.phase === "windup") && (this.czVel.x || this.czVel.y)) {
      this.cz = {
        x: clamp(this.cz.x + this.czVel.x * 0.65 * dt, -CZ_RANGE.x, CZ_RANGE.x),
        y: clamp(this.cz.y + this.czVel.y * 0.65 * dt, CZ_RANGE.y0, CZ_RANGE.y1),
      };
    }
    // 리그 애니
    this.batAnimT += dt;
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
        if (this.pt > 1.6) this.beginPA();
        break;
      case "mission":
        if (this.pt > 2.6) this.toPitch();
        break;
      case "ready":
        // 사용자 타자: 잠깐 숨 고르고 투구
        if (this.pt > (this.cfg.mode === "derby" ? 0.8 : 1.0)) this.startWindup();
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
                // 홈런은 슬로모션 + 줌
                if (pr.hr && !this.reduceMotion) {
                  this.slowmo = perfect ? 0.45 : 0.25;
                  this.zoomT = 0.6;
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
        if (this.pt > 0.8) this.toPitchNext();
        break;
      case "result":
        if (this.pt > (this.cfg.mode === "derby" ? 1.3 : 1.6)) this.afterResult();
        break;
      case "change":
        if (this.pt > 1.6) {
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
    // 필살타법은 휘둘렀을 때만 소모 (그냥 보낸 공이면 다음 공에 그대로)
    if (this.cfg.mode !== "derby" && swung) this.spArmed = false;
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
  private warmed = new Set<HTMLImageElement>();
  private warmUp(ctx: CanvasRenderingContext2D) {
    if (this.phase !== "intro" && this.phase !== "mission" && this.phase !== "ready" && this.phase !== "aim" && this.phase !== "change") return;
    const list = [
      ...batterSheets(),
      img(PITCHER_THROW.src),
      img(FIELDER.inf),
      img(FIELDER.of),
      img(UI.burst),
      img(UI.ring),
      img(UI.homerun),
      img(UI.profile),
    ];
    for (const im of list) {
      if (this.warmed.has(im) || !im.complete || !im.naturalWidth) continue;
      this.warmed.add(im);
      ctx.drawImage(im, 0, 0, 1, 1);
      return;
    }
  }

  draw(ctx: CanvasRenderingContext2D, q: number) {
    // 배경보다 먼저 1px 로 그려 가려짐
    this.warmUp(ctx);
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
    this.drawHud(ctx);
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.6})`;
      ctx.fillRect(0, 0, DW, DH);
    }
    if (this.cutin) this.drawCutin(ctx);
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
  }

  private lastWasField() {
    return this.outcome?.call === "bip" && !!this.outcome.field && !this.outcome.field.foul;
  }

  private drawBatting(ctx: CanvasRenderingContext2D, q: number) {
    ctx.drawImage(battingBg(q, this.night), 0, 0, DW, DH);
    const p = this.pitch;
    // 투수
    // 수비수 (내야 4 · 외야 3): 구장 그림 땅 위 실제 수비 위치 — 먼 쪽부터 그리고 투수는 그 앞
    this.drawFielders(ctx);
    // 투수판(높이 0.25m) 위 · 크기는 구장 그림 목업 기준 (키 ≈ 135px)
    const mp = PITCHER_FEET;
    const pitcherScale = 0.77;
    const pps = pose(PITCHER_RIG, this.pitAnim, this.pitAnim === PIT_THROW ? (this.pitAnimT * PIT_RIG_RELEASE_T) / PITCH_RELEASE_T : this.pitAnimT);
    const pFlip = this.pitcherNow.throws === "L";
    // 투수 그림 (지피티 세트 자세 1장, 발 = 투수판) — 없으면 코드 리그
    const pim = img(PITCHER_STILL.src);
    const tim = img(PITCHER_THROW.src);
    const throwSprite = tim.complete && tim.naturalWidth > 0;
    if (this.pitAnim === PIT_THROW && throwSprite) {
      const T = PITCHER_THROW;
      const c = (PIT_THROW_SEQ.find(([, e]) => this.pitAnimT < e) ?? PIT_THROW_SEQ[PIT_THROW_SEQ.length - 1])[0];
      const k = PIT_CANVAS_PX / T.cell;
      ctx.save();
      ctx.imageSmoothingQuality = "high";
      ctx.translate(mp.x, mp.y);
      ctx.scale(pFlip ? -k : k, k);
      ctx.drawImage(tim, c * T.CW, 0, T.CW, T.CH, -T.ax, -T.ay, T.CW, T.CH);
      ctx.restore();
    } else if (pim.complete && pim.naturalWidth) {
      ctx.save();
      ctx.imageSmoothingQuality = "high";
      ctx.translate(mp.x, mp.y);
      ctx.scale(pFlip ? -PITCHER_STILL.scale : PITCHER_STILL.scale, PITCHER_STILL.scale);
      ctx.drawImage(pim, -PITCHER_STILL.ax, -PITCHER_STILL.ay);
      ctx.restore();
    } else drawRig(ctx, PITCHER_RIG, pps, this.pitSkin, this.pitColors, mp.x, mp.y - 56 * pitcherScale, pitcherScale, pFlip);
    // 손 위치 (공 놓는 점)
    const relPs = pose(PITCHER_RIG, PIT_THROW, PIT_RIG_RELEASE_T);
    const [hx, hy] = boneTip(PITCHER_RIG, relPs, "handT", 1);
    const hand =
      throwSprite && PITCHER_THROW.hand
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
      const moving = !!(this.czVel.x || this.czVel.y) && (this.phase === "ready" || this.phase === "windup");
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

    // 이글아이 (초급 · 중급): 공이 들어올 자리 — 원 대신 작은 노란 점 + 십자 (공 둘레 원처럼 보이지 않게)
    if (p && this.userBat && this.phase === "flight" && !p.special) {
      const u = this.tf / p.dur;
      const show = this.cfg.diff === 0 ? 1 : this.cfg.diff === 1 ? smooth(0.45, 0.6, u) : 0;
      if (show > 0) {
        const at = plateCross(p);
        const c = ballProj(at.x, at.y, 0);
        ctx.globalAlpha = show * 0.8;
        ctx.fillStyle = "rgba(255,210,63,0.35)";
        ctx.beginPath();
        ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffd23f";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(c.x - 10, c.y);
        ctx.lineTo(c.x - 4, c.y);
        ctx.moveTo(c.x + 4, c.y);
        ctx.lineTo(c.x + 10, c.y);
        ctx.moveTo(c.x, c.y - 10);
        ctx.lineTo(c.x, c.y - 4);
        ctx.moveTo(c.x, c.y + 4);
        ctx.lineTo(c.x, c.y + 10);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // 공
    const ballBefore = p && this.phase === "flight";
    if (ballBefore && p) this.drawPitchBall(ctx, p, hand);
    if (this.phase === "windup" && this.pitAnimT > 0.2 && !img(PITCHER_THROW.src).naturalWidth) {
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
    {
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
    if (!drawBatter(ctx, batterFrame(this.batAnim, this.batAnimT, this.swingSp), this.batLook, bx, by, sc, lefty, this.batAnim === BAT_SWING && !this.reduceMotion ? 1 : 0)) drawRig(ctx, BATTER_RIG, bps, this.batSkin, this.batColors, bx, by, sc, lefty);

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
    // (예측 링은 뺌 — 공 둘레에 원이 생기는 건 실제 야구에 없음. 노리는 자리는 컨택존 · 초급 이글아이 점으로)
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
      if (kind === "SL" || kind === "CT") {
        ctx.fillStyle = "rgba(214,58,58,0.55)";
        ctx.beginPath();
        ctx.arc(x + r * 0.3, y - r * 0.25, r * 0.28, 0, Math.PI * 2);
        ctx.fill();
      } else if (kind === "CB") {
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

  private drawField(ctx: CanvasRenderingContext2D, q: number) {
    ctx.drawImage(fieldBg(q, this.night), 0, 0, DW, DH);
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
      // 골든 보드
      const gb = fproj(0, 128, 6);
      ctx.fillStyle = "#ffd23f";
      ctx.fillRect(gb.x - 22, gb.y - 10, 44, 16);
      ctx.fillStyle = "#3a2a00";
      ctx.font = '800 10px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      ctx.fillText("GOLD", gb.x, gb.y + 2);
    } else {
      drawFieldFrame(ctx, fr, { body: fsd.team.color, cap: fsd.team.dark }, { body: bsd.team.color, cap: bsd.team.dark }, this.trail, sp);
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

  private drawMission(ctx: CanvasRenderingContext2D) {
    const m = this.s.mission!;
    const a = smooth(0, 0.2, this.pt);
    ctx.globalAlpha = a;
    const x = 252;
    const y = 360;
    ctx.fillStyle = "rgba(10,12,22,0.92)";
    const mc = m.char ? charById(m.char).color : NPC_COLOR[m.who] ?? "#fff";
    ctx.strokeStyle = mc;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, 520, 104, 14);
    ctx.fill();
    ctx.stroke();
    // 말하는 사람 (인연 캐릭터면 얼굴 그림 · 아니면 간단 얼굴)
    const fim = m.char ? img(faceUrl(m.char)) : null;
    if (fim && fim.complete && fim.naturalWidth) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x + 14, y + 14, 76, 76, 12);
      ctx.clip();
      ctx.drawImage(fim, x + 14, y + 14, 76, 76 * (fim.naturalHeight / fim.naturalWidth));
      ctx.restore();
    } else {
      ctx.fillStyle = mc;
      ctx.beginPath();
      ctx.roundRect(x + 14, y + 14, 76, 76, 12);
      ctx.fill();
      ctx.fillStyle = "#1a1a24";
      ctx.font = '26px "Black Han Sans", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText(m.who, x + 52, y + 61);
      ctx.textAlign = "left";
    }
    ctx.fillStyle = m.char ? mc : "#ffcf4a";
    ctx.font = '800 13px "Nanum Gothic", sans-serif';
    ctx.fillText(m.char ? `${m.who}의 특별 미션!  성공 +${m.pt} 코인 · 호감 ↑ (실패하면 호감 ↓)` : `돌발 미션!  성공 +${m.pt} 코인 · 마구/필살 +1 (실패하면 감독 신뢰 ↓)`, x + 106, y + 32);
    ctx.fillStyle = "#fff";
    ctx.font = '22px "Jua", "Nanum Gothic", sans-serif';
    ctx.fillText(`"${m.text}"`, x + 106, y + 66);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = '12px "Nanum Gothic", sans-serif';
    ctx.fillText("누르면 바로 시작", x + 106, y + 90);
    ctx.globalAlpha = 1;
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
    if (!fieldView) {
      this.batterCard(ctx);
      this.pitcherCard(ctx);
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
    const order = [6, 7, 8, 3, 5, 2, 4].sort((a, b) => FIELDER_SPOT[a][1] - FIELDER_SPOT[b][1]).reverse();
    for (const i of order) {
      const [fx, fz] = FIELDER_SPOT[i];
      const g = proj(fx, 0, fz);
      const im = img(i >= 6 ? FIELDER.of : FIELDER.inf);
      if (!im.complete || !im.naturalWidth) continue;
      // 서 있는 그림 키(528px) = 1.75m 로 맞춤 · 사람마다 키 조금씩
      const k = (g.s * 1.75 * FIELDER_BOOST * FIELDER_H[i]) / 528;
      const w = im.naturalWidth * k;
      const h = im.naturalHeight * k;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath();
      ctx.ellipse(g.x, g.y, w * 0.4, Math.max(1.5, w * 0.08), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(g.x, g.y);
      if (fx < 0) ctx.scale(-1, 1);
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
    ctx.fillText(text, x + w / 2, y + h / 2 + 4);
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
    const se = seasonOf(b);
    ctx.fillStyle = "#ffd98a";
    ctx.font = '800 11.5px "JetBrains Mono", monospace';
    ctx.fillText(`시즌 ${se.avg.toFixed(3).replace(/^0/, "")} · ${se.hr}HR · ${se.rbi}타점`, tx, y + 67);
    // 능력치
    const bf = this.boostFx && this.boostFx.t >= 0 && b === this.shownBatter ? this.boostFx : null;
    const bon = bf?.bonus;
    const glow = bf ? 1 - smooth(BOOST_DUR - 0.45, BOOST_DUR, bf.t) : 0;
    this.statBar(ctx, tx, y + 76, "타격", b.hit, "#5fe07f", 120, undefined, bon?.hit, glow);
    this.statBar(ctx, tx, y + 93, "파워", b.power, "#ff5a5a", 120, undefined, bon?.power, glow);
    this.statBar(ctx, tx, y + 110, "주루", b.run, "#4fb3ff", 120, undefined, bon?.run, glow);
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
export { DW, DH };
