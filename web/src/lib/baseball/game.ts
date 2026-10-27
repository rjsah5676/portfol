/**
 * 경기 규칙 · 상태 (볼카운트 · 아웃 · 주자 · 점수 · 이닝 · 기록 · 투수 체력 · 마구/필살 횟수 · 돌발미션).
 * 화면(BaseballApp)과 밸런스 시뮬(scripts)이 같이 씀 — 여기엔 그리기 · 시간이 없음.
 */
import { charById, type Batter, type CharId, type Pitcher, type Team } from "./data";
import type { FieldOut } from "./play";
import type { Rng } from "./rng";
import type { Diff } from "./ai";

export interface BatLine {
  pa: number;
  ab: number;
  h: number;
  d2: number;
  d3: number;
  hr: number;
  rbi: number;
  bb: number;
  k: number;
  r: number;
}
export interface PitLine {
  pitches: number;
  outs: number;
  h: number;
  r: number;
  bb: number;
  k: number;
  hr: number;
}

export interface Side {
  team: Team;
  /** 타순 (0 ~ 8) */
  order: number;
  pitcher: number;
  /** 지금 투수가 남은 공 수 */
  stamina: number;
  used: number[];
  ballLeft: number;
  swingLeft: number;
  bat: BatLine[];
  pit: PitLine[];
  hits: number;
  errors: number;
}

export type MissionKind = "hit" | "xbh" | "hr" | "rbi" | "k" | "zero";
export interface Mission {
  who: string;
  /** 인연 특별 미션 (육성 — 덱 캐릭터가 줌): 성공하면 호감 ↑ · 실패하면 호감 ↓ */
  char?: CharId;
  kind: MissionKind;
  text: string;
  /** 성공하면 마구 · 필살 +1 과 코인 */
  pt: number;
  /** 투수 미션(무실점)은 이닝 끝까지 */
  untilInningEnd: boolean;
  startScore: number;
}

export interface GameOpts {
  innings: number;
  diff: Diff;
  /** 사용자가 홈팀(말 공격)인가 */
  userHome: boolean;
  away: Team;
  home: Team;
  /** 육성: 인연 특별 미션을 줄 수 있는 덱 캐릭터 [id, 노리는 쪽("hit" 타격 · "power" 파워 · "run" 주루)] */
  bondChars?: [CharId, "hit" | "power" | "run"][];
}

export interface GameState {
  opts: GameOpts;
  sides: [Side, Side];
  inning: number;
  top: boolean;
  outs: number;
  balls: number;
  strikes: number;
  /** 1 · 2 · 3루 주자 (공격 팀 타순 번호) */
  bases: (number | null)[];
  score: [number, number];
  line: [number[], number[]];
  over: boolean;
  /** 0 원정 승 · 1 홈 승 · -1 무승부 */
  winner: number;
  mission: Mission | null;
  pt: number;
  /** 이번 타석 동안 유지할 표시 (돌발미션 결과 등) */
  notes: string[];
}

const emptyBat = (): BatLine => ({ pa: 0, ab: 0, h: 0, d2: 0, d3: 0, hr: 0, rbi: 0, bb: 0, k: 0, r: 0 });
const emptyPit = (): PitLine => ({ pitches: 0, outs: 0, h: 0, r: 0, bb: 0, k: 0, hr: 0 });

export const SPECIAL_PER_GAME = 3;
export const staminaMax = (p: Pitcher) => Math.max(20, Math.round(p.stamina / 7));

function mkSide(team: Team): Side {
  return {
    team,
    order: 0,
    pitcher: 0,
    stamina: staminaMax(team.pitchers[0]),
    used: [0],
    ballLeft: SPECIAL_PER_GAME,
    swingLeft: SPECIAL_PER_GAME,
    bat: team.batters.map(emptyBat),
    pit: team.pitchers.map(emptyPit),
    hits: 0,
    errors: 0,
  };
}

export function newGame(opts: GameOpts): GameState {
  return {
    opts,
    sides: [mkSide(opts.away), mkSide(opts.home)],
    inning: 1,
    top: true,
    outs: 0,
    balls: 0,
    strikes: 0,
    bases: [null, null, null],
    score: [0, 0],
    line: [[0], []],
    over: false,
    winner: -1,
    mission: null,
    pt: 0,
    notes: [],
  };
}

export const batSide = (s: GameState) => (s.top ? 0 : 1);
export const fieldSide = (s: GameState) => (s.top ? 1 : 0);
export const userBatting = (s: GameState) => (s.opts.userHome ? !s.top : s.top);
export const batter = (s: GameState): Batter => {
  const sd = s.sides[batSide(s)];
  return sd.team.batters[sd.order];
};
export const pitcher = (s: GameState): Pitcher => {
  const sd = s.sides[fieldSide(s)];
  return sd.team.pitchers[sd.pitcher];
};
export const stamina01 = (s: GameState) => {
  const sd = s.sides[fieldSide(s)];
  return sd.stamina / staminaMax(sd.team.pitchers[sd.pitcher]);
};
export const lastInning = (s: GameState) => s.inning >= s.opts.innings;

