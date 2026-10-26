/**
 * 경기 진행 (화면 · 입력 · 연출). 규칙은 lib/baseball/game.ts, 공 하나 처리는 resolve.ts.
 *
 * 한 타석 흐름
 *   준비(돌발미션) → [사용자 투수] 구종 · 코스 → 게이지 → (마구면 컷인) → 와인드업 → 공 → 스윙/판정
 *                    [사용자 타자] (필살 · 번트 준비) → 와인드업 → 공 → 스윙 타이밍 → 판정
 *   → 인플레이면 필드 화면(수비 · 주루 재생) → 결과 문구 → 다음 타자 · 공수 교대 · 경기 끝
 * 홈런더비: 같은 타석 화면, 아웃 10개까지 비거리 합 (500m 마다 마투수 난입 · 골든 보드)
 */
import { cpuGauge, cpuPlan, cpuSwing, cpuUseSpecial, SPEED_SCALE, type Diff } from "@/lib/baseball/ai";
import { timingLabel, timingWindow } from "@/lib/baseball/contact";
import { BP_PITCHER, CHARS, TEAM_DEFS, charById, cutinUrl, faceUrl, makeTeam, swingOf, type CharId, type Pitcher } from "@/lib/baseball/data";
import { advanceToMyPA, mySide, newCareerGame, slotName, type CareerSetup, type MyPA } from "@/lib/baseball/careerGame";
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
import { boneTip, drawRig, pose, type Anim, type RigColors, type Skin } from "@/lib/baseball/rig";
import { clamp, lerp, makeRng, smooth, type Rng } from "@/lib/baseball/rng";
import { sfx } from "./sfx";
import { CAM, DH, DW, battingBg, drawFieldFrame, fieldBg, fproj, proj } from "./view";

export type Mode = "game" | "derby" | "career";

export interface MatchCfg {
  mode: Mode;
  diff: Diff;
  innings: number;
  userHome: boolean;
  /** 내 팀 마타자 · 마투수 */
  myBat: CharId;
  myPit: CharId;
  /** 홈런더비 타자 */
  derbyChar?: CharId;
  /** 육성 경기: 팀 · 내 타순 (내 타석만 직접, 나머지는 빠르게) */
  career?: CareerSetup;
  seed?: number;
}

