/**
 * 육성(커리어) 경기 — 내 타석만 진짜 엔진(투구 · 스윙 · 수비 시뮬)으로, 나머지 타석은 확률로 빠르게.
 * 화면(직접 출전) · 자동 진행 · 밸런스 시뮬이 같이 씀.
 */
import { CAST, RIVALS } from "./story";
import { cpuGauge, cpuPlan, cpuSwing, cpuUseSpecial, humanSwing, SPEED_SCALE, type Diff } from "./ai";
import { TEAM_DEFS, makeTeam, playStat, swingOf, type Batter, type CharId, type Team } from "./data";
import {
  batSide, batter as curBatter, callPitch, cpuManage, fieldSide, maybeMission, newGame, nextHalf, pitchThrown, pitcher as curPitcher,
  stamina01, applyPlay, clutchOf, type BatLine, type Clutch, type GameState, type PAResult,
} from "./game";
import { makePitch, plateCross, ZONE, type Pitch } from "./pitch";
import { CZ_RANGE } from "./contact";
import type { FieldOut } from "./play";
import { commit, evaluate, type SwingDecision } from "./resolve";
import { clamp, makeRng, type Rng } from "./rng";

/** 내 선수를 넣은 우리 팀 + 상대 팀 */
export interface CareerSetup {
  my: Team;
  opp: Team;
  /** 우리 팀 타순에서 내 자리 (0 ~ 8) */
  myIdx: number;
  userHome: boolean;
  diff: Diff;
  innings: number;
  /** 경기당 내 필살타법 횟수 (배운 레벨) */
  spUses?: number;
  /** 인연 특별 미션을 줄 덱 캐릭터 */
  bondChars?: GameState["opts"]["bondChars"];
  /** 시즌 미션 (경기 화면 표시) — now = 이 경기 전까지 */
  missions?: { name: string; key: "h" | "xbh" | "hr" | "rbi" | "sb" | "df"; now: number; need: number; done?: boolean }[];
}

export const slotName = (i: number) => `${i + 1}번`;

/**
 * 우리 팀 동료 덤: edge = 늘 (가을야구 진출 · 우승이 너무 운이 아니게) · mood = 팀 분위기 1 마다
 * (팀 분위기는 내 경기 평가로 오르내림 — 내가 잘 치면 팀이 같이 살아남 · career.ts MOOD)
 */
export const TEAM_TUNE = { edge: 40, mood: 16, pit: 0.6 };

/**
 * 한 시즌 같은 동료 · 매주 다른 상대 (시드로 고정). key = 경기 열쇠(주 · 결승), slot = 내 타순(0 = 1번),
 * lv = 이번 주 투수 수준 (원래 팀 기본 560 — 내 선수가 크는 만큼 주마다 세짐)
 */