export type PAKind = "K" | "BB" | "HIT" | "HR" | "OUT" | "SAC" | "FC" | "DP";
export interface PAResult {
  kind: PAKind;
  text: string;
  runs: number;
  /** 이 타석으로 이닝 · 경기가 끝났나 */
  halfOver: boolean;
  gameOver: boolean;
  mission?: { ok: boolean; text: string; /** 빡센 미션(홈런 · 장타)에서 안타는 쳤음 — 코인 조금 · 실패 패널티 없음 */ partial?: boolean; char?: CharId };
}

export function pitchThrown(s: GameState) {
  const sd = s.sides[fieldSide(s)];
  sd.stamina = Math.max(0, sd.stamina - 1);
  sd.pit[sd.pitcher].pitches++;
}
/**
 * 체력 추가 소모 (공 1개 = 1): 맞고 · 내보내고 · 점수 주면 더 지침 (위기 투구 · 세트 포지션),
 * 게이지 MAX 로 힘껏 던지면 조금 더
 */
export const STAMINA_COST = { hit: 1.5, walk: 1.5, hr: 3, run: 1.5, max: 0.5 };
export function drainStamina(s: GameState, n: number) {
  const sd = s.sides[fieldSide(s)];
  sd.stamina = Math.max(0, sd.stamina - n);
}

/** 공 · 스트라이크 · 파울 (타석이 끝나면 결과) */
export function callPitch(s: GameState, call: "ball" | "strike" | "swingMiss" | "foul" | "hbp"): PAResult | null {
  if (call === "hbp") return walk(s, true);
  if (call === "ball") {
    s.balls++;
    if (s.balls >= 4) return walk(s);
    return null;
  }
  if (call === "foul") {
    if (s.strikes < 2) s.strikes++;
    return null;
  }
  s.strikes++;
  if (s.strikes >= 3) {
    const bs = s.sides[batSide(s)];
    const fs = s.sides[fieldSide(s)];
    bs.bat[bs.order].pa++;
    bs.bat[bs.order].ab++;
    bs.bat[bs.order].k++;
    fs.pit[fs.pitcher].k++;
    return endPA(s, { kind: "K", text: call === "swingMiss" ? "헛스윙 삼진!" : "루킹 삼진!", runs: 0 }, 1, 0, [], s.bases);
  }
  return null;
}

/** 볼넷 · 몸에 맞는 공 (기록은 볼넷 칸에 같이 셈) */
function walk(s: GameState, hbp = false): PAResult {
  const bs = s.sides[batSide(s)];
  const fs = s.sides[fieldSide(s)];
  bs.bat[bs.order].pa++;
  bs.bat[bs.order].bb++;
  fs.pit[fs.pitcher].bb++;
  drainStamina(s, STAMINA_COST.walk);
  const b = [...s.bases];
  const scored: number[] = [];
  if (b[0] !== null) {
    if (b[1] !== null) {
      if (b[2] !== null) scored.push(b[2]);
      b[2] = b[1];
    }
    b[1] = b[0];
  }
  b[0] = bs.order;
  bs.bat[bs.order].rbi += scored.length;
  const text = hbp ? (scored.length ? "밀어내기 사구" : "몸에 맞는 공!") : scored.length ? "밀어내기 볼넷" : "볼넷";
  return endPA(s, { kind: "BB", text, runs: scored.length }, 0, scored.length, scored, b);
}

/** 인플레이 결과 반영 */
export function applyPlay(s: GameState, f: FieldOut): PAResult {
  const bs = s.sides[batSide(s)];
  const fs = s.sides[fieldSide(s)];
  const ln = bs.bat[bs.order];
  ln.pa++;
  if (f.result !== "SF" && f.result !== "SH") ln.ab++;
  const hit = f.result === "1B" || f.result === "2B" || f.result === "3B" || f.result === "HR" || f.result === "IPHR";
  if (hit) {
    ln.h++;
    bs.hits++;
    fs.pit[fs.pitcher].h++;
  }
  if (f.result === "2B") ln.d2++;
  if (f.result === "3B") ln.d3++;
  if (f.result === "HR" || f.result === "IPHR") {
    ln.hr++;
    fs.pit[fs.pitcher].hr++;
  }
  if (hit) drainStamina(s, f.result === "HR" || f.result === "IPHR" ? STAMINA_COST.hr : STAMINA_COST.hit);
  ln.rbi += f.rbi;
  const kind: PAKind =
    f.result === "HR" || f.result === "IPHR" ? "HR" : hit ? "HIT" : f.result === "SF" || f.result === "SH" ? "SAC" : f.result === "FC" ? "FC" : f.result === "DP" ? "DP" : "OUT";
  return endPA(s, { kind, text: f.label, runs: f.runs }, f.outs, f.runs, f.scored, f.bases);
}

