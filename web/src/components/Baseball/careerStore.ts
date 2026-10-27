/**
 * 육성 저장 (프로토: 이 브라우저 localStorage) — 진행 중인 선수 1명 + 명예의 전당.
 * 서버 저장은 다음 단계 (랭킹 · 구단으로 넘기기).
 */
import { GP_IDS, applyGame, careerBatter, finishBattle, hofEntry, spUses, type Career, type GameIn, type GameSummary, type HofEntry, type TurnOut } from "@/lib/baseball/career";
import { CHARS, type CharId } from "@/lib/baseball/data";
import { DEFAULT_LOOK } from "@/lib/baseball/look";
import { botHook, careerSetup, playCareerGame, type CareerSetup, type MyPA } from "@/lib/baseball/careerGame";
import { makeRng } from "@/lib/baseball/rng";

const KEY = "pxb:career:v3";
const HOF = "pxb:hof:v1";

/** 예전 저장의 포르테(→ 바이올렛으로 교체) 이름 바꾸기 */
const FORTE: [RegExp, string][] = [
  [/"forte"/g, '"violet"'],
  [/b_forte_tick/g, "b_violet_blind"],
  [/b_forte_music/g, "b_violet_stage"],
  [/b_forte_rewind/g, "b_violet_stretch"],
  [/b_forte_top/g, "b_violet_spin"],
  [/d_soy_forte/g, "d_soy_violet"],
  [/d_forte_lily/g, "d_violet_lily"],
];
const mig = (t: string | null) => (t ? FORTE.reduce((a, [r, v]) => a.replace(r, v), t) : t);

export function loadCareer(): Career | null {
  try {
    const c = JSON.parse(mig(localStorage.getItem(KEY)) ?? "null");
    return c && c.v === 3 ? normalize(c as Career) : null;
  } catch {
    return null;
  }
}
/** 예전 저장에 없던 칸 채우기 (v3 안에서 늘어난 것들) */
function normalize(c: Career): Career {
  c.bcount ??= {};
  c.look ??= { ...DEFAULT_LOOK };
  c.specials ??= [];
  c.know ??= {};
  c.aff ??= {};
  c.blv ??= {};
  c.battle ??= null;
  c.gp = (c.gp ?? []).filter((g) => GP_IDS.includes(g));
  if (!c.gp.length) c.gp = [...GP_IDS];
  return c;
}
export function saveCareer(c: Career | null) {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {}
}

export function loadHof(): HofEntry[] {
  try {
    const h = JSON.parse(mig(localStorage.getItem(HOF)) ?? "[]");
    return Array.isArray(h) ? h : [];
  } catch {
    return [];
  }
}
export function addHof(c: Career) {
  const all = loadHof();
  // 인연 레벨 (판을 넘어 쌓임): 처음 명예의 전당에 오를 때 덱 사람들 호감만큼
  if (!all.some((e) => e.id === c.id)) addBondXp(c);
  const list = all.filter((e) => e.id !== c.id);
  list.push(hofEntry(c));
  list.sort((a, b) => b.ovr - a.ovr);
  try {
    localStorage.setItem(HOF, JSON.stringify(list.slice(0, 30)));
  } catch {}
}

/** 이번 주 경기 세팅 */
export const setupOf = (c: Career): CareerSetup =>
  careerSetup(c.seed, c.season, c.week * 2 + c.gameInWeek, careerBatter(c), c.trust, c.diff, spUses(c));

/* 배속 (육성 화면 · 경기 화면 공용, 이 브라우저) */
const SPEED = "pxb:speed";
export const SPEEDS = [1, 1.5, 2, 3] as const;
export function loadSpeed(): number {
  try {
    const v = Number(localStorage.getItem(SPEED));
    return (SPEEDS as readonly number[]).includes(v) ? v : 1;
  } catch {
    return 1;
  }
}
export function saveSpeed(v: number) {
  try {
    localStorage.setItem(SPEED, String(v));
  } catch {}
}
/** 경기 진행 방식 (기억해 둠) */
export type PlayMode = "direct" | "highlight" | "auto";
const MODE = "pxb:playmode";
export function loadMode(): PlayMode {
  try {
    const v = localStorage.getItem(MODE);
    return v === "direct" || v === "auto" ? v : "highlight";
  } catch {
    return "highlight";
  }
}
export function saveMode(v: PlayMode) {
  try {
    localStorage.setItem(MODE, v);
  } catch {}
}

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

/* ─────────────── 인연 레벨 (판을 넘어 쌓임) ─────────────── */
const BXP = "pxb:bondxp:v1";
/** 레벨당 필요 경험치 · 최대 레벨 · 레벨당 시작 호감 */
export const BOND_LV = { per: 120, max: 6, aff: 5 } as const;
export function loadBondXp(): Partial<Record<CharId, number>> {
  try {
    const v = JSON.parse(mig(localStorage.getItem(BXP)) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
export const bondLevel = (xp: number) => Math.min(BOND_LV.max, Math.floor(xp / BOND_LV.per));
function addBondXp(c: Career) {
  const x = loadBondXp();
  for (const id of c.deck) x[id] = (x[id] ?? 0) + (c.aff[id] ?? 0) + (c.bonds[id] ?? 0) * 5;
  try {
    localStorage.setItem(BXP, JSON.stringify(x));
  } catch {}
}
/** 새 선수 시작 호감 (인연 레벨 × 5) */
export function affStart(): Partial<Record<CharId, number>> {
  const x = loadBondXp();
  const out: Partial<Record<CharId, number>> = {};
  for (const ch of CHARS) out[ch.id] = bondLevel(x[ch.id] ?? 0) * BOND_LV.aff;
  return out;
}

/* ─────────────── 인연 대결 (직접) ─────────────── */
let lastBattle: TurnOut | null = null;
export const takeBattle = () => {
  const r = lastBattle;
  lastBattle = null;
  return r;
};
/** 직접 친 인연 대결 반영 */
export function finishBond(pts: number) {
  const c = loadCareer();
  if (!c || !c.battle) return;
  lastBattle = finishBattle(c, pts);
  saveCareer(c);
}