export function careerSetup(seed: number, key: number, me: Batter, slot: number, diff: Diff, lv: number, spUses?: number, bondChars?: CareerSetup["bondChars"], mood = 0): CareerSetup {
  const week = key;
  const rTeam = makeRng((seed ^ 0x9e37) >>> 0);
  // 마선수 없음 — 캐릭터는 인연에서만
  const my = makeTeam(TEAM_DEFS[0], rTeam);
  const rOpp = makeRng((seed * 31 + 977 + week * 131) >>> 0);
  const def = TEAM_DEFS[key >= 300 ? key - 300 : 1 + ((week - 1 + 3) % 3)];
  const opp = makeTeam(def, rOpp);
  // 우리 팀 투수도 똑같이 낮춰야 팀 승률이 반반 (상대만 낮추면 동료들이 다 쳐서 순위 1위가 너무 쉬움)
  for (const p of [...opp.pitchers, ...my.pitchers]) {
    const d = lv - 560;
    p.control = Math.max(150, p.control + d);
    p.brk = Math.max(150, p.brk + d);
    p.velo = Math.round(p.velo + (d / 260) * 6);
  }
  // 동료 덤 (기본 + 팀 분위기)
  const boost = TEAM_TUNE.edge + mood * TEAM_TUNE.mood;
  if (boost) {
    for (const b of my.batters) {
      b.hit = Math.max(1, Math.min(999, Math.round(b.hit + boost)));
      b.power = Math.max(1, Math.min(999, Math.round(b.power + boost)));
    }
    for (const p of my.pitchers) {
      p.control = Math.max(150, Math.round(p.control + boost * TEAM_TUNE.pit));
      p.brk = Math.max(150, Math.round(p.brk + boost * TEAM_TUNE.pit));
    }
  }
  // 내 수비 위치 선수를 빼고 내 자리에 넣기
  const rest = my.batters.filter((b) => b.special || b.pos !== me.pos);
  while (rest.length > 8) {
    // 같은 위치가 없으면 가장 약한 일반 선수
    let wi = -1;
    rest.forEach((b, i) => {
      if (!b.special && (wi < 0 || b.hit + b.power < rest[wi].hit + rest[wi].power)) wi = i;
    });
    rest.splice(wi, 1);
  }
  rest.splice(slot, 0, me);
  my.batters = rest;
  // 스토리 이름 (능력치는 그대로 — 이름만): 상대 에이스 · 우리 주장 · 주전 경쟁 선배(4 · 5주차는 손목 부상으로 벤치)
  const oi = TEAM_DEFS.indexOf(def);
  const rv = RIVALS[oi];
  if (rv) {
    if (oi === 1) {
      if (opp.batters[3] && !opp.batters[3].special) opp.batters[3].name = rv.ace;
    } else if (opp.pitchers[0]) opp.pitchers[0].name = rv.ace;
  }
  const named = (i: number, n: string) => {
    const b = my.batters[i];
    if (b && b !== me && !b.special) b.name = n;
  };
  named(slot === 2 ? 1 : 2, CAST.seo.name);
  if (key !== 4 && key !== 5) named(slot === 3 ? 4 : 3, CAST.kang.name);
  return { my, opp, myIdx: slot, userHome: rOpp() < 0.5, diff, innings: 9, spUses, bondChars };
}

export function newCareerGame(st: CareerSetup): GameState {
  const s = newGame({
    innings: st.innings,
    diff: st.diff,
    userHome: st.userHome,
    away: st.userHome ? st.opp : st.my,
    home: st.userHome ? st.my : st.opp,
    bondChars: st.bondChars,
  });
  if (st.spUses !== undefined) s.sides[st.userHome ? 1 : 0].swingLeft = st.spUses;
  return s;
}

export const mySide = (s: GameState) => (s.opts.userHome ? 1 : 0);
export const isMyPA = (s: GameState, myIdx: number) => batSide(s) === mySide(s) && s.sides[batSide(s)].order === myIdx;