function endPA(s: GameState, r: Omit<PAResult, "halfOver" | "gameOver">, outs: number, runs: number, scored: number[], bases: (number | null)[]): PAResult {
  const bi = batSide(s);
  const bs = s.sides[bi];
  const fs = s.sides[fieldSide(s)];
  for (const id of scored) bs.bat[id].r++;
  fs.pit[fs.pitcher].r += runs;
  if (runs) drainStamina(s, runs * STAMINA_COST.run);
  fs.pit[fs.pitcher].outs += outs;
  s.outs += outs;
  s.score[bi] += runs;
  const li = s.inning - 1;
  s.line[bi][li] = (s.line[bi][li] ?? 0) + runs;
  s.bases = s.outs >= 3 ? [null, null, null] : [...bases];
  s.balls = 0;
  s.strikes = 0;
  bs.order = (bs.order + 1) % 9;
  const res: PAResult = { ...r, halfOver: false, gameOver: false };

  // 돌발미션 판정
  const m = s.mission;
  if (m) {
    let done: boolean | null = null;
    switch (m.kind) {
      case "hit":
        done = r.kind === "HIT" || r.kind === "HR";
        break;
      case "xbh":
        done = r.kind === "HR" || /2루타|3루타/.test(r.text);
        break;
      case "hr":
        done = r.kind === "HR";
        break;
      case "rbi":
        done = runs > 0 && r.kind !== "DP";
        break;
      case "k":
        done = r.kind === "K";
        break;
      case "zero":
        if (runs > 0) done = false;
        else if (s.outs >= 3) done = true;
        break;
    }
    if (done !== null) {
      s.mission = null;
      // 홈런 · 장타 미션은 빡세니까 안타라도 치면 살짝 보상 (코인 1/4 · 실패 패널티 없음)
      const partial = !done && (m.kind === "hr" || m.kind === "xbh") && (r.kind === "HIT" || r.kind === "HR");
      const partPt = Math.round(m.pt / 4);
      res.mission = { ok: done, partial, char: m.char, text: done ? `미션 성공! +${m.pt} 코인` : partial ? `아쉽지만 안타! +${partPt} 코인` : "미션 실패…" };
      if (partial) s.pt += partPt;
      if (done) {
        s.pt += m.pt;
        const us = s.sides[s.opts.userHome ? 1 : 0];
        us.ballLeft++;
        us.swingLeft++;
      }
    }
  }

  // 끝내기
  if (!s.top && lastInning(s) && s.score[1] > s.score[0]) {
    s.over = true;
    s.winner = 1;
    res.gameOver = true;
    res.halfOver = true;
    return res;
  }
  if (s.outs >= 3) {
    res.halfOver = true;
    if (s.top) {
      if (lastInning(s) && s.score[1] > s.score[0]) {
        s.over = true;
        s.winner = 1;
        res.gameOver = true;
      }
    } else if (lastInning(s) && s.score[0] !== s.score[1]) {
      s.over = true;
      s.winner = s.score[1] > s.score[0] ? 1 : 0;
      res.gameOver = true;
    } else if (s.inning >= s.opts.innings + 3) {
      s.over = true;
      s.winner = -1;
      res.gameOver = true;
    }
  }
  return res;
}

/** 다음 공격으로 */
export function nextHalf(s: GameState) {
  if (s.over) return;
  s.outs = 0;
  s.balls = 0;
  s.strikes = 0;
  s.bases = [null, null, null];
  if (s.top) {
    s.top = false;
    if (s.line[1].length < s.inning) s.line[1][s.inning - 1] = 0;
  } else {
    s.top = true;
    s.inning++;
    s.line[0][s.inning - 1] = 0;
  }
  // 이닝이 넘어가며 미션이 남아 있으면 (무실점 미션 등) 이미 판정됨
  s.mission = null;
}

/** 투수 교체 */
export function changePitcher(s: GameState, sideIdx: number, idx: number) {
  const sd = s.sides[sideIdx];
  if (idx === sd.pitcher) return;
  sd.pitcher = idx;
  sd.stamina = staminaMax(sd.team.pitchers[idx]);
  if (!sd.used.includes(idx)) sd.used.push(idx);
}