export type Phase =
  | "intro" | "mission" | "ready" | "aim" | "gauge" | "cutin" | "windup" | "flight" | "contact"
  | "call" | "field" | "result" | "change" | "rewind" | "over";

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
  over: null | { win: boolean | null; score: [number, number]; mvp: string; pt: number; derby?: { dist: number; hr: number; best: number } };
  paused: boolean;
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
  target = { x: 0, y: 0.8 };
  gaugeT = 0;
  gaugeVal = 0;
  quality = 0.7;
  useBallSp = false;
  cpuUseSp = false;
  contactShown = false;
  rewindUsed = false;
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
  particles: { x: number; y: number; vx: number; vy: number; life: number; c: string }[] = [];
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
  /** 육성: 내 타석 수 · 돌발미션 성공 수 */
  paCount = 0;
  missionsOk = 0;
  myPAs: MyPA[] = [];
  private rbiBefore = 0;

  derby = { outs: 0, dist: 0, hr: 0, nextBoss: 500, boss: null as CharId | null, bossLeft: 0, longest: 0 };

  constructor(cfg: MatchCfg, onUi: (u: UiState) => void) {
    this.cfg = cfg;
    this.onUi = onUi;
    this.rng = makeRng(cfg.seed);
    this.night = this.rng() < 0.5;
    this.save = typeof window === "undefined" ? { pt: 0, derbyBest: 0, games: 0, wins: 0 } : loadSave();
    const mine = TEAM_DEFS[0];
    const others = TEAM_DEFS.slice(1);
    const cpuDef = this.rng.pick(others);
    const left = CHARS.filter((c) => c.id !== cfg.myBat && c.id !== cfg.myPit);
    const cpuBat = this.rng.pick(left).id;
    const cpuPit = this.rng.pick(left.filter((c) => c.id !== cpuBat)).id;
    let myTeam = makeTeam(mine, this.rng, { bat: cfg.myBat, pit: cfg.myPit });
    const cpuTeam = makeTeam(cpuDef, this.rng, { bat: cpuBat, pit: cpuPit });
    if (cfg.mode === "derby") {
      const ch = charById(cfg.derbyChar ?? cfg.myBat);
      myTeam = { ...myTeam, batters: myTeam.batters.map(() => ({ name: ch.name, num: 1, pos: "마", bats: ch.bats, ...ch.bat, special: ch.id })) };
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
    }
    this.batSkin = baseSkin();
    this.pitSkin = baseSkin();
    this.ui = this.makeUi();
    this.setBanner(
      cfg.mode === "derby" ? "HOME RUN DERBY" : "PLAY BALL!",
      cfg.mode === "derby" ? "아웃 10개까지 · 비거리 합" : cfg.career ? `${slotName(cfg.career.myIdx)} 타자로 출전 · 내 타석만 직접 쳐요` : `${this.s.opts.away.name} vs ${this.s.opts.home.name}`,
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
      canSwing: ub && (this.phase === "ready" || this.phase === "windup" || this.phase === "flight") && this.swingStart < 0,
      bunt: this.buntArmed,
      spArmed: ub ? this.spArmed : this.useBallSp,
      spHero: hero && (this.cfg.mode !== "derby" || ub),
      spLeft: this.cfg.mode === "derby" ? (ub ? 99 : 0) : ub ? us.swingLeft : us.ballLeft,
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
      // 내 타석까지 빠르게 진행
      const sc = [...s.score];
      const inn = s.inning;
      advanceToMyPA(s, this.cfg.career.myIdx, this.rng);
      if (s.over) return this.finish();
      cpuManage(s, fieldSide(s));
      this.rbiBefore = s.sides[batSide(s)].bat[this.cfg.career.myIdx].rbi;
      if (this.paCount++ > 0) {
        const me = mySide(s);
        const got = s.score[me] - sc[me];
        const lost = s.score[1 - me] - sc[1 - me];
        const runners = s.bases.filter((x) => x !== null).length;
        this.setBanner(
          `${s.inning}회${s.top ? "초" : "말"} · 내 타석`,
          `${inn !== s.inning || got || lost ? `그 사이 우리 +${got} · 상대 +${lost} · ` : ""}${s.outs}아웃${runners ? ` · 주자 ${runners}명` : ""}`,
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
    this.rewindUsed = false;
    this.timingText = "";
    this.pitchInfo = "";
    this.batAnim = BAT_IDLE;
    this.batAnimT = 0;
    this.batFrom = undefined;
    this.pitAnim = PIT_IDLE;
    this.updateSkins();
    const m = this.cfg.mode !== "derby" ? maybeMission(s, this.rng) : null;
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
    this.batSkin = { ...baseSkin(), helmet: bc ? HELMETS.hero : HELMETS.basic, bat: bc || lc ? BATS.hero : this.rng() < 0.3 ? BATS.metal : BATS.wood };
    this.pitSkin = baseSkin();
    this.batColors = colorsFor(bs.team, bs.order * 7 + 3, b.num, b.special ? bc!.name : b.name, (bc ?? lc)?.color);
    const pc = p.special ? charById(p.special) : null;
    this.pitColors = colorsFor(this.cfg.mode === "derby" ? TEAM_DEFS[1] : fsd.team, fsd.pitcher * 5 + 1, p.num, p.name, pc?.color);
    if (pc) this.pitColors.team = pc.color;
    // 투수 바지는 원정 회색 (흰 공이 흰 바지 위에서 안 보이던 문제)
    this.pitColors.pants = "#8e95a8";
  }
  batColors: RigColors = colorsFor(TEAM_DEFS[0], 0, 0, "");
  pitColors: RigColors = colorsFor(TEAM_DEFS[1], 0, 0, "");

  private toPitch() {
    if (this.userBat) this.setPhase("ready");
    else {
      this.target = { x: 0, y: 0.8 };
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
      if (this.cfg.mode === "derby") this.cpuUseSp = !!this.derby.boss;
      else this.cpuUseSp = !!p.special && cpuUseSpecial(fsd.ballLeft, this.s.inning, this.s.strikes, risp, this.rng);
      if (this.cpuUseSp && this.cfg.mode !== "derby") fsd.ballLeft--;
      if (this.cfg.mode === "derby" && !this.derby.boss) {
        // 배팅볼: 존 안 · 느긋하게
        this.target = { x: this.rng.gauss() * 0.1, y: 0.8 + this.rng.gauss() * 0.12 };
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
    if (this.userBat && this.swingStart < 0 && !this.buntArmed) this.playBat(BAT_LOAD);
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
    if (!this.userBat || this.swingStart >= 0) return;
    if (this.phase !== "flight" && this.phase !== "windup") return;
    const p = this.pitch;
    // 공이 나오기 전 스윙 = 헛스윙 (너무 빠름)
    const tf = this.phase === "windup" ? -(PITCH_RELEASE_T - this.pt) : this.tf;
    const dur = p?.dur ?? 0.6;
    const e = tf + SWING_HIT_T - dur;
    const b = this.batterNow;
    this.decision = { swing: true, e, bunt: this.buntArmed, special: this.spArmed ? swingOf(b) : undefined };
    this.swingStart = tf;
    if (this.phase === "windup") {
      // 아직 공 없음 → 헛스윙 처리는 공이 나온 뒤
      this.swingEarly = true;
    } else {
      this.outcome = evaluate(this.s, p!, this.decision, this.rng);
    }
    this.computeTilt();
    if (!this.buntArmed) {
      this.playBat(BAT_SWING);
      sfx.swing();
    }
    const W = timingWindow(b.hit, this.buntArmed, !!this.decision.special);
    this.timingText = timingLabel(e, W);
    this.timingColor = this.timingText === "PERFECT" ? "#ffd23f" : this.timingText === "GOOD" ? "#7dff9a" : "#ff9a7a";
    this.pushUi();
  }
  swingEarly = false;

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
      if (this.cfg.mode !== "derby" && us.swingLeft <= 0) return;
      this.spArmed = true;
      if (this.cfg.mode !== "derby") us.swingLeft--;
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
    const at = this.outcome?.at ?? (this.pitch ? plateCross(this.pitch) : { x: 0, y: 0.8 });
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
    return { x: lefty ? 706 : 318, y: 423, sc: 2.25, lefty };
  }

  private resolveFlight() {
    const p = this.pitch!;
    if (!this.outcome) {
      // 안 휘두름 (또는 공 나오기 전에 휘두름)
      if (this.swingEarly && this.decision) {
        this.outcome = { call: "swingMiss", at: plateCross(p), bad: true };
      } else {
        this.outcome = evaluate(this.s, p, null, this.rng);
      }
    }
    this.swingEarly = false;
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
      case "forte":
        sfx.tick();
        break;
      default:
        sfx.ui();
    }
  }

  /** 공이 지나간 뒤: 볼 · 스트라이크 · 파울 · 인플레이 */
  private afterPitch() {
    const o = this.outcome!;
    const fortRewind = this.userBat && this.decision?.special === "forte" && o.bad && !this.rewindUsed;
    if (fortRewind) {
      this.rewindUsed = true;
      this.setPhase("rewind");
      sfx.tick();
      this.setBanner("되감기!", "포르테의 시간 — 그 공을 한 번 더", charById("forte").color, 1.0);
      return;
    }
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

  private derbyResolve(o: Outcome) {
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
    if (!d.boss && d.dist >= d.nextBoss && d.outs < 10) {
      d.boss = this.rng.pick(CHARS).id;
      d.bossLeft = 2;
      d.nextBoss += 500;
      const c = charById(d.boss);
      text += ` · 마투수 ${c.name} 난입!`;
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
    const dt = Math.min(dtRaw, 1 / 20);
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
    // 리그 애니
    this.batAnimT += dt;
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
          sfx.swing();
        }
        if (p.special === "lily" && Math.abs(this.tf - (p.tl?.segs[0].t1 ?? 0)) < dt) sfx.pop();
        if (p.special === "zena" && Math.floor(this.tf * 9) !== Math.floor((this.tf - dt) * 9) && this.tf < p.dur * 0.85) sfx.zap();
        if (p.special === "forte" && Math.floor(this.tf * 8) !== Math.floor((this.tf - dt) * 8)) sfx.tick();
        // 맞는 순간
        const hitT = this.swingStart + SWING_HIT_T;
        if (this.outcome && !this.contactShown && this.swingStart > -10 && this.tf >= hitT && this.outcome.call !== "swingMiss") {
          this.contactShown = true;
          if (this.outcome.call === "bip") {
            const q = this.outcome.sw?.kind === "bip" ? this.outcome.sw.ball.c : 0.5;
            sfx.crack(q);
            this.flash = 0.25 + q * 0.4;
            this.shake = 0.12 + q * 0.2;
            this.setPhase("contact");
            if (this.outcome.sw?.kind === "bip") {
              const pr = predictBall(this.outcome.sw.ball);
              this.hitPath = pr.pts.slice(0, 40).map((pp) => ({ x: pp.x, y: pp.y, h: pp.h }));
            }
            const at = proj(this.outcome.at.x, this.outcome.at.y, 0);
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
            if (!this.outcome || this.outcome.call !== "foul") sfx.mitt();
          }
          this.resolveFlight();
          this.afterPitch();
        }
        break;
      }
      case "contact":
        if (this.pt > 0.42) this.afterPitch();
        break;
      case "rewind":
        if (this.pt > 0.95) {
          // 같은 공 다시
          this.outcome = null;
          this.decision = null;
          this.swingStart = -1;
          this.contactShown = false;
          this.spArmed = true;
          this.batAnim = BAT_IDLE;
          this.tf = 0;
          this.setPhase("flight");
        }
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
    const pitcherScale = 1.0;
    const mp = proj(0, 0, 18.4);
    const pps = pose(PITCHER_RIG, this.pitAnim, this.pitAnimT);
    const pFlip = this.pitcherNow.throws === "L";
    drawRig(ctx, PITCHER_RIG, pps, this.pitSkin, this.pitColors, mp.x, mp.y - 56 * pitcherScale, pitcherScale, pFlip);
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
    const ballBefore = p && (this.phase === "flight" || this.phase === "rewind");
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
    // 그림자
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(bx, by + 150, 110, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    drawRig(ctx, BATTER_RIG, bps, this.batSkin, this.batColors, bx, by, sc, lefty);

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
    }
    if (this.phase === "gauge" || (this.phase === "aim" && !this.userBat)) this.drawGauge(ctx);
    if (this.phase === "rewind") {
      ctx.fillStyle = `rgba(247,168,200,${0.25 + 0.15 * Math.sin(this.pt * 20)})`;
      ctx.fillRect(0, 0, DW, DH);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(512, 288, 70, -Math.PI / 2, -Math.PI / 2 - this.pt * Math.PI * 4, true);
      ctx.stroke();
    }
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
    // 꼬리
    for (let i = 6; i >= 1; i--) {
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
        this.drawFireBall(ctx, a.x, a.y, Math.max(6, 0.08 * a.s), false);
      }
      ctx.globalAlpha = 1;
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
      case "forte":
        this.drawBall(ctx, b.x, b.y, r);
        if (v.tag === "rewind" || v.tag === "tick") {
          ctx.strokeStyle = "#F7A8C8";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(b.x, b.y, r * 3, -Math.PI / 2, -Math.PI / 2 - (v.tagK ?? 0) * Math.PI * 2, true);
          ctx.stroke();
        }
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
      if (d.boss) {
        const c = charById(d.boss);
        this.panel(ctx, DW - 262, 64, 250, 40);
        ctx.fillStyle = c.color;
        ctx.font = '16px "Black Han Sans", sans-serif';
        ctx.fillText(`마투수 ${c.name} 난입! (${d.bossLeft}구)`, DW - 248, 90);
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