/** 확률로 한 타석 (내 타석이 아닐 때) — 타자 · 투수 능력치를 대충 반영 */
export function quickPA(s: GameState, rng: Rng): PAResult {
  const b = curBatter(s);
  const p = curPitcher(s);
  for (let i = 0; i < 4; i++) pitchThrown(s);
  const bHit = playStat(b, b.hit);
  const x = (bHit - (p.control + p.brk) / 2) / 1000;
  const pw = playStat(b, b.power) / 1000;
  const tired = 1 - stamina01(s);
  const pK = clamp(0.17 - x * 0.18 - tired * 0.04, 0.06, 0.32);
  const pBB = clamp(0.08 + tired * 0.04, 0.05, 0.14);
  const pHR = clamp(0.006 + pw * pw * 0.06, 0.004, 0.08);
  const p3B = 0.004 + (playStat(b, b.run) / 1000) * 0.006;
  const p2B = 0.035 + pw * 0.025;
  const p1B = clamp(0.14 + x * 0.14 + (bHit / 1000) * 0.03, 0.08, 0.26);
  let r = rng();
  if ((r -= pK) < 0) {
    s.strikes = 2;
    return callPitch(s, "strike")!;
  }
  if ((r -= pBB) < 0) {
    s.balls = 3;
    return callPitch(s, "ball")!;
  }
  const bs = s.sides[batSide(s)];
  const me = bs.order;
  const base = s.bases;
  const scored: number[] = [];
  const nb: (number | null)[] = [null, null, null];
  let result: FieldOut["result"];
  let label: string;
  let outs = 0;
  const adv = (n: number, extraP = 0) => {
    // 주자 n 베이스 진루 (extraP 확률로 한 베이스 더)
    for (let k = 2; k >= 0; k--) {
      const id = base[k];
      if (id === null) continue;
      const to = k + n + (rng() < extraP ? 1 : 0);
      if (to >= 3) scored.push(id);
      else nb[to] = id;
    }
  };
  if ((r -= pHR) < 0) {
    adv(4);
    scored.push(me);
    result = "HR";
    label = "홈런!";
  } else if ((r -= p3B) < 0) {
    adv(3);
    nb[2] = me;
    result = "3B";
    label = "3루타";
  } else if ((r -= p2B) < 0) {
    adv(2, 0.45);
    nb[1] = me;
    result = "2B";
    label = "2루타";
  } else if ((r -= p1B) < 0) {
    adv(1, 0.5);
    nb[0] = me;
    result = "1B";
    label = "안타";
  } else {
    // 아웃: 병살 · 희생플라이 · 진루타 조금
    if (base[0] !== null && s.outs < 2 && rng() < 0.14) {
      outs = 2;
      result = "DP";
      label = "병살타";
      for (let k = 2; k >= 1; k--) if (base[k] !== null) nb[k] = base[k];
    } else if (base[2] !== null && s.outs < 2 && rng() < 0.3) {
      outs = 1;
      result = "SF";
      label = "희생플라이";
      scored.push(base[2]!);
      nb[0] = base[0];
      nb[1] = base[1];
    } else {
      outs = 1;
      result = "OUT";
      label = rng() < 0.5 ? "땅볼 아웃" : "뜬공 아웃";
      for (let k = 0; k < 3; k++) if (base[k] !== null) nb[k] = base[k];
      if (s.outs < 2 && rng() < 0.25) {
        // 진루타
        if (nb[2] === null && nb[1] !== null) [nb[2], nb[1]] = [nb[1], null];
      }
    }
  }
  const rbi = result === "DP" ? 0 : scored.length;
  const f: FieldOut = {
    foul: false, hr: result === "HR", dist: 0, frames: [], events: [], outs, runs: s.outs + outs >= 3 && result !== "HR" ? 0 : scored.length,
    scored: s.outs + outs >= 3 && result !== "HR" ? [] : scored, bases: nb, result, label, rbi: s.outs + outs >= 3 && result !== "HR" ? 0 : rbi, fielder: 0,
  };
  return applyPlay(s, f);
}

/* ─────────────── 주루 · 수비 찬스 (육성: 내 선수) ─────────────── */

/** 육성 선수 (수비 · 다이빙 덤까지) */
export type MeBatter = Batter & { def?: number; dive?: number };
/** 상대 타석마다 내 쪽으로 날카로운 타구가 올 확률 */
export const CHANCE = { field: 0.018, stealGo: 0.6 };
/** 도루 성공 확률 (주루 · 경기 능력치) */
export const stealP = (b: MeBatter) => clamp(0.38 + (b.run - 200) / 700, 0.22, 0.92);
/** 호수비 성공 확률 (자동 · 시뮬) — 직접이면 타이밍 창 크기 */
export const fieldP = (b: MeBatter) => clamp(0.32 + (b.def ?? 150) / 1500 + (b.dive ?? 0), 0.3, 0.9);
const meOf = (s: GameState, myIdx: number) => s.sides[mySide(s)].team.batters[myIdx] as MeBatter;
const meLine = (s: GameState) => (s.me ??= { sb: 0, cs: 0, df: 0, fc: 0 });
const POS_KO: Record<string, string> = { C: "포수", "1B": "1루수", "2B": "2루수", "3B": "3루수", SS: "유격수", LF: "좌익수", CF: "중견수", RF: "우익수" };

