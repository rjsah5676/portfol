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
import { timingLabel, timingWindow } from "@/lib/baseball/contact";
import { BP_PITCHER, TEAM_DEFS, charById, cutinUrl, faceUrl, makeTeam, swingOf, type Batter, type CharId, type Pitcher } from "@/lib/baseball/data";
import { advanceToMyPA, botHook, mySide, newCareerGame, slotName, type CareerSetup, type MyPA } from "@/lib/baseball/careerGame";
import {
  BAT_BUNT, BAT_IDLE, BAT_LOAD, BAT_SWING, BATS, BATTER_RIG, HAIR, HELMETS, PIT_IDLE, PIT_THROW, PITCH_RELEASE_T, PITCHER_RIG,
  SKIN_TONES, SWING_HIT_T, baseSkin,
} from "@/lib/baseball/figures";
import {
  batSide, batter as curBatter, changePitcher, cpuManage, fieldSide, maybeMission, mvp, newGame, nextHalf, pitcher as curPitcher,
  stamina01, staminaMax, userBatting, type GameState, type PAResult,
} from "@/lib/baseball/game";
import { PITCHES, ZONE, inZone, makePitch, pitchAt, plateCross, type Pitch, type PitchKind } from "@/lib/baseball/pitch";
import { predictBall, type FieldEvent, type Frame } from "@/lib/baseball/play";
import { commit, evaluate, type Outcome, type SwingDecision } from "@/lib/baseball/resolve";
import { lookColors, lookSkin, uniColors } from "@/lib/baseball/look";
import { batterFrame, drawBatter, KICK_HOLD_T, KICK_STEP_T, preloadBatter, type SpriteLook } from "@/lib/baseball/batterSprite";
/** 빈 스윙 한 번 길이 (이 시간 지나면 다시 휘두를 수 있고, 하던 자세로 돌아감) */
const FREE_SWING_T = 0.5;
import { BATCOL } from "@/lib/baseball/look";
import { boneTip, drawRig, pose, type Anim, type RigColors, type Skin } from "@/lib/baseball/rig";
import { clamp, lerp, makeRng, smooth, type Rng } from "@/lib/baseball/rng";
import { sfx } from "./sfx";
import { CAM, DH, DW, battingBg, drawFieldFrame, fieldBg, fproj, proj } from "./view";

