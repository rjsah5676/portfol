/**
 * 육성 저장 (프로토: 이 브라우저 localStorage) — 진행 중인 선수 1명 + 명예의 전당.
 * 서버 저장은 다음 단계 (랭킹 · 구단으로 넘기기).
 */
import { BONDS, CAREER_DIFF, SKILLS, applyGame, careerBatter, finishBattle, gameKey, hofEntry, ovrOf, spUses, type Career, type GameIn, type GameSummary, type HofEntry, type TurnOut } from "@/lib/baseball/career";
import { logPlay } from "@/lib/baseball/telemetry";
import { CHARS, TEAM_DEFS, type CharId } from "@/lib/baseball/data";
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
  c.table ??= TEAM_DEFS.map(() => [0, 0] as [number, number]);
  // 없어진 특수능력 (수비 세트 「골든 글러브」 등) 은 지움
  c.skills = (c.skills ?? []).filter((id) => id in SKILLS);
  // 고르기 · 축복 레벨 · 계승에 남은 없어진 id 도 (남아 있으면 그리다 죽음 — 새로고침해도 계속)
  if (c.pick) c.pick.options = c.pick.options.filter((id) => id in SKILLS);
  for (const k of Object.keys(c.blv)) if (!(k in SKILLS)) delete (c.blv as Record<string, unknown>)[k];
  if (c.legacy?.skill && !(c.legacy.skill in SKILLS)) c.legacy.skill = undefined;
  // 육성 모드 코치는 뺌
  c.gp = [];
  // 육성 난이도는 중급 하나로 통일
  c.diff = CAREER_DIFF;
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
    if (!Array.isArray(h)) return [];
    // 없어진 특수능력 id 는 지움 (계승 고를 때 죽음)
    for (const e of h as HofEntry[]) e.skills = (e.skills ?? []).filter((id) => id in SKILLS);
    return h;
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
  careerSetup(c.seed, c.season, gameKey(c), careerBatter(c), c.trust, c.diff, spUses(c), bondCharsOf(c), c.mood ?? 0);
/** 인연 특별 미션을 줄 덱 캐릭터 (그 사람이 키워 주는 능력치 쪽을 요구) */
export const bondCharsOf = (c: Career): CareerSetup["bondChars"] => c.deck.map((id) => [id, BONDS[id].stat]);
const missionResults = (pas: MyPA[]) => pas.filter((p) => p.mission).map((p) => ({ ok: p.mission!.ok, partial: p.mission!.partial, char: p.mission!.char }));

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

/* ─────────────── 플레이 기록 (관리자 분석용) ─────────────── */
/** 선수 상태 요약 (기록 한 줄에 같이 붙임) */
export function careerSnap(c: Career) {
  return {
    cid: c.id,
    season: c.season,
    week: c.week,
    turn: c.turn,
    type: c.type,
    talent: c.talent,
    diff: c.diff,
    ovr: ovrOf(c),
    stats: { ...c.stats },
    trust: Math.round(c.trust * 10) / 10,
    cond: c.cond,
    stamina: Math.round(c.stamina),
    fame: Math.round(c.fame),
    money: c.money,
    skills: [...c.skills],
    blv: { ...c.blv },
    deck: [...c.deck],
    bonds: { ...c.bonds },
    aff: { ...c.aff },
  };
}
function logGame(c: Career, g: GameIn, sum: GameSummary, mode: "direct" | "auto", pas: MyPA[]) {
  logPlay("game", {
    ...careerSnap(c),
    // 하이라이트는 직접 경기 안에 자동 타석이 섞인 것
    mode: mode === "direct" && pas.some((p) => p.auto) ? "highlight" : mode,
    line: g.line,
    win: g.win,
    grade: sum.grade ?? null,
    missions: g.missions,
    pas: pas.map((p) => ({ k: p.kind, auto: !!p.auto, m: p.mission ? (p.mission.ok ? "ok" : p.mission.partial ? "partial" : "fail") : undefined })),
  });
}

/** 자동 진행 (또는 직접 출전을 그만둔 경기) */
export function autoGame(c: Career, note?: string): GameReport {
  const st = setupOf(c);
  const g = playCareerGame(st, botHook(c.diff), makeRng((c.seed * 7 + c.turn * 131) >>> 0));
  c.inGame = false;
  const gin: GameIn = { line: g.line, win: g.win, missionPt: g.missionPt, missions: g.pas.filter((p) => p.mission?.ok).length, results: missionResults(g.pas), direct: false, clutch: g.clutch };
  const sum = applyGame(c, gin);
  logGame(c, gin, sum, "auto", g.pas);
  const s = g.s;
  // 자동 경기는 타석이 다 자동 (리포트에 「직접」 배지가 붙던 것)
  const r: GameReport = { sum, pas: g.pas.map((p) => ({ ...p, auto: true })), score: `${s.opts.away.short} ${s.score[0]} : ${s.score[1]} ${s.opts.home.short}`, auto: true, note };
  saveCareer(c);
  return r;
}

/** 직접 출전한 경기 반영 */
/** 실수로 누른 경기 시작 취소 (첫 공 전) — 경기 안 한 걸로, 육성 화면(허브)으로 바로 */
let backToHub = false;
export function cancelDirect() {
  const c = loadCareer();
  if (!c || !c.inGame) return;
  c.inGame = false;
  saveCareer(c);
  backToHub = true;
}
export function takeBackToHub() {
  const v = backToHub;
  backToHub = false;
  return v;
}
export function finishDirect(g: GameIn, pas: MyPA[], score: string) {
  const c = loadCareer();
  if (!c || !c.inGame) return;
  c.inGame = false;
  const sum = applyGame(c, { ...g, results: missionResults(pas) });
  logGame(c, g, sum, "direct", pas);
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