/** 지금 도루 찬스인가 — 내가 방금 쳐서 1루에 있고 2루가 비었고 2아웃 전 */
export function stealChance(s: GameState, myIdx: number) {
  if (s.over || batSide(s) !== mySide(s) || s.outs >= 2) return false;
  if (s.bases[0] !== myIdx || s.bases[1] !== null) return false;
  const pl = s.plays ?? [];
  const last = pl[pl.length - 1];
  if (!last || last.side !== mySide(s) || last.ord !== myIdx) return false;
  return s.stealAsk !== pl.length;
}
/** 도루 고르기 반영 — go = 뛴다 · ok = 성공 (뛸 때만). 돌려줌: 띄울 말 */
export function resolveSteal(s: GameState, myIdx: number, go: boolean, ok: boolean): string | null {
  s.chance = null;
  s.stealAsk = (s.plays ?? []).length;
  if (!go || s.bases[0] !== myIdx) return null;
  const ml = meLine(s);
  if (ok) {
    s.bases = [null, myIdx, s.bases[2]];
    ml.sb++;
    return "도루 성공!";
  }
  s.bases = [null, null, s.bases[2]];
  s.outs++;
  const fs = s.sides[fieldSide(s)];
  fs.pit[fs.pitcher].outs++;
  ml.cs++;
  return "도루 실패…";
}

/** 수비 찬스 결과 반영 (상대 타석 하나) — ok 면 호수비 아웃, 아니면 빠지는 안타 */
export function resolveField(s: GameState, myIdx: number, ok: boolean, rng: Rng): PAResult {
  const hit = s.chance?.hit ?? "1B";
  s.chance = null;
  const pos = POS_KO[meOf(s, myIdx).pos] ?? "";
  for (let i = 0; i < 4; i++) pitchThrown(s);
  const base = s.bases;
  const scored: number[] = [];
  const nb: (number | null)[] = [null, null, null];
  const bo = s.sides[batSide(s)].order;
  const ml = meLine(s);
  let f: FieldOut;
  if (ok) {
    ml.df++;
    for (let k = 0; k < 3; k++) nb[k] = base[k];
    f = { foul: false, hr: false, dist: 0, frames: [], events: [], outs: 1, runs: 0, scored: [], bases: nb, result: "OUT", label: `${pos} 호수비!`, rbi: 0, fielder: 0 };
  } else {
    const n = hit === "2B" ? 2 : 1;
    for (let k = 2; k >= 0; k--) {
      const id = base[k];
      if (id === null) continue;
      const to = k + n + (rng() < 0.5 ? 1 : 0);
      if (to >= 3) scored.push(id);
      else nb[to] = id;
    }
    nb[n - 1] = bo;
    f = { foul: false, hr: false, dist: 0, frames: [], events: [], outs: 0, runs: scored.length, scored, bases: nb, result: hit, label: `${pos} 옆을 빠지는 ${hit === "2B" ? "2루타" : "안타"}`, rbi: scored.length, fielder: 0 };
  }
  return applyPlay(s, f);
}

/** 찬스를 사람이 안 고를 때 (자동 · 시뮬) 바로 풀기 */
export function autoChance(s: GameState, myIdx: number, rng: Rng): PAResult | null {
  const ch = s.chance;
  if (!ch) return null;
  if (ch.kind === "steal") {
    const go = ch.p >= CHANCE.stealGo;
    resolveSteal(s, myIdx, go, go && rng() < ch.p);
    return null;
  }
  return resolveField(s, myIdx, rng() < ch.p, rng);
}

/** 지금 찬스가 생기나 보고 s.chance 를 세움 (상대 타석이면 수비 찬스 굴림) */
function rollChance(s: GameState, myIdx: number, rng: Rng): boolean {
  if (s.chance) return true;
  if (stealChance(s, myIdx)) {
    s.chance = { kind: "steal", p: stealP(meOf(s, myIdx)) };
    return true;
  }
  if (batSide(s) !== mySide(s) && rng() < CHANCE.field) {
    meLine(s).fc++;
    s.chance = { kind: "field", p: fieldP(meOf(s, myIdx)), hit: rng() < 0.75 ? "1B" : "2B" };
    return true;
  }
  return false;
}

