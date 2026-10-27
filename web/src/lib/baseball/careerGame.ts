/**
 * 육성(커리어) 경기 — 내 타석만 진짜 엔진(투구 · 스윙 · 수비 시뮬)으로, 나머지 타석은 확률로 빠르게.
 * 화면(직접 출전) · 자동 진행 · 밸런스 시뮬이 같이 씀.
 */
import { cpuGauge, cpuPlan, cpuSwing, cpuUseSpecial, humanSwing, SPEED_SCALE, type Diff } from "./ai";
import { TEAM_DEFS, makeTeam, swingOf, type Batter, type CharId, type Team } from "./data";
import {
  batSide, batter as curBatter, callPitch, cpuManage, fieldSide, maybeMission, newGame, nextHalf, pitchThrown, pitcher as curPitcher,
  stamina01, applyPlay, type BatLine, type GameState, type PAResult,
} from "./game";
import { makePitch, plateCross, type Pitch } from "./pitch";
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
}

/** 감독 신뢰 → 타순 (낮으면 하위 타순 · 높으면 중심 타선) */
export function slotOf(trust: number) {
  return trust < 25 ? 8 : trust < 50 ? 6 : trust < 75 ? 1 : 3;
}
export const slotName = (i: number) => `${i + 1}번`;

/** 시즌마다 같은 동료 · 매주 다른 상대 (시드로 고정) */
export function careerSetup(seed: number, season: number, week: number, me: Batter, trust: number, diff: Diff, spUses?: number): CareerSetup {
  const rTeam = makeRng((seed ^ (season * 0x9e37)) >>> 0);
  // 마선수 없음 — 캐릭터는 인연에서만
  const my = makeTeam(TEAM_DEFS[0], rTeam);
  const rOpp = makeRng((seed * 31 + season * 977 + week * 131) >>> 0);
  const def = TEAM_DEFS[1 + (week % 3)];
  const opp = makeTeam(def, rOpp);
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
  const slot = slotOf(trust);
  rest.splice(slot, 0, me);
  my.batters = rest;
  return { my, opp, myIdx: slot, userHome: rOpp() < 0.5, diff, innings: 9, spUses };
}

export function newCareerGame(st: CareerSetup): GameState {
  const s = newGame({
    innings: st.innings,
    diff: st.diff,
    userHome: st.userHome,
    away: st.userHome ? st.opp : st.my,
    home: st.userHome ? st.my : st.opp,
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
  const x = (b.hit - (p.control + p.brk) / 2) / 1000;
  const pw = b.power / 1000;
  const tired = 1 - stamina01(s);
  const pK = clamp(0.17 - x * 0.18 - tired * 0.04, 0.06, 0.32);
  const pBB = clamp(0.08 + tired * 0.04, 0.05, 0.14);
  const pHR = clamp(0.006 + pw * pw * 0.06, 0.004, 0.08);
  const p3B = 0.004 + (b.run / 1000) * 0.006;
  const p2B = 0.035 + pw * 0.025;
  const p1B = clamp(0.14 + x * 0.14 + (b.hit / 1000) * 0.03, 0.08, 0.26);
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

/** 내 타석 스윙 결정 (사람 · 봇 · 시뮬) */
export type SwingHook = (s: GameState, p: Pitch, at: { x: number; y: number }, b: Batter, rng: Rng) => SwingDecision | null;

/** 봇이 대신 치기 (자동 진행) — 그 난이도 봇 타자 실력 */
export const botHook =
  (diff: Diff): SwingHook =>
  (s, p, at, b, rng) => {
    const fbDur = 17 / (curPitcher(s).velo / 3.6) / SPEED_SCALE[diff];
    const c = cpuSwing(b, p, at, s.strikes, s.balls, diff, rng, fbDur);
    return { swing: c.swing, e: c.e, bunt: false, special: useSp(s, b, c.swing, rng) };
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
  mission?: { ok: boolean; pt: number };
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
export function advanceToMyPA(s: GameState, myIdx: number, rng: Rng, autoMine?: SwingHook, directSoFar = 0, allAuto = false): MyPA[] {
  const autoPAs: MyPA[] = [];
  let guard = 0;
  while (!s.over && guard++ < 600) {
    if (isMyPA(s, myIdx)) {
      if (!autoMine) break;
      cpuManage(s, fieldSide(s));
      if (!s.mission) {
        const m = maybeMission(s, rng);
        if (m) s.mission = m;
      }
      // 찬스가 한 번도 없었으면 7회부터 내 타석은 직접 (경기당 최소 한 타석)
      if (!allAuto && (isKeyPA(s) || (s.inning >= 7 && directSoFar === 0))) break;
      const before = s.sides[mySide(s)].bat[myIdx].rbi;
      const inning = s.inning;
      const pa = enginePA(s, rng, autoMine);
      autoPAs.push({ inning, text: pa.text, kind: pa.kind, rbi: s.sides[mySide(s)].bat[myIdx].rbi - before, auto: true });
      if (pa.halfOver && !s.over) nextHalf(s);
      continue;
    }
    cpuManage(s, fieldSide(s));
    const pa = quickPA(s, rng);
    if (pa.halfOver && !s.over) nextHalf(s);
  }
  return autoPAs;
}

/** 경기 한 판 통째로 (자동 · 시뮬) */
export function playCareerGame(st: CareerSetup, hook: SwingHook, rng: Rng, autoMine?: SwingHook): CareerGameOut {
  const s = newCareerGame(st);
  const pas: MyPA[] = [];
  let missionPt = 0;
  for (let guard = 0; guard < 60 && !s.over; guard++) {
    pas.push(...advanceToMyPA(s, st.myIdx, rng, autoMine, pas.filter((p) => !p.auto).length));
    if (s.over) break;
    cpuManage(s, fieldSide(s));
    const m = s.mission ?? maybeMission(s, rng);
    if (m) s.mission = m;
    const before = s.sides[mySide(s)].bat[st.myIdx].rbi;
    const inning = s.inning;
    const pa = enginePA(s, rng, hook);
    const rbi = s.sides[mySide(s)].bat[st.myIdx].rbi - before;
    if (pa.mission?.ok && m) missionPt += m.pt;
    pas.push({ inning, text: pa.text, kind: pa.kind, rbi, mission: pa.mission && m ? { ok: pa.mission.ok, pt: m.pt } : undefined });
    if (pa.halfOver && !s.over) nextHalf(s);
  }
  const ms = mySide(s);
  return { s, line: s.sides[ms].bat[st.myIdx], win: s.winner < 0 ? null : s.winner === ms, pas, missionPt };
}