/** 투수 그림 (pitcher-set.webp): 발 기준점 · 크기 (키 ≈ 115px, 목업 크기) */
const PITCHER_STILL = { src: "/baseball/sprites/pitcher-set.webp", ax: 85, ay: 503, scale: 0.229 };

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
  /** 배속 — 투구 · 스윙 타이밍은 그대로, 결과 · 수비 · 공수 교대 같은 기다림만 빨라짐 */
  speed?: number;
  /**
   * 인연 대결 (mode "derby" 로 돌림): 그 캐릭터가 공 N개를 던지고 내 육성 선수가 침.
   * 안타 1점 · 홈런 2점, need 점이면 승리. magic = 마구를 던지는 공 순서 (0부터). 볼(안 친 것)은 다시 던짐.
   */
  bond?: { char: CharId; pitches: number; need: number; magic: readonly number[]; batter: Batter; title: string };
  seed?: number;
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
  timingColor = "#fff";
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
  timingMs = 0;
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
    let myTeam = makeTeam(mine, this.rng);
    const cpuTeam = makeTeam(cpuDef, this.rng);
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
  private playBat(a: Anim) {
    this.batFrom = { a: this.batAnim, t: this.batAnimT, k: 0 };
    this.batAnim = a;
    this.batAnimT = 0;
  }

  // ───────────── 타석 준비 ─────────────
  private beginPA() {
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
    this.updateSkins();
    const m = this.cfg.mode !== "derby" ? s.mission ?? maybeMission(s, this.rng) : null;
    if (m) {
      s.mission = m;
      sfx.mission();
      this.setPhase("mission");
    } else this.toPitch();
  }

  private updateSkins() {
    const b = this.batterNow;
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

  private goWindup() {
    this.setPhase("windup");
    this.pitAnim = PIT_THROW;
    this.pitAnimT = 0;
    if (this.userBat && this.swingStart < 0 && !this.buntArmed && !this.freeSwing) this.playBat(BAT_LOAD);
  }

  private release() {
    const p = this.pitcherNow;
    const kind = p.rep[this.kindIdx] ?? "FB";
    const special = this.userBat ? (this.cpuUseSp ? p.special : undefined) : this.useBallSp ? p.special : undefined;
    const st = this.cfg.mode === "derby" ? 1 : stamina01(this.s);
    this.pitch = makePitch(p, { kind, target: this.target, quality: this.quality, special }, this.speedScale, this.rng, st);
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
      this.decision = { swing: cs.swing, e: cs.e, bunt: false, special: useSwingSp ? swingOf(b) : undefined };
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
    const e = this.tf + SWING_HIT_T - p.dur;
    this.decision = { swing: true, e, bunt: this.buntArmed, special: this.spArmed ? swingOf(b) : undefined };
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
    this.timingMs = Math.round(e * 1000);
    this.timingColor = this.timingText === "PERFECT" ? "#ffd23f" : this.timingText === "GOOD" ? "#7dff9a" : "#ff9a7a";
    this.pushUi();
  }
  /** 지금 스윙이 빈 스윙(판정 없음)인지 — 끝나면 하던 자세(대기 · 레그킥)로 돌아감 */
  freeSwing = false;

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
    const s = proj(0, 0, 0).s;
    const x = (sx - CAM.cx) / s;
    const y = CAM.camH - (sy - CAM.Y0) / s;
    if (Math.abs(x) > 0.55 || y < 0.15 || y > 1.5) return false;
    this.target = { x: clamp(x, -0.5, 0.5), y: clamp(y, 0.2, 1.45) };
    return true;
  }
  moveAim(dx: number, dy: number) {
    if (this.userBat || this.phase !== "aim") return;
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
    const bp = proj(at.x, at.y, 0);
    const lefty = this.batterNow.bats === "L";
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
    const lefty = this.batterNow.bats === "L";
    // 구장 그림의 왼쪽 · 오른쪽 타석 가운데에 발이 오게
    return { x: lefty ? 684 : 340, y: 394, sc: 2.25, lefty };
  }

  private resolveFlight() {
    const p = this.pitch!;
    // 안 휘두름
    if (!this.outcome) this.outcome = evaluate(this.s, p, null, this.rng);
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
      this.setBanner(res.text, sub, col, 1.5, big || res.runs > 0);
      if (res.kind === "K") (this.userBat ? sfx.groan : () => sfx.cheer(0.7))();
      if (this.cfg.career && this.userBat) {
        const ln = this.s.sides[batSide(this.s)].bat[this.cfg.career.myIdx];
        this.myPAs.push({ inning: this.s.inning, text: res.text, kind: res.kind, rbi: ln.rbi - this.rbiBefore, mission: res.mission ? { ok: res.mission.ok, pt: 0 } : undefined });
      }
      if (res.mission) {
        if (res.mission.ok) this.missionsOk++;
        this.popup(DW / 2, 150, res.mission.text, res.mission.ok ? "#ffd23f" : "#ff9a7a");
        (res.mission.ok ? sfx.missionOk : sfx.missionNg)();
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
    // 배속: 타이밍이 걸린 구간(준비 · 와인드업 · 공 · 컨택 · 조준 · 게이지)은 그대로
    const timed = this.phase === "ready" || this.phase === "windup" || this.phase === "flight" || this.phase === "contact" || this.phase === "aim" || this.phase === "gauge";
    let dt = Math.min(dtRaw, 1 / 20) * (timed ? 1 : this.cfg.speed ?? 1);
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
          if (this.outcome.call === "bip") {
            const q = this.outcome.sw?.kind === "bip" ? this.outcome.sw.ball.c : 0.5;
            const perfect = this.outcome.sw?.kind === "bip" && this.outcome.sw.ball.perfect;
            sfx.crack(q, perfect);
            // 등급별 손맛: PERFECT 히트스톱 110ms + 플래시 · 정타 60ms · 빗맞음 25ms (멈춘 화면 = 임팩트 자세)
            this.hitStop = perfect ? 0.11 : q > 0.6 ? 0.06 : 0.025;
            this.impact = { x: 0, y: 0, t: 0, q, perfect };
            this.flash = perfect ? 0.55 : 0.12 + q * 0.3;
            this.shake = this.reduceMotion ? 0 : perfect ? 0.32 : 0.08 + q * 0.16;
            this.setPhase("contact");
            if (this.outcome.sw?.kind === "bip") {
              const pr = predictBall(this.outcome.sw.ball);
              this.hitPath = pr.pts.slice(0, 40).map((pp) => ({ x: pp.x, y: pp.y, h: pp.h }));
              const kmh = Math.round(this.outcome.sw.ball.ev * 3.6);
              this.batInfo = { text: `타구 ${kmh}km/h${pr.land > 30 ? ` · 비거리 ${Math.round(pr.land)}m` : ""}`, t: 0 };
              // 홈런은 슬로모션 + 줌
              if (pr.hr && !this.reduceMotion) {
                this.slowmo = perfect ? 0.45 : 0.25;
                this.zoomT = 0.6;
              }
            }
            const at = proj(this.outcome.at.x, this.outcome.at.y, 0);
            this.impact.x = at.x;
            this.impact.y = at.y;
            for (let i = 0; i < 18; i++) {
              const a = this.rng() * Math.PI * 2;
              const v = 120 + this.rng() * 260;
              this.particles.push({ x: at.x, y: at.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: 0.35 + this.rng() * 0.3, c: q > 0.85 ? "#ffd23f" : "#ffffff" });
            }
            break;
          }
          if (this.outcome.call === "foul") sfx.foul();
        }
        if (this.tf >= p.dur + 0.1) {
          if (!this.contactShown || this.outcome?.call !== "foul") {
            if (!this.outcome || this.outcome.call !== "foul") sfx.mitt(this.outcome?.call === "swingMiss" || this.outcome?.call === "strike");
          }
          this.resolveFlight();
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
  draw(ctx: CanvasRenderingContext2D, q: number) {
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
    // 투수판(높이 0.25m) 위 · 크기는 구장 그림 목업 기준 (키 ≈ 135px)
    const mp = proj(0, 0.25, 18.4);
    const pitcherScale = 0.9;
    const pps = pose(PITCHER_RIG, this.pitAnim, this.pitAnimT);
    const pFlip = this.pitcherNow.throws === "L";
    // 투수 그림 (지피티 세트 자세 1장, 발 = 투수판) — 없으면 코드 리그
    const pim = img(PITCHER_STILL.src);
    if (pim.complete && pim.naturalWidth) {
      ctx.save();
      ctx.imageSmoothingQuality = "high";
      ctx.translate(mp.x, mp.y);
      ctx.scale(pFlip ? -PITCHER_STILL.scale : PITCHER_STILL.scale, PITCHER_STILL.scale);
      ctx.drawImage(pim, -PITCHER_STILL.ax, -PITCHER_STILL.ay);
      ctx.restore();
    } else drawRig(ctx, PITCHER_RIG, pps, this.pitSkin, this.pitColors, mp.x, mp.y - 56 * pitcherScale, pitcherScale, pFlip);
    // 손 위치 (공 놓는 점)
    const relPs = pose(PITCHER_RIG, PIT_THROW, PITCH_RELEASE_T);
    const [hx, hy] = boneTip(PITCHER_RIG, relPs, "handT", 1);
    const hand = { x: mp.x + (pFlip ? -hx : hx) * pitcherScale, y: mp.y - 56 * pitcherScale + hy * pitcherScale };
    // 이반 기모으기 · 손에 든 공
    if (this.phase === "windup" || (p && this.tf < 0.02)) {
      // 아무것도
    }

    // 스트라이크 존
    const z0 = proj(-ZONE.x, ZONE.y1, 0);
    const z1 = proj(ZONE.x, ZONE.y0, 0);
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

    // 사용자 투수: 코스 표시
    if (!this.userBat && (this.phase === "aim" || this.phase === "gauge" || this.phase === "cutin" || this.phase === "windup")) {
      const t = proj(this.target.x, this.target.y, 0);
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

    // 이글아이 (초급 · 중급): 공이 들어올 자리
    if (p && this.userBat && this.phase === "flight" && !p.special) {
      const u = this.tf / p.dur;
      const show = this.cfg.diff === 0 ? 1 : this.cfg.diff === 1 ? smooth(0.45, 0.6, u) : 0;
      if (show > 0) {
        const at = plateCross(p);
        const c = proj(at.x, at.y, 0);
        ctx.globalAlpha = show * 0.85;
        ctx.strokeStyle = "#ffd23f";
        ctx.lineWidth = 2;
        const rr = 14 + Math.max(0, 1 - u) * 26;
        ctx.beginPath();
        ctx.arc(c.x, c.y, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(c.x, c.y, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // 공
    const ballBefore = p && this.phase === "flight";
    if (ballBefore && p) this.drawPitchBall(ctx, p, hand);
    if (this.phase === "windup" && this.pitAnimT > 0.2) {
      // 손에 든 공
      const ps = pose(PITCHER_RIG, this.pitAnim, this.pitAnimT);
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
        const pp = proj(hp.x, hp.h, Math.max(0.2, hp.y));
        ctx.globalAlpha = (i - (k - 8)) / 8;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, Math.max(2, 0.06 * pp.s), 0, Math.PI * 2);
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
    if (!drawBatter(ctx, batterFrame(this.batAnim, this.batAnimT), this.batLook, bx, by, sc, lefty, this.batAnim === BAT_SWING && !this.reduceMotion ? 1 : 0)) drawRig(ctx, BATTER_RIG, bps, this.batSkin, this.batColors, bx, by, sc, lefty);

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
    // 파티클
    for (const pt of this.particles) {
      ctx.globalAlpha = Math.min(1, pt.life * 3);
      ctx.fillStyle = pt.c;
      ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    // 투구 정보 · 타이밍
    if (this.pitchInfo && (this.phase === "flight" || this.phase === "call" || this.phase === "contact" || this.phase === "result")) {
      ctx.font = '700 15px "JetBrains Mono", monospace';
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      const w = ctx.measureText(this.pitchInfo).width + 16;
      ctx.fillRect(z1.x + 22, z0.y - 2, w, 24);
      ctx.fillStyle = "#fff";
      ctx.fillText(this.pitchInfo, z1.x + 30, z0.y + 15);
    }
    if (this.timingText && this.userBat && (this.phase === "flight" || this.phase === "contact" || this.phase === "call")) {
      ctx.font = '26px "Black Han Sans", sans-serif';
      ctx.textAlign = "center";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeText(this.timingText, 512, 296);
      ctx.fillStyle = this.timingColor;
      ctx.fillText(this.timingText, 512, 296);
      // 얼마나 빨랐나 늦었나 (ms)
      if (this.timingText !== "PERFECT") {
        const ms = `${this.timingMs > 0 ? "늦음 +" : "빠름 "}${this.timingMs}ms`;
        ctx.font = '700 14px "JetBrains Mono", monospace';
        ctx.lineWidth = 4;
        ctx.strokeText(ms, 512, 318);
        ctx.fillText(ms, 512, 318);
      }
    }
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

  private drawPitchBall(ctx: CanvasRenderingContext2D, p: Pitch, hand: { x: number; y: number }) {
    const t = this.tf;
    const v = pitchAt(p, t);
    const toScreen = (x: number, y: number, z: number, u: number) => {
      const s = proj(x, y, Math.max(z, -1.5));
      // 처음 12% 는 투수 손에서 이어지게
      const k = smooth(0, 0.12, u);
      return { x: lerp(hand.x, s.x, k), y: lerp(hand.y, s.y, k), s: s.s };
    };
    // 지나간 공 (헛스윙 · 볼) 은 미트까지만
    if (v.u > 1.25) return;
    const sp = p.special;
    // 그림자
    const g = proj(v.x, 0, Math.max(v.z, 0.2));
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, Math.max(3.5, 0.06 * g.s), Math.max(1.5, 0.022 * g.s), 0, 0, Math.PI * 2);
    ctx.fill();
    // 예측 링 (파워프로식): 일반 구종은 비행 40%, 마구는 70% 지점부터. 변화구는 「꺾이기 전」 자리를 가리켜 막판 변화가 느껴지게
    if (this.userBat && this.cfg.diff < 2 && !v.inHand && v.u < 1) {
      const show = sp ? 0.7 : 0.4;
      if (v.u >= show) {
        const breaking = p.kind !== "FB" && !sp;
        const px = p.target.x - (breaking ? p.brk.x * 0.55 : 0);
        const py = p.target.y - (breaking ? p.brk.y * 0.55 : 0);
        const r0 = proj(px, py, 0);
        const a = smooth(show, show + 0.12, v.u) * 0.55;
        ctx.strokeStyle = `rgba(255,255,255,${a})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(r0.x, r0.y, Math.max(9, BALLR_PX(r0.s) * 1.6), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // 꼬리 (마구는 마지막 25% 꼬리를 꺼서 늦은 변화를 숨김)
    for (let i = 6; i >= 1; i--) {
      if (sp && v.u > 0.75) break;
      const vt = pitchAt(p, Math.max(0, t - i * 0.016));
      if (vt.inHand) continue;
      const a = toScreen(vt.x, vt.y, vt.z, vt.u);
      ctx.globalAlpha = (0.35 * (7 - i)) / 7 * vt.vis;
      ctx.fillStyle = sp ? charById(sp).color : "#ffffff";
      ctx.beginPath();
      ctx.arc(a.x, a.y, Math.max(3.5, 0.05 * a.s) * (1 - i * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
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
    const r = Math.max(5.4, BALLR_PX(b.s));
    // 멀리 있을 땐 어두운 테두리 + 흰 빛무리 (밝은 배경 · 어두운 배경 어디서든 공이 떠 보이게)
    if (b.s < 160 && v.vis > 0.3) {
      ctx.fillStyle = `rgba(10,14,30,${0.42 * v.vis})`;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r * 1.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.35 * v.vis})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r * 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
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
        this.drawBall(ctx, b.x, b.y, r);
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

  private drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "rgba(10,10,20,0.95)";
    ctx.lineWidth = Math.max(1.8, r * 0.22);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (r > 5) {
      ctx.strokeStyle = "#e0413b";
      ctx.lineWidth = Math.max(1, r * 0.12);
      ctx.beginPath();
      ctx.arc(x - r * 1.1, y, r * 0.8, -0.8, 0.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + r * 1.1, y, r * 0.8, Math.PI - 0.8, Math.PI + 0.8);
      ctx.stroke();
    }
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

  private drawGauge(ctx: CanvasRenderingContext2D) {
    // 타자 반대쪽 (좌타자면 존 왼쪽)
    const x = this.batterNow.bats === "L" ? 352 : 640;
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
    ctx.strokeStyle = NPC_COLOR[m.who] ?? "#fff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, 520, 104, 14);
    ctx.fill();
    ctx.stroke();
    // 말하는 사람 (간단 얼굴)
    ctx.fillStyle = NPC_COLOR[m.who] ?? "#fff";
    ctx.beginPath();
    ctx.roundRect(x + 14, y + 14, 76, 76, 12);
    ctx.fill();
    ctx.fillStyle = "#1a1a24";
    ctx.font = '26px "Black Han Sans", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(m.who, x + 52, y + 61);
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffcf4a";
    ctx.font = '800 13px "Nanum Gothic", sans-serif';
    ctx.fillText(`돌발 미션!  성공하면 +${m.pt} 코인 · 마구/필살 +1`, x + 106, y + 32);
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
    // 점수판
    this.panel(ctx, 12, 12, 238, 76);
    const rows: [string, number, string][] = [
      [s.opts.away.short, s.score[0], s.opts.away.color],
      [s.opts.home.short, s.score[1], s.opts.home.color],
    ];
    rows.forEach(([n, sc, col], i) => {
      const y = 38 + i * 30;
      ctx.fillStyle = col;
      ctx.fillRect(22, y - 15, 6, 20);
      ctx.fillStyle = "#fff";
      ctx.font = '800 16px "JetBrains Mono", monospace';
      ctx.fillText(n, 36, y);
      const me = (i === 1) === s.opts.userHome;
      if (me) {
        ctx.fillStyle = "#ffcf4a";
        ctx.font = '700 10px "Nanum Gothic", sans-serif';
        ctx.fillText("나", 80, y - 1);
      }
      ctx.fillStyle = "#fff";
      ctx.font = '24px "Black Han Sans", sans-serif';
      ctx.textAlign = "right";
      ctx.fillText(String(sc), 150, y + 2);
      ctx.textAlign = "left";
      if ((i === 0) === s.top) {
        ctx.fillStyle = "#ffcf4a";
        ctx.beginPath();
        ctx.moveTo(158, y - 6);
        ctx.lineTo(166, y - 10);
        ctx.lineTo(166, y - 2);
        ctx.fill();
      }
    });
    ctx.fillStyle = "#fff";
    ctx.font = '20px "Black Han Sans", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(`${s.inning}회`, 208, 46);
    ctx.font = '700 13px "Nanum Gothic", sans-serif';
    ctx.fillText(s.top ? "초 ▲" : "말 ▼", 208, 68);
    ctx.textAlign = "left";

    // 볼카운트 · 주자
    this.panel(ctx, DW - 196, 12, 184, 92);
    const dots: [string, number, number, string][] = [
      ["B", s.balls, 3, "#7dff9a"],
      ["S", s.strikes, 2, "#ffd23f"],
      ["O", s.outs, 2, "#ff4d6d"],
    ];
    dots.forEach(([l, n, max, col], i) => {
      const y = 36 + i * 24;
      ctx.fillStyle = "#fff";
      ctx.font = '800 14px "JetBrains Mono", monospace';
      ctx.fillText(l, DW - 184, y + 5);
      for (let k = 0; k < max; k++) {
        ctx.fillStyle = k < n ? col : "rgba(255,255,255,0.16)";
        ctx.beginPath();
        ctx.arc(DW - 160 + k * 20, y, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 주자 다이아몬드
    const cx = DW - 52;
    const cy = 58;
    const base = (bx: number, by: number, on: boolean) => {
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = on ? "#ffd23f" : "rgba(255,255,255,0.18)";
      ctx.fillRect(-7, -7, 14, 14);
      ctx.restore();
    };
    base(cx + 18, cy, s.bases[0] !== null);
    base(cx, cy - 18, s.bases[1] !== null);
    base(cx - 18, cy, s.bases[2] !== null);

    this.batterCard(ctx);
    this.pitcherCard(ctx);
    // 미션 진행 중
    if (s.mission && this.phase !== "mission") {
      this.panel(ctx, 262, 12, 300, 30);
      ctx.fillStyle = NPC_COLOR[s.mission.who] ?? "#ffcf4a";
      ctx.font = '700 13px "Nanum Gothic", sans-serif';
      ctx.fillText(`미션 · ${s.mission.who}: ${s.mission.text}`, 272, 32);
    }
  }

  private panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    ctx.fillStyle = "rgba(10,12,22,0.78)";
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();
    ctx.stroke();
  }

  private statBar(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, v: number, col: string) {
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = '700 10px "Nanum Gothic", sans-serif';
    ctx.fillText(label, x, y + 8);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(x + 26, y + 1, 70, 7);
    ctx.fillStyle = col;
    ctx.fillRect(x + 26, y + 1, 70 * clamp(v / 1000, 0, 1), 7);
    ctx.fillStyle = "#fff";
    ctx.font = '700 10px "JetBrains Mono", monospace';
    ctx.fillText(String(v), x + 100, y + 8);
  }

  private batterCard(ctx: CanvasRenderingContext2D) {
    const b = this.batterNow;
    const bs = this.s.sides[batSide(this.s)];
    const ln = bs.bat[bs.order];
    const x = 12;
    const y = DH - 112;
    const hero = b.special ? charById(b.special) : null;
    this.panel(ctx, x, y, 236, 100);
    if (hero) {
      const im = img(faceUrl(hero.id));
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x + 8, y + 8, 60, 66, 8);
      ctx.clip();
      if (im.complete && im.naturalWidth) ctx.drawImage(im, x + 8, y + 8, 60, 66);
      ctx.restore();
      ctx.strokeStyle = hero.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x + 8, y + 8, 60, 66, 8);
      ctx.stroke();
    }
    const tx = hero ? x + 76 : x + 12;
    ctx.textAlign = "left";
    ctx.fillStyle = hero ? hero.color : "#fff";
    ctx.font = '17px "Black Han Sans", sans-serif';
    ctx.fillText(`${hero ? "마타자 " : ""}${b.name}`, tx, y + 26);
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = '700 11px "Nanum Gothic", sans-serif';
    const today = this.cfg.mode === "derby" ? "" : ` · 오늘 ${ln.ab}타수 ${ln.h}안타`;
    const learned = !hero && b.learned ? charById(b.learned) : null;
    ctx.fillText(`${bs.order + 1}번 ${b.bats === "L" ? "좌타" : "우타"}${today}`, tx, y + 42);
    this.statBar(ctx, tx, y + 50, "히트", b.hit, "#7dff9a");
    this.statBar(ctx, tx, y + 64, "파워", b.power, "#ff7a5c");
    this.statBar(ctx, tx, y + 78, "주루", b.run, "#7ad7ff");
    if ((hero || learned) && this.cfg.mode !== "derby") {
      const left = this.s.sides[batSide(this.s)].swingLeft;
      ctx.fillStyle = (hero ?? learned)!.color;
      ctx.font = '700 11px "Nanum Gothic", sans-serif';
      ctx.fillText(`필살 ${"★".repeat(left)}${"☆".repeat(Math.max(0, 3 - left))}`, x + 12, y + 92);
    }
  }

  private pitcherCard(ctx: CanvasRenderingContext2D) {
    const p = this.pitcherNow;
    const fsd = this.s.sides[fieldSide(this.s)];
    const x = DW - 248;
    const y = DH - 112;
    const hero = p.special ? charById(p.special) : null;
    this.panel(ctx, x, y, 236, 100);
    if (hero) {
      const im = img(faceUrl(hero.id));
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x + 168, y + 8, 60, 66, 8);
      ctx.clip();
      if (im.complete && im.naturalWidth) ctx.drawImage(im, x + 168, y + 8, 60, 66);
      ctx.restore();
      ctx.strokeStyle = hero.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x + 168, y + 8, 60, 66, 8);
      ctx.stroke();
    }
    ctx.textAlign = "left";
    ctx.fillStyle = hero ? hero.color : "#fff";
    ctx.font = '17px "Black Han Sans", sans-serif';
    ctx.fillText(`${hero ? "마투수 " : ""}${p.name}`, x + 12, y + 26);
    const ln = fsd.pit[fsd.pitcher];
    const st = stamina01(this.s);
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = '700 11px "Nanum Gothic", sans-serif';
    ctx.fillText(`${p.throws === "L" ? "좌투" : "우투"} · ${ln.pitches}구 · ${ln.k}K`, x + 12, y + 42);
    this.statBar(ctx, x + 12, y + 50, "제구", p.control, "#7dff9a");
    this.statBar(ctx, x + 12, y + 64, "변화", p.brk, "#c9b8ff");
    // 체력
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = '700 10px "Nanum Gothic", sans-serif';
    ctx.fillText("체력", x + 12, y + 86);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(x + 38, y + 79, 120, 8);
    ctx.fillStyle = st > 0.5 ? "#7dff9a" : st > 0.25 ? "#ffd23f" : "#ff4d6d";
    ctx.fillRect(x + 38, y + 79, 120 * st, 8);
    void staminaMax;
    if (hero) {
      ctx.fillStyle = hero.color;
      ctx.font = '700 11px "Nanum Gothic", sans-serif';
      ctx.fillText(`마구 ${"★".repeat(fsd.ballLeft)}${"☆".repeat(Math.max(0, 3 - fsd.ballLeft))}`, x + 168, y + 92);
    }
  }
}

const BALLR_PX = (s: number) => 0.055 * s;
export { DW, DH };