/** 내 타석 스윙 결정 (사람 · 봇 · 시뮬) */
export type SwingHook = (s: GameState, p: Pitch, at: { x: number; y: number }, b: Batter, rng: Rng) => SwingDecision | null;

/**
 * 자동 타석의 컨택존: 공 쪽으로 lead 만큼만 옮기고 ± sd 흔들림 (거의 가운데에 둠).
 * 예전엔 자동이 컨택존을 아예 안 써서(늘 「대충 잘 노린」 판정) 존을 직접 옮겨 치는 사람보다 잘 쳤음 — 직접 치는 쪽이 이득이게.
 * 사람(보통)은 lead ≈ 0.4 (scratchpad · 시뮬 HCZ)
 */
export const AUTO_CZ = { lead: 0.15, sd: 0.07 };
export const leadCz = (at: { x: number; y: number }, lead: number, sd: number, rng: Rng) => ({
  x: clamp(at.x * lead + rng.gauss() * sd, -CZ_RANGE.x, CZ_RANGE.x),
  y: clamp(ZONE.mid + (at.y - ZONE.mid) * lead + rng.gauss() * sd, CZ_RANGE.y0, CZ_RANGE.y1),
});

/** 봇이 대신 치기 (자동 진행) — 그 난이도 봇 타자 실력 · 컨택존은 대충 (AUTO_CZ). sp = 필살타법도 쓸지 (하이라이트의 자동 타석은 안 씀 — 내 직접 타석용으로 남김) */
export const botHook =
  (diff: Diff, sp = true): SwingHook =>
  (s, p, at, b, rng) => {
    const fbDur = 17 / (curPitcher(s).velo / 3.6) / SPEED_SCALE[diff];
    const c = cpuSwing(b, p, at, s.strikes, s.balls, diff, rng, fbDur);
    return { swing: c.swing, e: c.e, bunt: false, special: sp ? useSp(s, b, c.swing, rng) : undefined, cz: leadCz(at, AUTO_CZ.lead, AUTO_CZ.sd, rng) };
  };

/** 사람 흉내 (밸런스 시뮬): 타이밍 표준편차 sigma 초 */
export const humanHook =
  (sigma: number): SwingHook =>
  (s, p, at, b, rng) => {
    const c = humanSwing(p, at, s.strikes, sigma, rng);
    return { swing: c.swing, e: c.e, bunt: false, special: useSp(s, b, c.swing, rng) };
  };

function useSp(s: GameState, b: Batter, swing: boolean, rng: Rng): CharId | undefined {
  const id = swingOf(b);
  const sd = s.sides[batSide(s)];
  if (!id || !swing || sd.swingLeft <= 0) return undefined;
  const risp = s.bases[1] !== null || s.bases[2] !== null;
  if (rng() < (risp ? 0.45 : 0.15)) {
    sd.swingLeft--;
    return id;
  }
  return undefined;
}