/** 봇 감독: 지쳤거나 많이 맞으면 교체 · 막판엔 마투수 */
export function cpuManage(s: GameState, sideIdx: number) {
  const sd = s.sides[sideIdx];
  const ps = sd.team.pitchers;
  const cur = ps[sd.pitcher];
  const free = ps.map((_, i) => i).filter((i) => !sd.used.includes(i));
  const lead = s.score[sideIdx] - s.score[1 - sideIdx];
  const tired = sd.stamina / staminaMax(cur) < 0.12;
  const late = s.inning >= Math.max(2, s.opts.innings - 1);
  const closer = free.find((i) => ps[i].role === "CL");
  if (closer !== undefined && late && lead >= 0 && lead <= 3 && cur.role !== "CL") {
    changePitcher(s, sideIdx, closer);
    return true;
  }
  if (tired || sd.pit[sd.pitcher].r >= 6) {
    const rp = free.find((i) => ps[i].role === "RP") ?? closer;
    if (rp !== undefined) {
      changePitcher(s, sideIdx, rp);
      return true;
    }
  }
  return false;
}

const NPC = ["감독", "주장", "선배", "안경", "후배"];

/** 사용자 차례에 돌발미션 (게임빌 프로야구 그대로: 감독 · 주장 · 선배 …) */
export function maybeMission(s: GameState, rng: Rng): Mission | null {
  if (s.mission || s.over) return null;
  const late = s.inning >= Math.max(2, s.opts.innings - 3);
  const close = Math.abs(s.score[0] - s.score[1]) <= 3;
  const risp = s.bases[1] !== null || s.bases[2] !== null;
  const startScore = s.score[batSide(s)];
  if (userBatting(s)) {
    const p = (risp ? 0.32 : 0.06) + (late && close ? 0.12 : 0);
    if (rng() > p) return null;
    // 인연 특별 미션 (육성 · 덱 캐릭터, 1/3): 그 사람이 키워 주는 쪽을 요구 · 코인 1.5배
    const bc = s.opts.bondChars;
    if (bc?.length && rng() < 0.34) {
      const [id, stat] = rng.pick(bc);
      const who = charById(id).name;
      const base = { who, char: id, untilInningEnd: false, startScore };
      if (stat === "power") return s.bases[0] === null && rng() < 0.4 ? { ...base, kind: "hr", text: "담장 넘겨 봐. 네 힘이면 돼.", pt: 120 } : { ...base, kind: "xbh", text: "장타 하나. 보여 줘.", pt: 75 };
      if (stat === "run" && risp) return { ...base, kind: "rbi", text: "주자 불러들여. 발로 만든 점수!", pt: 45 };
      return risp && rng() < 0.5 ? { ...base, kind: "rbi", text: "한 점만. 네가 해내는 거 보고 싶어.", pt: 45 } : { ...base, kind: "hit", text: "안타 하나만. 나 보고 있어.", pt: 40 };
    }
    const who = rng.pick(NPC);
    if (risp && rng() < 0.55) return { who, kind: "rbi", text: "주자 불러들여! 한 점만 내 봐", pt: 30, untilInningEnd: false, startScore };
    if (s.bases[0] === null && rng() < 0.3) return { who, kind: "hr", text: "여기서 한 방! 홈런 치면 보너스다", pt: 80, untilInningEnd: false, startScore };
    if (rng() < 0.5) return { who, kind: "xbh", text: "장타 하나 부탁해!", pt: 50, untilInningEnd: false, startScore };
    return { who, kind: "hit", text: "안타 하나만 쳐 줘!", pt: 25, untilInningEnd: false, startScore };
  }
  const p = (risp ? 0.28 : 0.05) + (late && close ? 0.1 : 0);
  if (rng() > p) return null;
  const who = rng.pick(NPC);
  if (s.outs === 0 && risp && rng() < 0.5) return { who, kind: "zero", text: "이번 이닝 무실점으로 막아!", pt: 50, untilInningEnd: true, startScore };
  return { who, kind: "k", text: "삼진으로 잡아!", pt: 35, untilInningEnd: false, startScore };
}

/** 경기 MVP (사용자 팀에서) */
export function mvp(s: GameState) {
  const side = s.sides[s.opts.userHome ? 1 : 0];
  let best = { name: "", score: -1, line: "" };
  side.bat.forEach((l, i) => {
    const sc = l.h * 2 + l.hr * 4 + l.rbi * 2 + l.d2 + l.d3 * 2 + l.bb;
    if (sc > best.score) best = { name: side.team.batters[i].name, score: sc, line: `${l.ab}타수 ${l.h}안타${l.hr ? ` ${l.hr}홈런` : ""}${l.rbi ? ` ${l.rbi}타점` : ""}` };
  });
  side.pit.forEach((l, i) => {
    if (!l.pitches) return;
    const sc = l.outs * 0.7 + l.k * 1.2 - l.r * 2;
    if (sc > best.score) best = { name: side.team.pitchers[i].name, score: sc, line: `${Math.floor(l.outs / 3)}${l.outs % 3 ? `.${l.outs % 3}` : ""}이닝 ${l.k}K ${l.r}실점` };
  });
  return best;
}
