/**
 * 육성 저장 (프로토: 이 브라우저 localStorage) — 진행 중인 선수 1명 + 명예의 전당.
 * 서버 저장은 다음 단계 (랭킹 · 구단으로 넘기기).
 */
import { applyGame, careerBatter, hofEntry, type Career, type GameIn, type GameSummary, type HofEntry } from "@/lib/baseball/career";
import { botHook, careerSetup, playCareerGame, type CareerSetup, type MyPA } from "@/lib/baseball/careerGame";
import { makeRng } from "@/lib/baseball/rng";

const KEY = "pxb:career:v1";
const HOF = "pxb:hof:v1";

export function loadCareer(): Career | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return c && c.v === 1 ? (c as Career) : null;
  } catch {
    return null;
  }
}
export function saveCareer(c: Career | null) {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {}
}

export function loadHof(): HofEntry[] {
  try {
    const h = JSON.parse(localStorage.getItem(HOF) ?? "[]");
    return Array.isArray(h) ? h : [];
  } catch {
    return [];
  }
}
export function addHof(c: Career) {
  const list = loadHof().filter((e) => e.id !== c.id);
  list.push(hofEntry(c));
  list.sort((a, b) => b.ovr - a.ovr);
  try {
    localStorage.setItem(HOF, JSON.stringify(list.slice(0, 30)));
  } catch {}
}

/** 이번 주 경기 세팅 */
export const setupOf = (c: Career): CareerSetup => careerSetup(c.seed, c.season, c.week, careerBatter(c), c.trust, c.diff);

/** 경기 끝나고 육성 화면에 띄울 요약 (화면이 바뀌어도 남게 모듈에 둠) */
export interface GameReport {
  sum: GameSummary;
  pas: MyPA[];
  score: string;
  auto: boolean;
  note?: string;
}
let lastReport: GameReport | null = null;
export const takeReport = () => {
  const r = lastReport;
  lastReport = null;
  return r;
};

/** 자동 진행 (또는 직접 출전을 그만둔 경기) */
export function autoGame(c: Career, note?: string): GameReport {
  const st = setupOf(c);
  const g = playCareerGame(st, botHook(c.diff), makeRng((c.seed * 7 + c.turn * 131) >>> 0));
  c.inGame = false;
  const sum = applyGame(c, { line: g.line, win: g.win, missionPt: g.missionPt, missions: g.pas.filter((p) => p.mission?.ok).length, direct: false });
  const s = g.s;
  const r: GameReport = { sum, pas: g.pas, score: `${s.opts.away.short} ${s.score[0]} : ${s.score[1]} ${s.opts.home.short}`, auto: true, note };
  saveCareer(c);
  return r;
}

/** 직접 출전한 경기 반영 */
export function finishDirect(g: GameIn, pas: MyPA[], score: string) {
  const c = loadCareer();
  if (!c || !c.inGame) return;
  c.inGame = false;
  const sum = applyGame(c, g);
  saveCareer(c);
  lastReport = { sum, pas, score, auto: false };
}