/** 진짜 엔진으로 한 타석 (공 하나씩) */
export function enginePA(s: GameState, rng: Rng, hook: SwingHook): PAResult {
  const diff = s.opts.diff;
  for (let guard = 0; guard < 40; guard++) {
    const fs = s.sides[fieldSide(s)];
    const p = curPitcher(s);
    const b = curBatter(s);
    const plan = cpuPlan(p, s.balls, s.strikes, b.bats, rng);
    const risp = s.bases[1] !== null || s.bases[2] !== null;
    const useSpB = !!p.special && cpuUseSpecial(fs.ballLeft, s.inning, s.strikes, risp, rng);
    if (useSpB) fs.ballLeft--;
    const target = useSpB ? { x: rng.gauss() * 0.1, y: 0.75 + rng.gauss() * 0.12 } : plan.target;
    const pitch = makePitch(p, { kind: plan.kind, target, quality: cpuGauge(diff, rng), special: useSpB ? p.special : undefined }, SPEED_SCALE[diff], rng, stamina01(s));
    const d = hook(s, pitch, plateCross(pitch), b, rng);
    const o = evaluate(s, pitch, d, rng);
    // 내 필살타법은 앞으로 보냈을 때만 소모 — 헛스윙 · 파울이면 돌려줌
    if (d?.special && o.sw?.kind !== "bip" && batSide(s) === (s.opts.userHome ? 1 : 0)) s.sides[batSide(s)].swingLeft++;
    const pa = commit(s, o);
    if (pa) return pa;
  }
  s.balls = 3;
  return callPitch(s, "ball")!;
}

export interface MyPA {
  inning: number;
  text: string;
  kind: PAResult["kind"];
  rbi: number;
  mission?: { ok: boolean; pt: number; partial?: boolean; char?: CharId };
  /** 하이라이트 모드에서 자동으로 친 타석 */
  auto?: boolean;
}

export interface CareerGameOut {
  s: GameState;
  line: BatLine;
  win: boolean | null;
  pas: MyPA[];
  /** 돌발미션으로 번 코인 */
  missionPt: number;
  clutch: Clutch;
  /** 도루 · 도루 실패 · 호수비 */
  sb: number;
  cs: number;
  df: number;
}

/** 하이라이트 타석: 득점권 · 7회부터 2점 차 이내 · 돌발미션 */
export function isKeyPA(s: GameState) {
  const risp = s.bases[1] !== null || s.bases[2] !== null;
  const close = s.inning >= 7 && Math.abs(s.score[0] - s.score[1]) <= 2;
  return risp || close || !!s.mission;
}

/**
 * 내 타석 전까지 빠르게 진행 (내 타석이 오면 멈춤) — 화면 직접 출전에서도 씀.
 * autoMine 을 주면 하이라이트 모드: 내 타석이라도 찬스가 아니면 그 훅으로 자동으로 치고 계속 (결과는 돌려줌)
 */
/** 건너뛴 타석 하나 (화면의 「경기 요약」 문자중계) */
export interface RecapLine {
  inning: number;
  top: boolean;
  /** 우리 팀 공격 */
  ours: boolean;
  /** 내 선수 (하이라이트 자동 타석) */
  me: boolean;
  name: string;
  text: string;
  kind: PAResult["kind"];
  runs: number;
  /** 공격 팀 (0 원정 · 1 홈) · 타순 번호 · 상대 투수 */
  side: number;
  ord: number;
  pit: string;
  /** 이 타석 뒤 아웃 · 주자 · 점수 · 이닝별 점수 · 안타 수 */
  outs: number;
  bases: [boolean, boolean, boolean];
  score: [number, number];
  line: [number[], number[]];
  hits: [number, number];
}

type RecapHead = Pick<RecapLine, "inning" | "top" | "ours" | "me" | "name" | "side" | "ord" | "pit">;
/** 지금 타석 머리 (문자중계 한 줄) */
export const recapHead = (s: GameState, me: boolean): RecapHead => ({
  inning: s.inning, top: s.top, ours: batSide(s) === mySide(s), me, name: curBatter(s).name,
  side: batSide(s), ord: s.sides[batSide(s)].order, pit: curPitcher(s).name,
});
export function recapOf(s: GameState, before: RecapHead, pa: PAResult): RecapLine {
  return {
    ...before, text: pa.text, kind: pa.kind, runs: pa.runs, outs: pa.halfOver ? 3 : s.outs,
    bases: [s.bases[0] !== null, s.bases[1] !== null, s.bases[2] !== null], score: [s.score[0], s.score[1]],
    line: [[...s.line[0]], [...s.line[1]]], hits: [s.sides[0].hits, s.sides[1].hits],
  };
}

export function advanceToMyPA(s: GameState, myIdx: number, rng: Rng, autoMine?: SwingHook, directSoFar = 0, allAuto = false, log?: RecapLine[], interactive = false): MyPA[] {
  const autoPAs: MyPA[] = [];
  let guard = 0;
  const head = (me: boolean) => recapHead(s, me);
  while (!s.over && guard++ < 600) {
    // 도루 · 수비 찬스: 화면이면 멈추고 (s.chance) 사람이 풂 · 아니면 바로
    if (rollChance(s, myIdx, rng)) {
      if (interactive) break;
      const h = head(false);
      const pa = autoChance(s, myIdx, rng);
      if (pa) {
        log?.push(recapOf(s, h, pa));
        if (pa.halfOver && !s.over) nextHalf(s);
      }
      continue;
    }
    if (isMyPA(s, myIdx)) {
      if (!autoMine) break;
      cpuManage(s, fieldSide(s));
      // 남은 경기 자동이면 미션 없음 (미션 보상은 직접 쳐야) · 하이라이트는 미션이 뜨면 그 타석을 직접으로
      if (allAuto) s.mission = null;
      else if (!s.mission) {
        const m = maybeMission(s, rng);
        if (m) s.mission = m;
      }
      // 찬스가 한 번도 없었으면 7회부터 내 타석은 직접 (경기당 최소 한 타석)
      if (!allAuto && (isKeyPA(s) || (s.inning >= 7 && directSoFar === 0))) break;
      const before = s.sides[mySide(s)].bat[myIdx].rbi;
      const inning = s.inning;
      const h = head(true);
      const pa = enginePA(s, rng, autoMine);
      log?.push(recapOf(s, h, pa));
      autoPAs.push({ inning, text: pa.text, kind: pa.kind, rbi: s.sides[mySide(s)].bat[myIdx].rbi - before, auto: true });
      if (pa.halfOver && !s.over) nextHalf(s);
      continue;
    }
    cpuManage(s, fieldSide(s));
    const h = head(false);
    const pa = quickPA(s, rng);
    log?.push(recapOf(s, h, pa));
    if (pa.halfOver && !s.over) nextHalf(s);
  }
  return autoPAs;
}

/** 경기 한 판 통째로 (자동 · 시뮬) */
/** missions = false: 자동 진행 — 돌발미션이 안 나옴 (보상 · 패널티 없음 · 미션은 직접 쳐야 받는 것) */
export function playCareerGame(st: CareerSetup, hook: SwingHook, rng: Rng, autoMine?: SwingHook, missions = true): CareerGameOut {
  const s = newCareerGame(st);
  const pas: MyPA[] = [];
  let missionPt = 0;
  for (let guard = 0; guard < 60 && !s.over; guard++) {
    pas.push(...advanceToMyPA(s, st.myIdx, rng, autoMine, pas.filter((p) => !p.auto).length));
    if (s.over) break;
    cpuManage(s, fieldSide(s));
    if (!missions) s.mission = null;
    const m = missions ? s.mission ?? maybeMission(s, rng) : null;
    if (m) s.mission = m;
    const before = s.sides[mySide(s)].bat[st.myIdx].rbi;
    const inning = s.inning;
    const pa = enginePA(s, rng, hook);
    const rbi = s.sides[mySide(s)].bat[st.myIdx].rbi - before;
    if (pa.mission?.ok && m) missionPt += m.pt;
    pas.push({ inning, text: pa.text, kind: pa.kind, rbi, mission: pa.mission && m ? { ok: pa.mission.ok, pt: m.pt, partial: pa.mission.partial, char: m.char } : undefined });
    if (pa.halfOver && !s.over) nextHalf(s);
  }
  const ms = mySide(s);
  const me = s.me ?? { sb: 0, cs: 0, df: 0, fc: 0 };
  return { s, line: s.sides[ms].bat[st.myIdx], win: s.winner < 0 ? null : s.winner === ms, pas, missionPt, clutch: clutchOf(s, ms, st.myIdx), sb: me.sb, cs: me.cs, df: me.df };
}
